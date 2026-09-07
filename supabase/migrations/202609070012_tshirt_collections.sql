-- Audited T-shirt collection operations. Apply after 202609070007--010.
-- This creates a separate, payment-gated desk workflow; it does not expose
-- registrations, payment evidence, or operational history to participants.
begin;

create sequence if not exists marathon_private.tshirt_issue_source_revision_seq
  as bigint;

-- An issue records the physical handover of one event T-shirt. A row can be
-- voided later by a controlled backend migration if a recovery path is needed,
-- while the partial index below still permits only one active issue at a time.
create table if not exists marathon_private.tshirt_issues (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.event_config(id),
  registration_id uuid not null,
  requested_size text not null check (requested_size in ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL')),
  issued_size text not null check (issued_size in ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL')),
  override_reason text,
  status text not null default 'issued' check (status in ('issued', 'voided')),
  issued_at timestamptz not null default clock_timestamp(),
  issued_by uuid not null references auth.users(id),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  revision integer not null default 1 check (revision >= 1),
  source_revision bigint not null unique check (source_revision >= 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint tshirt_issues_registration_event_fkey
    foreign key (registration_id, event_id)
    references public.registrations(id, event_id),
  constraint tshirt_issues_size_override_check check (
    (requested_size = issued_size and override_reason is null)
    or (
      requested_size <> issued_size
      and override_reason is not null
      and char_length(btrim(override_reason)) between 5 and 500
    )
  ),
  constraint tshirt_issues_state_check check (
    (status = 'issued' and voided_at is null and voided_by is null and void_reason is null)
    or (
      status = 'voided'
      and voided_at is not null
      and voided_by is not null
      and void_reason is not null
      and char_length(btrim(void_reason)) between 5 and 500
    )
  )
);

-- A voided historical entry stays auditable, but never prevents one later
-- replacement issue. Browser callers do not receive a direct void operation.
create unique index if not exists tshirt_issues_one_active_per_registration_idx
  on marathon_private.tshirt_issues(registration_id)
  where status = 'issued';
create unique index if not exists tshirt_issues_id_event_unique_idx
  on marathon_private.tshirt_issues(id, event_id);
create index if not exists tshirt_issues_event_collection_idx
  on marathon_private.tshirt_issues(event_id, status, source_revision);

-- Request IDs make one physical handover idempotent when a desk tablet loses
-- connectivity after the server has already saved the result.
create table if not exists marathon_private.tshirt_collection_requests (
  event_id text not null references public.event_config(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  registration_id uuid not null,
  issued_size text not null check (issued_size in ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL')),
  override_reason text not null default '' check (char_length(override_reason) <= 500),
  outcome jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (event_id, request_id),
  foreign key (registration_id, event_id)
    references public.registrations(id, event_id),
  check (outcome is null or jsonb_typeof(outcome) = 'object'),
  check (
    (outcome is null and completed_at is null)
    or (outcome is not null and completed_at is not null)
  )
);

-- Only an event administrator can reverse an accidental desk record. This
-- separate idempotency ledger makes a correction independently auditable and
-- requires the latest issue revision, rather than quietly reusing an issue
-- request ID.
create table if not exists marathon_private.tshirt_issue_void_requests (
  event_id text not null references public.event_config(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  tshirt_issue_id uuid not null,
  expected_issue_revision integer not null check (expected_issue_revision >= 1),
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  outcome jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (event_id, request_id),
  foreign key (tshirt_issue_id, event_id)
    references marathon_private.tshirt_issues(id, event_id),
  check (outcome is null or jsonb_typeof(outcome) = 'object'),
  check (
    (outcome is null and completed_at is null)
    or (outcome is not null and completed_at is not null)
  )
);

-- The table is private even from authenticated organisers. Public RPC wrappers
-- below validate identity, MFA, capability and the minimal response shape.
alter table marathon_private.tshirt_issues enable row level security;
alter table marathon_private.tshirt_collection_requests enable row level security;
alter table marathon_private.tshirt_issue_void_requests enable row level security;
revoke all on table marathon_private.tshirt_issues,
  marathon_private.tshirt_collection_requests,
  marathon_private.tshirt_issue_void_requests from public, anon, authenticated;
grant select, insert, update, delete on table marathon_private.tshirt_issues,
  marathon_private.tshirt_collection_requests,
  marathon_private.tshirt_issue_void_requests to service_role;

-- Keep the requested size tied to the submitted registration and require both
-- the legacy payment summary and the private evidence ledger to be verified.
-- This prevents an accidental or partial backend payment update from enabling
-- physical collection.
create or replace function marathon_private.validate_tshirt_issue_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requested_size text;
  v_payment_status text;
  v_now timestamptz := clock_timestamp();
begin
  if tg_op = 'INSERT' then
    select r.tshirt, r.payment_status
      into v_requested_size, v_payment_status
    from public.registrations r
    where r.id = new.registration_id
      and r.event_id = new.event_id
    for share;

    if not found then
      raise exception 'Registration was not found for this event' using errcode = '22023';
    end if;
    if v_payment_status <> 'verified' or not exists (
      select 1
      from marathon_private.payment_attempts a
      where a.registration_id = new.registration_id
        and a.event_id = new.event_id
        and a.status = 'verified'
    ) then
      raise exception 'T-shirt collection requires a verified payment' using errcode = '42501';
    end if;
    if new.issued_by is null then
      raise exception 'A T-shirt desk operator is required' using errcode = '42501';
    end if;

    new.requested_size := v_requested_size;
    new.issued_size := upper(btrim(new.issued_size));
    new.override_reason := nullif(btrim(new.override_reason), '');
    new.status := 'issued';
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;
    new.revision := 1;
    new.source_revision := nextval('marathon_private.tshirt_issue_source_revision_seq'::regclass);
    new.issued_at := v_now;
    new.created_at := v_now;
    new.updated_at := v_now;
    return new;
  end if;

  if new.id is distinct from old.id
     or new.event_id is distinct from old.event_id
     or new.registration_id is distinct from old.registration_id
     or new.requested_size is distinct from old.requested_size
     or new.issued_size is distinct from old.issued_size
     or new.override_reason is distinct from old.override_reason
     or new.issued_at is distinct from old.issued_at
     or new.issued_by is distinct from old.issued_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Recorded T-shirt collection details are immutable' using errcode = '55000';
  end if;
  if old.status <> 'issued' or new.status <> 'voided' then
    raise exception 'T-shirt issue changes require a controlled void transition' using errcode = '55000';
  end if;
  if new.voided_by is null then
    raise exception 'A T-shirt issue void requires an operator' using errcode = '42501';
  end if;

  new.void_reason := nullif(btrim(new.void_reason), '');
  new.revision := old.revision + 1;
  new.source_revision := nextval('marathon_private.tshirt_issue_source_revision_seq'::regclass);
  new.updated_at := v_now;
  new.voided_at := v_now;
  return new;
end;
$$;

drop trigger if exists marathon_validate_tshirt_issue_write
  on marathon_private.tshirt_issues;
create trigger marathon_validate_tshirt_issue_write
before insert or update on marathon_private.tshirt_issues
for each row execute function marathon_private.validate_tshirt_issue_write();

create or replace function marathon_private.tshirt_collection_queue(
  p_event_id text,
  p_status text default 'ready',
  p_race text default null,
  p_after_registration_id uuid default null,
  p_limit integer default 25
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text := btrim(coalesce(p_status, ''));
  v_race text := nullif(btrim(coalesce(p_race, '')), '');
  v_limit integer := coalesce(p_limit, 25);
  v_items jsonb := '[]'::jsonb;
  v_next uuid := null;
  v_has_more boolean := false;
  v_count integer := 0;
  v_row record;
begin
  perform marathon_private.require_active_capability(p_event_id, 'tshirt_desk');

  if v_status not in ('ready', 'issued', 'all') then
    raise exception 'Choose a valid T-shirt collection status filter' using errcode = '22023';
  end if;
  if v_race is not null and v_race not in ('5', '10', '21') then
    raise exception 'Choose a valid race filter' using errcode = '22023';
  end if;
  if v_limit not between 1 and 100 then
    raise exception 'T-shirt desk pages contain between 1 and 100 entries' using errcode = '22023';
  end if;

  for v_row in
    select
      r.id as registration_id,
      r.full_name,
      r.race,
      r.tshirt as requested_size,
      i.id as tshirt_issue_id,
      i.revision as issue_revision,
      i.source_revision,
      i.issued_size,
      i.override_reason,
      i.issued_at
    from public.registrations r
    left join marathon_private.tshirt_issues i
      on i.registration_id = r.id
      and i.event_id = r.event_id
      and i.status = 'issued'
    where r.event_id = p_event_id
      and r.payment_status = 'verified'
      and exists (
        select 1
        from marathon_private.payment_attempts a
        where a.registration_id = r.id
          and a.event_id = r.event_id
          and a.status = 'verified'
      )
      and (v_status = 'all'
        or (v_status = 'ready' and i.id is null)
        or (v_status = 'issued' and i.id is not null))
      and (v_race is null or r.race = v_race)
      and (p_after_registration_id is null or r.id > p_after_registration_id)
    order by r.id asc
    limit v_limit + 1
  loop
    if v_count >= v_limit then
      v_has_more := true;
      exit;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'registration_id', v_row.registration_id,
      'full_name', v_row.full_name,
      'race', v_row.race,
      'requested_size', v_row.requested_size,
      'tshirt_issue_id', v_row.tshirt_issue_id,
      'issue_revision', v_row.issue_revision,
      'source_revision', v_row.source_revision,
      'issued_size', v_row.issued_size,
      'override_reason', v_row.override_reason,
      'issued_at', v_row.issued_at
    ));
    v_next := v_row.registration_id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'items', v_items,
    'next_after_registration_id', v_next,
    'has_more', v_has_more
  );
end;
$$;

create or replace function marathon_private.record_tshirt_collection(
  p_event_id text,
  p_registration_id uuid,
  p_issued_size text,
  p_override_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_issued_size text := upper(btrim(coalesce(p_issued_size, '')));
  v_override_reason text := btrim(coalesce(p_override_reason, ''));
  v_registration public.registrations%rowtype;
  v_request marathon_private.tshirt_collection_requests%rowtype;
  v_issue marathon_private.tshirt_issues%rowtype;
  v_outcome jsonb;
begin
  v_actor := marathon_private.require_active_capability(p_event_id, 'tshirt_desk');

  if p_registration_id is null or p_request_id is null then
    raise exception 'A registration and request ID are required' using errcode = '22023';
  end if;
  if v_issued_size not in ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL') then
    raise exception 'Choose a valid issued T-shirt size' using errcode = '22023';
  end if;
  if char_length(v_override_reason) > 500 then
    raise exception 'T-shirt size override reasons are limited to 500 characters' using errcode = '22023';
  end if;

  insert into marathon_private.tshirt_collection_requests(
    event_id, request_id, actor_id, registration_id, issued_size, override_reason
  ) values (
    p_event_id, p_request_id, v_actor, p_registration_id, v_issued_size, v_override_reason
  ) on conflict (event_id, request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from marathon_private.tshirt_collection_requests r
    where r.event_id = p_event_id and r.request_id = p_request_id
    for update;

    if v_request.actor_id is distinct from v_actor
       or v_request.registration_id is distinct from p_registration_id
       or v_request.issued_size is distinct from v_issued_size
       or v_request.override_reason is distinct from v_override_reason then
      raise exception 'This T-shirt collection request ID was already used for a different payload'
        using errcode = '23505';
    end if;
    if v_request.outcome is null then
      raise exception 'This T-shirt collection request did not complete' using errcode = '55000';
    end if;
    return v_request.outcome;
  end if;

  -- Lock the registration first, matching the payment-review ordering. A
  -- concurrent payment correction cannot race the physical-collection check.
  select * into v_registration
  from public.registrations r
  where r.id = p_registration_id and r.event_id = p_event_id
  for update;

  if not found then
    raise exception 'Registration was not found for this event' using errcode = '22023';
  end if;
  if v_registration.payment_status <> 'verified' or not exists (
    select 1
    from marathon_private.payment_attempts a
    where a.registration_id = v_registration.id
      and a.event_id = p_event_id
      and a.status = 'verified'
  ) then
    raise exception 'T-shirt collection requires a verified payment' using errcode = '42501';
  end if;
  if v_issued_size = v_registration.tshirt and v_override_reason <> '' then
    raise exception 'A size override reason is only used when the issued size changes'
      using errcode = '22023';
  end if;
  if v_issued_size <> v_registration.tshirt and char_length(v_override_reason) < 5 then
    raise exception 'Explain the T-shirt size override' using errcode = '22023';
  end if;

  select * into v_issue
  from marathon_private.tshirt_issues i
  where i.registration_id = v_registration.id
    and i.event_id = p_event_id
    and i.status = 'issued'
  for update;
  if found then
    raise exception 'A T-shirt has already been issued for this registration' using errcode = '55000';
  end if;

  insert into marathon_private.tshirt_issues(
    event_id, registration_id, requested_size, issued_size, override_reason, issued_by
  ) values (
    p_event_id, v_registration.id, v_registration.tshirt,
    v_issued_size, nullif(v_override_reason, ''), v_actor
  ) returning * into v_issue;

  v_outcome := jsonb_build_object(
    'tshirt_issue_id', v_issue.id,
    'registration_id', v_issue.registration_id,
    'requested_size', v_issue.requested_size,
    'issued_size', v_issue.issued_size,
    'override_reason', v_issue.override_reason,
    'status', v_issue.status,
    'issued_at', v_issue.issued_at,
    'issue_revision', v_issue.revision,
    'source_revision', v_issue.source_revision
  );

  perform marathon_private.record_organizer_audit(
    p_event_id,
    'tshirt_desk',
    'tshirt_collected',
    p_request_id,
    jsonb_build_object(
      'registration_id', v_issue.registration_id,
      'tshirt_issue_id', v_issue.id
    ),
    v_issue.revision,
    jsonb_build_object(
      'requested_size', v_issue.requested_size,
      'issued_size', v_issue.issued_size,
      'size_override_recorded', v_issue.requested_size <> v_issue.issued_size,
      'source_revision', v_issue.source_revision
    )
  );

  update marathon_private.tshirt_collection_requests
  set outcome = v_outcome,
      completed_at = clock_timestamp()
  where event_id = p_event_id and request_id = p_request_id;

  return v_outcome;
end;
$$;

create or replace function marathon_private.void_tshirt_collection(
  p_event_id text,
  p_tshirt_issue_id uuid,
  p_expected_issue_revision integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_issue marathon_private.tshirt_issues%rowtype;
  v_registration public.registrations%rowtype;
  v_request marathon_private.tshirt_issue_void_requests%rowtype;
  v_outcome jsonb;
begin
  -- A desk operator can hand over a shirt, but cannot erase a physical issue.
  -- Recovery requires the separately assigned event_admin capability.
  v_actor := marathon_private.require_active_capability(p_event_id, 'event_admin');

  if p_tshirt_issue_id is null or p_request_id is null then
    raise exception 'A T-shirt issue and request ID are required' using errcode = '22023';
  end if;
  if p_expected_issue_revision is null or p_expected_issue_revision < 1 then
    raise exception 'The current T-shirt issue revision is required' using errcode = '22023';
  end if;
  if char_length(v_reason) not between 5 and 500 then
    raise exception 'Record a concise reason for voiding this T-shirt issue' using errcode = '22023';
  end if;

  insert into marathon_private.tshirt_issue_void_requests(
    event_id, request_id, actor_id, tshirt_issue_id, expected_issue_revision, reason
  ) values (
    p_event_id, p_request_id, v_actor, p_tshirt_issue_id,
    p_expected_issue_revision, v_reason
  ) on conflict (event_id, request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from marathon_private.tshirt_issue_void_requests r
    where r.event_id = p_event_id and r.request_id = p_request_id
    for update;

    if v_request.actor_id is distinct from v_actor
       or v_request.tshirt_issue_id is distinct from p_tshirt_issue_id
       or v_request.expected_issue_revision is distinct from p_expected_issue_revision
       or v_request.reason is distinct from v_reason then
      raise exception 'This T-shirt issue void request ID was already used for a different payload'
        using errcode = '23505';
    end if;
    if v_request.outcome is null then
      raise exception 'This T-shirt issue void request did not complete' using errcode = '55000';
    end if;
    return v_request.outcome;
  end if;

  -- Lock registration first, then the issue, following the collection and
  -- payment review lock order so a correction cannot deadlock a desk action.
  select * into v_issue
  from marathon_private.tshirt_issues i
  where i.id = p_tshirt_issue_id and i.event_id = p_event_id;
  if not found then
    raise exception 'T-shirt issue was not found for this event' using errcode = '22023';
  end if;

  select * into v_registration
  from public.registrations r
  where r.id = v_issue.registration_id and r.event_id = p_event_id
  for update;
  if not found then
    raise exception 'Registration was not found for this T-shirt issue' using errcode = '22023';
  end if;

  select * into v_issue
  from marathon_private.tshirt_issues i
  where i.id = p_tshirt_issue_id and i.event_id = p_event_id
  for update;
  if v_issue.revision <> p_expected_issue_revision then
    raise exception 'T-shirt issue changed since this desk screen was opened' using errcode = '40001';
  end if;
  if v_issue.status <> 'issued' then
    raise exception 'This T-shirt issue is already voided' using errcode = '55000';
  end if;

  update marathon_private.tshirt_issues
  set status = 'voided',
      voided_by = v_actor,
      void_reason = v_reason
  where id = v_issue.id
  returning * into v_issue;

  v_outcome := jsonb_build_object(
    'tshirt_issue_id', v_issue.id,
    'registration_id', v_issue.registration_id,
    'status', v_issue.status,
    'issue_revision', v_issue.revision,
    'source_revision', v_issue.source_revision,
    'voided_at', v_issue.voided_at
  );

  perform marathon_private.record_organizer_audit(
    p_event_id,
    'event_admin',
    'tshirt_collection_voided',
    p_request_id,
    jsonb_build_object(
      'registration_id', v_issue.registration_id,
      'tshirt_issue_id', v_issue.id
    ),
    v_issue.revision,
    jsonb_build_object(
      'reason_recorded', true,
      'source_revision', v_issue.source_revision
    )
  );

  update marathon_private.tshirt_issue_void_requests
  set outcome = v_outcome,
      completed_at = clock_timestamp()
  where event_id = p_event_id and request_id = p_request_id;

  return v_outcome;
end;
$$;

-- The browser can call only these narrow wrappers. Neither private table is
-- exposed through the Data API, and no participant can enumerate the queue.
create or replace function public.tshirt_collection_queue(
  p_event_id text,
  p_status text default 'ready',
  p_race text default null,
  p_after_registration_id uuid default null,
  p_limit integer default 25
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.tshirt_collection_queue(
    p_event_id, p_status, p_race, p_after_registration_id, p_limit
  );
$$;

create or replace function public.record_tshirt_collection(
  p_event_id text,
  p_registration_id uuid,
  p_issued_size text,
  p_override_reason text,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.record_tshirt_collection(
    p_event_id, p_registration_id, p_issued_size, p_override_reason, p_request_id
  );
$$;

create or replace function public.void_tshirt_collection(
  p_event_id text,
  p_tshirt_issue_id uuid,
  p_expected_issue_revision integer,
  p_reason text,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.void_tshirt_collection(
    p_event_id, p_tshirt_issue_id, p_expected_issue_revision, p_reason, p_request_id
  );
$$;

revoke all on function marathon_private.validate_tshirt_issue_write()
  from public, anon, authenticated;
revoke all on function marathon_private.tshirt_collection_queue(text, text, text, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.record_tshirt_collection(text, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.void_tshirt_collection(text, uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.tshirt_collection_queue(text, text, text, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.record_tshirt_collection(text, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.void_tshirt_collection(text, uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on sequence marathon_private.tshirt_issue_source_revision_seq
  from public, anon, authenticated;
grant usage, select on sequence marathon_private.tshirt_issue_source_revision_seq to service_role;
grant execute on function public.tshirt_collection_queue(text, text, text, uuid, integer),
  public.record_tshirt_collection(text, uuid, text, text, uuid),
  public.void_tshirt_collection(text, uuid, integer, text, uuid)
  to authenticated;

commit;
