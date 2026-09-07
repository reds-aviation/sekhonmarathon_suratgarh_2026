import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migration = () => readFile(
  new URL('../supabase/migrations/202609070008_payment_attempts.sql', import.meta.url),
  'utf8',
);

const ids = {
  pending: '00000000-0000-4000-8000-000000000201',
  verified: '00000000-0000-4000-8000-000000000202',
  rejected: '00000000-0000-4000-8000-000000000203',
  later: '00000000-0000-4000-8000-000000000204',
  reviewer: '00000000-0000-4000-8000-000000000205',
};

async function fixture() {
  const db = new PGlite();
  const q = (sql, args = []) => db.query(sql, args);
  const scalar = async (sql, args = []) => Object.values((await q(sql, args)).rows[0])[0];
  const as = async (role, fn) => {
    await db.exec(`set role ${role}`);
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
    }
  };
  const rejects = (fn, fragment) => assert.rejects(fn, error =>
    !fragment || error.message.includes(fragment),
  );

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema marathon_private;
    create table auth.users(id uuid primary key, email text);
    create table public.event_config(id text primary key);
    create table public.registrations(
      id uuid primary key,
      event_id text not null references public.event_config(id),
      fee_paise integer not null check (fee_paise > 0),
      transaction_id text not null,
      receipt_path text not null,
      payment_status text not null check (payment_status in ('pending_review', 'verified', 'rejected')),
      created_at timestamptz not null default clock_timestamp(),
      reviewed_at timestamptz,
      reviewed_by uuid references auth.users(id),
      review_note text
    );
    -- Present because this migration is ordered after 007.
    create table marathon_private.organizer_capabilities(
      event_id text not null,
      user_id uuid not null,
      capability text not null
    );
    grant usage on schema public, auth, marathon_private to anon, authenticated, service_role;
    grant select, insert, update, delete on public.event_config, public.registrations to service_role;
    grant select, insert, update, delete on auth.users to service_role;
  `);
  await q("insert into public.event_config values('suratgarh-2026')");
  await q('insert into auth.users values($1,$2)', [ids.reviewer, 'reviewer@example.test']);

  const seedRegistration = (id, fee, utr, status, createdAt, reviewed = false) => q(
    `insert into public.registrations(
      id,event_id,fee_paise,transaction_id,receipt_path,payment_status,created_at,
      reviewed_at,reviewed_by,review_note
    ) values(
      $1,'suratgarh-2026',$2,$3,$4,$5,$6::timestamptz,
      case when $7 then $6::timestamptz + interval '10 minutes' else null end,
      case when $7 then $8::uuid else null end,
      case when $7 then 'Legacy review evidence.' else null end
    )`,
    [id, fee, utr, `legacy/${id}/receipt.png`, status, createdAt, reviewed, ids.reviewer],
  );

  await seedRegistration(ids.pending, 39900, 'abc-1234', 'pending_review', '2026-09-01T08:00:00Z');
  await seedRegistration(ids.verified, 49900, 'verified-5678', 'verified', '2026-09-01T09:00:00Z', true);
  await seedRegistration(ids.rejected, 49900, 'rejected-9012', 'rejected', '2026-09-01T10:00:00Z', true);

  await db.exec(await migration());
  return {db, q, scalar, as, rejects, seedRegistration};
}

function insertAttempt(q, {
  registrationId,
  ordinal,
  fee,
  utr,
  sourceRevision = 1,
  digest = 'a'.repeat(64),
  digestState = 'sha256',
}) {
  return q(`insert into marathon_private.payment_attempts(
    registration_id,event_id,attempt_ordinal,expected_fee_paise,transaction_utr,
    normalized_utr,receipt_path,receipt_digest_state,receipt_digest_sha256,status,source_revision
  ) values($1,'suratgarh-2026',$2,$3,$4,'CALLER-SUPPLIED',$5,$6,$7,'pending_review',$8)`, [
    registrationId,
    ordinal,
    fee,
    utr,
    `new/${registrationId}/${ordinal}.png`,
    digestState,
    digest,
    sourceRevision,
  ]);
}

void test('payment attempts backfill legacy evidence into a private, ordered ledger', async t => {
  const {db, q, scalar, as, rejects, seedRegistration} = await fixture();
  const source = await migration();

  await t.test('the migration does not introduce a race identifier that is not part of this event', () => {
    assert.doesNotMatch(source, /\bbib(?:s)?\b/iu);
  });

  await t.test('every existing registration receives attempt one without changing legacy payment fields', async () => {
    const rows = (await q(`select registration_id,attempt_ordinal,expected_fee_paise,transaction_utr,
      normalized_utr,receipt_path,receipt_digest_state,receipt_digest_sha256,status,
      reviewed_by,review_note,revision,source_revision,submitted_at
      from marathon_private.payment_attempts order by registration_id`)).rows;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => ({
      registration_id: row.registration_id,
      attempt_ordinal: row.attempt_ordinal,
      expected_fee_paise: row.expected_fee_paise,
      transaction_utr: row.transaction_utr,
      normalized_utr: row.normalized_utr,
      receipt_path: row.receipt_path,
      receipt_digest_state: row.receipt_digest_state,
      receipt_digest_sha256: row.receipt_digest_sha256,
      status: row.status,
      reviewed_by: row.reviewed_by,
      review_note: row.review_note,
      revision: row.revision,
      submitted_at: row.submitted_at.toISOString(),
    })), [
      {
        registration_id: ids.pending,
        attempt_ordinal: 1,
        expected_fee_paise: 39900,
        transaction_utr: 'abc-1234',
        normalized_utr: 'ABC1234',
        receipt_path: `legacy/${ids.pending}/receipt.png`,
        receipt_digest_state: 'legacy_unavailable',
        receipt_digest_sha256: null,
        status: 'pending_review',
        reviewed_by: null,
        review_note: null,
        revision: 1,
        submitted_at: '2026-09-01T08:00:00.000Z',
      },
      {
        registration_id: ids.verified,
        attempt_ordinal: 1,
        expected_fee_paise: 49900,
        transaction_utr: 'verified-5678',
        normalized_utr: 'VERIFIED5678',
        receipt_path: `legacy/${ids.verified}/receipt.png`,
        receipt_digest_state: 'legacy_unavailable',
        receipt_digest_sha256: null,
        status: 'verified',
        reviewed_by: ids.reviewer,
        review_note: 'Legacy review evidence.',
        revision: 1,
        submitted_at: '2026-09-01T09:00:00.000Z',
      },
      {
        registration_id: ids.rejected,
        attempt_ordinal: 1,
        expected_fee_paise: 49900,
        transaction_utr: 'rejected-9012',
        normalized_utr: 'REJECTED9012',
        receipt_path: `legacy/${ids.rejected}/receipt.png`,
        receipt_digest_state: 'legacy_unavailable',
        receipt_digest_sha256: null,
        status: 'rejected',
        reviewed_by: ids.reviewer,
        review_note: 'Legacy review evidence.',
        revision: 1,
        submitted_at: '2026-09-01T10:00:00.000Z',
      },
    ]);
    assert.deepEqual((await q(`select id,fee_paise,payment_status from public.registrations order by id`)).rows, [
      {id: ids.pending, fee_paise: 39900, payment_status: 'pending_review'},
      {id: ids.verified, fee_paise: 49900, payment_status: 'verified'},
      {id: ids.rejected, fee_paise: 49900, payment_status: 'rejected'},
    ]);
  });

  await t.test('source revisions are global, monotonic and refreshed for a review', async () => {
    const before = (await q(`select source_revision from marathon_private.payment_attempts
      order by source_revision`)).rows.map(row => Number(row.source_revision));
    assert.equal(new Set(before).size, 3);
    assert.ok(before.every((value, index) => index === 0 || value > before[index - 1]));

    await as('service_role', () => q(`update marathon_private.payment_attempts
      set status='rejected', reviewed_by=$1, review_note='Reference could not be verified.'
      where registration_id=$2 and attempt_ordinal=1`, [ids.reviewer, ids.pending]));
    const reviewed = (await q(`select status,revision,source_revision,reviewed_at is not null as server_reviewed,
      updated_at is not null as server_updated
      from marathon_private.payment_attempts where registration_id=$1`, [ids.pending])).rows[0];
    assert.deepEqual({...reviewed, source_revision: Number(reviewed.source_revision)}, {
      status: 'rejected',
      revision: 2,
      source_revision: before.at(-1) + 1,
      server_reviewed: true,
      server_updated: true,
    });

    await as('service_role', () => insertAttempt(q, {
      registrationId: ids.pending,
      ordinal: 2,
      fee: 39900,
      utr: 'new-utr-5678',
      sourceRevision: 1,
    }));
    const next = (await q(`select normalized_utr,revision,source_revision
      from marathon_private.payment_attempts
      where registration_id=$1 and attempt_ordinal=2`, [ids.pending])).rows[0];
    assert.deepEqual({...next, source_revision: Number(next.source_revision)}, {
      normalized_utr: 'NEWUTR5678',
      revision: 1,
      source_revision: Number(reviewed.source_revision) + 1,
    });
  });

  await t.test('ordinal, normalized UTR, fee and active-attempt constraints all fail closed', async () => {
    await rejects(
      () => as('service_role', () => insertAttempt(q, {
        registrationId: ids.verified,
        ordinal: 2,
        fee: 49900,
        utr: 'second-verified-utr',
      })),
      'payment_attempts_one_active_per_registration_idx',
    );
    await rejects(
      () => as('service_role', () => insertAttempt(q, {
        registrationId: ids.pending,
        ordinal: 2,
        fee: 39900,
        utr: 'same-ordinal-utr',
      })),
      'payment_attempts_registration_id_attempt_ordinal_key',
    );

    await seedRegistration(ids.later, 39900, 'later-registration-utr', 'pending_review', '2026-09-02T08:00:00Z');
    await rejects(
      () => as('service_role', () => insertAttempt(q, {
        registrationId: ids.later,
        ordinal: 1,
        fee: 39900,
        utr: 'ABC1234',
      })),
      'payment_attempts_event_normalized_utr_unique_idx',
    );
    await rejects(
      () => as('service_role', () => insertAttempt(q, {
        registrationId: ids.later,
        ordinal: 1,
        fee: 1,
        utr: 'different-utr-123',
      })),
      'Expected payment fee',
    );
    await rejects(
      () => as('service_role', () => insertAttempt(q, {
        registrationId: ids.later,
        ordinal: 1,
        fee: 39900,
        utr: 'different-utr-456',
        digest: 'not-a-digest',
      })),
      'payment_attempts_receipt_digest_state',
    );
  });

  await t.test('payment evidence cannot be rewritten after submission', async () => {
    await rejects(
      () => as('service_role', () => q(`update marathon_private.payment_attempts
        set expected_fee_paise=1 where registration_id=$1 and attempt_ordinal=2`, [ids.pending])),
      'immutable',
    );
    await rejects(
      () => as('service_role', () => q(`update marathon_private.payment_attempts
        set status='verified' where registration_id=$1 and attempt_ordinal=2`, [ids.pending])),
      'reviewer',
    );
    await rejects(
      () => as('service_role', () => q(`update marathon_private.payment_attempts
        set status='pending_review' where registration_id=$1 and attempt_ordinal=1`, [ids.rejected])),
      'Invalid payment attempt status transition',
    );
  });

  await t.test('browser roles have neither access nor row-level bypass', async () => {
    assert.equal(await scalar(`select relrowsecurity
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='marathon_private' and c.relname='payment_attempts'`), true);
    for (const role of ['anon', 'authenticated']) {
      await as(role, () => rejects(
        () => q('select * from marathon_private.payment_attempts'),
        'permission denied',
      ));
      await as(role, () => rejects(
        () => q(`update marathon_private.payment_attempts
          set status='rejected' where registration_id=$1`, [ids.pending]),
        'permission denied',
      ));
    }
  });

  await db.close();
});
