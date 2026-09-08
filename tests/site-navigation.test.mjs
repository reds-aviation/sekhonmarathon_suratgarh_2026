import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashForPage,
  hashForPortal,
  parseSiteLocation,
} from '../lib/site-navigation.ts';

test('page fragments round-trip without depending on a hosting base path', () => {
  for (const page of [
    'home',
    'races',
    'register',
    'guide',
    'tribute',
    'gallery',
  ]) {
    assert.equal(hashForPage(page), `#${page}`);
    assert.deepEqual(parseSiteLocation(hashForPage(page)), {
      page,
      portal: null,
    });
  }
});

test('portal fragments round-trip and preserve the caller’s underlying page', () => {
  for (const [portal, hash] of Object.entries({
    participant: '#race-desk',
    organiser: '#organiser',
    verify: '#verify-certificate',
  })) {
    assert.equal(hashForPortal(portal), hash);
    assert.deepEqual(parseSiteLocation(hash), { page: null, portal });
  }
});

test('old section links resolve to the new page while retaining their anchor', () => {
  const aliases = {
    main: 'home',
    legacy: 'tribute',
    running: 'tribute',
    event: 'tribute',
    'race-day': 'guide',
    'how-to-register': 'register',
    faqs: 'guide',
    contact: 'guide',
    'guide-kit': 'guide',
    'race-5': 'races',
    'race-10': 'races',
    'race-21': 'races',
  };
  for (const [anchor, page] of Object.entries(aliases)) {
    assert.deepEqual(parseSiteLocation(`#${anchor}`), {
      page,
      portal: null,
      anchor: anchor === 'faqs' ? 'contact' : anchor,
    });
  }
  assert.deepEqual(parseSiteLocation('#race%2D10'), {
    page: 'races',
    portal: null,
    anchor: 'race-10',
  });
});

test('certificate links take precedence over page and organiser fragments', () => {
  for (const hash of ['', '#races', '#contact', '#organiser', '#unknown']) {
    assert.deepEqual(parseSiteLocation(hash, '?certificate=token-from-qr'), {
      page: null,
      portal: 'verify',
    });
  }
  // Invalid/empty tokens still open the verification form for a useful explanation.
  assert.deepEqual(parseSiteLocation('#home', '?certificate='), {
    page: null,
    portal: 'verify',
  });
  assert.deepEqual(parseSiteLocation('#races', '?notcertificate=123'), {
    page: 'races',
    portal: null,
  });
});

test('empty, unknown and malformed fragments safely resolve home', () => {
  for (const hash of [
    '',
    '#',
    '#missing',
    '#race-42',
    '#%E0%A4%A',
    '#constructor',
    '#__proto__',
  ]) {
    assert.deepEqual(parseSiteLocation(hash), { page: 'home', portal: null });
  }
  assert.deepEqual(parseSiteLocation(), { page: 'home', portal: null });
});
