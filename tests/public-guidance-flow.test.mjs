import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RACE_FEES } from '../lib/race-data.ts';

const root = new URL('../', import.meta.url);

void test('public journey points eligible runners to the official AFNET process', async () => {
  const [guide, registration, eventGuide, routeTimeline, navigationStyles] = await Promise.all([
    readFile(new URL('app/public-guide.tsx', root), 'utf8'),
    readFile(new URL('components/registration-guide.tsx', root), 'utf8'),
    readFile(new URL('components/event-guide.tsx', root), 'utf8'),
    readFile(new URL('components/route-timeline.tsx', root), 'utf8'),
    readFile(new URL('app/app-navigation.css', root), 'utf8'),
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
  assert.match(registration, /during normal working hours/u);
  assert.match(registration, /SI POS receipt number/u);
  assert.match(registration, /Airwarrior completes the[\s\S]*registration through AFNET/u);
  assert.match(registration, /visit Station Sports Section/u);
  assert.match(registration, /not sent or stored/u);
  assert.match(registration, /Have you completed all three steps\?/u);
  assert.match(
    registration,
    /Have you completed the participant registration form on AFNET\?/u,
  );
  assert.match(registration, /Have you paid the applicable fee at Sports Section\?/u);
  assert.match(
    registration,
    /Have you entered the receipt and payment-confirmation details in[\s\S]*the official internal portal\?/u,
  );
  assert.match(
    registration,
    /Based on your answers, you have completed the required[\s\S]*Final payment verification is carried out by[\s\S]*submitted internal records/u,
  );
  assert.match(registration, /This is a self-reported checklist/u);
  assert.match(registration, /does not verify or store registration or payment/u);
  assert.doesNotMatch(registration, /Your registration steps are complete/u);
  assert.doesNotMatch(registration, /\b(fetch|localStorage|sessionStorage)\b/u);

  const generalMobileStart = navigationStyles.lastIndexOf('@media (max-width: 700px)');
  const mobilePathStart = navigationStyles.indexOf(
    '  .registration-path {',
    generalMobileStart,
  );
  const mobilePathEnd = navigationStyles.indexOf(
    '  .registration-steps-panel,',
    mobilePathStart,
  );
  const mobilePathRule = navigationStyles.slice(mobilePathStart, mobilePathEnd);
  assert.match(navigationStyles, /\.registration-path\s*\{[\s\S]{0,300}flex-wrap:\s*wrap/u);
  assert.match(navigationStyles, /\.registration-path-step\s*\{[\s\S]{0,200}white-space:\s*nowrap/u);
  assert.match(mobilePathRule, /justify-content:\s*center/u);
  assert.doesNotMatch(mobilePathRule, /overflow-x|margin-(?:left|right):\s*-/u);
  assert(
    navigationStyles.lastIndexOf('@media (max-width: 359px)') >
      navigationStyles.lastIndexOf('@media (max-width: 700px)'),
    'the narrow-screen registration rule must override the general mobile rule',
  );

  assert.match(eventGuide, /<details className="guide-group" id="faqs">/u);
  assert.match(routeTimeline, /id="route-title" tabIndex=\{-1\}/u);
  assert.match(guide, /const \[anchor, setAnchor\] = useState\(initial\.anchor\)/u);
  assert.match(guide, /document\.getElementById\(anchor\)/u);
  assert.match(guide, /disclosure\.open = true/u);
  assert.match(guide, /focusTarget\.scrollIntoView/u);

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
    assert.match(route, new RegExp(`Turnaround for the ${distance} km category`, 'u'));
  }
  assert.match(route, /illustrative sequence, not a navigation map/iu);
  assert.doesNotMatch(
    route,
    /P&S|AFWWA|Kartavya|MT Section|Gate No\.? 2|Tech Gate|Tower 16/iu,
  );
});
