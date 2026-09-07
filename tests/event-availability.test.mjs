import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGISTRATION_DEADLINE,
  resolveEventAvailability,
  resolveConfirmedRaceFees,
} from '../lib/event-availability.ts';

const now = Date.parse('2026-09-05T12:00:00+05:30');
const ready = {
  id: 'suratgarh-2026',
  registration_open: true,
  payment_configured: true,
  registration_deadline: REGISTRATION_DEADLINE,
  payment_qr_url: 'https://example.com/approved-qr.png',
  payee_name: 'Test organiser',
  upi_id: 'test@example',
  contact_phone: null,
  contact_email: null,
};
const raceConfig = [
  { event_id: ready.id, race: '5', fee_paise: 39900 },
  { event_id: ready.id, race: '10', fee_paise: 49900 },
  { event_id: ready.id, race: '21', fee_paise: 49900 },
];

test('unconfigured preview is upcoming before its deadline, then closes', () => {
  assert.equal(resolveEventAvailability(null, { now }), 'upcoming');
  assert.equal(
    resolveEventAvailability(null, {
      now: Date.parse(REGISTRATION_DEADLINE) + 1,
    }),
    'closed',
  );
});

test('loading and unreadable live settings cannot advertise open registration', () => {
  assert.equal(
    resolveEventAvailability(ready, { now, loading: true }),
    'loading',
  );
  assert.equal(
    resolveEventAvailability(ready, { now, failed: true }),
    'unavailable',
  );
  assert.equal(
    resolveEventAvailability(null, { now, failed: true }),
    'unavailable',
  );
});

test('only enabled registration with a complete payment configuration opens', () => {
  assert.equal(resolveEventAvailability(ready, { now, raceConfig }), 'open');
  assert.equal(
    resolveEventAvailability({ ...ready, registration_open: false }, { now }),
    'upcoming',
  );
  assert.equal(
    resolveEventAvailability({ ...ready, payment_configured: false }, { now }),
    'upcoming',
  );
  for (const missing of [
    { payment_qr_url: null },
    { payment_qr_url: 'http://example.com/qr.png' },
    {
      payment_qr_url:
        'https://reds-aviation.github.io/sekhonmarathon_suratgarh_2026/assets/payment-placeholder.svg?preview=1',
    },
    { payee_name: '  ' },
    { upi_id: null },
  ]) {
    assert.equal(
      resolveEventAvailability({ ...ready, ...missing }, { now, raceConfig }),
      'unavailable',
    );
  }
});

test('deadline closes new entries regardless of open flags or incomplete payment details', () => {
  const afterDeadline = Date.parse(REGISTRATION_DEADLINE) + 1;
  for (const config of [
    ready,
    { ...ready, registration_open: false },
    { ...ready, payment_qr_url: null },
  ]) {
    assert.equal(
      resolveEventAvailability(config, { now: afterDeadline }),
      'closed',
    );
  }
});

test('configured deadline takes precedence over the public preview date', () => {
  assert.equal(
    resolveEventAvailability(
      { ...ready, registration_deadline: '2026-09-01T23:59:59+05:30' },
      { now },
    ),
    'closed',
  );
});

test('exact deadline boundary agrees with the database inclusive deadline', () => {
  const deadline = Date.parse(REGISTRATION_DEADLINE);
  assert.equal(
    resolveEventAvailability(ready, { now: deadline, raceConfig }),
    'open',
  );
  assert.equal(
    resolveEventAvailability(ready, { now: deadline + 1 }),
    'closed',
  );
});

test('confirmed fees reflect backend prices even when they differ from planned values', () => {
  const updated = raceConfig.map((row) => ({
    ...row,
    fee_paise: { 5: 65000, 10: 92550, 21: 110000 }[row.race],
  }));
  assert.deepEqual(resolveConfirmedRaceFees(raceConfig), {
    5: 399,
    10: 499,
    21: 499,
  });
  assert.deepEqual(resolveConfirmedRaceFees(updated), {
    5: 650,
    10: 925.5,
    21: 1100,
  });
  assert.equal(
    resolveEventAvailability(ready, { now, raceConfig: updated }),
    'open',
  );
  assert.deepEqual(resolveConfirmedRaceFees([...updated].reverse()), {
    5: 650,
    10: 925.5,
    21: 1100,
  });
});

test('missing, duplicate, extra and wrong-event price rows fail closed', () => {
  for (const rows of [
    null,
    [],
    raceConfig.slice(0, 2),
    [raceConfig[0], raceConfig[0], raceConfig[2]],
    [...raceConfig, { event_id: ready.id, race: '42', fee_paise: 90000 }],
    raceConfig.map((row) =>
      row.race === '10' ? { ...row, event_id: 'another-event' } : row,
    ),
    raceConfig.map((row) => (row.race === '10' ? { ...row, race: '42' } : row)),
  ]) {
    assert.equal(resolveConfirmedRaceFees(rows), null);
    assert.equal(
      resolveEventAvailability(ready, { now, raceConfig: rows }),
      'unavailable',
    );
  }
  assert.equal(resolveEventAvailability(ready, { now }), 'unavailable');
});

test('only positive integer paise amounts authorize live registration', () => {
  for (const fee_paise of [
    0,
    -1,
    70000.5,
    '70000',
    null,
    undefined,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const rows = raceConfig.map((row) =>
      row.race === '10' ? { ...row, fee_paise } : row,
    );
    assert.equal(resolveConfirmedRaceFees(rows), null);
    assert.equal(
      resolveEventAvailability(ready, { now, raceConfig: rows }),
      'unavailable',
    );
  }
});

test('invalid configured deadlines remain unavailable instead of using the preview deadline', () => {
  for (const registration_deadline of ['invalid', '']) {
    assert.equal(
      resolveEventAvailability({ ...ready, registration_deadline }, { now }),
      'unavailable',
    );
  }
});
