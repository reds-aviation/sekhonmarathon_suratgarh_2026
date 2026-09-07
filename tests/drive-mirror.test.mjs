import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const eventId = 'suratgarh-2026';
const ids = {
  participant: '00000000-0000-4000-8000-000000000611',
  reviewer: '00000000-0000-4000-8000-000000000612',
};
const requestIds = {
  review: '10000000-0000-4000-8000-000000000611',
  nonce: '20000000-0000-4000-8000-000000000611',
  staleNonce: '20000000-0000-4000-8000-000000000612',
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
    '202609070010_receipt_integrity.sql',
    '202609070011_drive_mirror.sql',
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
  await q(`insert into marathon_private.organizer_capabilities(
      event_id,user_id,capability,granted_by
    ) values($1,$2,'payment_reviewer',$2)`, [eventId, ids.reviewer]);
  const invitationId = await scalar(`insert into marathon_private.invitations(
    event_id,label,code_sha256,expires_at
  ) values($1,'Drive mirror test',repeat('a',64),now()+interval '1 day') returning id`, [eventId]);
  await q(
    'insert into marathon_private.memberships(event_id,user_id,invitation_id) values($1,$2,$3)',
    [eventId, ids.participant, invitationId],
  );

  const submissionId = '10000000-0000-4000-8000-000000000699';
  const receiptPath = `${ids.participant}/${submissionId}/receipt.png`;
  await as('service_role', null, {}, () => q(
    "insert into storage.objects(bucket_id,name,metadata) values('payment-receipts',$1,'{\"size\":500,\"mimetype\":\"image/png\"}')",
    [receiptPath],
  ));
  const registrationId = await as('service_role', null, {}, () => scalar(`insert into public.registrations(
    event_id,user_id,submission_id,full_name,mobile,email,dob,gender,race,tshirt,
    blood_group,emergency_contact,city,participant_type,transaction_id,receipt_path,
    consent,fee_paise,receipt_digest_sha256
  ) values(
    $1,$2,$3,'Mirror Runner','9123456789','ignored@example.test','1990-01-01','male','5','M',
    'O+','9234567890','Suratgarh','airwarrior','MIRROR-UTR-611',$4,true,1,repeat('b',64)
  ) returning id`, [eventId, ids.participant, submissionId, receiptPath]));
  const attempt = (await q(`select id, source_revision from marathon_private.payment_attempts
    where registration_id=$1`, [registrationId])).rows[0];

  return {as, attempt, db, q, registrationId, scalar};
}

test('private Drive mirror only exposes revisioned operational data to the service integration', async t => {
  const [migrationSql, functionSource, scriptSource, manifest] = await Promise.all([
    migration('202609070011_drive_mirror.sql'),
    readFile(new URL('../supabase/functions/drive-register/index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../integrations/google-drive/Code.gs', import.meta.url), 'utf8'),
    readFile(new URL('../integrations/google-drive/appsscript.json', import.meta.url), 'utf8'),
  ]);
  const retiredBearer = ['DRIVE', 'SYNC_TOKEN'].join('_');
  const retiredOrganizer = ['DRIVE', 'ORGANIZER_USER_ID'].join('_');
  const retiredPublish = ['publish', 'PaymentReviews'].join('');

  assert.doesNotMatch(migrationSql, /\bbib(?:s)?\b/iu);
  assert.match(migrationSql, /drive_mirror_nonces/i);
  assert.match(migrationSql, /timestamp is outside the five minute window/i);
  assert.match(migrationSql, /public\.claim_drive_mirror_nonce/i);
  assert.match(migrationSql, /grant execute on function public\.claim_drive_mirror_nonce[\s\S]*?to service_role/i);
  assert.doesNotMatch(migrationSql, /grant execute[\s\S]{0,300}to authenticated/i);

  assert.match(functionSource, /DRIVE_MIRROR_HMAC_SECRET/);
  assert.match(functionSource, /MAX_CLOCK_SKEW_SECONDS = 300/);
  assert.match(functionSource, /timingSafeEqualHex/);
  assert.match(functionSource, /claim_drive_mirror_nonce/);
  assert.match(functionSource, /request\.headers\.get\('Origin'\)/);
  assert.match(functionSource, /SIGNED_URL_TTL_SECONDS = 60/);
  assert.doesNotMatch(functionSource, /Access-Control-Allow/i);
  assert.doesNotMatch(functionSource, new RegExp(`${retiredBearer}|${retiredOrganizer}|action\\s*===\\s*['\"]review`, 'i'));

  assert.match(scriptSource, /DRIVE_MIRROR_HMAC_SECRET/);
  assert.match(scriptSource, /HMAC_AUDIENCE_ = 'drive-register'/);
  assert.match(scriptSource, /DRIVE_MIRROR_AFTER_SOURCE_REVISION/);
  assert.match(scriptSource, /Source revision/);
  assert.match(scriptSource, /T-shirt issued/);
  assert.doesNotMatch(scriptSource, new RegExp(
    `onOpen|${retiredPublish}|getUi|${retiredBearer}|action\\s*:\\s*['\"]review`, 'i',
  ));
  assert.doesNotMatch(manifest, /script\.container\.ui/i);

  const {as, attempt, db, q, registrationId, scalar} = await fixture();

  await t.test('only service_role can claim a nonce or read the private mirror wrappers', async () => {
    await assert.rejects(
      () => as('authenticated', ids.participant, {aal: 'aal2'}, () => scalar(
        "select public.drive_mirror_batch('suratgarh-2026',0,10)",
      )),
      /permission denied/,
    );
    await assert.rejects(
      () => as('authenticated', ids.participant, {aal: 'aal2'}, () => q(
        'select * from marathon_private.drive_mirror_nonces',
      )),
      /permission denied/,
    );
    await assert.rejects(
      () => as('anon', null, {}, () => scalar(
        "select public.claim_drive_mirror_nonce($1,$2,repeat('a',64),'sync')",
        [requestIds.nonce, Math.floor(Date.now() / 1000)],
      )),
      /permission denied/,
    );
  });

  await t.test('mirror records use payment source revisions and retain no storage path', async () => {
    const first = await as('service_role', null, {}, () => scalar(
      'select public.drive_mirror_batch($1,$2,$3)', [eventId, 0, 10],
    ));
    assert.equal(first.has_more, false);
    assert.equal(first.records.length, 1);
    assert.deepEqual(first.records[0].registration_id, registrationId);
    assert.deepEqual(Number(first.records[0].source_revision), Number(attempt.source_revision));
    assert.equal(first.records[0].receipt_path, undefined);
    assert.equal(first.records[0].receipt_available, true);
    assert.equal(first.records[0].payment_status, 'pending_review');

    const reviewed = await as('authenticated', ids.reviewer, {aal: 'aal2'}, () => scalar(
      'select public.review_payment_attempt($1,$2,$3,$4,$5,$6)', [
        eventId, attempt.id, 1, 'verified', 'Verified against the station payment record.', requestIds.review,
      ],
    ));
    const second = await as('service_role', null, {}, () => scalar(
      'select public.drive_mirror_batch($1,$2,$3)', [eventId, Number(first.next_after_source_revision), 10],
    ));
    assert.equal(second.records.length, 1);
    assert.equal(second.records[0].registration_id, registrationId);
    assert.equal(second.records[0].payment_status, 'verified');
    assert.equal(second.records[0].payment_attempt_status, 'verified');
    assert.equal(Number(second.records[0].source_revision), Number(reviewed.source_revision));
  });

  await t.test('a persisted nonce rejects both replay and stale timestamps', async () => {
    const now = Math.floor(Date.now() / 1000);
    const firstClaim = await as('service_role', null, {}, () => scalar(
      "select public.claim_drive_mirror_nonce($1,$2,repeat('c',64),'sync')",
      [requestIds.nonce, now],
    ));
    assert.deepEqual(firstClaim, {accepted: true});
    await assert.rejects(
      () => as('service_role', null, {}, () => scalar(
        "select public.claim_drive_mirror_nonce($1,$2,repeat('c',64),'sync')",
        [requestIds.nonce, now],
      )),
      /already used/,
    );
    await assert.rejects(
      () => as('service_role', null, {}, () => scalar(
        "select public.claim_drive_mirror_nonce($1,$2,repeat('d',64),'sync')",
        [requestIds.staleNonce, now - 301],
      )),
      /outside the five minute window/,
    );
  });

  await t.test('only the service integration can resolve the private receipt path', async () => {
    const receipt = await as('service_role', null, {}, () => scalar(
      'select public.drive_mirror_receipt($1,$2)', [eventId, registrationId],
    ));
    assert.deepEqual(receipt, {
      storage_bucket: 'payment-receipts',
      receipt_path: `${ids.participant}/10000000-0000-4000-8000-000000000699/receipt.png`,
    });
    await assert.rejects(
      () => as('authenticated', ids.participant, {aal: 'aal2'}, () => scalar(
        'select public.drive_mirror_receipt($1,$2)', [eventId, registrationId],
      )),
      /permission denied/,
    );
  });

  await db.close();
});
