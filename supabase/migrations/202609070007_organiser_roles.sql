-- Secure organiser capability foundation. Apply after 202609070006_confirmed_race_fees.sql.
-- This deliberately leaves legacy marathon_private.organizers and its callers
-- unchanged; later operations can migrate one capability at a time.
begin;

create table if not exists marathon_private.organizer_capabilities (
  event_id text not null references public.event_config(id),
  user_id uuid not null references auth.users(id),
  capability text not null check (capability in (
    'event_admin',
    'payment_reviewer',
    'tshirt_desk',
    'completion_desk',
    'route_publisher'
  )),
  granted_at timestamptz not null default clock_timestamp(),
  granted_by uuid references auth.users(id),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revision integer not null default 1 check (revision >= 1),
  primary key (event_id, user_id, capability),
  check (revoked_at is null or revoked_at >= granted_at)
);

-- This is append-only evidence for privileged event operations. It is not a
-- browser-facing history and it never carries participant records by default.
create table if not exists marathon_private.organizer_audit (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.event_config(id),
  actor_id uuid not null references auth.users(id),
  capability text not null check (capability in (
    'event_admin',
    'payment_reviewer',
    'tshirt_desk',
    'completion_desk',
    'route_publisher'
  )),
  action text not null check (char_length(btrim(action)) between 1 and 120),
  request_id uuid not null,
  target jsonb not null default '{}'::jsonb
    check (jsonb_typeof(target) = 'object' and octet_length(target::text) <= 4096),
  revision integer check (revision is null or revision >= 0),
  details jsonb not null default '{}'::jsonb
    check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 16384),
  server_time timestamptz not null default clock_timestamp()
);
create index if not exists organizer_audit_event_time_idx
  on marathon_private.organizer_audit(event_id, server_time desc);
create index if not exists organizer_audit_request_idx
  on marathon_private.organizer_audit(event_id, request_id);

alter table marathon_private.organizer_capabilities enable row level security;
alter table marathon_private.organizer_audit enable row level security;

-- No browser role can enumerate capability assignments or privileged activity.
revoke all on table marathon_private.organizer_capabilities,
  marathon_private.organizer_audit from public, anon, authenticated;
grant select, insert, update, delete on table marathon_private.organizer_capabilities,
  marathon_private.organizer_audit to service_role;

-- Keep active legacy organisers in control of the next migration phase. An
-- existing explicit revocation is never overwritten by this idempotent seed.
insert into marathon_private.organizer_capabilities(
  event_id, user_id, capability, granted_at, granted_by
)
select o.event_id, o.user_id, 'event_admin', o.granted_at, o.user_id
from marathon_private.organizers o
where o.revoked_at is null
on conflict (event_id, user_id, capability) do nothing;

-- The prerequisite is deliberately private. Future SECURITY DEFINER operations
-- can call this first, while browser roles cannot call it directly.
create or replace function marathon_private.require_verified_aal2()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'A verified email sign-in is required' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from auth.users u
    where u.id = v_actor
      and u.email_confirmed_at is not null
      and nullif(btrim(u.email), '') is not null
      and not coalesce(u.is_anonymous, false)
  ) then
    raise exception 'A verified email sign-in is required' using errcode = '42501';
  end if;

  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Multi-factor authentication is required for organiser operations'
      using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

-- event_admin is the only broad capability. Every other role authorises only
-- the operation named in p_capability.
create or replace function marathon_private.require_active_capability(
  p_event_id text,
  p_capability text
)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := marathon_private.require_verified_aal2();
begin
  if nullif(btrim(p_event_id), '') is null then
    raise exception 'An event is required' using errcode = '22023';
  end if;

  if p_capability is null or p_capability not in (
    'event_admin',
    'payment_reviewer',
    'tshirt_desk',
    'completion_desk',
    'route_publisher'
  ) then
    raise exception 'Unknown organiser capability' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from marathon_private.organizer_capabilities c
    where c.event_id = p_event_id
      and c.user_id = v_actor
      and c.revoked_at is null
      and c.capability in ('event_admin', p_capability)
  ) then
    raise exception 'An active organiser capability is required' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;

-- Future privileged operations can use this as their final, server-timestamped
-- audit write. The caller cannot substitute another actor.
create or replace function marathon_private.record_organizer_audit(
  p_event_id text,
  p_capability text,
  p_action text,
  p_request_id uuid,
  p_target jsonb default '{}'::jsonb,
  p_revision integer default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_audit_id uuid;
begin
  v_actor := marathon_private.require_active_capability(p_event_id, p_capability);

  if p_request_id is null then
    raise exception 'A request ID is required for organiser auditing' using errcode = '22023';
  end if;
  if nullif(btrim(p_action), '') is null or char_length(p_action) > 120 then
    raise exception 'A concise organiser action is required' using errcode = '22023';
  end if;
  if p_target is null or jsonb_typeof(p_target) <> 'object'
     or octet_length(p_target::text) > 4096 then
    raise exception 'Audit target must be a small object' using errcode = '22023';
  end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object'
     or octet_length(p_details::text) > 16384 then
    raise exception 'Audit details must be a small object' using errcode = '22023';
  end if;
  if p_revision is not null and p_revision < 0 then
    raise exception 'Audit revision cannot be negative' using errcode = '22023';
  end if;

  insert into marathon_private.organizer_audit(
    event_id, actor_id, capability, action, request_id, target, revision, details
  ) values (
    p_event_id, v_actor, p_capability, btrim(p_action), p_request_id,
    p_target, p_revision, p_details
  ) returning id into v_audit_id;

  return v_audit_id;
end;
$$;

-- Privileged audit history is append-only. The database owner can still make a
-- deliberate schema-level recovery, but ordinary data writes cannot rewrite it.
create or replace function marathon_private.prevent_organizer_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Organiser audit records are immutable' using errcode = '55000';
end;
$$;

drop trigger if exists marathon_prevent_organizer_audit_mutation
  on marathon_private.organizer_audit;
create trigger marathon_prevent_organizer_audit_mutation
before update or delete on marathon_private.organizer_audit
for each row execute function marathon_private.prevent_organizer_audit_mutation();

revoke all on function marathon_private.require_verified_aal2() from public, anon, authenticated;
revoke all on function marathon_private.require_active_capability(text, text) from public, anon, authenticated;
revoke all on function marathon_private.record_organizer_audit(text, text, text, uuid, jsonb, integer, jsonb)
  from public, anon, authenticated;
revoke all on function marathon_private.prevent_organizer_audit_mutation()
  from public, anon, authenticated;
grant execute on function marathon_private.require_verified_aal2(),
  marathon_private.require_active_capability(text, text),
  marathon_private.record_organizer_audit(text, text, text, uuid, jsonb, integer, jsonb)
  to service_role;

commit;
