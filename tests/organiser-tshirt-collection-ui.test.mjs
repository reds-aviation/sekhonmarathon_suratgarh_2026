import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const component = new URL(
  '../components/organiser/tshirt-collection-desk.tsx',
  import.meta.url,
);
const stylesheet = new URL(
  '../components/organiser/tshirt-collection-desk.css',
  import.meta.url,
);

test('organiser T-shirt desk uses narrow, capability-gated APIs only', async () => {
  const source = await readFile(component, 'utf8');

  assert.match(source, /rpc\('tshirt_collection_queue'/u);
  assert.match(source, /rpc\('record_tshirt_collection'/u);
  assert.match(source, /p_registration_id/u);
  assert.match(source, /p_issued_size/u);
  assert.match(source, /p_override_reason/u);
  assert.match(source, /p_request_id/u);
  assert.match(source, /3 October 2026 · 09:00–13:30/u);
  assert.match(source, /In front of SBI Bank, inside the station/u);
  assert.doesNotMatch(source, /\.from\(/u);
  assert.doesNotMatch(source, /\.storage\./u);
  assert.doesNotMatch(source, /\bbib(?:s)?\b/ui);
});

test('organiser T-shirt desk has phone and reduced-motion safeguards', async () => {
  const source = await readFile(stylesheet, 'utf8');

  assert.match(source, /@media \(max-width: 620px\)/u);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(source, /tshirt-collection-desk__record-fields/u);
});
