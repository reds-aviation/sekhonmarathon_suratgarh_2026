import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
void test('shared links identify the current Suratgarh event without overstating registration', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const compactHtml = html.replaceAll(/\s+/g, ' ');

  assert.match(
    compactHtml,
    /<link rel="canonical" href="__SITE_URL__"/,
  );
  assert.match(
    compactHtml,
    /<meta property="og:url" content="__SITE_URL__"/,
  );
  assert.match(
    compactHtml,
    /<meta property="og:title" content="Sekhon IAF Marathon 2026 · Suratgarh"/,
  );
  assert.doesNotMatch(compactHtml, /og:description[^>]+Registration open/i);

  const schemaText = html.match(
    /<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/,
  )?.[1];
  assert.ok(schemaText, 'event schema must be present');
  const schema = JSON.parse(schemaText);
  assert.equal(schema['@type'], 'SportsEvent');
  assert.equal(schema.startDate, '2026-10-04');
  assert.equal(schema.endDate, undefined);
  assert.equal(schema.location.name, 'Air Force Station Suratgarh');
  assert.equal(schema.url, '__SITE_URL__');
});

void test('installed-app shortcuts and calendar downloads retain the confirmed event details', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('public/manifest.webmanifest', root), 'utf8'),
  );
  assert.deepEqual(
    manifest.shortcuts.map(({ url }) => url),
    [
      './#races',
      './#register',
    ],
  );

  const calendar = await readFile(
    new URL('public/sekhon-marathon-2026.ics', root),
  );
  const calendarLines = calendar.toString('utf8').replaceAll('\r\n', '\n').split('\n');
  assert.ok(
    calendarLines.every((line) => Buffer.byteLength(line, 'utf8') <= 75),
    'calendar lines must remain within the iCalendar folding limit',
  );
  const text = calendar.toString('utf8').replace(/\r\n /g, '');
  assert.match(text, /DTSTART:20261003T033000Z/);
  assert.match(text, /DTEND:20261003T080000Z/);
  assert.match(text, /DTSTART;VALUE=DATE:20261004/);
  assert.match(text, /DTEND;VALUE=DATE:20261005/);
  assert.doesNotMatch(text, /Race day runs from/);
  assert.doesNotMatch(
    text,
    /reds-aviation\.github/u,
    'the downloadable calendar must remain host-neutral for GitHub Pages and Netlify',
  );
  assert.match(
    text,
    /In front of SBI Bank\\, inside Air Force Station Suratgarh/,
  );
});
