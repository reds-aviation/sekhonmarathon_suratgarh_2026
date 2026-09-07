import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const eventId = 'suratgarh-2026';
const ids = {
  owner: '00000000-0000-4000-8000-000000000701',
  other: '00000000-0000-4000-8000-000000000702',
  pending: '00000000-0000-4000-8000-000000000703',
  verified: '00000000-0000-4000-8000-000000000704',
  reviewer: '00000000-0000-4000-8000-000000000705',
  unverified: '00000000-0000-4000-8000-000000000706',
};
const requestIds = {
  owner: '10000000-0000-4000-8000-000000000701',
  other: '10000000-0000-4000-8000-000000000702',
  pending: '10000000-0000-4000-8000-000000000703',
  verified: '10000000-0000-4000-8000-000000000704',
  reused: '10000000-0000-4000-8000-000000000705',
  rejectOwner: '20000000-0000-4000-8000-000000000701',
  rejectOther: '20000000-0000-4000-8000-000000000702',
  verify: '20000000-0000-4000-8000-000000000703',
};
const migration = name => readFile(
  new URL(`../supabase/migrations/${name}`, import.meta.url),
  'utf8',
);

async function fixture() {
  const db = new PGlite();
  const q = (sql, args = []) => db.query(sql, args);
  const scalar = async (sql, args = []) => Object.values((await q(sql, args)).rows[0])[0];
  const as = async (role, userId, claims, fn) => {
    await db.exec(`set role ${role}`);
    await q("select set_config('request.jwt.claim.sub',$1,false)", [userId ?? '']);
    await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims ?? {})]);
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
      await q("select set_config('request.jwt.claim.sub','',false)");
      await q("select set_config('request.jwt.claims','',false)");
    }
  };
  const rejects = (fn, text) => assert.rejects(fn, error => !text || error.message.includes(text));

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
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
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
  for (const name of [
    '202609050001_marathon.sql',
    '202609050004_event_day.sql',
    '202609070006_confirmed_race_fees.sql',
    '202609070007_organiser_roles.sql',
    '202609070008_payment_attempts.sql',
    '202609070009_payment_operations.sql',
    '202609070010_receipt_integrity.sql',
    '202609070011_drive_mirror.sql',
    '202609070012_tshirt_collections.sql',
    '202609070013_payment_corrections.sql',
  ]) await db.exec(await migration(name));

  await q(`update public.event_config
    set event_starts_at=now()+interval '2 days',
        registration_deadline=now()+interval '1 day',
        payment_qr_url='https://example.test/qr.png',
        payee_name='Synthetic payment desk',
        upi_id='synthetic@upi',
        payment_configured=true,
        registration_open=true
    where id=$1`, [eventId]);
  await q(`insert into marathon_private.organizer_capabilities(
    event_id,user_id,capability,granted_by
  ) values($1,$2,'payment_reviewer',$2)`, [eventId, ids.reviewer]);
  const invitationId = await scalar(`insert into marathon_private.invitations(
    event_id,label,code_sha256,expires_at
  ) values($1,'Correction test',repeat('a',64),now()+interval '1 day') returning id`, [eventId]);
  for (const id of [ids.owner, ids.other, ids.pending, ids.verified]) {
    await q('insert into marathon_private.memberships(event_id,user_id,invitation_id) values($1,$2,$3)', [
      eventId, id, invitationId,
    ]);
  }

  let registrationOrdinal = 1;
  const registration = async (userId, utr) => {
    const submissionId = `30000000-0000-4000-8000-${String(registrationOrdinal).padStart(12, '0')}`;
    registrationOrdinal += 1;
    const receiptPath = `${userId}/${submissionId}/receipt.png`;
    return as('service_role', null, {}, async () => {
      await q(
        "insert into storage.objects(bucket_id,name,metadata) values('payment-receipts',$1,'{\"size\":500,\"mimetype\":\"image/png\"}')",
        [receiptPath],
      );
      return scalar(`insert into public.registrations(
        event_id,user_id,submission_id,full_name,mobile,email,dob,gender,race,tshirt,
        blood_group,emergency_contact,city,participant_type,transaction_id,receipt_path,
        consent,fee_paise,receipt_digest_sha256
      ) values(
        $1,$2,$3,'Correction Runner','9123456789','ignored@example.test','1990-01-01','male','5','M',
        'O+','9234567890','Suratgarh','airwarrior',$4,$5,true,39900,repeat('a',64)
      ) returning id`, [eventId, userId, submissionId, utr, receiptPath]);
    });
  };
  const review = (attemptId, status, note, requestId) => as('authenticated', ids.reviewer, {aal: 'aal2'}, () => scalar(
    'select public.review_payment_attempt($1,$2,$3,$4,$5,$6)',
    [eventId, attemptId, 1, status, note, requestId],
  ));
  const attempt = async registrationId => (await q(`select * from marathon_private.payment_attempts
    where registration_id=$1 order by attempt_ordinal desc`, [registrationId])).rows[0];
  const correction = (actor, registrationId, transactionId, receiptPath, digest, requestId) => as(
    'authenticated', actor, {aal: 'aal1'}, () => scalar(
      'select public.submit_payment_correction($1,$2,$3,$4,$5,$6)',
      [eventId, registrationId, transactionId, receiptPath, digest, requestId],
    ),
  );
  const correctionPath = (actor, registrationId, requestId, ext = 'png') =>
    `${actor}/payment-corrections/${registrationId}/${requestId}/receipt.${ext}`;
  const addReceipt = (path, mime = 'image/png', size = 500) => as('service_role', null, {}, () => q(
    "insert into storage.objects(bucket_id,name,metadata) values('payment-receipts',$1,jsonb_build_object('size',$2::bigint,'mimetype',$3::text))",
    [path, size, mime],
  ));
  return {as, attempt, correction, correctionPath, db, q, registration, review, rejects, addReceipt};
}

test('rejected payment corrections create a new immutable proof and private Drive evidence reference', async t => {
  const [migrationSql, functionSource, validationSource, submitSource, proofSource] = await Promise.all([
    migration('202609070013_payment_corrections.sql'),
    readFile(new URL('../supabase/functions/correct-payment/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/submit-registration/validation.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/submit-registration/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/functions/organiser-payment-proof/index.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(migrationSql, /\bbib(?:s)?\b/iu);
  assert.match(migrationSql, /payment_correction_requests/i);
  assert.match(migrationSql, /Only a rejected payment can be corrected/);
  assert.match(migrationSql, /receipt_digest_sha256/i);
  assert.match(migrationSql, /payment_attempt_id/i);
  assert.match(functionSource, /receiptExtension\(bytes,receipt\.type\)/);
  assert.match(functionSource, /receiptDigestSha256\(bytes\)/);
  assert.match(functionSource, /upsert:false/);
  assert.match(functionSource, /submit_payment_correction/);
  assert.doesNotMatch(functionSource, /payment_status:\s*['"]verified/i);
  assert.match(validationSource, /validatePaymentCorrectionPayload/);
  assert.match(submitSource, /SITE_ORIGIN must be configured as an HTTPS origin/);
  assert.doesNotMatch(submitSource, /reds-aviation\.github\.io/);
  assert.match(proofSource, /payment-corrections/);

  const {as, attempt, correction, correctionPath, db, q, registration, review, rejects, addReceipt} = await fixture();
  const ownerRegistration = await registration(ids.owner, 'ORIGINAL-UTR-701');
  const otherRegistration = await registration(ids.other, 'OTHER-UTR-702');
  const pendingRegistration = await registration(ids.pending, 'PENDING-UTR-703');
  const verifiedRegistration = await registration(ids.verified, 'VERIFIED-UTR-704');
  const ownerAttempt = await attempt(ownerRegistration);
  const otherAttempt = await attempt(otherRegistration);
  const verifiedAttempt = await attempt(verifiedRegistration);
  await review(ownerAttempt.id, 'rejected', 'The original reference does not match the payment statement.', requestIds.rejectOwner);
  await review(otherAttempt.id, 'rejected', 'The original reference does not match the payment statement.', requestIds.rejectOther);
  await review(verifiedAttempt.id, 'verified', 'Matched the station payment statement.', requestIds.verify);

  const replacementPath = correctionPath(ids.owner, ownerRegistration, requestIds.owner);
  await addReceipt(replacementPath);
  const digest = 'b'.repeat(64);
  const outcome = await correction(
    ids.owner, ownerRegistration, 'REPLACEMENT-UTR-701', replacementPath, digest, requestIds.owner,
  );

  await t.test('owner correction returns a review-pending replacement attempt and is idempotent', async () => {
    assert.deepEqual(outcome.status, 'pending_review');
    assert.equal(outcome.attempt_ordinal, 2);
    assert.equal(outcome.attempt_revision, 1);
    assert.ok(Number(outcome.source_revision) > Number(ownerAttempt.source_revision));
    const retry = await correction(
      ids.owner, ownerRegistration, 'REPLACEMENT-UTR-701', replacementPath, digest, requestIds.owner,
    );
    assert.deepEqual(retry, outcome);
    assert.equal(await (async () => (await q(`select count(*)::int as count from marathon_private.payment_attempts
      where registration_id=$1`, [ownerRegistration])).rows[0].count)(), 2);
    await rejects(
      () => correction(ids.owner, ownerRegistration, 'DIFFERENT-UTR-701', replacementPath, digest, requestIds.owner),
      'different payload',
    );
  });

  await t.test('the original proof stays rejected and the public summary moves atomically to the new proof', async () => {
    const attempts = (await q(`select attempt_ordinal,status,transaction_utr,receipt_path,receipt_digest_sha256,
      source_revision from marathon_private.payment_attempts where registration_id=$1 order by attempt_ordinal`, [ownerRegistration])).rows;
    assert.deepEqual(attempts.map(row => ({
      ordinal:row.attempt_ordinal,
      status:row.status,
      receipt:row.receipt_path,
      digest:row.receipt_digest_sha256,
    })), [
      {ordinal:1,status:'rejected',receipt:ownerAttempt.receipt_path,digest:'a'.repeat(64)},
      {ordinal:2,status:'pending_review',receipt:replacementPath,digest:digest},
    ]);
    assert.ok(Number(attempts[1].source_revision) > Number(attempts[0].source_revision));
    const summary = (await q(`select payment_status,transaction_id,receipt_path,receipt_digest_sha256,
      reviewed_at,reviewed_by,review_note from public.registrations where id=$1`, [ownerRegistration])).rows[0];
    assert.deepEqual(summary, {
      payment_status:'pending_review',
      transaction_id:'replacement-utr-701',
      receipt_path:replacementPath,
      receipt_digest_sha256:digest,
      reviewed_at:null,
      reviewed_by:null,
      review_note:null,
    });
    const audit = (await q(`select actor_id,registration_id,normalized_utr,outcome,completed_at is not null as completed
      from marathon_private.payment_correction_requests where event_id=$1 and request_id=$2`, [eventId, requestIds.owner])).rows[0];
    assert.equal(audit.actor_id, ids.owner);
    assert.equal(audit.registration_id, ownerRegistration);
    assert.equal(audit.normalized_utr, 'REPLACEMENTUTR701');
    assert.equal(audit.outcome.payment_attempt_id, outcome.payment_attempt_id);
    assert.equal(audit.completed, true);
  });

  await t.test('other people, unverified accounts, pending payments and verified payments cannot use the correction path', async () => {
    const otherPath = correctionPath(ids.other, ownerRegistration, requestIds.other);
    await addReceipt(otherPath);
    await rejects(
      () => correction(ids.other, ownerRegistration, 'OTHER-CORRECTION-702', otherPath, 'c'.repeat(64), requestIds.other),
      'own payment',
    );
    const pendingPath = correctionPath(ids.pending, pendingRegistration, requestIds.pending);
    await addReceipt(pendingPath);
    await rejects(
      () => correction(ids.pending, pendingRegistration, 'PENDING-CORRECTION-703', pendingPath, 'd'.repeat(64), requestIds.pending),
      'Only a rejected payment',
    );
    const verifiedPath = correctionPath(ids.verified, verifiedRegistration, requestIds.verified);
    await addReceipt(verifiedPath);
    await rejects(
      () => correction(ids.verified, verifiedRegistration, 'VERIFIED-CORRECTION-704', verifiedPath, 'e'.repeat(64), requestIds.verified),
      'Only a rejected payment',
    );
    await rejects(
      () => correction(ids.unverified, otherRegistration, 'UNVERIFIED-UTR-706', otherPath, 'f'.repeat(64), requestIds.reused),
      'verified email',
    );
  });

  await t.test('canonical UTRs remain globally unique and private Drive uses payment-attempt IDs', async () => {
    const otherPath = correctionPath(ids.other, otherRegistration, requestIds.reused);
    await addReceipt(otherPath);
    await rejects(
      () => correction(ids.other, otherRegistration, 'replacement-utr-701', otherPath, 'c'.repeat(64), requestIds.reused),
      'already been submitted',
    );
    const replacementAttempt = await attempt(ownerRegistration);
    const mirror = await as('service_role', null, {}, async () => Object.values((await q(
      'select public.drive_mirror_batch($1,$2,$3)', [eventId, Number(ownerAttempt.source_revision), 20],
    )).rows[0])[0]);
    const correctedRecord = mirror.records.find(record => record.payment_attempt_id === replacementAttempt.id);
    assert.ok(correctedRecord);
    assert.equal(correctedRecord.payment_attempt_ordinal, 2);
    assert.equal(correctedRecord.receipt_available, true);
    const currentReceipt = await as('service_role', null, {}, async () => Object.values((await q(
      'select public.drive_mirror_receipt($1,$2)', [eventId, replacementAttempt.id],
    )).rows[0])[0]);
    assert.deepEqual(currentReceipt, {
      payment_attempt_id:replacementAttempt.id,
      storage_bucket:'payment-receipts',
      receipt_path:replacementPath,
    });
    const historicReceipt = await as('service_role', null, {}, async () => Object.values((await q(
      'select public.drive_mirror_receipt($1,$2)', [eventId, ownerAttempt.id],
    )).rows[0])[0]);
    assert.equal(historicReceipt.receipt_path, ownerAttempt.receipt_path);
    await rejects(() => as('authenticated', ids.owner, {aal:'aal1'}, () => q(
      'select public.drive_mirror_receipt($1,$2)', [eventId, replacementAttempt.id],
    )), 'permission denied');
    await as('service_role', null, {}, () => q(`update marathon_private.memberships
      set revoked_at=clock_timestamp() where event_id=$1 and user_id=$2`, [eventId, ids.other]));
    const revokedPath = correctionPath(ids.other, otherRegistration, '10000000-0000-4000-8000-000000000799');
    await addReceipt(revokedPath);
    await rejects(
      () => correction(ids.other, otherRegistration, 'REVOKED-MEMBERSHIP-799', revokedPath, 'd'.repeat(64), '10000000-0000-4000-8000-000000000799'),
      'station invitation membership',
    );
  });

  await db.close();
});
