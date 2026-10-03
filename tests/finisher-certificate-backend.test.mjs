import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createCertificateHandler, getCertificateAvailability, claimQuota } from "../netlify/functions/certificates/service.mjs";
import { validateCertificateInput, CERTIFICATE_RELEASE_AT, CERTIFICATE_TEMPLATE_VERSION } from "../lib/certificate-contract.mjs";
import { certificateStoreName, createPrivateStoreAdapter } from "../netlify/functions/certificates/index.mjs";

const env = { CERTIFICATES_ENABLED: "true", CERTIFICATE_TEMPLATE_VERSION };
const released = new Date(CERTIFICATE_RELEASE_AT);
const validInput = (overrides = {}) => ({ requestId: randomUUID(), name: "Aman Singh", race: "5", finishTime: "00:30:01", completionDeclared: true, ...overrides });
function memoryStore() {
  const entries = new Map();
  return {
    entries,
    async getJSON(key) { await Promise.resolve(); return entries.get(key) ?? null; },
    async createJSON(key, value) {
      await Promise.resolve();
      if (entries.has(key)) return false;
      entries.set(key, JSON.parse(JSON.stringify(value)));
      return true;
    },
  };
}
function makeRequest(input, options = {}) {
  return new Request("https://sekhonmarathon-suratgarh-2026.netlify.app/.netlify/functions/certificates", {
    method: "POST",
    headers: { Origin: "https://sekhonmarathon-suratgarh-2026.netlify.app", "Content-Type": "application/json", ...options.headers },
    body: typeof input === "string" ? input : JSON.stringify(input),
  });
}
function handlerFor(store, overrides = {}) {
  return createCertificateHandler({ getStore: () => store, env, now: () => released, ...overrides });
}

test("release stays closed until the precise IST release, enabled switch and final template", () => {
  assert.equal(getCertificateAvailability(env, new Date("2026-10-04T04:59:59.999Z")).reason, "scheduled");
  assert.equal(getCertificateAvailability(env, released).available, true);
  assert.equal(getCertificateAvailability({}, released).reason, "disabled");
  assert.equal(getCertificateAvailability({ CERTIFICATES_ENABLED: "true" }, released).reason, "template_not_ready");
  assert.equal(getCertificateAvailability({ ...env, CERTIFICATE_TEMPLATE_VERSION: "wrong" }, released).available, false);
});

test("a pre-release POST is rejected before validation, quota or private storage", async () => {
  const store = memoryStore();
  const handler = handlerFor(store, { now: () => new Date("2026-10-04T04:59:59.999Z") });
  const result = await handler(makeRequest(validInput()), { ip: "198.51.100.51" });
  assert.equal(result.status, 403);
  assert.equal((await result.json()).code, "NOT_RELEASED");
  assert.equal(store.entries.size, 0);
});

test("validation supports Unicode names and rejects unsafe text, impossible timing and missing completion", () => {
  assert.equal(validateCertificateInput(validInput({ name: "  नीरज   O’Connor  " })).value.name, "नीरज O’Connor");
  for (const name of ["", "<script>Aman</script>", "Aman\u202ESingh", "A".repeat(81), "Aman123", "🏃"]) {
    assert.equal(validateCertificateInput(validInput({ name })).valid, false, name);
  }
  for (const finishTime of ["00:00:00", "1:23:45", "00:60:00", "24:00:00", "24:00:01", "25:00:00", "00:01:99", "NaN"]) {
    assert.equal(validateCertificateInput(validInput({ finishTime })).valid, false, finishTime);
  }
  assert.equal(validateCertificateInput(validInput({ finishTime: "23:59:59" })).valid, true);
  assert.equal(validateCertificateInput(validInput({ completionDeclared: false })).valid, false);
  assert.equal(validateCertificateInput(validInput({ race: "2" })).valid, false);
  assert.equal(validateCertificateInput(validInput({ requestId: "guessable" })).valid, false);
});

test("GET exposes availability only, with no participant lookup or cached responses", async () => {
  const store = memoryStore();
  const handler = handlerFor(store);
  const result = await handler(new Request("https://event.test/.netlify/functions/certificates?action=status"));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).available, true);
  assert.match(result.headers.get("Cache-Control"), /no-store/);
  assert.equal(store.entries.size, 0);
  const lookup = await handler(new Request("https://event.test/.netlify/functions/certificates?certificateId=private"));
  assert.equal(lookup.status, 400);
});

test("new certificate saves only supplied certificate fields and explicit provenance", async () => {
  const store = memoryStore();
  const result = await handlerFor(store)(makeRequest(validInput()), { ip: "192.0.2.1" });
  const certificate = await result.json();
  assert.equal(result.status, 201);
  assert.match(certificate.certificateId, /^SEK26-[A-F0-9]{16}$/);
  assert.equal(certificate.issueDate, "2026-10-04");
  assert.equal(certificate.status, "self-declared");
  assert.equal(certificate.timingSource, "self-reported");
  assert.equal(certificate.templateVersion, CERTIFICATE_TEMPLATE_VERSION);
  assert.equal(JSON.stringify([...store.entries]).includes("192.0.2.1"), false);
  assert.equal(JSON.stringify(certificate).includes("requestId"), false);
});

test("concurrent identical requests return one stable issued certificate", async () => {
  const store = memoryStore();
  const handler = handlerFor(store);
  const input = validInput();
  const responses = await Promise.all(Array.from({ length: 20 }, () => handler(makeRequest(input), { ip: "192.0.2.2" })));
  const certificates = await Promise.all(responses.map((response) => response.json()));
  assert.equal(new Set(certificates.map((certificate) => certificate.certificateId)).size, 1);
  assert.equal([...store.entries.keys()].filter((key) => key.startsWith("requests/")).length, 1);
  assert.equal([...store.entries.keys()].filter((key) => key.startsWith("quota/ip/")).length, 1);
  assert.equal([...store.entries.keys()].filter((key) => key.startsWith("quota/day/")).length, 1);
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  const repeat = await handler(makeRequest({ ...input, name: "AMAN SINGH" }), { ip: "192.0.2.2" });
  assert.equal(repeat.status, 200);
  assert.equal((await repeat.json()).name, "Aman Singh");
});

test("same request ID cannot overwrite a certificate with different details", async () => {
  const store = memoryStore();
  const handler = handlerFor(store);
  const input = validInput();
  await handler(makeRequest(input), { ip: "192.0.2.3" });
  const conflict = await handler(makeRequest({ ...input, finishTime: "00:22:00" }), { ip: "192.0.2.3" });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "REQUEST_CONFLICT");
});

test("generated number collisions retry, and reserved numbers are never overwritten", async () => {
  const store = memoryStore();
  const firstId = "SEK26-AAAAAAAAAAAAAAAA";
  store.entries.set(`numbers/${firstId}`, { requestHash: "another-request" });
  let tries = 0;
  const handler = handlerFor(store, { generateId: () => ++tries === 1 ? firstId : "SEK26-BBBBBBBBBBBBBBBB" });
  const result = await handler(makeRequest(validInput()), { ip: "192.0.2.4" });
  assert.equal(result.status, 201);
  assert.equal((await result.json()).certificateId, "SEK26-BBBBBBBBBBBBBBBB");
  assert.equal(store.entries.get(`numbers/${firstId}`).requestHash, "another-request");
  assert.equal(tries, 2);
});

test("quota conditional slots cap concurrent admissions and allow an idempotent claim", async () => {
  const store = memoryStore();
  const claims = await Promise.all(Array.from({ length: 12 }, (_, index) => claimQuota(store, "quota/example", `person${index}`, 3)));
  assert.equal(claims.filter(Boolean).length, 3);
  assert.equal([...store.entries.keys()].length, 3);
  const existingOwner = [...store.entries.values()][0].owner;
  assert.equal(await claimQuota(store, "quota/example", existingOwner, 3), true);
});

test("rate limits do not prevent re-download, reset on next window and are durable across handlers", async () => {
  const store = memoryStore();
  const input = validInput();
  const firstHandler = handlerFor(store, { ipLimit: 1 });
  assert.equal((await firstHandler(makeRequest(input), { ip: "192.0.2.5" })).status, 201);
  const secondHandler = handlerFor(store, { ipLimit: 1 });
  assert.equal((await secondHandler(makeRequest(validInput()), { ip: "192.0.2.5" })).status, 429);
  assert.equal((await secondHandler(makeRequest(input), { ip: "192.0.2.5" })).status, 200);
  const nextWindow = handlerFor(store, { ipLimit: 1, now: () => new Date(released.getTime() + 600000) });
  assert.equal((await nextWindow(makeRequest(validInput()), { ip: "192.0.2.5" })).status, 201);
});

test("500 simultaneous individual downloads keep unique IDs without global quota exhaustion", async () => {
  const store = memoryStore();
  const handler = handlerFor(store);
  const results = await Promise.all(Array.from({ length: 500 }, (_, index) => handler(makeRequest(validInput({ name: `Participant ${String.fromCharCode(65 + index % 26)}`, race: ["5", "10", "21"][index % 3] })), { ip: `198.51.${Math.floor(index / 256)}.${index % 256}` })));
  assert.equal(results.every((result) => result.status === 201), true);
  const certificates = await Promise.all(results.map((result) => result.json()));
  assert.equal(new Set(certificates.map((certificate) => certificate.certificateId)).size, 500);
});

test("500 new certificates on a shared station connection fit the durable quota", async () => {
  const store = memoryStore();
  const handler = handlerFor(store);
  const results = await Promise.all(Array.from({ length: 500 }, (_, index) => handler(makeRequest(validInput({
    requestId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    name: "Station Participant",
  })), { ip: "198.51.100.50" })));
  assert.equal(results.filter((result) => result.status === 201).length, 500);
  assert.equal([...store.entries.keys()].filter((key) => key.startsWith("quota/ip/")).length, 500);
});

test("request protections reject other origins, malformed JSON, oversized data and unsupported methods", async () => {
  const handler = handlerFor(memoryStore());
  assert.equal((await handler(makeRequest(validInput(), { headers: { Origin: "https://other.test" } }))).status, 403);
  assert.equal((await handler(makeRequest("not JSON"))).status, 400);
  assert.equal((await handler(makeRequest("a".repeat(4097)))).status, 413);
  assert.equal((await handler(makeRequest(validInput(), { headers: { "Content-Type": "text/plain" } }))).status, 415);
  assert.equal((await handler(new Request("https://event.test/api/certificates", { method: "DELETE" }))).status, 405);
});

test("GitHub Pages has narrowly scoped status, POST and preflight access", async () => {
  const handler = handlerFor(memoryStore());
  const origin = "https://reds-aviation.github.io";
  const status = await handler(new Request("https://event.test/api/certificates?action=status", { headers: { Origin: origin } }));
  assert.equal(status.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(status.headers.get("Vary"), "Origin");
  assert.equal(status.headers.get("Access-Control-Allow-Credentials"), null);
  const preflight = await handler(new Request("https://event.test/api/certificates", {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  }));
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(preflight.headers.get("Access-Control-Allow-Headers"), "Content-Type");
  assert.match(preflight.headers.get("Vary"), /Origin/);
  const issue = await handler(makeRequest(validInput(), { headers: { Origin: origin, "Sec-Fetch-Site": "cross-site" } }), { ip: "192.0.2.10" });
  assert.equal(issue.status, 201);
  assert.equal(issue.headers.get("Access-Control-Allow-Origin"), origin);
  for (const badOrigin of ["https://evil.test", "https://reds-aviation.github.io.evil.test", "http://reds-aviation.github.io"]) {
    const bad = await handler(new Request("https://event.test/api/certificates", {
      method: "OPTIONS",
      headers: { Origin: badOrigin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    }));
    assert.equal(bad.status, 403);
    assert.equal(bad.headers.get("Access-Control-Allow-Origin"), null);
  }
  const badHeader = await handler(new Request("https://event.test/api/certificates", {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,authorization" },
  }));
  assert.equal(badHeader.status, 403);
});

test("storage outages fail closed without disclosing entered fields or issuing an unpersisted number", async () => {
  const store = { getJSON: async () => { throw new Error("sensitive provider details"); } };
  const response = await handlerFor(store)(makeRequest(validInput()), { ip: "192.0.2.6" });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.equal(body.includes("sensitive"), false);
  assert.equal(body.includes("Aman Singh"), false);
  assert.equal(body.includes("certificateId"), false);
});

test("holding release also prevents replay downloads through the server", async () => {
  const store = memoryStore();
  const input = validInput();
  await handlerFor(store)(makeRequest(input));
  const held = handlerFor(store, { env: { ...env, CERTIFICATES_ENABLED: "false" } });
  assert.equal((await held(makeRequest(input))).status, 403);
});

test("production issuance persists across deploys and preview data stays isolated", () => {
  assert.equal(certificateStoreName({ deploy: { context: "production", id: "first" } }), "sekhon-finisher-2026");
  assert.equal(certificateStoreName({ deploy: { context: "production", id: "second" } }), "sekhon-finisher-2026");
  assert.notEqual(certificateStoreName({ deploy: { context: "deploy-preview", id: "preview" } }), "sekhon-finisher-2026");
  assert.notEqual(certificateStoreName({ deploy: { context: "deploy-preview", id: "one" } }), certificateStoreName({ deploy: { context: "deploy-preview", id: "two" } }));
});

test("Blobs adapter rejects SDK phantom success and unconfirmed writes", async () => {
  const value = { requestHash: "private-request" };
  const phantom = createPrivateStoreAdapter({ setJSON: async () => ({ modified: true, etag: "" }) });
  await assert.rejects(() => phantom.createJSON("numbers/example", value), /Unconfirmed/);
  const missing = createPrivateStoreAdapter({ setJSON: async () => ({ modified: true, etag: '"abc"' }), get: async () => null });
  await assert.rejects(() => missing.createJSON("numbers/example", value), /not durable/);
  const collision = createPrivateStoreAdapter({ setJSON: async () => ({ modified: false }) });
  assert.equal(await collision.createJSON("numbers/example", value), false);
  const optionsSeen = [];
  const durable = createPrivateStoreAdapter({
    setJSON: async (_key, _value, options) => { optionsSeen.push(options); return { modified: true, etag: '"abc"' }; },
    get: async (_key, options) => { optionsSeen.push(options); return value; },
  });
  assert.equal(await durable.createJSON("numbers/example", value), true);
  assert.deepEqual(optionsSeen, [{ onlyIfNew: true }, { type: "json", consistency: "strong" }]);
});
