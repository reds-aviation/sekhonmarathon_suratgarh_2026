import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const migration = () => readFile(
  new URL('../supabase/migrations/202609070007_organiser_roles.sql', import.meta.url),
  'utf8',
);

void test('organiser capabilities require verified AAL2 identities and remain private', async t => {
  const db = new PGlite();
  const q = (sql, args = []) => db.query(sql, args);
  const scalar = async (sql, args = []) => Object.values((await q(sql, args)).rows[0])[0];
  const ids = {
    unverified: '00000000-0000-4000-8000-000000000101',
    reviewer: '00000000-0000-4000-8000-000000000102',
    tshirt: '00000000-0000-4000-8000-000000000103',
    revoked: '00000000-0000-4000-8000-000000000104',
    legacyAdmin: '00000000-0000-4000-8000-000000000105',
    revokedLegacy: '00000000-0000-4000-8000-000000000106',
  };

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
  const requireCapability = (id, claims, capability) => as(
    'service_role',
    id,
    claims,
    () => scalar(
      'select marathon_private.require_active_capability($1,$2)',
      ['suratgarh-2026', capability],
    ),
  );
  const rejects = (fn, fragment) => assert.rejects(fn, error =>
    !fragment || error.message.includes(fragment),
  );

  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema marathon_private;
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
    create table public.event_config(id text primary key);
    create table marathon_private.organizers(
      event_id text not null references public.event_config(id),
      user_id uuid not null references auth.users(id),
      granted_at timestamptz not null default now(),
      revoked_at timestamptz,
      primary key(event_id, user_id)
    );
    grant usage on schema public, auth, marathon_private to anon, authenticated, service_role;
    grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role;
    grant select, insert, update, delete on auth.users to service_role;
  `);
  await q("insert into public.event_config values('suratgarh-2026')");
  await q('insert into auth.users values($1,$2,null,false)', [ids.unverified, 'unverified@example.test']);
  for (const id of Object.values(ids).filter(id => id !== ids.unverified)) {
    await q('insert into auth.users values($1,$2,now(),false)', [id, `${id}@example.test`]);
  }
  await q(
    "insert into marathon_private.organizers(event_id,user_id) values('suratgarh-2026',$1)",
    [ids.legacyAdmin],
  );
  await q(
    "insert into marathon_private.organizers(event_id,user_id,revoked_at) values('suratgarh-2026',$1,now())",
    [ids.revokedLegacy],
  );

  await db.exec(await migration());

  await t.test('active legacy organisers seed exactly one event_admin capability', async () => {
    assert.deepEqual(
      (await q(`select user_id, capability, revoked_at is null as active
        from marathon_private.organizer_capabilities order by user_id`)).rows,
      [{user_id: ids.legacyAdmin, capability: 'event_admin', active: true}],
    );
  });

  await q(`insert into marathon_private.organizer_capabilities(event_id,user_id,capability,granted_by)
    values
      ('suratgarh-2026',$1,'payment_reviewer',$1),
      ('suratgarh-2026',$2,'tshirt_desk',$2),
      ('suratgarh-2026',$3,'completion_desk',$3)`,
    [ids.reviewer, ids.tshirt, ids.revoked],
  );
  await q(`update marathon_private.organizer_capabilities
    set revoked_at=clock_timestamp(), revoked_by=$1, revision=revision+1
    where event_id='suratgarh-2026' and user_id=$1 and capability='completion_desk'`, [ids.revoked]);

  await t.test('missing and unverified identities are refused inside the helper', async () => {
    await rejects(
      () => requireCapability(null, {aal: 'aal2'}, 'payment_reviewer'),
      'verified email sign-in',
    );
    await rejects(
      () => requireCapability(ids.unverified, {aal: 'aal2'}, 'payment_reviewer'),
      'verified email sign-in',
    );
  });

  await t.test('AAL1, revoked and unrelated roles are refused', async () => {
    await rejects(
      () => requireCapability(ids.reviewer, {aal: 'aal1'}, 'payment_reviewer'),
      'Multi-factor authentication',
    );
    await rejects(
      () => requireCapability(ids.revoked, {aal: 'aal2'}, 'completion_desk'),
      'active organiser capability',
    );
    await rejects(
      () => requireCapability(ids.tshirt, {aal: 'aal2'}, 'payment_reviewer'),
      'active organiser capability',
    );
    await rejects(
      () => requireCapability(ids.legacyAdmin, {aal: 'aal2'}, null),
      'Unknown organiser capability',
    );
  });

  await t.test('the matching AAL2 capability and event_admin are accepted', async () => {
    assert.equal(
      await requireCapability(ids.reviewer, {aal: 'aal2'}, 'payment_reviewer'),
      ids.reviewer,
    );
    assert.equal(
      await requireCapability(ids.legacyAdmin, {aal: 'aal2'}, 'route_publisher'),
      ids.legacyAdmin,
    );
  });

  await t.test('audit entries carry the server record and cannot be rewritten', async () => {
    const requestId = '10000000-0000-4000-8000-000000000201';
    const auditId = await as('service_role', ids.reviewer, {aal: 'aal2'}, () => scalar(
      `select marathon_private.record_organizer_audit(
        'suratgarh-2026', 'payment_reviewer', 'payment_reviewed', $1,
        '{"registration_id":"synthetic"}'::jsonb, 3, '{"status":"verified"}'::jsonb
      )`,
      [requestId],
    ));
    const audit = (await q(`select actor_id, capability, action, request_id, target, revision, details,
      server_time is not null as server_recorded
      from marathon_private.organizer_audit where id=$1`, [auditId])).rows[0];
    assert.deepEqual(audit, {
      actor_id: ids.reviewer,
      capability: 'payment_reviewer',
      action: 'payment_reviewed',
      request_id: requestId,
      target: {registration_id: 'synthetic'},
      revision: 3,
      details: {status: 'verified'},
      server_recorded: true,
    });
    await rejects(
      () => q('update marathon_private.organizer_audit set action=$1 where id=$2', ['changed', auditId]),
      'immutable',
    );
  });

  await t.test('regular authenticated users cannot read private roles or audit records', async () => {
    await as('authenticated', ids.reviewer, {aal: 'aal2'}, () => rejects(
      () => q('select * from marathon_private.organizer_capabilities'),
      'permission denied',
    ));
    await as('authenticated', ids.reviewer, {aal: 'aal2'}, () => rejects(
      () => q('select * from marathon_private.organizer_audit'),
      'permission denied',
    ));
    await as('authenticated', ids.reviewer, {aal: 'aal2'}, () => rejects(
      () => q("select marathon_private.require_active_capability('suratgarh-2026','payment_reviewer')"),
      'permission denied',
    ));
  });

  await db.close();
});
