import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  DEFAULT_ROUTE_DISTANCE,
  routeDistanceFromSearch,
} from '../lib/route-selection.ts';
import { parseSiteLocation } from '../lib/site-navigation.ts';

const root = new URL('../', import.meta.url);

test('route links use only approved category values and a safe default', () => {
  assert.equal(DEFAULT_ROUTE_DISTANCE, '5');
  assert.equal(routeDistanceFromSearch(), '5');
  assert.equal(routeDistanceFromSearch('?route=5'), '5');
  assert.equal(routeDistanceFromSearch('?route=10'), '10');
  assert.equal(routeDistanceFromSearch('?route=21'), '21');
  assert.equal(routeDistanceFromSearch('?route=42'), '5');
  assert.equal(routeDistanceFromSearch('?route=5&route=21'), '5');
  assert.deepEqual(parseSiteLocation('#routes'), {
    page: 'guide',
    portal: null,
    anchor: 'routes',
  });
});

test('race selection is carried into the public route guide', async () => {
  const [guide, eventGuide, timeline] = await Promise.all([
    readFile(new URL('app/public-guide.tsx', root), 'utf8'),
    readFile(new URL('components/event-guide.tsx', root), 'utf8'),
    readFile(new URL('components/route-timeline.tsx', root), 'utf8'),
  ]);

  assert.match(guide, /href=\{`\?route=\$\{race\.distance\}#guide`\}/u);
  assert.match(guide, /go\(hashForPage\('guide'\), false, `\?route=\$\{distance\}`\)/u);
  assert.match(guide, /selectedRoute=\{routeDistance\}/u);
  assert.match(guide, /onSelectRoute=\{selectGuideRoute\}/u);
  assert.match(eventGuide, /selectedDistance=\{selectedRoute\}/u);
  assert.match(eventGuide, /onSelectDistance=\{onSelectRoute\}/u);
  assert.match(timeline, /Turnaround for the 5 km category/u);
  assert.match(timeline, /Turnaround for the 10 km category/u);
  assert.match(timeline, /Turnaround for the 21 km category/u);

  const warning = timeline.indexOf('illustrative sequence, not a navigation map');
  const selector = timeline.indexOf('<fieldset className="route-tabs"');
  assert(warning >= 0 && warning < selector, 'route warning must appear before route controls');
});
