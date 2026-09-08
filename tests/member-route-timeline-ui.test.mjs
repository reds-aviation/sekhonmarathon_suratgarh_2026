import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const viewer = new URL('../components/member-route-timeline.tsx', import.meta.url);
const publisher = new URL('../components/organiser/route-timeline-desk.tsx', import.meta.url);
const migration = new URL(
  '../supabase/migrations/202609070015_member_route_timeline.sql',
  import.meta.url,
);
const appPage = new URL('../app/page.tsx', import.meta.url);
const memberRouteStyles = new URL(
  '../components/member-route-timeline.css',
  import.meta.url,
);
const routeDeskStyles = new URL(
  '../components/organiser/route-timeline-desk.css',
  import.meta.url,
);
const organiserStyles = new URL(
  '../components/organiser/payment-review-queue.css',
  import.meta.url,
);

void test('member routes are rendered from invitation-gated data and edited only through narrow route APIs', async () => {
  const [viewerSource, publisherSource, migrationSource, appSource] = await Promise.all([
    readFile(viewer, 'utf8'),
    readFile(publisher, 'utf8'),
    readFile(migration, 'utf8'),
    readFile(appPage, 'utf8'),
  ]);

  assert.match(viewerSource, /rpc\('get_member_route'/u);
  assert.doesNotMatch(viewerSource, /publish_member_route|unpublish_member_route|marathon_private/u);
  assert.match(publisherSource, /rpc\('get_route_publication'/u);
  assert.match(publisherSource, /rpc\('publish_member_route'/u);
  assert.match(publisherSource, /rpc\('unpublish_member_route'/u);
  assert.doesNotMatch(publisherSource, /service_role|marathon_private/u);
  assert.match(publisherSource, /OrganiserMfaSetup/u);
  assert.match(migrationSource, /marathon_private\.is_member\(p_event_id\)/u);
  assert.match(migrationSource, /require_active_capability\(p_event_id, 'route_publisher'\)/u);
  assert.match(migrationSource, /member_route_requests/u);
  assert.match(migrationSource, /Route request ID does not match its original action/u);
  assert.match(migrationSource, /public\.get_route_publication/u);
  assert.match(migrationSource, /public\.unpublish_member_route/u);
  assert.match(appSource, /OrganiserRouteTimelineDesk/u);
});

void test('member route views and organiser route controls retain phone-safe layout rules', async () => {
  const [memberStyles, deskStyles, organiserSource] = await Promise.all([
    readFile(memberRouteStyles, 'utf8'),
    readFile(routeDeskStyles, 'utf8'),
    readFile(organiserStyles, 'utf8'),
  ]);

  assert.match(memberStyles, /grid-template-columns: 22px minmax\(0, 1fr\)/u);
  assert.match(memberStyles, /@media \(max-width: 620px\)/u);
  assert.match(deskStyles, /min-height: 44px/u);
  assert.match(deskStyles, /@media \(max-width: 620px\)[\s\S]*grid-template-columns: 1fr/u);
  assert.match(
    organiserSource,
    /organiser-payment-portal__desk-tabs[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/u,
  );
});
