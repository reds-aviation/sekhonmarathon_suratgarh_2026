import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const eventId = 'suratgarh-2026';
const participants = {
  legacy: '00000000-0000-4000-8000-000000000401',
  future: '00000000-0000-4000-8000-000000000402',
};

const migration = name => readFile(
  new URL(`../supabase/migrations/${name}`, import.meta.url),
  'utf8',
);

async function fixture() {
  const db = new PGlite();
  const q = (sql, args = []) => db.query(sql, args);
  const scalar = async (sql, args = []) => Object.values((await q(sql, args)).rows[0])[0];
  const as = async (role, userId, fn) => {
    await db.exec(`set role ${role}`);
    await q("select set_config('request.jwt.claim.sub',$1,false)", [userId ?? '']);
    await q("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({aal: 'aal2'})]);
    try {
      return await fn();
    } finally {
      await db.exec('reset role');
      await q("select set_config('request.jwt.claim.sub','',false)");
      await q("select set_config('request.jwt.claims','',false)");
    }
  };

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

  for (const [label, id] of Object.entries(participants)) {
    await q(
      'insert into auth.users(id,email,email_confirmed_at,is_anonymous) values($1,$2,now(),false)',
      [id, `${label}@example.test`],
    );
  }

  for (const name of [
    '202609050001_marathon.sql',
    '202609050004_event_day.sql',
    '202609070006_confirmed_race_fees.sql',
    '202609070007_organiser_roles.sql',
    '202609070008_payment_attempts.sql',
    '202609070009_payment_operations.sql',
  ]) {
    await db.exec(await migration(name));
  }

  await q(`update public.event_config
    set event_starts_at=now()+interval '2 days',
        registration_deadline=now()+interval '1 day',
        payment_qr_url='https://example.test/qr.png',
        payee_name='Synthetic payment desk',
        upi_id='synthetic@upi',
        payment_configured=true,
        registration_open=true
    where id=$1`, [eventId]);
  const invitationId = await scalar(`insert into marathon_private.invitations(
    event_id,label,code_sha256,expires_at
  ) values($1,'Receipt integrity test',repeat('a',64),now()+interval '1 day') returning id`, [eventId]);
  for (const userId of Object.values(participants)) {
    await q(
      'insert into marathon_private.memberships(event_id,user_id,invitation_id) values($1,$2,$3)',
      [eventId, userId, invitationId],
    );
  }

  let ordinal = 1;
  const insertRegistration = async ({userId, transactionId, digest, includeDigest}) => {
    const submissionId = `10000000-0000-4000-8000-${String(ordinal).padStart(12, '0')}`;
    ordinal += 1;
    const receiptPath = `${userId}/${submissionId}/receipt.png`;
    await as('service_role', null, () => q(
      "insert into storage.objects(bucket_id,name,metadata) values('payment-receipts',$1,'{\"size\":500,\"mimetype\":\"image/png\"}')",
      [receiptPath],
    ));
    const digestColumns = includeDigest ? ',receipt_digest_sha256' : '';
    const digestValues = includeDigest ? ',$6' : '';
    return as('service_role', null, () => scalar(`insert into public.registrations(
      event_id,user_id,submission_id,full_name,mobile,email,dob,gender,race,tshirt,
      blood_group,emergency_contact,city,participant_type,transaction_id,receipt_path,
      consent,fee_paise${digestColumns}
    ) values(
      $1,$2,$3,'Receipt Test Runner','9123456789','ignored@example.test','1990-01-01','male','5','M',
      'O+','9234567890','Suratgarh','airwarrior',$4,$5,true,1${digestValues}
    ) returning id`, includeDigest
      ? [eventId, userId, submissionId, transactionId, receiptPath, digest]
      : [eventId, userId, submissionId, transactionId, receiptPath]));
  };

  return {as, db, insertRegistration, q, scalar};
}

test('receipt integrity migration keeps historic evidence honest and copies server digests into the private ledger', async t => {
  const [migrationSql, functionSource] = await Promise.all([
    migration('202609070010_receipt_integrity.sql'),
    readFile(new URL('../supabase/functions/submit-registration/index.ts', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(migrationSql, /\bbib(?:s)?\b/iu);
  assert.match(migrationSql, /add column if not exists receipt_digest_sha256/i);
  assert.match(migrationSql, /A server-computed receipt SHA-256 digest is required/);
  assert.match(functionSource, /receiptDigestSha256\(bytes\)/);
  assert.match(functionSource, /receipt_digest_sha256:receiptDigest/);

  const {as, db, insertRegistration, q, scalar} = await fixture();
  const legacyRegistration = await insertRegistration({
    userId: participants.legacy,
    transactionId: 'LEGACY-RECEIPT-401',
    includeDigest: false,
  });
  const preMigrationAttempt = (await q(`select receipt_digest_state,receipt_digest_sha256,
    source_revision from marathon_private.payment_attempts where registration_id=$1`, [legacyRegistration])).rows[0];
  assert.deepEqual({...preMigrationAttempt, source_revision: Number(preMigrationAttempt.source_revision)}, {
    receipt_digest_state: 'legacy_unavailable',
    receipt_digest_sha256: null,
    source_revision: 1,
  });

  await db.exec(migrationSql);

  await t.test('pre-upgrade receipt evidence remains intentionally unhashed', async () => {
    const legacy = (await q(`select r.receipt_digest_sha256,a.receipt_digest_state,
      a.receipt_digest_sha256 as attempt_digest
      from public.registrations r
      join marathon_private.payment_attempts a on a.registration_id=r.id
      where r.id=$1`, [legacyRegistration])).rows[0];
    assert.deepEqual(legacy, {
      receipt_digest_sha256: null,
      receipt_digest_state: 'legacy_unavailable',
      attempt_digest: null,
    });
  });

  await t.test('a post-upgrade submission fails closed without its Edge-computed digest', async () => {
    await assert.rejects(
      () => insertRegistration({
        userId: participants.future,
        transactionId: 'MISSING-DIGEST-402',
        includeDigest: true,
        digest: null,
      }),
      /server-computed receipt SHA-256 digest/i,
    );
    assert.equal(await scalar('select count(*)::int from public.registrations'), 1);
  });

  await t.test('a future submission stores one canonical digest in both records', async () => {
    const suppliedDigest = 'B'.repeat(64);
    const registrationId = await insertRegistration({
      userId: participants.future,
      transactionId: 'Future-UTR-402',
      includeDigest: true,
      digest: suppliedDigest,
    });
    const row = (await q(`select r.receipt_digest_sha256,a.receipt_digest_state,
      a.receipt_digest_sha256 as attempt_digest,a.normalized_utr,a.revision,a.source_revision
      from public.registrations r
      join marathon_private.payment_attempts a on a.registration_id=r.id
      where r.id=$1`, [registrationId])).rows[0];
    assert.deepEqual({...row, source_revision: Number(row.source_revision)}, {
      receipt_digest_sha256: suppliedDigest.toLowerCase(),
      receipt_digest_state: 'sha256',
      attempt_digest: suppliedDigest.toLowerCase(),
      normalized_utr: 'FUTUREUTR402',
      revision: 1,
      source_revision: Number(preMigrationAttempt.source_revision) + 1,
    });
    await assert.rejects(
      () => as('service_role', null, () => q(
        'update public.registrations set receipt_digest_sha256=$1 where id=$2',
        ['c'.repeat(64), registrationId],
      )),
      /Submitted registration fields are immutable/,
    );
  });

  await t.test('browser roles still cannot write submissions or read the private payment ledger', async () => {
    await assert.rejects(
      () => as('authenticated', participants.future, () => q(
        'update public.registrations set receipt_digest_sha256=$1 where user_id=$2',
        ['d'.repeat(64), participants.future],
      )),
      /permission denied/,
    );
    await assert.rejects(
      () => as('authenticated', participants.future, () => q(
        'select * from marathon_private.payment_attempts',
      )),
      /permission denied/,
    );
  });

  await db.close();
});
