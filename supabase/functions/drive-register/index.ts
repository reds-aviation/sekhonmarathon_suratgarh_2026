// Private server-to-server organiser mirror. This endpoint intentionally sends
// no CORS headers and accepts only short-lived HMAC-authenticated requests from
// the standalone Google Apps Script integration.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.115.0';

const EVENT_ID = 'suratgarh-2026';
const HMAC_AUDIENCE = 'drive-register';
const MAX_REQUEST_BYTES = 8192;
const MAX_CLOCK_SKEW_SECONDS = 300;
const SIGNED_URL_TTL_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(url, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});
const encoder = new TextEncoder();

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
});

const bytesToHex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

async function sha256Hex(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function hmacSha256Hex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign'],
  );
  return bytesToHex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

function fixedHexBytes(value: string | null) {
  const text = value ?? '';
  const bytes = new Uint8Array(32);
  let valid = text.length === 64;
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = text.slice(index * 2, index * 2 + 2);
    const parsed = Number.parseInt(pair, 16);
    if (!/^[0-9a-f]{2}$/i.test(pair)) valid = false;
    bytes[index] = Number.isNaN(parsed) ? 0 : parsed;
  }
  return {bytes, valid};
}

function timingSafeEqualHex(candidate: string | null, expected: string) {
  const left = fixedHexBytes(candidate);
  const right = fixedHexBytes(expected);
  let difference = (left.valid ? 0 : 1) | (right.valid ? 0 : 1);
  for (let index = 0; index < left.bytes.length; index += 1) {
    difference |= left.bytes[index] ^ right.bytes[index];
  }
  return difference === 0;
}

function asInteger(value: unknown, minimum: number, maximum: number) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : null;
}

function requestMessage(timestamp: string, nonce: string, raw: string) {
  return ['POST', HMAC_AUDIENCE, timestamp, nonce, raw].join('\n');
}

async function claimRequest(nonce: string, timestamp: number, raw: string, action: string) {
  const {error} = await admin.rpc('claim_drive_mirror_nonce', {
    p_nonce: nonce,
    p_timestamp_epoch: timestamp,
    p_request_digest_sha256: await sha256Hex(raw),
    p_action: action,
  });
  return error;
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({error: 'Method not allowed.'}, 405);
  // Apps Script does not send a browser Origin. Rejecting one makes accidental
  // browser exposure fail closed even if a future caller tries to add CORS.
  if (request.headers.get('Origin')) return json({error: 'Private mirror only.'}, 403);
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return json({error: 'Invalid request.'}, 400);
  }
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_REQUEST_BYTES)) {
    return json({error: 'Request too large.'}, 413);
  }

  const raw = await request.text();
  if (encoder.encode(raw).byteLength > MAX_REQUEST_BYTES) {
    return json({error: 'Request too large.'}, 413);
  }

  const timestampHeader = request.headers.get('X-Drive-Mirror-Timestamp');
  const nonce = request.headers.get('X-Drive-Mirror-Nonce');
  const signature = request.headers.get('X-Drive-Mirror-Signature');
  if (!timestampHeader || !/^\d{10}$/.test(timestampHeader) || !nonce || !UUID.test(nonce)) {
    return json({error: 'Unauthorised.'}, 401);
  }
  const timestamp = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    return json({error: 'Unauthorised.'}, 401);
  }
  const secret = Deno.env.get('DRIVE_MIRROR_HMAC_SECRET');
  if (!secret || secret.length < 32) return json({error: 'Private mirror is unavailable.'}, 503);
  const expectedSignature = await hmacSha256Hex(secret, requestMessage(timestampHeader, nonce, raw));
  if (!timingSafeEqualHex(signature, expectedSignature)) {
    return json({error: 'Unauthorised.'}, 401);
  }

  let body: Record<string, unknown>;
  try {
    const candidate = JSON.parse(raw);
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('Invalid body');
    body = candidate as Record<string, unknown>;
  } catch {
    return json({error: 'Invalid request.'}, 400);
  }
  const action = body.action;
  if (action !== 'sync' && action !== 'receipt') return json({error: 'Invalid request.'}, 400);

  // The private database claim makes a valid request nonce single-use. Do this
  // before every read or signed URL operation, so replay never returns data.
  const claimError = await claimRequest(nonce, timestamp, raw, action);
  if (claimError) return json({error: 'Unauthorised.'}, 401);

  if (action === 'sync') {
    const afterSourceRevision = body.after_source_revision === undefined
      ? 0
      : asInteger(body.after_source_revision, 0, Number.MAX_SAFE_INTEGER);
    const limit = body.limit === undefined ? 50 : asInteger(body.limit, 1, 100);
    if (afterSourceRevision === null || limit === null) return json({error: 'Invalid request.'}, 400);
    const {data, error} = await admin.rpc('drive_mirror_batch', {
      p_event_id: EVENT_ID,
      p_after_source_revision: afterSourceRevision,
      p_limit: limit,
    });
    if (error || !data) return json({error: 'Private mirror is unavailable.'}, 503);
    return json(data);
  }

  const paymentAttemptId = body.payment_attempt_id;
  if (typeof paymentAttemptId !== 'string' || !UUID.test(paymentAttemptId)) {
    return json({error: 'Invalid request.'}, 400);
  }
  const {data: authorized, error: authorizeError} = await admin.rpc('drive_mirror_receipt', {
    p_event_id: EVENT_ID,
    p_payment_attempt_id: paymentAttemptId,
  });
  if (authorizeError || !authorized
      || authorized.storage_bucket !== 'payment-receipts'
      || typeof authorized.receipt_path !== 'string') {
    return json({error: 'Private receipt is unavailable.'}, 404);
  }
  const {data: signed, error: signError} = await admin.storage
    .from(authorized.storage_bucket)
    .createSignedUrl(authorized.receipt_path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) return json({error: 'Private receipt is unavailable.'}, 503);
  return json({payment_attempt_id: paymentAttemptId, signed_url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SECONDS});
});
