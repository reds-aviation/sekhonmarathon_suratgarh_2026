import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const registration = new URL('../components/registration.tsx', import.meta.url);
const portal = new URL('../components/event-portal.tsx', import.meta.url);
const registrationStyles = new URL('../app/mobile-polish.css', import.meta.url);
const portalStyles = new URL('../components/event-portal.css', import.meta.url);

test('participants can submit a replacement proof from their entry screens without overwriting history', async () => {
  const [registrationSource, portalSource] = await Promise.all([
    readFile(registration, 'utf8'),
    readFile(portal, 'utf8'),
  ]);

  for (const source of [registrationSource, portalSource]) {
    assert.match(source, /functions\.invoke\(\s*'correct-payment'/u);
    assert.match(source, /correction_id:\s*requestId/u);
    assert.match(source, /crypto\.randomUUID\(\)/u);
    assert.match(source, /replacement proof/u);
    assert.match(source, /(?:remains|stays)\s+on\s+record/u);
    assert.match(source, /image\/jpeg,image\/png/u);
    assert.match(source, /5 \* 1024 \* 1024/u);
    assert.doesNotMatch(source, /\bbib(?:s)?\b/ui);
  }
});

test('payment-correction controls remain usable on a phone', async () => {
  const [registrationCss, portalCss] = await Promise.all([
    readFile(registrationStyles, 'utf8'),
    readFile(portalStyles, 'utf8'),
  ]);

  assert.match(registrationCss, /@media \(max-width: 760px\)/u);
  assert.match(registrationCss, /payment-correction-actions/u);
  assert.match(portalCss, /portal-payment-correction/u);
  assert.match(portalCss, /portal-payment-upload/u);
});
