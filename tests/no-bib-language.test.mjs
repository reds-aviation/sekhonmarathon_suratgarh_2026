import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

void test('registration and public policy copy do not promise bibs', async () => {
  const [registration, policies] = await Promise.all([
    readFile(new URL('../components/registration.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../lib/policies.json', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(registration, /\bbib(?:s)?\b/i);
  assert.doesNotMatch(policies, /\bbib(?:s)?\b/i);
});
