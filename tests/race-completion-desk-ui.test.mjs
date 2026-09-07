import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const component = new URL(
  '../components/organiser/race-completion-desk.tsx',
  import.meta.url,
);
const stylesheet = new URL(
  '../components/organiser/race-completion-desk.css',
  import.meta.url,
);
const appPage = new URL('../app/page.tsx', import.meta.url);
const participantPortal = new URL('../components/event-portal.tsx', import.meta.url);

test('race completion desk uses only the narrow, capability-gated completion APIs', async () => {
  const source = await readFile(component, 'utf8');

  assert.match(source, /rpc\('completion_desk_queue'/u);
  assert.match(source, /rpc\('record_race_completion'/u);
  assert.match(source, /rpc\('review_race_completion'/u);
  assert.match(source, /p_expected_result_revision/u);
  assert.match(source, /p_request_id/u);
  assert.match(source, /OrganiserMfaSetup/u);
  assert.match(source, /Multi-factor sign-in/u);
  assert.match(source, /can_review_results/u);
  assert.match(source, /canReviewResults/u);
  assert.match(source, /Awaiting administrator review/u);
  assert.match(source, /if \(!canReviewResults\)/u);
  assert.doesNotMatch(source, /rpc\('event_day'/u);
  assert.doesNotMatch(source, /\.from\(/u);
  assert.doesNotMatch(source, /\.storage\./u);
  assert.doesNotMatch(source, /payment-review|payment-receipts|organiser-payment-proof/u);
  assert.doesNotMatch(source, /\bbib(?:s)?\b/ui);
});

test('race completion desk remains legible on phones and respects reduced motion', async () => {
  const source = await readFile(stylesheet, 'utf8');

  assert.match(source, /race-completion-desk__record-fields/u);
  assert.match(source, /@media \(max-width: 620px\)/u);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/u);
});

test('the protected organiser route opens the completion desk instead of the legacy portal', async () => {
  const source = await readFile(appPage, 'utf8');
  const organiserRoute = source.slice(
    source.indexOf("if (portal === 'organiser'"),
    source.indexOf('if (portal && EventPortal)'),
  );

  assert.match(source, /OrganiserRaceCompletionDesk/u);
  assert.match(organiserRoute, /Completion desk/u);
  assert.match(organiserRoute, /<OrganiserRaceCompletionDesk/u);
  assert.doesNotMatch(organiserRoute, /<EventPortal/u);
});

test('the participant portal preserves only participant-safe race-day actions', async () => {
  const source = await readFile(participantPortal, 'utf8');

  const eventDayActions = [...source.matchAll(/p_action:\s*'([^']+)'/gu)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(eventDayActions, ['self_time', 'snapshot']);
  assert.match(source, /onOpenOrganiser/u);
  assert.doesNotMatch(
    source,
    /\b(?:capture_finish|associate_finish|review_result|review_payment|start_clock)\b/u,
  );
});
