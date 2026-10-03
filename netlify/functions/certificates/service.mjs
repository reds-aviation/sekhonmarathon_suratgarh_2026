import { createHash, randomBytes } from 'node:crypto';
import {
  CERTIFICATE_DECLARATION,
  CERTIFICATE_ISSUE_DATE,
  CERTIFICATE_RELEASE_AT,
  CERTIFICATE_TEMPLATE_VERSION,
  certificateFingerprint,
  validateCertificateInput,
} from '../../../lib/certificate-contract.mjs';

const RESPONSE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Netlify-CDN-Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const GITHUB_ORIGIN = 'https://reds-aviation.github.io';
function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  return origin === new URL(request.url).origin || origin === GITHUB_ORIGIN
    ? origin
    : null;
}
const response = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...RESPONSE_HEADERS, ...extraHeaders },
  });

export function getCertificateAvailability(env, now = new Date()) {
  const releaseEnabled = env.CERTIFICATES_ENABLED === 'true';
  const templateVersion =
    env.CERTIFICATE_TEMPLATE_VERSION === CERTIFICATE_TEMPLATE_VERSION
      ? env.CERTIFICATE_TEMPLATE_VERSION
      : null;
  const reason = !releaseEnabled
    ? 'disabled'
    : !templateVersion
      ? 'template_not_ready'
      : now.getTime() < Date.parse(CERTIFICATE_RELEASE_AT)
        ? 'scheduled'
        : 'open';
  return {
    available: reason === 'open',
    releaseEnabled,
    releaseAt: CERTIFICATE_RELEASE_AT,
    issueDate: CERTIFICATE_ISSUE_DATE,
    serverTime: now.toISOString(),
    templateVersion,
    reason,
    declaration: CERTIFICATE_DECLARATION,
  };
}

function assertRecord(record, fingerprint) {
  if (!record || record.fingerprint !== fingerprint || !record.certificate) {
    return response(
      {
        error:
          'This request was already used for different details. Please start again.',
        code: 'REQUEST_CONFLICT',
      },
      409,
    );
  }
  return response(record.certificate);
}

// Quotas use independent, immutable slots, avoiding a shared mutable counter.
// Two callers cannot claim the same slot, even in different function instances.
export async function claimQuota(store, prefix, owner, limit) {
  const attempts = Math.min(limit, 64);
  // The same owner takes the same probe path, including during concurrent
  // retries. This prevents one request consuming several quota tickets.
  const seed = sha256(`${prefix}:${owner}`);
  const start = Number.parseInt(seed.slice(0, 8), 16) % limit;
  const step =
    limit === 1
      ? 1
      : (Number.parseInt(seed.slice(8, 16), 16) % (limit - 1)) + 1;
  const checked = new Set();
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let slot = (start + attempt * step) % limit;
    while (checked.has(slot)) slot = (slot + 1) % limit;
    checked.add(slot);
    const key = `${prefix}/${slot}`;
    const existing = await store.getJSON(key);
    if (existing?.owner === owner) return true;
    if (existing) continue;
    const ticket = { owner };
    if (await store.createJSON(key, ticket)) return true;
    if ((await store.getJSON(key))?.owner === owner) return true;
  }
  return false;
}

export function createCertificateHandler({
  getStore,
  env = {},
  now = () => new Date(),
  generateId = () => `SEK26-${randomBytes(8).toString('hex').toUpperCase()}`,
  ipLimit = 600,
  dailyLimit = 3000,
}) {
  const handle = async (request, context = {}) => {
    const currentTime = now();
    const availability = getCertificateAvailability(env, currentTime);
    if (request.method === 'OPTIONS') {
      const requestedHeaders = (
        request.headers.get('Access-Control-Request-Headers') ?? ''
      )
        .split(',')
        .map((header) => header.trim().toLowerCase())
        .filter(Boolean);
      if (
        !allowedOrigin(request) ||
        request.headers.get('Access-Control-Request-Method') !== 'POST' ||
        requestedHeaders.some((header) => header !== 'content-type')
      ) {
        return response(
          { error: 'This origin or request is not allowed.' },
          403,
        );
      }
      return new Response(null, {
        status: 204,
        headers: {
          ...RESPONSE_HEADERS,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '600',
        },
      });
    }
    if (request.method === 'GET') {
      const url = new URL(request.url);
      if (url.search && url.searchParams.get('action') !== 'status') {
        return response(
          { error: 'This endpoint provides certificate availability only.' },
          400,
        );
      }
      return response(availability);
    }
    if (request.method !== 'POST') {
      return response(
        {
          error: 'Use GET for availability or POST to create your certificate.',
        },
        405,
        { Allow: 'GET, POST, OPTIONS' },
      );
    }
    if (!availability.available) {
      return response(
        {
          error:
            availability.reason === 'scheduled'
              ? 'Certificate downloads open at 10:30 a.m. IST on 4 October 2026.'
              : 'Certificate downloads are being prepared. Please check again shortly.',
          code: 'NOT_RELEASED',
          ...availability,
        },
        403,
      );
    }
    const origin = allowedOrigin(request);
    if (
      !origin ||
      (request.headers.get('Sec-Fetch-Site') === 'cross-site' &&
        origin !== GITHUB_ORIGIN)
    ) {
      return response(
        { error: 'Open the certificate page on this website and try again.' },
        403,
      );
    }
    if (
      !/^application\/json(?:\s*;|$)/iu.test(
        request.headers.get('Content-Type') ?? '',
      )
    ) {
      return response({ error: 'Submit certificate details as JSON.' }, 415);
    }
    const contentLength = request.headers.get('Content-Length');
    if (
      contentLength &&
      (!/^\d+$/u.test(contentLength) || Number(contentLength) > 4096)
    ) {
      return response({ error: 'The request is too large.' }, 413);
    }
    let input;
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > 4096)
        return response({ error: 'The request is too large.' }, 413);
      input = JSON.parse(text);
    } catch {
      return response(
        { error: 'Please check your details and try again.' },
        400,
      );
    }
    const validation = validateCertificateInput(input);
    if (!validation.valid)
      return response(
        {
          error: 'Please check the highlighted details.',
          errors: validation.errors,
        },
        400,
      );
    const value = validation.value;
    const owner = sha256(value.requestId);
    const fingerprint = sha256(certificateFingerprint(value));
    const requestKey = `requests/${owner}`;
    try {
      const store = getStore(context);
      const existing = await store.getJSON(requestKey);
      if (existing) return assertRecord(existing, fingerprint);
      // Netlify supplies context.ip; never trust a caller-provided forwarded IP.
      const ip = context.ip || 'unknown';
      const window = Math.floor(currentTime.getTime() / 600000);
      const day = currentTime.toISOString().slice(0, 10);
      const ipKey = sha256(`${env.SITE_ID ?? 'suratgarh'}:${window}:${ip}`);
      if (
        !(await claimQuota(
          store,
          `quota/ip/${window}/${ipKey}`,
          owner,
          ipLimit,
        ))
      ) {
        return response(
          {
            error:
              'This connection has made many certificate requests. Please try again in a few minutes.',
            code: 'RATE_LIMITED',
          },
          429,
          { 'Retry-After': '600' },
        );
      }
      if (!(await claimQuota(store, `quota/day/${day}`, owner, dailyLimit))) {
        return response(
          {
            error:
              'Certificate requests are temporarily limited. Please contact the Sports Section.',
            code: 'RATE_LIMITED',
          },
          429,
          { 'Retry-After': '3600' },
        );
      }
      let certificateId;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = generateId();
        if (!/^SEK26-[A-F0-9]{16}$/u.test(candidate))
          throw new Error('Invalid generated certificate number');
        if (
          await store.createJSON(`numbers/${candidate}`, { requestHash: owner })
        ) {
          certificateId = candidate;
          break;
        }
      }
      if (!certificateId)
        throw new Error('Certificate number reservation unavailable');
      const certificate = {
        certificateId,
        name: value.name,
        race: value.race,
        finishTime: value.finishTime,
        issueDate: CERTIFICATE_ISSUE_DATE,
        issuedAt: currentTime.toISOString(),
        status: 'self-declared',
        timingSource: 'self-reported',
        templateVersion: availability.templateVersion,
      };
      const record = { fingerprint, certificate };
      if (await store.createJSON(requestKey, record))
        return response(certificate, 201);
      // A concurrent retry may have won. Its certificate is the sole issued one.
      // Our losing number reservation remains unavailable and can never repeat.
      return assertRecord(await store.getJSON(requestKey), fingerprint);
    } catch {
      // Do not leak entered details, request identifiers, credentials or IPs.
      return response(
        {
          error:
            'The certificate service is temporarily unavailable. Please try again; your request will not be duplicated.',
          code: 'SERVICE_UNAVAILABLE',
        },
        503,
        { 'Retry-After': '30' },
      );
    }
  };
  return async (request, context = {}) => {
    const result = await handle(request, context);
    const headers = new Headers(result.headers);
    headers.set(
      'Vary',
      request.method === 'OPTIONS'
        ? 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers'
        : 'Origin',
    );
    const origin = allowedOrigin(request);
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    // Deliberately omit credentials support. No cookie or login is involved.
    return new Response(result.body, { status: result.status, headers });
  };
}
