-- Member-only route timeline. Detailed station routing never enters the public
-- guide or a client bundle: it is published from the protected organiser path.
begin;

create table if not exists marathon_private.member_route_timeline (
  event_id text primary key references public.event_config(id) on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  state text not null default 'draft' check (state in ('draft', 'published')),
  timeline jsonb,
  published_at timestamptz,
  published_by uuid references auth.users(id),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    (state = 'draft' and published_at is null and published_by is null)
    or (state = 'published' and timeline is not null and published_at is not null and published_by is not null)
  )
);

-- A route action must be safe to retry after a tablet loses connectivity. Keep
-- only a digest of a publish payload here; route text itself remains in the
-- protected timeline row.
create table if not exists marathon_private.member_route_requests (
  event_id text not null references public.event_config(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('publish', 'unpublish')),
  expected_revision integer not null check (expected_revision >= 0),
  timeline_sha256 text,
  outcome jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (event_id, request_id),
  check (timeline_sha256 is null or timeline_sha256 ~ '^[0-9a-f]{64}$'),
  check (
    (action = 'publish' and timeline_sha256 is not null)
    or (action = 'unpublish' and timeline_sha256 is null)
  ),
  check (outcome is null or jsonb_typeof(outcome) = 'object'),
  check ((outcome is null and completed_at is null) or completed_at is not null)
);

alter table marathon_private.member_route_timeline enable row level security;
alter table marathon_private.member_route_requests enable row level security;
revoke all on table marathon_private.member_route_timeline
  from public, anon, authenticated;
revoke all on table marathon_private.member_route_requests
  from public, anon, authenticated;
grant select, insert, update, delete on table marathon_private.member_route_timeline,
  marathon_private.member_route_requests
  to service_role;

insert into marathon_private.member_route_timeline(event_id)
select id from public.event_config where id = 'suratgarh-2026'
on conflict (event_id) do nothing;

create or replace function marathon_private.validate_member_route_timeline(
  p_timeline jsonb
) returns void
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_segment jsonb;
  v_step jsonb;
  v_distance text;
  v_distances text[] := array[]::text[];
begin
  if p_timeline is null
     or jsonb_typeof(p_timeline) <> 'object'
     or octet_length(p_timeline::text) > 12000 then
    raise exception 'Route timeline must be a compact object' using errcode = '22023';
  end if;

  if jsonb_typeof(p_timeline -> 'start') is distinct from 'string'
     or char_length(btrim(p_timeline ->> 'start')) not between 2 and 180 then
    raise exception 'Route start is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_timeline -> 'distances') <> 'array'
     or jsonb_array_length(p_timeline -> 'distances') <> 3 then
    raise exception 'Route timeline must contain the 5, 10 and 21 KM routes' using errcode = '22023';
  end if;

  for v_segment in select value from jsonb_array_elements(p_timeline -> 'distances') loop
    if jsonb_typeof(v_segment) is distinct from 'object' then
      raise exception 'Each route must be an object' using errcode = '22023';
    end if;

    v_distance := v_segment ->> 'distance';
    if v_distance not in ('5', '10', '21') or v_distance = any(v_distances) then
      raise exception 'Each route distance must appear once' using errcode = '22023';
    end if;
    v_distances := array_append(v_distances, v_distance);

    if jsonb_typeof(v_segment -> 'steps') is distinct from 'array'
       or jsonb_array_length(v_segment -> 'steps') not between 2 and 8 then
      raise exception 'Each route needs two to eight timeline steps' using errcode = '22023';
    end if;

    for v_step in select value from jsonb_array_elements(v_segment -> 'steps') loop
      if jsonb_typeof(v_step) is distinct from 'string'
         or char_length(btrim(v_step #>> '{}')) not between 2 and 220 then
        raise exception 'Each route step must be concise text' using errcode = '22023';
      end if;
    end loop;
  end loop;

  if jsonb_typeof(p_timeline -> 'notice') is not null
     and (
       jsonb_typeof(p_timeline -> 'notice') is distinct from 'string'
       or char_length(btrim(p_timeline ->> 'notice')) not between 2 and 500
     ) then
    raise exception 'Route notice must be concise text' using errcode = '22023';
  end if;
end;
$$;

create or replace function marathon_private.publish_member_route(
  p_event_id text,
  p_timeline jsonb,
  p_expected_revision integer,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := marathon_private.require_active_capability(p_event_id, 'route_publisher');
  v_current marathon_private.member_route_timeline%rowtype;
  v_request marathon_private.member_route_requests%rowtype;
  v_revision integer;
  v_now timestamptz := clock_timestamp();
  v_timeline_sha256 text;
  v_outcome jsonb;
begin
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'A non-negative route revision is required' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'A route publication request ID is required' using errcode = '22023';
  end if;

  perform marathon_private.validate_member_route_timeline(p_timeline);
  v_timeline_sha256 := encode(sha256(convert_to(p_timeline::text, 'UTF8')), 'hex');

  insert into marathon_private.member_route_requests(
    event_id, request_id, actor_id, action, expected_revision, timeline_sha256
  ) values (
    p_event_id, p_request_id, v_actor, 'publish', p_expected_revision, v_timeline_sha256
  ) on conflict (event_id, request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from marathon_private.member_route_requests request_row
    where request_row.event_id = p_event_id and request_row.request_id = p_request_id
    for update;

    if v_request.actor_id is distinct from v_actor
       or v_request.action <> 'publish'
       or v_request.expected_revision <> p_expected_revision
       or v_request.timeline_sha256 is distinct from v_timeline_sha256 then
      raise exception 'Route request ID does not match its original action' using errcode = '22023';
    end if;
    if v_request.outcome is not null then
      return v_request.outcome;
    end if;
  end if;

  insert into marathon_private.member_route_timeline(event_id)
  values (p_event_id)
  on conflict (event_id) do nothing;

  select * into v_current
  from marathon_private.member_route_timeline
  where event_id = p_event_id
  for update;

  if v_current.revision <> p_expected_revision then
    raise exception 'Route timeline has changed; refresh before publishing' using errcode = '40001';
  end if;
  v_revision := v_current.revision + 1;
  update marathon_private.member_route_timeline
  set revision = v_revision,
      state = 'published',
      timeline = p_timeline,
      published_at = v_now,
      published_by = v_actor,
      updated_at = v_now
  where event_id = p_event_id;

  insert into marathon_private.organizer_audit(
    event_id, actor_id, capability, action, request_id, target, revision, details
  ) values (
    p_event_id, v_actor, 'route_publisher', 'member_route_published', p_request_id,
    jsonb_build_object('resource', 'member_route_timeline'), v_revision,
    jsonb_build_object('timeline_bytes', octet_length(p_timeline::text))
  );

  v_outcome := jsonb_build_object(
    'published', true,
    'revision', v_revision,
    'updated_at', v_now
  );
  update marathon_private.member_route_requests
  set outcome = v_outcome, completed_at = v_now
  where event_id = p_event_id and request_id = p_request_id;

  return v_outcome;
end;
$$;

create or replace function marathon_private.unpublish_member_route(
  p_event_id text,
  p_expected_revision integer,
  p_request_id uuid
) returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := marathon_private.require_active_capability(p_event_id, 'route_publisher');
  v_current marathon_private.member_route_timeline%rowtype;
  v_request marathon_private.member_route_requests%rowtype;
  v_revision integer;
  v_now timestamptz := clock_timestamp();
  v_outcome jsonb;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'A published route revision is required' using errcode = '22023';
  end if;
  if p_request_id is null then
    raise exception 'A route publication request ID is required' using errcode = '22023';
  end if;

  insert into marathon_private.member_route_requests(
    event_id, request_id, actor_id, action, expected_revision
  ) values (
    p_event_id, p_request_id, v_actor, 'unpublish', p_expected_revision
  ) on conflict (event_id, request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from marathon_private.member_route_requests request_row
    where request_row.event_id = p_event_id and request_row.request_id = p_request_id
    for update;

    if v_request.actor_id is distinct from v_actor
       or v_request.action <> 'unpublish'
       or v_request.expected_revision <> p_expected_revision
       or v_request.timeline_sha256 is not null then
      raise exception 'Route request ID does not match its original action' using errcode = '22023';
    end if;
    if v_request.outcome is not null then
      return v_request.outcome;
    end if;
  end if;

  select * into v_current
  from marathon_private.member_route_timeline
  where event_id = p_event_id
  for update;
  if not found or v_current.state <> 'published' then
    raise exception 'No published route timeline is available' using errcode = '22023';
  end if;
  if v_current.revision <> p_expected_revision then
    raise exception 'Route timeline has changed; refresh before unpublishing' using errcode = '40001';
  end if;

  v_revision := v_current.revision + 1;
  update marathon_private.member_route_timeline
  set revision = v_revision,
      state = 'draft',
      published_at = null,
      published_by = null,
      updated_at = v_now
  where event_id = p_event_id;

  insert into marathon_private.organizer_audit(
    event_id, actor_id, capability, action, request_id, target, revision, details
  ) values (
    p_event_id, v_actor, 'route_publisher', 'member_route_unpublished', p_request_id,
    jsonb_build_object('resource', 'member_route_timeline'), v_revision,
    jsonb_build_object('prior_revision', v_current.revision)
  );

  v_outcome := jsonb_build_object(
    'published', false,
    'revision', v_revision,
    'updated_at', v_now
  );
  update marathon_private.member_route_requests
  set outcome = v_outcome, completed_at = v_now
  where event_id = p_event_id and request_id = p_request_id;

  return v_outcome;
end;
$$;

create or replace function public.get_member_route(p_event_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_route marathon_private.member_route_timeline%rowtype;
begin
  if v_user is null or not exists (
    select 1 from auth.users u
    where u.id = v_user
      and u.email_confirmed_at is not null
      and u.email is not null
      and not coalesce(u.is_anonymous, false)
  ) then
    raise exception 'A verified email sign-in is required' using errcode = '42501';
  end if;

  if not marathon_private.is_member(p_event_id) then
    raise exception 'An active station invitation membership is required' using errcode = '42501';
  end if;

  select * into v_route
  from marathon_private.member_route_timeline
  where event_id = p_event_id and state = 'published';

  if not found then
    return jsonb_build_object('published', false);
  end if;

  return jsonb_build_object(
    'published', true,
    'revision', v_route.revision,
    'updated_at', v_route.updated_at,
    'timeline', v_route.timeline
  );
end;
$$;

create or replace function public.publish_member_route(
  p_event_id text,
  p_timeline jsonb,
  p_expected_revision integer,
  p_request_id uuid
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.publish_member_route(
    p_event_id, p_timeline, p_expected_revision, p_request_id
  );
$$;

create or replace function public.get_route_publication(p_event_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_route marathon_private.member_route_timeline%rowtype;
begin
  perform marathon_private.require_active_capability(p_event_id, 'route_publisher');

  select * into v_route
  from marathon_private.member_route_timeline
  where event_id = p_event_id;

  if not found then
    return jsonb_build_object('published', false, 'revision', 0);
  end if;

  return jsonb_build_object(
    'published', v_route.state = 'published',
    'revision', v_route.revision,
    'updated_at', v_route.updated_at,
    'timeline', v_route.timeline
  );
end;
$$;

create or replace function public.unpublish_member_route(
  p_event_id text,
  p_expected_revision integer,
  p_request_id uuid
) returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.unpublish_member_route(
    p_event_id, p_expected_revision, p_request_id
  );
$$;

revoke all on function marathon_private.validate_member_route_timeline(jsonb),
  marathon_private.publish_member_route(text, jsonb, integer, uuid),
  marathon_private.unpublish_member_route(text, integer, uuid)
  from public, anon, authenticated;
revoke all on function public.get_member_route(text),
  public.publish_member_route(text, jsonb, integer, uuid),
  public.get_route_publication(text),
  public.unpublish_member_route(text, integer, uuid)
  from public, anon;
grant execute on function public.get_member_route(text),
  public.publish_member_route(text, jsonb, integer, uuid),
  public.get_route_publication(text),
  public.unpublish_member_route(text, integer, uuid)
  to authenticated;
grant execute on function marathon_private.validate_member_route_timeline(jsonb),
  marathon_private.publish_member_route(text, jsonb, integer, uuid),
  marathon_private.unpublish_member_route(text, integer, uuid)
  to service_role;

commit;
