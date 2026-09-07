import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const component = new URL(
  '../components/organiser/payment-review-queue.tsx',
  import.meta.url,
);
const stylesheet = new URL(
  '../components/organiser/payment-review-queue.css',
  import.meta.url,
);

test('organiser payment desk uses only narrow review APIs', async () => {
  const source = await readFile(component, 'utf8');

  assert.match(source, /rpc\('payment_review_queue'/u);
  assert.match(source, /rpc\('review_payment_attempt'/u);
  assert.match(source, /functions\.invoke\(\s*'organiser-payment-proof'/u);
  assert.match(source, /p_expected_attempt_revision/u);
  assert.match(source, /p_request_id/u);
  assert.match(source, /request_id/u);
  assert.match(source, /Required when asking for a correction/u);
  assert.doesNotMatch(source, /\.from\(/u);
  assert.doesNotMatch(source, /\.storage\./u);
  assert.doesNotMatch(source, /\bbib\b/ui);
});

test('organiser payment desk keeps a phone-safe, reduced-motion layout', async () => {
  const source = await readFile(stylesheet, 'utf8');

  assert.match(source, /@media \(max-width: 620px\)/u);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(source, /payment-review-desk__review-actions/u);
});
