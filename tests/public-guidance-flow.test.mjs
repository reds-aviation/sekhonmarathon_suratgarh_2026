import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RACE_FEES } from '../lib/race-data.ts';

const root = new URL('../', import.meta.url);

void test('public journey points eligible runners to the official AFNET process', async () => {
  const [guide, registration, eventGuide] = await Promise.all([
    readFile(new URL('app/public-guide.tsx', root), 'utf8'),
    readFile(new URL('components/registration-guide.tsx', root), 'utf8'),
    readFile(new URL('components/event-guide.tsx', root), 'utf8'),
  ]);

  assert.deepEqual(RACE_FEES, { 5: 200, 10: 250, 21: 250 });

  const orderedSteps = [
    'Connect to AFNET',
    'Open AFND',
    'Open the marathon link',
    'Select HQ WAC',
    'Complete the form',
    'Pay at Sports Section',
    'Confirm the payment',
  ];
  let previous = -1;
  for (const step of orderedSteps) {
    const position = registration.indexOf(step);
    assert(position > previous, `${step} must appear in the correct order`);
    previous = position;
  }

  assert.match(registration, /www\.afnd\.iaf\.in/u);
  assert.doesNotMatch(registration, /href=["'{][^\n]*afnd\.iaf\.in/iu);
  assert.match(registration, /SI POS machine/u);
  assert.match(registration, /not sent or stored/u);
  assert.match(registration, /Have you registered on the official AFNET form\?/u);
  assert.match(registration, /Have you paid the registration fee\?/u);
  assert.doesNotMatch(registration, /\b(fetch|localStorage|sessionStorage)\b/u);

  assert.doesNotMatch(
    guide,
    /My entry|Register in secure app|Organiser access|Verify a certificate/iu,
  );
  assert.match(
    guide,
    /Developed by Flt Lt Balaram Reddy, OIC Sports and Adv/u,
  );
  assert.match(eventGuide, /Reporting and flag-off timings to be announced/u);
  assert.match(
    eventGuide,
    /All registered participants will receive an event T-shirt and medal/u,
  );
});

void test('public route graphic remains illustrative and excludes internal landmarks', async () => {
  const route = await readFile(
    new URL('components/route-timeline.tsx', root),
    'utf8',
  );

  for (const distance of ['5', '10', '21']) {
    assert.match(route, new RegExp(`'${distance}': \\{`, 'u'));
    assert.match(route, new RegExp(`${distance} KM turnaround`, 'u'));
  }
  assert.match(route, /illustrative sequence, not a navigation map/iu);
  assert.doesNotMatch(
    route,
    /P&S|AFWWA|Kartavya|MT Section|Gate No\.? 2|Tech Gate|Tower 16/iu,
  );
});
