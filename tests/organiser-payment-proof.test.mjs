import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const sourceUrl = new URL('../supabase/functions/organiser-payment-proof/index.ts', import.meta.url);
const configUrl = new URL('../supabase/config.toml', import.meta.url);

test('organiser payment proof issues only a short, capability-authorized receipt link', async () => {
  const [source, config] = await Promise.all([
    readFile(sourceUrl, 'utf8'),
    readFile(configUrl, 'utf8'),
  ]);

  assert.match(config, /\[functions\.organiser-payment-proof\][\s\S]*?verify_jwt\s*=\s*false/);
  assert.match(source, /const EVENT_ID = 'suratgarh-2026'/);
  assert.match(source, /const SIGNED_URL_TTL_SECONDS = 60/);
  assert.doesNotMatch(source, /Access-Control-Allow-Origin['"]?\s*[:=]\s*['"]\*/);
  assert.match(source, /if \(origin !== SITE_ORIGIN\)/);
  assert.match(source, /parsed\.protocol === 'https:' && parsed\.origin === candidate/);
  assert.match(source, /request\.method !== 'POST'/);
  assert.match(source, /startsWith\('application\/json'\)/);
  assert.match(source, /payment_attempt_id/);
  assert.match(source, /request_id/);
  assert.match(source, /UUID\.test\(value\.payment_attempt_id\)/);
  assert.match(source, /userClient\.auth\.getUser\(token\)/);
  assert.match(source, /userClient\.rpc\(\s*'authorize_payment_receipt'/);
  assert.match(source, /p_event_id: EVENT_ID/);
  assert.match(source, /\.from\(authorized\.storage_bucket\)\s*\.createSignedUrl\(authorized\.receipt_path, SIGNED_URL_TTL_SECONDS\)/);

  const authorizeIndex = source.indexOf("'authorize_payment_receipt'");
  const signIndex = source.indexOf('.createSignedUrl(');
  assert.ok(authorizeIndex >= 0 && signIndex > authorizeIndex, 'receipt signing must follow database authorization');

  const finalResponse = source.slice(source.lastIndexOf('return json({'));
  assert.match(finalResponse, /signed_url: signed\.signedUrl/);
  assert.match(finalResponse, /expires_in: SIGNED_URL_TTL_SECONDS/);
  assert.match(finalResponse, /payment_attempt_id: authorized\.payment_attempt_id/);
  assert.match(finalResponse, /attempt_revision: authorized\.attempt_revision/);
  assert.doesNotMatch(finalResponse, /receipt_path|storage_bucket|registration_id|full_name|email|mobile/);
});
