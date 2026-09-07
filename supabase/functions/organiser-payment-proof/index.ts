import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.115.0';

const EVENT_ID = 'suratgarh-2026';
const RECEIPT_BUCKET = 'payment-receipts';
const SIGNED_URL_TTL_SECONDS = 60;
const MAX_REQUEST_BYTES = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const RECEIPT_PATH = new RegExp(
  `^${UUID_SEGMENT}/(?:${UUID_SEGMENT}|payment-corrections/${UUID_SEGMENT}/${UUID_SEGMENT})/receipt\\.(?:jpg|png)$`,
  'i',
);

type ProofRequest = {
  payment_attempt_id: string;
  request_id: string;
};

type ReceiptAuthorization = {
  payment_attempt_id: string;
  storage_bucket: typeof RECEIPT_BUCKET;
  receipt_path: string;
  attempt_revision: number;
};

class RequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function configuredSiteOrigin(): string | null {
  const candidate = Deno.env.get('SITE_ORIGIN')?.trim() ?? '';
  if (!candidate || candidate.includes('*')) return null;

  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' && parsed.origin === candidate ? candidate : null;
  } catch {
    return null;
  }
}

const SITE_ORIGIN = configuredSiteOrigin();

function responseHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  };

  if (SITE_ORIGIN && origin === SITE_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = SITE_ORIGIN;
    headers['Access-Control-Allow-Headers'] = 'authorization, x-client-info, apikey, content-type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  }

  return headers;
}

function json(data: unknown, status: number, origin: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders(origin),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isProofRequest(value: unknown): value is ProofRequest {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length === 2
    && keys.every(key => key === 'payment_attempt_id' || key === 'request_id')
    && typeof value.payment_attempt_id === 'string'
    && typeof value.request_id === 'string'
    && UUID.test(value.payment_attempt_id)
    && UUID.test(value.request_id);
}

function isReceiptAuthorization(value: unknown, attemptId: string): value is ReceiptAuthorization {
  return isRecord(value)
    && value.payment_attempt_id === attemptId
    && value.storage_bucket === RECEIPT_BUCKET
    && typeof value.receipt_path === 'string'
    && RECEIPT_PATH.test(value.receipt_path)
    && typeof value.attempt_revision === 'number'
    && Number.isSafeInteger(value.attempt_revision)
    && value.attempt_revision >= 1;
}

async function readProofRequest(request: Request): Promise<ProofRequest> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new RequestError(415, 'Send a JSON request.');
  }

  const contentLength = request.headers.get('Content-Length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_REQUEST_BYTES)) {
    throw new RequestError(413, 'Request too large.');
  }

  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, 'Invalid request.');

  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new RequestError(413, 'Request too large.');
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError(400, 'Invalid request.');
  }

  if (!isProofRequest(parsed)) throw new RequestError(400, 'Invalid request.');
  return parsed;
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin') ?? '';
  if (!SITE_ORIGIN) {
    return json({ error: 'Payment proof is temporarily unavailable.' }, 503, origin);
  }
  if (origin !== SITE_ORIGIN) return json({ error: 'Origin not allowed.' }, 403, origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, origin);

  const authorization = request.headers.get('Authorization') ?? '';
  const token = /^Bearer\s+([^\s]+)$/i.exec(authorization)?.[1];
  if (!token) return json({ error: 'Sign in to review payment proof.' }, 401, origin);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'Payment proof is temporarily unavailable.' }, 503, origin);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser(token);
  if (authError || !user?.id || !user.email_confirmed_at || user.is_anonymous) {
    return json({ error: 'Verified email sign-in is required.' }, 401, origin);
  }

  let payload: ProofRequest;
  try {
    payload = await readProofRequest(request);
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status, origin);
    return json({ error: 'Invalid request.' }, 400, origin);
  }

  const { data: authorized, error: authorizationError } = await userClient.rpc(
    'authorize_payment_receipt',
    {
      p_event_id: EVENT_ID,
      p_attempt_id: payload.payment_attempt_id,
      p_request_id: payload.request_id,
    },
  );
  if (authorizationError || !isReceiptAuthorization(authorized, payload.payment_attempt_id)) {
    // The database applies verified-email, MFA and organiser-capability checks,
    // and records a successful authorization in the private audit trail.
    return json({ error: 'Payment screenshot is not available for your account.' }, 403, origin);
  }

  // The service key is used only after the caller-specific RPC has authorized
  // this exact private object. Neither a storage path nor a bucket comes from
  // the browser request.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signed, error: signError } = await admin.storage
    .from(authorized.storage_bucket)
    .createSignedUrl(authorized.receipt_path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    return json({ error: 'Payment screenshot is temporarily unavailable.' }, 503, origin);
  }

  return json({
    signed_url: signed.signedUrl,
    expires_in: SIGNED_URL_TTL_SECONDS,
    payment_attempt_id: authorized.payment_attempt_id,
    attempt_revision: authorized.attempt_revision,
  }, 200, origin);
});
