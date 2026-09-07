import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const eventId = 'suratgarh-2026';
const ids = {
  participantA: '00000000-0000-4000-8000-000000000301',
  participantB: '00000000-0000-4000-8000-000000000302',
  participantC: '00000000-0000-4000-8000-000000000303',
  reviewer: '00000000-0000-4000-8000-000000000304',
  eventAdmin: '00000000-0000-4000-8000-000000000305',
  tshirtDesk: '00000000-0000-4000-8000-000000000306',
  legacyOrganizer: '00000000-0000-4000-8000-000000000307',
  unverified: '00000000-0000-4000-8000-000000000308',
};

const requests = {
  proof: '10000000-0000-4000-8000-000000000301',
  stale: '10000000-0000-4000-8000-000000000302',
  shortReason: '10000000-0000-4000-8000-000000000303',
  verify: '10000000-0000-4000-8000-000000000304',
  reject: '10000000-0000-4000-8000-000000000305',
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
      select (string_to_array(name,'/'))[1:cardinality(string_to_array(name,'/'))-1]
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

  await db.exec(await readMigration('202609050001_marathon.sql'));
  await db.exec(await readMigration('202609050004_event_day.sql'));
  await db.exec(await readMigration('202609070006_confirmed_race_fees.sql'));

  await q(`update public.event_config
    set event_starts_at=now()+interval '2 days',
        registration_deadline=now()+interval '1 day',
        payment_qr_url='https://example.test/payment-qr.png',
        payee_name='Test payment desk',
        upi_id='test@upi',
        payment_configured=true,
        registration_open=true
    where id=$1`, [eventId]);
  await q(
    "insert into marathon_private.organizers(event_id,user_id) values($1,$2)",
    [eventId, ids.legacyOrganizer],
  );

  await db.exec(await readMigration('202609070007_organiser_roles.sql'));
  await q(`insert into marathon_private.organizer_capabilities(
      event_id,user_id,capability,granted_by
    ) values
      ($1,$2,'payment_reviewer',$2),
      ($1,$3,'event_admin',$3),
      ($1,$4,'tshirt_desk',$4)`,
  [eventId, ids.reviewer, ids.eventAdmin, ids.tshirtDesk]);

  const invitationId = await scalar(`insert into marathon_private.invitations(
    event_id,label,code_sha256,expires_at
  ) values($1,'Synthetic station test',repeat('a',64),now()+interval '1 day') returning id`, [eventId]);
  for (const id of [ids.participantA, ids.participantB, ids.participantC, ids.legacyOrganizer]) {
    await q(
      'insert into marathon_private.memberships(event_id,user_id,invitation_id) values($1,$2,$3)',
      [eventId, id, invitationId],
    );
  }

  let submissionOrdinal = 1;
  const registration = async ({userId, race, fullName, transactionId}) => {
    const submissionId = `10000000-0000-4000-8000-${String(submissionOrdinal).padStart(12, '0')}`;
    submissionOrdinal += 1;
    const receiptPath = `${userId}/${submissionId}/receipt.png`;
    return as('service_role', null, {}, async () => {
      await q(
        "insert into storage.objects(bucket_id,name,metadata) values('payment-receipts',$1,'{\"size\":500,\"mimetype\":\"image/png\"}')",
        [receiptPath],
      );
      return scalar(`insert into public.registrations(
        event_id,user_id,submission_id,full_name,mobile,email,dob,gender,race,tshirt,
        blood_group,emergency_contact,city,participant_type,transaction_id,receipt_path,
        consent,fee_paise
      ) values(
        $1,$2,$3,$4,'9123456789','ignored@example.test','1990-01-01','male',$5,'M',
        'O+','9234567890','Suratgarh','airwarrior',$6,$7,true,1
      ) returning id`, [eventId, userId, submissionId, fullName, race, transactionId, receiptPath]);
    });
  };

  const registration5a = await registration({
    userId: ids.participantA,
    race: '5',
    fullName: 'Queue Runner One',
    transactionId: 'QUEUE-ONE-12345',
  });
  const registration5b = await registration({
    userId: ids.participantB,
    race: '5',
    fullName: 'Queue Runner Two',
    transactionId: 'QUEUE-TWO-12345',
  });
  const registration10 = await registration({
    userId: ids.participantC,
    race: '10',
    fullName: 'Rejected Runner',
    transactionId: 'REJECT-12345',
  });
  const legacyRegistration = await registration({
    userId: ids.legacyOrganizer,
    race: '21',
    fullName: 'Legacy Review Runner',
    transactionId: 'LEGACY-12345',
  });

  await db.exec(await readMigration('202609070008_payment_attempts.sql'));
  const transitionRegistration = await registration({
    userId: ids.participantA,
    race: '21',
    fullName: 'Transition Window Runner',
    transactionId: 'TRANSITION-12345',
  });
  await as('authenticated', ids.legacyOrganizer, {aal: 'aal1'}, () => scalar(
    'select public.event_day($1,$2)',
    ['review_payment', JSON.stringify({
      registration_id: legacyRegistration,
      status: 'verified',
      note: 'Legacy review during the deployment window.',
    })],
  ));
  await db.exec(await readMigration('202609070009_payment_operations.sql'));

  const queue = (id, claims, status = 'pending_review', race = null, after = null, limit = 25) => as(
    'authenticated',
    id,
    claims,
    () => scalar('select public.payment_review_queue($1,$2,$3,$4,$5)', [
      eventId, status, race, after, limit,
    ]),
  );
  const proof = (id, claims, attemptId, requestId) => as(
    'authenticated',
    id,
    claims,
    () => scalar('select public.authorize_payment_receipt($1,$2,$3)', [eventId, attemptId, requestId]),
  );
  const review = (id, claims, attemptId, expectedRevision, status, note, requestId) => as(
    'authenticated',
    id,
    claims,
    () => scalar('select public.review_payment_attempt($1,$2,$3,$4,$5,$6)', [
      eventId, attemptId, expectedRevision, status, note, requestId,
    ]),
  );
  const attemptFor = async registrationId => (await q(`select id,registration_id,status,revision,
    source_revision,receipt_path from marathon_private.payment_attempts
    where registration_id=$1`, [registrationId])).rows[0];

  return {
    db, q, scalar, as, rejects, queue, proof, review, attemptFor,
    registration,
    registrations: {
      registration5a,
      registration5b,
      registration10,
      legacyRegistration,
      transitionRegistration,
    },
  };
}

test('capability-gated payment operations keep evidence private and payment state coherent', async t => {
  const operationsSql = await readMigration('202609070009_payment_operations.sql');
  assert.doesNotMatch(operationsSql, /\bbib(?:s)?\b/i);

  const {db, q, scalar, as, rejects, queue, proof, review, attemptFor, registration, registrations} = await fixture();
  const aal2 = {aal: 'aal2'};

  await t.test('AAL1, unverified and unrelated identities cannot use the reviewer wrappers', async () => {
    await rejects(
      () => queue(ids.reviewer, {aal: 'aal1'}),
      'Multi-factor authentication',
    );
    await rejects(
      () => queue(ids.participantA, aal2),
      'active organiser capability',
    );
    await rejects(
      () => queue(ids.unverified, aal2),
      'verified email sign-in',
    );
    assert.equal((await queue(ids.eventAdmin, aal2)).items.length, 4);
  });

  await t.test('the queue is paginated, filtered and limited to payment-review fields', async () => {
    const firstPage = await queue(ids.reviewer, aal2, 'pending_review', '5', null, 1);
    assert.equal(firstPage.items.length, 1);
    assert.equal(firstPage.items[0].race, '5');
    assert.equal(firstPage.has_more, true);
    assert.ok(Number(firstPage.next_after_source_revision) > 0);
    assert.deepEqual(Object.keys(firstPage.items[0]).sort(), [
      'attempt_ordinal',
      'attempt_revision',
      'expected_fee_paise',
      'full_name',
      'payment_attempt_id',
      'race',
      'receipt_available',
      'registration_id',
      'source_revision',
      'status',
      'submitted_at',
      'transaction_utr',
    ]);
    assert.equal(firstPage.items[0].email, undefined);
    assert.equal(firstPage.items[0].mobile, undefined);
    assert.equal(firstPage.items[0].receipt_path, undefined);

    const secondPage = await queue(
      ids.reviewer,
      aal2,
      'pending_review',
      '5',
      Number(firstPage.next_after_source_revision),
      1,
    );
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(secondPage.items[0].payment_attempt_id, firstPage.items[0].payment_attempt_id);
    assert.equal(secondPage.has_more, false);
  });

  const firstAttempt = await attemptFor(registrations.registration5a);

  await t.test('one capability-checked operation authorizes exactly one receipt path and records access', async () => {
    const authorized = await proof(ids.reviewer, aal2, firstAttempt.id, requests.proof);
    assert.deepEqual(authorized, {
      payment_attempt_id: firstAttempt.id,
      storage_bucket: 'payment-receipts',
      receipt_path: firstAttempt.receipt_path,
      attempt_revision: 1,
    });
    const audit = (await q(`select action,capability,target,revision,details
      from marathon_private.organizer_audit
      where event_id=$1 and request_id=$2`, [eventId, requests.proof])).rows[0];
    assert.deepEqual(audit, {
      action: 'payment_receipt_authorized',
      capability: 'payment_reviewer',
      target: {payment_attempt_id: firstAttempt.id, registration_id: registrations.registration5a},
      revision: 1,
      details: {receipt_digest_state: 'legacy_unavailable'},
    });
    await rejects(
      () => proof(ids.participantA, aal2, firstAttempt.id, '10000000-0000-4000-8000-000000000309'),
      'active organiser capability',
    );
    assert.equal(await as('authenticated', ids.participantA, aal2, () => scalar(
      "select count(*)::int from storage.objects where bucket_id='payment-receipts' and name=$1",
      [firstAttempt.receipt_path],
    )), 1);
    assert.equal(await as('authenticated', ids.legacyOrganizer, aal2, () => scalar(
      "select count(*)::int from storage.objects where bucket_id='payment-receipts' and name=$1",
      [firstAttempt.receipt_path],
    )), 0);
    assert.equal(await as('authenticated', ids.reviewer, aal2, () => scalar(
      "select count(*)::int from storage.objects where bucket_id='payment-receipts' and name=$1",
      [firstAttempt.receipt_path],
    )), 0);
  });

  await t.test('a stale review is refused before it changes either payment record', async () => {
    await rejects(
      () => review(ids.reviewer, aal2, firstAttempt.id, 2, 'verified', '', requests.stale),
      'changed since this review screen was opened',
    );
    assert.deepEqual((await attemptFor(registrations.registration5a)).status, 'pending_review');
    assert.equal(await scalar(`select count(*)::int from marathon_private.payment_review_requests
      where event_id=$1 and request_id=$2`, [eventId, requests.stale]), 0);
  });

  await t.test('a review is idempotent, audited and mirrors its status to the registration summary', async () => {
    const outcome = await review(
      ids.reviewer,
      aal2,
      firstAttempt.id,
      1,
      'verified',
      'Verified against the station payment record.',
      requests.verify,
    );
    assert.equal(outcome.status, 'verified');
    assert.equal(outcome.attempt_revision, 2);
    assert.ok(Number(outcome.source_revision) > Number(firstAttempt.source_revision));
    assert.ok(outcome.reviewed_at);

    const retry = await review(
      ids.reviewer,
      aal2,
      firstAttempt.id,
      1,
      'verified',
      'Verified against the station payment record.',
      requests.verify,
    );
    assert.deepEqual(retry, outcome);
    await rejects(
      () => review(ids.reviewer, aal2, firstAttempt.id, 1, 'rejected', 'Different use of a request ID.', requests.verify),
      'different payload',
    );

    const attempt = await attemptFor(registrations.registration5a);
    assert.deepEqual({status: attempt.status, revision: attempt.revision}, {status: 'verified', revision: 2});
    const summary = (await q(`select payment_status,reviewed_by,review_note,reviewed_at is not null as reviewed
      from public.registrations where id=$1`, [registrations.registration5a])).rows[0];
    assert.deepEqual(summary, {
      payment_status: 'verified',
      reviewed_by: ids.reviewer,
      review_note: 'Verified against the station payment record.',
      reviewed: true,
    });
    assert.equal(await scalar(`select count(*)::int from marathon_private.organizer_audit
      where event_id=$1 and request_id=$2 and action='payment_reviewed'`, [eventId, requests.verify]), 1);
  });

  await t.test('rejections require a useful correction reason and keep both records aligned', async () => {
    const attempt = await attemptFor(registrations.registration10);
    await rejects(
      () => review(ids.reviewer, aal2, attempt.id, 1, 'rejected', 'no', requests.shortReason),
      'Explain why the payment needs correction',
    );
    const rejected = await review(
      ids.reviewer,
      aal2,
      attempt.id,
      1,
      'rejected',
      'The transaction reference does not match the payment statement.',
      requests.reject,
    );
    assert.equal(rejected.status, 'rejected');
    assert.deepEqual((await q(`select payment_status,reviewed_by,review_note
      from public.registrations where id=$1`, [registrations.registration10])).rows[0], {
      payment_status: 'rejected',
      reviewed_by: ids.reviewer,
      review_note: 'The transaction reference does not match the payment statement.',
    });
    assert.deepEqual((await attemptFor(registrations.registration10)).status, 'rejected');
  });

  await t.test('legacy event-day payment review is closed while privileged summary compatibility remains coherent', async () => {
    const legacyAttempt = await attemptFor(registrations.transitionRegistration);
    const legacyReview = () => as('authenticated', ids.legacyOrganizer, {aal: 'aal1'}, () => scalar(
      'select public.event_day($1,$2)',
      ['review_payment', JSON.stringify({
        registration_id: registrations.transitionRegistration,
        status: 'verified',
        note: 'Legacy organiser check completed.',
      })],
    ));
    await rejects(legacyReview, 'capability-gated payment review operation');
    assert.equal((await attemptFor(registrations.transitionRegistration)).status, 'pending_review');
    await as('service_role', ids.legacyOrganizer, {}, () => q(`update public.registrations
      set payment_status='verified', reviewed_by=$1, review_note='Legacy backend summary sync.'
      where id=$2`, [ids.legacyOrganizer, registrations.transitionRegistration]));
    const updatedAttempt = await attemptFor(registrations.transitionRegistration);
    assert.deepEqual(
      {status: updatedAttempt.status, revision: updatedAttempt.revision, reviewer: (await q(
        'select reviewed_by from marathon_private.payment_attempts where id=$1', [legacyAttempt.id],
      )).rows[0].reviewed_by},
      {status: 'verified', revision: 2, reviewer: ids.legacyOrganizer},
    );
  });

  await t.test('the remaining event-day participant path stays available without exposing payment evidence', async () => {
    const snapshot = await as('authenticated', ids.participantA, {aal: 'aal1'}, () => scalar(
      "select public.event_day('snapshot','{}'::jsonb)",
    ));
    assert.equal(snapshot.is_organiser, false);
    assert.ok(snapshot.registrations.every(entry => entry.transaction_id === null));
    assert.ok(snapshot.registrations.every(entry => entry.receipt_path === null));
  });

  await t.test('revoking an event-admin capability also removes legacy organiser visibility', async () => {
    assert.equal((await as('authenticated', ids.legacyOrganizer, aal2, () => scalar(
      "select (public.event_day('snapshot','{}'::jsonb)->>'is_organiser')::boolean",
    ))), true);
    await as('service_role', null, {}, () => q(`update marathon_private.organizer_capabilities
      set revoked_at=clock_timestamp(), revoked_by=$1, revision=revision+1
      where event_id=$2 and user_id=$1 and capability='event_admin'`, [ids.legacyOrganizer, eventId]));
    assert.equal((await as('authenticated', ids.legacyOrganizer, aal2, () => scalar(
      "select (public.event_day('snapshot','{}'::jsonb)->>'is_organiser')::boolean",
    ))), false);
  });

  await t.test('the deployment transition reconciles a legacy review recorded between migrations', async () => {
    const transitionAttempt = await attemptFor(registrations.legacyRegistration);
    assert.deepEqual(
      {status: transitionAttempt.status, revision: transitionAttempt.revision, reviewer: (await q(
        'select reviewed_by from marathon_private.payment_attempts where id=$1', [transitionAttempt.id],
      )).rows[0].reviewed_by},
      {status: 'verified', revision: 2, reviewer: ids.legacyOrganizer},
    );
  });

  await t.test('new legacy-compatible registrations receive a private pending attempt automatically', async () => {
    const postMigrationRegistration = await registration({
      userId: ids.participantA,
      race: '21',
      fullName: 'Post Migration Runner',
      transactionId: 'POST-MIGRATION-12345',
    });
    const attempt = await attemptFor(postMigrationRegistration);
    assert.deepEqual(
      {
        status: attempt.status,
        revision: attempt.revision,
        receiptPath: attempt.receipt_path,
      },
      {
        status: 'pending_review',
        revision: 1,
        receiptPath: `${ids.participantA}/10000000-0000-4000-8000-000000000006/receipt.png`,
      },
    );
  });

  await t.test('ordinary users cannot query the queue, proof or review internals', async () => {
    const secondAttempt = await attemptFor(registrations.registration5b);
    await as('authenticated', ids.participantB, aal2, () => rejects(
      () => q('select * from marathon_private.payment_attempts'),
      'permission denied',
    ));
    await as('authenticated', ids.participantB, aal2, () => rejects(
      () => q("select marathon_private.payment_review_queue('suratgarh-2026')"),
      'permission denied',
    ));
    await rejects(
      () => proof(ids.participantB, aal2, secondAttempt.id, '10000000-0000-4000-8000-000000000310'),
      'active organiser capability',
    );
    await rejects(
      () => review(ids.participantB, aal2, secondAttempt.id, 1, 'verified', '', '10000000-0000-4000-8000-000000000311'),
      'active organiser capability',
    );
    await as('anon', null, {}, () => rejects(
      () => q("select public.payment_review_queue('suratgarh-2026')"),
      'permission denied',
    ));
  });

  await db.close();
});
