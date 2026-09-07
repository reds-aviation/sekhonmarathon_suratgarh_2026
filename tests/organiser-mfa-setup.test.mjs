import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const setup = new URL(
  '../components/organiser/mfa-setup.tsx',
  import.meta.url,
);
const styles = new URL(
  '../components/organiser/mfa-setup.css',
  import.meta.url,
);
const desk = new URL(
  '../components/organiser/payment-review-queue.tsx',
  import.meta.url,
);

test('organiser MFA enrols and challenges TOTP without rendering setup secrets', async () => {
  const source = await readFile(setup, 'utf8');

  assert.match(source, /getAuthenticatorAssuranceLevel\(\)/u);
  assert.match(source, /mfa\.listFactors\(\)/u);
  assert.match(source, /mfa\.enroll\(\{[\s\S]*factorType: 'totp'/u);
  assert.match(source, /mfa\.challengeAndVerify\(/u);
  assert.match(source, /autoComplete="one-time-code"/u);
  assert.match(source, /inputMode="numeric"/u);
  assert.match(source, /currentLevel === 'aal2'/u);
  assert.doesNotMatch(source, /\.totp\.secret/u);
  assert.doesNotMatch(source, /console\./u);
  assert.doesNotMatch(source, /\bbib\b/ui);
});

test('payment records remain gated until the authenticated session reaches AAL2', async () => {
  const source = await readFile(desk, 'utf8');

  assert.match(source, /mfaAssurance !== 'aal2'/u);
  assert.match(source, /mfaAssurance === 'aal2'/u);
  assert.match(source, /<OrganiserMfaSetup/u);
  assert.match(source, /onAssuranceChange=\{handleMfaAssurance\}/u);
});

test('organiser MFA is phone-safe and honours reduced motion', async () => {
  const source = await readFile(styles, 'utf8');

  assert.match(source, /@media \(max-width: 620px\)/u);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(source, /organiser-mfa__qr/u);
});
