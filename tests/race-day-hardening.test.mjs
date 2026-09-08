import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const eventId = 'suratgarh-2026';
const ids = {
  owner: '00000000-0000-4000-8000-000000000901',
  other: '00000000-0000-4000-8000-000000000902',
  selfRunner: '00000000-0000-4000-8000-000000000903',
  completionDesk: '00000000-0000-4000-8000-000000000904',
  eventAdmin: '00000000-0000-4000-8000-000000000905',
  legacyOnly: '00000000-0000-4000-8000-000000000906',
  unverified: '00000000-0000-4000-8000-000000000907',
  routePublisher: '00000000-0000-4000-8000-000000000908',
};

const requestIds = {
  paymentOwner: '10000000-0000-4000-8000-000000000901',
  paymentOther: '10000000-0000-4000-8000-000000000902',
  paymentSelf: '10000000-0000-4000-8000-000000000903',
  recordOwner: '20000000-0000-4000-8000-000000000901',
  recordOwnerOtherPayload: '20000000-0000-4000-0000-000000000902',
  recordOwnerStale: '20000000-0000-4000-8000-000000000903',
  reviewOwner: '30000000-0000-4000-8000-000000000901',
  reviewOwnerStale: '30000000-0000-4000-8000-000000000902',
  clock: '40000000-0000-4000-8000-000000000901',
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

  for (const [label, id] of Object.entries(ids)) {
    await q(
      'insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,$3,false)',
      [id, `${label}@example.test`, label === 'unverified' ? null : new Date().toISOString()],
    );
  }

  for (const migration of [
    '202609050001_marathon.sql',
    '202609050004_event_day.sql',
    '202609050005_certificates.sql',
    '202609070006_confirmed_race_fees.sql',
    '202609070007_organiser_roles.sql',
    '202609070008_payment_attempts.sql',
    '202609070009_payment_operations.sql',
    '202609070010_receipt_integrity.sql',
    '202609070011_drive_mirror.sql',
    '202609070012_tshirt_collections.sql',
    '202609070013_payment_corrections.sql',
    '202609070014_race_day_hardening.sql',
    '202609070015_member_route_timeline.sql',
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

  await q(`insert into marathon_private.organizer_capabilities(
    event_id,user_id,capability,granted_by
  ) values
    ($1,$2,'completion_desk',$2),
    ($1,$3,'event_admin',$3),
    ($1,$4,'route_publisher',$4)`, [
    eventId,
    ids.completionDesk,
    ids.eventAdmin,
    ids.routePublisher,
  ]);
  // This row is intentionally added after 007's compatibility seed. It must
  // never regain certificate authority merely by appearing in the old table.
  await q(`insert into marathon_private.organizers(event_id,user_id) values($1,$2)`, [eventId, ids.legacyOnly]);

  const invitationId = await scalar(`insert into marathon_private.invitations(
    event_id,label,code_sha256,expires_at
  ) values($1,'Race-day test',repeat('a',64),now()+interval '1 day') returning id`, [eventId]);
  for (const id of [ids.owner, ids.other, ids.selfRunner]) {
    await q('insert into marathon_private.memberships(event_id,user_id,invitation_id) values($1,$2,$3)', [
      eventId, id, invitationId,
    ]);
  }

  let ordinal = 1;
  const registration = async (userId, race, name) => {
    const submissionId = `50000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
    const transactionId = `RACE-DAY-${ordinal}-REFERENCE`;
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
        $1,$2,$3,$4,'9123456789','ignored@example.test','1990-01-01','male',$5,'M',
        'O+','9234567890','Suratgarh','airwarrior',$6,$7,repeat('a',64),true,39900
      ) returning id`, [eventId, userId, submissionId, name, race, transactionId, receiptPath]);
    });
  };

  const registrations = {
    owner: await registration(ids.owner, '5', 'Owner Finish Runner'),
    other: await registration(ids.other, '10', 'Other Finish Runner'),
    selfRunner: await registration(ids.selfRunner, '5', 'Self Time Runner'),
  };

  const reviewPayment = async (registrationId, requestId) => {
    const attempt = (await q(`select id,revision from marathon_private.payment_attempts
      where registration_id=$1 and status='pending_review'`, [registrationId])).rows[0];
    return as('authenticated', ids.eventAdmin, { aal: 'aal2' }, () => scalar(
      'select public.review_payment_attempt($1,$2,$3,$4,$5,$6)',
      [eventId, attempt.id, attempt.revision, 'verified', 'Matched synthetic station record.', requestId],
    ));
  };
  await reviewPayment(registrations.owner, requestIds.paymentOwner);
  await reviewPayment(registrations.other, requestIds.paymentOther);
  await reviewPayment(registrations.selfRunner, requestIds.paymentSelf);

  const completionQueue = (actor, claims, race = null, after = null, limit = 25) => as(
    'authenticated', actor, claims, () => scalar(
      'select public.completion_desk_queue($1,$2,$3,$4)',
      [eventId, race, after, limit],
    ),
  );
  const record = (actor, claims, registrationId, elapsed, expectedRevision, requestId) => as(
    'authenticated', actor, claims, () => scalar(
      'select public.record_race_completion($1,$2,$3,$4,$5)',
      [eventId, registrationId, elapsed, expectedRevision, requestId],
    ),
  );
  const review = (actor, claims, registrationId, expectedRevision, status, elapsed, note, hold, requestId) => as(
    'authenticated', actor, claims, () => scalar(
      'select public.review_race_completion($1,$2,$3,$4,$5,$6,$7,$8)',
      [eventId, registrationId, expectedRevision, status, elapsed, note, hold, requestId],
    ),
  );

  return {
    as, completionQueue, db, q, record, registrations, rejects, review, scalar,
  };
}

void test('race-day completion cutover is capability-gated, private and revision-safe', async t => {
  const [migrationSource, certificateFunction] = await Promise.all([
    readMigration('202609070014_race_day_hardening.sql'),
    readFile(new URL('../supabase/functions/certificate/index.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(migrationSource, /completion_desk_enabled boolean not null default false/i);
  assert.match(migrationSource, /organizer_capabilities/i);
  assert.doesNotMatch(migrationSource, /from\s+marathon_private\.organizers\b/i);
  assert.doesNotMatch(migrationSource, /\bbib(?:s)?\b/iu);
  assert.match(certificateFunction, /SITE_ORIGIN must be configured as an HTTPS origin/);
  assert.match(certificateFunction, /p_actor_aal:\s*actorAssurance/);
  assert.doesNotMatch(certificateFunction, /ALLOWED_ORIGIN|reds-aviation\.github\.io/u);

  const {
    as, completionQueue, db, q, record, registrations, rejects, review, scalar,
  } = await fixture();
  const aal1 = { aal: 'aal1' };
  const aal2 = { aal: 'aal2' };

  await t.test('the desk, timing and certificate switches all remain disabled by default', async () => {
    assert.equal(await scalar(`select timing_enabled or self_submission_open or completion_desk_enabled
      from marathon_private.event_day_settings where event_id=$1`, [eventId]), false);
    assert.equal(await scalar(`select enabled from marathon_private.certificate_settings where event_id=$1`, [eventId]), false);
    await rejects(
      () => completionQueue(ids.owner, aal2),
      'active organiser capability',
    );
    await rejects(
      () => completionQueue(ids.completionDesk, aal1),
      'Multi-factor authentication',
    );
    await rejects(
      () => completionQueue(ids.completionDesk, aal2),
      'Completion desk is not enabled',
    );
  });

  await t.test('member route timelines stay invitation-gated, private and revision-safe', async () => {
    const timeline = {
      start: 'Synthetic station start',
      distances: [
        { distance: '5', steps: ['First marked point', 'Return to start'] },
        { distance: '10', steps: ['First marked point', 'Further point', 'Return to start'] },
        { distance: '21', steps: ['First marked point', 'Further point', 'Final turn-around', 'Return to start'] },
      ],
      notice: 'Follow the directions of race marshals at all times.',
    };
    const publish = (actor, claims, expectedRevision, requestId = crypto.randomUUID()) => as(
      'authenticated', actor, claims, () => scalar(
        'select public.publish_member_route($1,$2::jsonb,$3,$4)',
        [eventId, JSON.stringify(timeline), expectedRevision, requestId],
      ),
    );

    const unavailable = await as('authenticated', ids.owner, aal1, () => scalar(
      'select public.get_member_route($1)', [eventId],
    ));
    assert.deepEqual(unavailable, { published: false });
    await rejects(
      () => publish(ids.routePublisher, aal1, 0),
      'Multi-factor authentication',
    );
    const publishRequestId = crypto.randomUUID();
    const published = await publish(ids.routePublisher, aal2, 0, publishRequestId);
    assert.equal(published.published, true);
    assert.equal(published.revision, 1);
    const publishedReplay = await publish(ids.routePublisher, aal2, 0, publishRequestId);
    assert.deepEqual(publishedReplay, published);
    await rejects(
      () => publish(ids.routePublisher, aal2, 1, publishRequestId),
      'does not match its original action',
    );

    const publication = await as('authenticated', ids.routePublisher, aal2, () => scalar(
      'select public.get_route_publication($1)', [eventId],
    ));
    assert.equal(publication.revision, 1);
    assert.equal(publication.timeline.start, timeline.start);

    const route = await as('authenticated', ids.owner, aal1, () => scalar(
      'select public.get_member_route($1)', [eventId],
    ));
    assert.equal(route.published, true);
    assert.equal(route.revision, 1);
    assert.equal(route.timeline.start, timeline.start);
    assert.equal(route.timeline.distances.length, 3);

    await as('authenticated', ids.unverified, aal1, () => rejects(
      () => scalar('select public.get_member_route($1)', [eventId]),
      'verified email',
    ));
    await as('authenticated', ids.owner, aal1, () => rejects(
      () => q('select * from marathon_private.member_route_timeline'),
      'permission denied',
    ));
    await as('authenticated', ids.owner, aal1, () => rejects(
      () => q('select * from marathon_private.member_route_requests'),
      'permission denied',
    ));
    await as('authenticated', ids.owner, aal2, () => rejects(
      () => scalar('select public.get_route_publication($1)', [eventId]),
      'active organiser capability',
    ));
    await as('authenticated', ids.routePublisher, aal2, () => rejects(
      () => publish(ids.routePublisher, aal2, 0),
      'Route timeline has changed',
    ));
    await as('authenticated', ids.routePublisher, aal2, () => rejects(
      () => scalar('select public.publish_member_route($1,$2::jsonb,$3,$4)', [
        eventId,
        JSON.stringify({ distances: [] }),
        1,
        crypto.randomUUID(),
      ]),
      'Route start is required',
    ));
    const unpublishRequestId = crypto.randomUUID();
    const unpublished = await as('authenticated', ids.routePublisher, aal2, () => scalar(
      'select public.unpublish_member_route($1,$2,$3)',
      [eventId, 1, unpublishRequestId],
    ));
    assert.equal(unpublished.published, false);
    assert.equal(unpublished.revision, 2);
    const unpublishedReplay = await as('authenticated', ids.routePublisher, aal2, () => scalar(
      'select public.unpublish_member_route($1,$2,$3)',
      [eventId, 1, unpublishRequestId],
    ));
    assert.deepEqual(unpublishedReplay, unpublished);
    const hidden = await as('authenticated', ids.owner, aal1, () => scalar(
      'select public.get_member_route($1)', [eventId],
    ));
    assert.deepEqual(hidden, { published: false });
    const editableDraft = await as('authenticated', ids.routePublisher, aal2, () => scalar(
      'select public.get_route_publication($1)', [eventId],
    ));
    assert.equal(editableDraft.published, false);
    assert.equal(editableDraft.revision, 2);
    assert.equal(editableDraft.timeline.start, timeline.start);
  });

  await q(`update marathon_private.event_day_settings
    set timing_enabled=true, completion_desk_enabled=true, self_submission_open=true
    where event_id=$1`, [eventId]);

  await t.test('the completion queue exposes only finish-line fields to an AAL2 desk operator', async () => {
    const queue = await completionQueue(ids.completionDesk, aal2, null, null, 1);
    assert.equal(queue.items.length, 1);
    assert.equal(queue.has_more, true);
    assert.equal(queue.can_review_results, false);
    assert.deepEqual(Object.keys(queue.items[0]).sort(), [
      'certificate_hold',
      'elapsed_seconds',
      'full_name',
      'race',
      'registration_id',
      'registration_number',
      'result_provenance',
      'result_revision',
      'result_status',
    ]);
    assert.equal(queue.items[0].email, undefined);
    assert.equal(queue.items[0].mobile, undefined);
    assert.equal(queue.items[0].transaction_utr, undefined);
    assert.equal(queue.items[0].receipt_path, undefined);
    const administratorQueue = await completionQueue(
      ids.eventAdmin,
      aal2,
      null,
      null,
      1,
    );
    assert.equal(administratorQueue.can_review_results, true);
    await as('authenticated', ids.completionDesk, aal2, () => rejects(
      () => q('select * from marathon_private.completion_record_requests'),
      'permission denied',
    ));
  });

  let recorded;
  await t.test('a desk operator records one idempotent, revision-checked official finish', async () => {
    recorded = await record(
      ids.completionDesk,
      aal2,
      registrations.owner,
      1800,
      0,
      requestIds.recordOwner,
    );
    assert.deepEqual(
      { status: recorded.status, provenance: recorded.provenance, revision: recorded.result_revision },
      { status: 'organiser_recorded', provenance: 'organiser_recorded', revision: 1 },
    );
    assert.deepEqual(
      await record(
        ids.completionDesk,
        aal2,
        registrations.owner,
        1800,
        0,
        requestIds.recordOwner,
      ),
      recorded,
    );
    await rejects(
      () => record(
        ids.completionDesk,
        aal2,
        registrations.owner,
        1801,
        0,
        requestIds.recordOwner,
      ),
      'different payload',
    );
    await rejects(
      () => record(
        ids.completionDesk,
        aal2,
        registrations.owner,
        1801,
        0,
        requestIds.recordOwnerStale,
      ),
      'result changed',
    );
    await rejects(
      () => record(
        ids.completionDesk,
        aal2,
        registrations.owner,
        1801,
        1,
        requestIds.recordOwnerOtherPayload,
      ),
      'official result already exists',
    );
    assert.equal(await scalar(`select count(*)::int from marathon_private.organizer_audit
      where event_id=$1 and request_id=$2 and action='race_completion_recorded'`,
    [eventId, requestIds.recordOwner]), 1);
  });

  await t.test('only an AAL2 event administrator can review or correct a recorded finish', async () => {
    await rejects(
      () => review(
        ids.completionDesk,
        aal2,
        registrations.owner,
        recorded.result_revision,
        'verified',
        null,
        'Finish desk record checked against the official sheet.',
        false,
        requestIds.reviewOwner,
      ),
      'active organiser capability',
    );
    const verified = await review(
      ids.eventAdmin,
      aal2,
      registrations.owner,
      recorded.result_revision,
      'verified',
      null,
      'Finish desk record checked against the official sheet.',
      false,
      requestIds.reviewOwner,
    );
    assert.deepEqual(
      { status: verified.status, revision: verified.result_revision, hold: verified.certificate_hold },
      { status: 'verified', revision: 2, hold: false },
    );
    assert.deepEqual(
      await review(
        ids.eventAdmin,
        aal2,
        registrations.owner,
        recorded.result_revision,
        'verified',
        null,
        'Finish desk record checked against the official sheet.',
        false,
        requestIds.reviewOwner,
      ),
      verified,
    );
    await rejects(
      () => review(
        ids.eventAdmin,
        aal2,
        registrations.owner,
        recorded.result_revision,
        'locked',
        null,
        'Late stale review must not overwrite the verified result.',
        false,
        requestIds.reviewOwnerStale,
      ),
      'result changed',
    );
    assert.equal(await scalar(`select count(*)::int from marathon_private.organizer_audit
      where event_id=$1 and request_id=$2 and action='race_completion_reviewed'`,
    [eventId, requestIds.reviewOwner]), 1);
  });

  await t.test('the public dispatcher keeps own self-time but blocks every legacy organiser mutation', async () => {
    await as('service_role', null, {}, () => q(`insert into marathon_private.race_clocks(
      event_id,race,started_at,started_by,start_request_id
    ) values($1,'5',now()-interval '1 hour',$2,$3)`, [eventId, ids.eventAdmin, requestIds.clock]));
    const selfResult = await as('authenticated', ids.selfRunner, aal1, () => scalar(
      'select public.event_day($1,$2)',
      ['self_time', JSON.stringify({ registration_id: registrations.selfRunner, elapsed_seconds: 1200 })],
    ));
    assert.deepEqual(
      { status: selfResult.status, provenance: selfResult.provenance, revision: selfResult.revision },
      { status: 'participant_submitted', provenance: 'participant_submitted', revision: 1 },
    );
    await as('authenticated', ids.eventAdmin, aal2, () => rejects(
      () => scalar('select public.event_day($1,$2)', [
        'review_result',
        JSON.stringify({ registration_id: registrations.selfRunner, expected_revision: 1 }),
      ]),
      'capability-gated completion operations',
    ));
    await as('authenticated', ids.eventAdmin, aal2, () => rejects(
      () => scalar('select public.event_day($1,$2)', ['start_clock', JSON.stringify({ race: '10' })]),
      'capability-gated completion operations',
    ));
  });

  await t.test('certificate access keeps an owner path and removes the legacy organiser path', async () => {
    const prepare = (actor, assurance, registrationId) => as('service_role', null, {}, () => scalar(
      'select public.prepare_certificate_backend($1,$2,$3,$4)',
      [actor, assurance, registrationId, 'completion'],
    ));
    await rejects(
      () => prepare(ids.owner, 'aal1', registrations.owner),
      'Approved certificate signing has not been configured',
    );
    await q(`update marathon_private.certificate_settings
      set enabled=true,
          signer_name='Synthetic authorised signatory',
          signer_designation='Test appointment',
          signature_object_path='test/signature.png',
          font_object_path='test/font.ttf',
          approval_reference='TEST-ONLY',
          approved_at=now(),
          verification_base_url='https://example.test/'
      where event_id=$1`, [eventId]);

    const ownerCertificate = await prepare(ids.owner, 'aal1', registrations.owner);
    assert.equal(ownerCertificate.certificate.registration_id, registrations.owner);
    await as('service_role', null, {}, () => rejects(
      () => scalar('select public.prepare_certificate_backend($1,$2,$3)', [
        ids.legacyOnly, registrations.owner, 'completion',
      ]),
      'does not exist',
    ));
    await rejects(
      () => prepare(ids.legacyOnly, 'aal2', registrations.owner),
      'active event administrator capability',
    );
    await rejects(
      () => prepare(ids.completionDesk, 'aal2', registrations.owner),
      'active event administrator capability',
    );
    await rejects(
      () => prepare(ids.eventAdmin, 'aal1', registrations.owner),
      'Multi-factor authentication',
    );
    const administratorCertificate = await prepare(ids.eventAdmin, 'aal2', registrations.owner);
    assert.equal(administratorCertificate.certificate.id, ownerCertificate.certificate.id);
    const verified = await as('anon', null, {}, () => scalar(
      'select public.verify_certificate($1)',
      [ownerCertificate.certificate.verification_token],
    ));
    assert.equal(verified.status, 'not_ready');
    await as('authenticated', ids.owner, aal1, () => rejects(
      () => scalar('select public.prepare_certificate_backend($1,$2,$3,$4)', [
        ids.owner, 'aal1', registrations.owner, 'completion',
      ]),
      'permission denied',
    ));
  });

  await db.close();
});
