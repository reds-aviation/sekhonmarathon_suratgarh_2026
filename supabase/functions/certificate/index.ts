import { createClient } from '@supabase/supabase-js';
import { renderCertificate } from './render.ts';

const MAX_REQUEST_BYTES = 2048;
const CERTIFICATE_URL_TTL_SECONDS = 120;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function configuredSiteOrigin(value: string | undefined): string {
  if (!value) throw new Error('SITE_ORIGIN must be configured as an HTTPS origin.');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('SITE_ORIGIN must be configured as an HTTPS origin.');
  }
  if (
    parsed.protocol !== 'https:'
    || parsed.username
    || parsed.password
    || parsed.pathname !== '/'
    || parsed.search
    || parsed.hash
  ) {
    throw new Error('SITE_ORIGIN must be an HTTPS origin without a path.');
  }
  return parsed.origin;
}

const siteOrigin = configuredSiteOrigin(Deno.env.get('SITE_ORIGIN'));
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function cors(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': siteOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
  if (origin !== siteOrigin) delete headers['Access-Control-Allow-Origin'];
  return headers;
}

function json(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), { status, headers: cors(origin) });
}

function tokenAssurance(token: string): 'aal1' | 'aal2' {
  try {
    const segment = token.split('.')[1];
    if (!segment) return 'aal1';
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/').padEnd(
      Math.ceil(segment.length / 4) * 4,
      '=',
    );
    const payload = JSON.parse(atob(padded)) as { aal?: unknown };
    return payload.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
  }
}

function validRequest(value: unknown): value is { registration_id: string; kind: 'completion' | 'participation' } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  return typeof body.registration_id === 'string'
    && UUID.test(body.registration_id)
    && (body.kind === 'completion' || body.kind === 'participation')
    && Object.keys(body).every(key => key === 'registration_id' || key === 'kind');
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') ?? '';
  if (origin && origin !== siteOrigin) return json({ error: 'Origin not allowed.' }, 403, origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);

  const authorization = request.headers.get('Authorization') ?? '';
  const token = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
  if (!token) return json({ error: 'Sign in to download your certificate.' }, 401, origin);

  const { data: { user }, error: authError } = await admin.auth.getUser(token);
  if (authError || !user?.id || !user.email_confirmed_at || user.is_anonymous) {
    return json({ error: 'Verified email sign-in is required.' }, 401, origin);
  }
  // getUser above verifies this access token before the decoded assurance claim
  // is passed to the service-role certificate preparation RPC.
  const actorAssurance = tokenAssurance(token);

  let body: unknown;
  try {
    const declaredLength = request.headers.get('Content-Length');
    if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_REQUEST_BYTES)) {
      return json({ error: 'Request too large.' }, 413, origin);
    }
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) return json({ error: 'Request too large.' }, 413, origin);
    body = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid request.' }, 400, origin);
  }
  if (!validRequest(body)) return json({ error: 'Choose a registration and certificate type.' }, 400, origin);

  const { data: context, error: contextError } = await admin.rpc('prepare_certificate_backend', {
    p_actor: user.id,
    p_actor_aal: actorAssurance,
    p_registration: body.registration_id,
    p_kind: body.kind,
  });
  if (contextError || !context) {
    const denied = contextError?.code === '42501';
    return json({
      error: denied
        ? 'Registration access denied.'
        : 'Certificate is not ready. A valid result and approved certificate setup are required.',
    }, denied ? 403 : 409, origin);
  }

  let certificate = context.certificate;
  try {
    if (certificate.status !== 'ready') {
      const [{ data: signature, error: signatureError }, { data: font, error: fontError }] = await Promise.all([
        admin.storage.from('certificate-signatures').download(context.signature_object_path),
        admin.storage.from('certificate-fonts').download(context.font_object_path),
      ]);
      if (
        signatureError || fontError || !signature || !font
        || signature.size > 2097152 || font.size > 10485760
      ) {
        return json({ error: 'Approved certificate assets are unavailable. Contact the organising team.' }, 409, origin);
      }

      let fallbackFontBytes: Uint8Array | undefined;
      if (context.fallback_font_object_path) {
        const { data: fallback, error: fallbackError } = await admin.storage
          .from('certificate-fonts')
          .download(context.fallback_font_object_path);
        if (fallbackError || !fallback || fallback.size > 10485760) {
          return json({ error: 'The approved certificate font is unavailable.' }, 409, origin);
        }
        fallbackFontBytes = new Uint8Array(await fallback.arrayBuffer());
      }

      let pdf = await renderCertificate({
        number: certificate.certificate_number,
        kind: certificate.kind,
        verificationUrl: context.verification_url,
        snapshot: certificate.snapshot,
        signature: new Uint8Array(await signature.arrayBuffer()),
        fontBytes: new Uint8Array(await font.arrayBuffer()),
        fallbackFontBytes,
      });
      const path = `${certificate.registration_id}/${certificate.id}.pdf`;
      const { error: uploadError } = await admin.storage.from('event-certificates').upload(path, pdf, {
        contentType: 'application/pdf',
        upsert: false,
      });
      if (uploadError) {
        // A retry may have uploaded the same immutable certificate already.
        const { data: existing, error: existingError } = await admin.storage
          .from('event-certificates')
          .download(path);
        if (existingError || !existing) throw new Error('Private certificate storage unavailable');
        pdf = new Uint8Array(await existing.arrayBuffer());
      }

      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pdf)))
        .map(value => value.toString(16).padStart(2, '0'))
        .join('');
      const { data: completed, error: completionError } = await admin.rpc('complete_certificate_backend', {
        p_certificate: certificate.id,
        p_sha256: hash,
      });
      if (completionError || !completed) {
        return json({ error: 'The result changed while generating the certificate. Refresh your entry before trying again.' }, 409, origin);
      }
      certificate = completed;
    }

    const { data: signed, error: signError } = await admin.storage
      .from('event-certificates')
      .createSignedUrl(certificate.object_path, CERTIFICATE_URL_TTL_SECONDS, {
        download: `${certificate.certificate_number}.pdf`,
      });
    if (signError || !signed) throw new Error('Download unavailable');
    return json({
      certificate_number: certificate.certificate_number,
      download_url: signed.signedUrl,
      expires_in: CERTIFICATE_URL_TTL_SECONDS,
      verification_url: context.verification_url,
      signature_type: 'approved visual facsimile',
    }, 200, origin);
  } catch {
    return json({
      error: 'Certificate generation could not finish. Your result remains saved; please retry or contact the organising team.',
    }, 503, origin);
  }
});
