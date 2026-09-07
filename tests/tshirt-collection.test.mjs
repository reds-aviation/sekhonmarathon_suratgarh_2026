import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const eventId = 'suratgarh-2026';
const ids = {
  runnerOne: '00000000-0000-4000-8000-000000000501',
  runnerTwo: '00000000-0000-4000-8000-000000000502',
  runnerPending: '00000000-0000-4000-8000-000000000503',
  reviewer: '00000000-0000-4000-8000-000000000504',
  tshirtDesk: '00000000-0000-4000-8000-000000000505',
  eventAdmin: '00000000-0000-4000-8000-000000000506',
  unverified: '00000000-0000-4000-8000-000000000507',
};

const requestIds = {
  issueOne: '20000000-0000-4000-8000-000000000501',
  issueOneOther: '20000000-0000-4000-8000-000000000502',
  issueTwoNoReason: '20000000-0000-4000-8000-000000000503',
  issueTwoOverride: '20000000-0000-4000-8000-000000000504',
  reusedPayload: '20000000-0000-4000-8000-000000000505',
  pending: '20000000-0000-4000-8000-000000000506',
  voidOne: '20000000-0000-4000-8000-000000000507',
};

const readMigration = name => readFile(
  new URL(`../supabase/migrations/${name}`, import.meta.url),
  'utf8',
);

async function fixture() {
  const db = new PGlite();
  const q = (sql, args = []) => db.query(sql, args);
  const scalar = async (sql, args = []) => Object.values((await q(sql, args)).rows[0])[0];
  const as = async (role, id, claims, fn) => {
    await db.exec(`set role ${role}`);
    await q("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
    await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims ?? {})]);
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
      await q("select set_config('request.jwt.claim.sub','',false)");
      await q("select set_config('request.jwt.claims','',false)");
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
    create schema storage;
    create table auth.users(
      id uuid primary key,
      email text,
      email_confirmed_at timestamptz,
      is_anonymous boolean default false
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      )
    $$;
    create table storage.buckets(
      id text primary key,
      name text,
      public boolean default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    create table storage.objects(
      id uuid primary key default gen_random_uuid(),
      bucket_id text references storage.buckets(id),
      name text,
      owner_id text,
      metadata jsonb,
      unique(bucket_id, name)
    );
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select (string_to_array(name, '/'))[1:cardinality(string_to_array(name, '/')) - 1]
    $$;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.jwt(), storage.foldername(text)
      to anon, authenticated, service_role;
    grant select, insert, update, delete on storage.objects to authenticated, service_role;
  `);

  for (const [name, id] of Object.entries(ids)) {
    await q(
      'insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,$3,false)',
      [id, `${name}@example.test`, name === 'unverified' ? null : new Date().toISOString()],
    );
  }

  for (const migration of [
    '202609050001_marathon.sql',
    '202609050004_event_day.sql',
    '202609070006_confirmed_race_fees.sql',
  ]) {
    await db.exec(await readMigration(migration));
  }
  await q(`update public.event_config
    set event_starts_at = now() + interval '2 days',
        registration_deadline = now() + interval '1 day',
        payment_qr_url = 'https://example.test/qr.png',
        payee_name = 'Synthetic payment desk',
        upi_id = 'synthetic@upi',
        payment_configured = true,
        registration_open = true
    where id = $1`, [eventId]);

  await db.exec(await readMigration('202609070007_organiser_roles.sql'));
  await q(`insert into marathon_private.organizer_capabilities(
      event_id, user_id, capability, granted_by
    ) values
      ($1,$2,'payment_reviewer',$2),
      ($1,$3,'tshirt_desk',$3),
      ($1,$4,'event_admin',$4)`,
  [eventId, ids.reviewer, ids.tshirtDesk, ids.eventAdmin]);

  const invitationId = await scalar(`insert into marathon_private.invitations(
    event_id, label, code_sha256, expires_at
  ) values($1, 'Synthetic station test', repeat('a', 64), now() + interval '1 day') returning id`, [eventId]);
  for (const id of [ids.runnerOne, ids.runnerTwo, ids.runnerPending]) {
    await q(
      'insert into marathon_private.memberships(event_id,user_id,invitation_id) values($1,$2,$3)',
      [eventId, id, invitationId],
    );
  }

  for (const migration of [
    '202609070008_payment_attempts.sql',
    '202609070009_payment_operations.sql',
    '202609070010_receipt_integrity.sql',
    '202609070011_drive_mirror.sql',
    '202609070012_tshirt_collections.sql',
  ]) {
    await db.exec(await readMigration(migration));
  }

  let ordinal = 1;
  const registration = async ({userId, race, name, size}) => {
    const submissionId = `30000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
    const transactionId = `COLLECT-${ordinal}-12345`;
    ordinal += 1;
    const receiptPath = `${userId}/${submissionId}/receipt.png`;
    return as('service_role', null, {}, async () => {
      await q(
        "insert into storage.objects(bucket_id,name,metadata) values('payment-receipts',$1,'{\"size\":500,\"mimetype\":\"image/png\"}')",
        [receiptPath],
      );
      return scalar(`insert into public.registrations(
        event_id,user_id,submission_id,full_name,mobile,email,dob,gender,race,tshirt,
        blood_group,emergency_contact,city,participant_type,transaction_id,receipt_path,
        receipt_digest_sha256,consent,fee_paise
      ) values(
        $1,$2,$3,$4,'9123456789','ignored@example.test','1990-01-01','male',$5,$6,
        'O+','9234567890','Suratgarh','airwarrior',$7,$8,repeat('a',64),true,1
      ) returning id`, [eventId, userId, submissionId, name, race, size, transactionId, receiptPath]);
    });
  };

  const runnerOne = await registration({
    userId: ids.runnerOne,
    race: '5',
    name: 'Verified Runner One',
    size: 'M',
  });
  const runnerTwo = await registration({
    userId: ids.runnerTwo,
    race: '10',
    name: 'Verified Runner Two',
    size: 'L',
  });
  const runnerPending = await registration({
    userId: ids.runnerPending,
    race: '21',
    name: 'Pending Runner',
    size: 'S',
  });

  const attemptFor = async registrationId => (await q(`select id, revision
    from marathon_private.payment_attempts where registration_id = $1`, [registrationId])).rows[0];
  const review = async registrationId => {
    const attempt = await attemptFor(registrationId);
    return as('authenticated', ids.reviewer, {aal: 'aal2'}, () => scalar(
      'select public.review_payment_attempt($1,$2,$3,$4,$5,$6)',
      [eventId, attempt.id, attempt.revision, 'verified', 'Verified synthetic payment.', crypto.randomUUID()],
    ));
  };
  await review(runnerOne);
  await review(runnerTwo);

  const queue = (id, claims, status = 'ready', race = null, after = null, limit = 25) => as(
    'authenticated',
    id,
    claims,
    () => scalar('select public.tshirt_collection_queue($1,$2,$3,$4,$5)', [
      eventId, status, race, after, limit,
    ]),
  );
  const collect = (id, claims, registrationId, issuedSize, overrideReason, requestId) => as(
    'authenticated',
    id,
    claims,
    () => scalar('select public.record_tshirt_collection($1,$2,$3,$4,$5)', [
      eventId, registrationId, issuedSize, overrideReason, requestId,
    ]),
  );
  const voidIssue = (id, claims, tshirtIssueId, expectedRevision, reason, requestId) => as(
    'authenticated',
    id,
    claims,
    () => scalar('select public.void_tshirt_collection($1,$2,$3,$4,$5)', [
      eventId, tshirtIssueId, expectedRevision, reason, requestId,
    ]),
  );

  return {
    db, q, scalar, as, rejects, queue, collect, voidIssue,
    registrations: {runnerOne, runnerTwo, runnerPending},
  };
}

test('T-shirt desk only issues to paid runners and preserves an auditable size record', async t => {
  const source = await readMigration('202609070012_tshirt_collections.sql');
  assert.doesNotMatch(source, /\bbib(?:s)?\b/i);

  const {db, q, scalar, as, rejects, queue, collect, voidIssue, registrations} = await fixture();
  const aal2 = {aal: 'aal2'};

  await t.test('MFA, verified identity and role capability are mandatory for the private desk queue', async () => {
    await rejects(() => queue(ids.tshirtDesk, {aal: 'aal1'}), 'Multi-factor authentication');
    await rejects(() => queue(ids.runnerOne, aal2), 'active organiser capability');
    await rejects(() => queue(ids.unverified, aal2), 'verified email sign-in');
    assert.equal((await queue(ids.eventAdmin, aal2)).items.length, 2);
    await as('authenticated', ids.tshirtDesk, aal2, () => rejects(
      () => q('select * from marathon_private.tshirt_issues'),
      'permission denied',
    ));
  });

  await t.test('the collection queue returns only payment-verified runners and only desk fields', async () => {
    const firstPage = await queue(ids.tshirtDesk, aal2, 'ready', null, null, 1);
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.has_more, true);
    assert.ok(firstPage.next_after_registration_id);
    assert.deepEqual(Object.keys(firstPage.items[0]).sort(), [
      'full_name',
      'issue_revision',
      'issued_at',
      'issued_size',
      'override_reason',
      'race',
      'registration_id',
      'requested_size',
      'source_revision',
      'tshirt_issue_id',
    ]);
    assert.equal(firstPage.items[0].email, undefined);
    assert.equal(firstPage.items[0].mobile, undefined);
    assert.equal(firstPage.items[0].transaction_utr, undefined);

    const secondPage = await queue(
      ids.tshirtDesk,
      aal2,
      'ready',
      null,
      firstPage.next_after_registration_id,
      1,
    );
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(secondPage.items[0].registration_id, firstPage.items[0].registration_id);
    assert.equal(secondPage.has_more, false);
    assert.equal((await queue(ids.tshirtDesk, aal2, 'ready', '21')).items.length, 0);
  });

  await t.test('a regular collection is idempotent and writes the requested and issued sizes', async () => {
    const issued = await collect(
      ids.tshirtDesk,
      aal2,
      registrations.runnerOne,
      'M',
      '',
      requestIds.issueOne,
    );
    assert.deepEqual(
      {requested: issued.requested_size, issued: issued.issued_size, status: issued.status},
      {requested: 'M', issued: 'M', status: 'issued'},
    );
    assert.ok(issued.tshirt_issue_id);
    assert.ok(issued.issued_at);

    const retry = await collect(
      ids.tshirtDesk,
      aal2,
      registrations.runnerOne,
      'M',
      '',
      requestIds.issueOne,
    );
    assert.deepEqual(retry, issued);
    await rejects(
      () => collect(
        ids.tshirtDesk,
        aal2,
        registrations.runnerOne,
        'M',
        '',
        requestIds.issueOneOther,
      ),
      'already been issued',
    );

    assert.deepEqual((await q(`select requested_size, issued_size, override_reason, status, issued_by
      from marathon_private.tshirt_issues where id = $1`, [issued.tshirt_issue_id])).rows[0], {
      requested_size: 'M',
      issued_size: 'M',
      override_reason: null,
      status: 'issued',
      issued_by: ids.tshirtDesk,
    });
    assert.equal(await scalar(`select count(*)::int from marathon_private.organizer_audit
      where event_id = $1 and request_id = $2 and action = 'tshirt_collected'`,
    [eventId, requestIds.issueOne]), 1);
  });

  await t.test('the issue ledger retains its payment and size guards even for a backend write mistake', async () => {
    await as('service_role', null, {}, () => rejects(
      () => q(`insert into marathon_private.tshirt_issues(
        event_id, registration_id, requested_size, issued_size, issued_by
      ) values($1,$2,'L','XL',$3)`, [eventId, registrations.runnerTwo, ids.eventAdmin]),
      'tshirt_issues_size_override_check',
    ));
    await as('service_role', null, {}, () => rejects(
      () => q(`insert into marathon_private.tshirt_issues(
        event_id, registration_id, requested_size, issued_size, issued_by
      ) values($1,$2,'S','S',$3)`, [eventId, registrations.runnerPending, ids.eventAdmin]),
      'requires a verified payment',
    ));
  });

  await t.test('a size substitute requires a reason and keeps the submitted requested size intact', async () => {
    await rejects(
      () => collect(
        ids.tshirtDesk,
        aal2,
        registrations.runnerTwo,
        'XL',
        '',
        requestIds.issueTwoNoReason,
      ),
      'Explain the T-shirt size override',
    );
    const override = await collect(
      ids.eventAdmin,
      aal2,
      registrations.runnerTwo,
      'XL',
      'Requested L was unavailable at the desk.',
      requestIds.issueTwoOverride,
    );
    assert.deepEqual(
      {requested: override.requested_size, issued: override.issued_size, reason: override.override_reason},
      {requested: 'L', issued: 'XL', reason: 'Requested L was unavailable at the desk.'},
    );
    await rejects(
      () => collect(
        ids.eventAdmin,
        aal2,
        registrations.runnerTwo,
        'L',
        '',
        requestIds.reusedPayload,
      ),
      'already been issued',
    );
  });

  await t.test('pending payment cannot enter the collection workflow', async () => {
    await rejects(
      () => collect(
        ids.tshirtDesk,
        aal2,
        registrations.runnerPending,
        'S',
        '',
        requestIds.pending,
      ),
      'requires a verified payment',
    );
    assert.equal(await scalar(`select count(*)::int from marathon_private.tshirt_issues
      where registration_id = $1`, [registrations.runnerPending]), 0);
  });

  await t.test('an event administrator can void an accidental issue with revision control and an audit trail', async () => {
    const activeIssue = (await q(`select id, revision from marathon_private.tshirt_issues
      where registration_id = $1 and status = 'issued'`, [registrations.runnerOne])).rows[0];
    await rejects(
      () => voidIssue(
        ids.tshirtDesk,
        aal2,
        activeIssue.id,
        activeIssue.revision,
        'Accidental duplicate desk tap.',
        requestIds.voidOne,
      ),
      'active organiser capability',
    );
    const outcome = await voidIssue(
      ids.eventAdmin,
      aal2,
      activeIssue.id,
      activeIssue.revision,
      'Accidental duplicate desk tap.',
      requestIds.voidOne,
    );
    assert.deepEqual(
      {status: outcome.status, revision: outcome.issue_revision},
      {status: 'voided', revision: 2},
    );
    assert.deepEqual(
      await voidIssue(
        ids.eventAdmin,
        aal2,
        activeIssue.id,
        activeIssue.revision,
        'Accidental duplicate desk tap.',
        requestIds.voidOne,
      ),
      outcome,
    );
    assert.equal(await scalar(`select count(*)::int from marathon_private.organizer_audit
      where event_id = $1 and request_id = $2 and action = 'tshirt_collection_voided'`,
    [eventId, requestIds.voidOne]), 1);
    assert.equal((await queue(ids.tshirtDesk, aal2, 'ready')).items.some(
      item => item.registration_id === registrations.runnerOne,
    ), true);
  });

  await db.close();
});
