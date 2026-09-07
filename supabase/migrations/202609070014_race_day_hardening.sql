-- Capability-gated race-day completion cutover. Apply after 202609070013.
-- This keeps timing, route publication and certificate issuance disabled until
-- explicitly configured by an event administrator outside the browser flow.
begin;

-- A race-day desk is off by default, separately from the clock and participant
-- self-submission switches. There is deliberately no browser RPC to enable it.
alter table marathon_private.event_day_settings
  add column if not exists completion_desk_enabled boolean not null default false;

-- Certificate preparation used to accept a legacy organiser-table lookup. The
-- Edge Function is the service-role caller and supplies the verified caller ID
-- and the verified access-token assurance level. An owner needs a verified
-- account; preparing another participant's certificate requires AAL2 and the
-- active event_admin capability.
drop function if exists public.prepare_certificate_backend(uuid, uuid, text);
drop function if exists marathon_private.prepare_certificate_backend(uuid, uuid, text);

create function marathon_private.prepare_certificate_backend(
  p_actor uuid,
  p_actor_aal text,
  p_registration uuid,
  p_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.registrations%rowtype;
  rr marathon_private.race_results%rowtype;
  s marathon_private.certificate_settings%rowtype;
  c marathon_private.certificates%rowtype;
  n text;
  snap jsonb;
  event_date text;
begin
  if p_actor is null or not exists (
    select 1
    from auth.users u
    where u.id = p_actor
      and u.email_confirmed_at is not null
      and nullif(btrim(u.email), '') is not null
      and not coalesce(u.is_anonymous, false)
  ) then
    raise exception 'Verified email is required' using errcode = '42501';
  end if;
  if p_actor_aal not in ('aal1', 'aal2') then
    raise exception 'Caller assurance is invalid' using errcode = '42501';
  end if;
  if p_registration is null or p_kind not in ('completion', 'participation') then
    raise exception 'Invalid certificate request' using errcode = '22023';
  end if;

  -- Lock the participant record before the result and certificate rows, which
  -- matches certificate completion and result mutation lock ordering.
  select * into r
  from public.registrations
  where id = p_registration
  for update;
  if not found or r.payment_status <> 'verified' then
    raise exception 'Confirmed registration access is required' using errcode = '42501';
  end if;

  if r.user_id is distinct from p_actor then
    if p_actor_aal <> 'aal2' then
      raise exception 'Multi-factor authentication is required for organiser certificate access'
        using errcode = '42501';
    end if;
    if not exists (
      select 1
      from marathon_private.organizer_capabilities capability_row
      where capability_row.event_id = r.event_id
        and capability_row.user_id = p_actor
        and capability_row.revoked_at is null
        and capability_row.capability = 'event_admin'
    ) then
      raise exception 'An active event administrator capability is required'
        using errcode = '42501';
    end if;
  end if;

  select * into rr
  from marathon_private.race_results
  where registration_id = r.id
  for update;
  if not found or rr.status = 'correction_required' or rr.certificate_hold then
    raise exception 'Certificate is awaiting a valid result or organiser release';
  end if;

  select * into s
  from marathon_private.certificate_settings
  where event_id = r.event_id;
  if not found or not s.enabled then
    raise exception 'Approved certificate signing has not been configured';
  end if;

  select registration_number into n
  from marathon_private.registration_numbers
  where registration_id = r.id;
  select to_char(event_starts_at at time zone 'Asia/Kolkata', 'DD Mon YYYY')
    into event_date
  from public.event_config
  where id = r.event_id;

  snap := jsonb_build_object(
    'participant_name', r.full_name,
    'registration_number', n,
    'race', r.race,
    'event_date', event_date,
    'elapsed_seconds', rr.elapsed_seconds,
    'timing_provenance', rr.provenance,
    'signer_name', s.signer_name,
    'signer_designation', s.signer_designation,
    'approval_reference', s.approval_reference,
    'approval_revision', s.approval_revision,
    'signature_object_path', s.signature_object_path,
    'font_object_path', s.font_object_path,
    'fallback_font_object_path', s.fallback_font_object_path,
    'verification_base_url', s.verification_base_url,
    'event_title', 'Sekhon Indian Air Force Marathon 2026',
    'organiser', 'Desert Braves · Air Force Station Suratgarh'
  );

  insert into marathon_private.certificates(
    registration_id, result_revision, kind, snapshot, approval_revision
  ) values (
    r.id, rr.revision, p_kind, snap, s.approval_revision
  ) on conflict (registration_id, result_revision, kind, approval_revision) do nothing;

  select * into c
  from marathon_private.certificates
  where registration_id = r.id
    and result_revision = rr.revision
    and kind = p_kind
    and approval_revision = s.approval_revision
  for update;
  if c.status = 'revoked' then
    raise exception 'This certificate was revoked; an organiser must review and reissue the result';
  end if;

  return jsonb_build_object(
    'certificate', to_jsonb(c),
    'signature_object_path', c.snapshot ->> 'signature_object_path',
    'font_object_path', c.snapshot ->> 'font_object_path',
    'fallback_font_object_path', c.snapshot ->> 'fallback_font_object_path',
    'verification_url', (c.snapshot ->> 'verification_base_url')
      || case when position('?' in (c.snapshot ->> 'verification_base_url')) > 0 then '&' else '?' end
      || 'certificate=' || c.verification_token::text
  );
end;
$$;

create function public.prepare_certificate_backend(
  p_actor uuid,
  p_actor_aal text,
  p_registration uuid,
  p_kind text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select marathon_private.prepare_certificate_backend(
    p_actor, p_actor_aal, p_registration, p_kind
  );
$$;

-- Each state-changing completion action has its own request ledger. A retry
-- from an unreliable desk device returns the first saved outcome; it cannot
-- create or revise a second result.
create table if not exists marathon_private.completion_record_requests (
  event_id text not null references public.event_config(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  registration_id uuid not null,
  elapsed_seconds integer not null check (elapsed_seconds between 1 and 172800),
  expected_result_revision integer not null check (expected_result_revision >= 0),
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

create table if not exists marathon_private.completion_review_requests (
  event_id text not null references public.event_config(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  registration_id uuid not null,
  expected_result_revision integer not null check (expected_result_revision >= 1),
  target_status text not null check (target_status in ('verified', 'correction_required', 'locked')),
  elapsed_seconds integer check (elapsed_seconds is null or elapsed_seconds between 1 and 172800),
  note text not null check (char_length(btrim(note)) between 5 and 1000),
  certificate_hold boolean not null,
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

create index if not exists completion_record_requests_registration_idx
  on marathon_private.completion_record_requests(event_id, registration_id, created_at desc);
create index if not exists completion_review_requests_registration_idx
  on marathon_private.completion_review_requests(event_id, registration_id, created_at desc);

alter table marathon_private.completion_record_requests enable row level security;
alter table marathon_private.completion_review_requests enable row level security;
revoke all on table marathon_private.completion_record_requests,
  marathon_private.completion_review_requests from public, anon, authenticated;
grant select, insert, update, delete on table marathon_private.completion_record_requests,
  marathon_private.completion_review_requests to service_role;

create or replace function marathon_private.validate_completion_request_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Completion request records are immutable' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if new.outcome is not null or new.completed_at is not null then
      raise exception 'Completion outcomes are assigned by the server' using errcode = '42501';
    end if;
    new.created_at := clock_timestamp();
    return new;
  end if;

  if (to_jsonb(new) - array['outcome', 'completed_at'])
     is distinct from
     (to_jsonb(old) - array['outcome', 'completed_at']) then
    raise exception 'Completion request details are immutable' using errcode = '55000';
  end if;
  if old.outcome is not null or old.completed_at is not null
     or new.outcome is null or new.completed_at is null then
    raise exception 'Completion outcomes are immutable' using errcode = '55000';
  end if;
  new.completed_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists marathon_validate_completion_record_request_write
  on marathon_private.completion_record_requests;
create trigger marathon_validate_completion_record_request_write
before insert or update or delete on marathon_private.completion_record_requests
for each row execute function marathon_private.validate_completion_request_write();

drop trigger if exists marathon_validate_completion_review_request_write
  on marathon_private.completion_review_requests;
create trigger marathon_validate_completion_review_request_write
before insert or update or delete on marathon_private.completion_review_requests
for each row execute function marathon_private.validate_completion_request_write();

-- The completion desk needs only the identity and result facts needed at the
-- finish line. Contact information, payment evidence and payment references
-- never leave the private tables through this queue.
create function marathon_private.completion_desk_queue(
  p_event_id text,
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
  v_race text := nullif(btrim(coalesce(p_race, '')), '');
  v_limit integer := coalesce(p_limit, 25);
  v_actor uuid;
  v_can_review_results boolean := false;
  v_setting marathon_private.event_day_settings%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_next uuid := null;
  v_has_more boolean := false;
  v_count integer := 0;
  v_row record;
begin
  v_actor := marathon_private.require_active_capability(
    p_event_id,
    'completion_desk'
  );
  select exists (
    select 1
    from marathon_private.organizer_capabilities c
    where c.event_id = p_event_id
      and c.user_id = v_actor
      and c.capability = 'event_admin'
      and c.revoked_at is null
  ) into v_can_review_results;
  if v_race is not null and v_race not in ('5', '10', '21') then
    raise exception 'Choose a valid race filter' using errcode = '22023';
  end if;
  if v_limit not between 1 and 100 then
    raise exception 'Completion desk pages contain between 1 and 100 entries' using errcode = '22023';
  end if;

  select * into v_setting
  from marathon_private.event_day_settings
  where event_id = p_event_id;
  if not found or not v_setting.timing_enabled or not v_setting.completion_desk_enabled then
    raise exception 'Completion desk is not enabled for this event' using errcode = '42501';
  end if;

  for v_row in
    select
      r.id as registration_id,
      n.registration_number,
      r.full_name,
      r.race,
      rr.elapsed_seconds,
      rr.provenance as result_provenance,
      rr.status as result_status,
      coalesce(rr.revision, 0) as result_revision,
      coalesce(rr.certificate_hold, false) as certificate_hold
    from public.registrations r
    left join marathon_private.registration_numbers n
      on n.registration_id = r.id
    left join marathon_private.race_results rr
      on rr.registration_id = r.id
    where r.event_id = p_event_id
      and r.payment_status = 'verified'
      and exists (
        select 1
        from marathon_private.payment_attempts a
        where a.registration_id = r.id
          and a.event_id = r.event_id
          and a.status = 'verified'
      )
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
      'registration_number', v_row.registration_number,
      'full_name', v_row.full_name,
      'race', v_row.race,
      'elapsed_seconds', v_row.elapsed_seconds,
      'result_provenance', v_row.result_provenance,
      'result_status', v_row.result_status,
      'result_revision', v_row.result_revision,
      'certificate_hold', v_row.certificate_hold
    ));
    v_next := v_row.registration_id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'items', v_items,
    'next_after_registration_id', v_next,
    'has_more', v_has_more,
    'can_review_results', v_can_review_results
  );
end;
$$;

create function marathon_private.record_race_completion(
  p_event_id text,
  p_registration_id uuid,
  p_elapsed_seconds integer,
  p_expected_result_revision integer,
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
  v_setting marathon_private.event_day_settings%rowtype;
  v_registration public.registrations%rowtype;
  v_result marathon_private.race_results%rowtype;
  v_request marathon_private.completion_record_requests%rowtype;
  v_outcome jsonb;
  v_minimum_seconds integer;
  v_previous jsonb;
begin
  v_actor := marathon_private.require_active_capability(p_event_id, 'completion_desk');
  if p_registration_id is null or p_request_id is null then
    raise exception 'A registration and request ID are required' using errcode = '22023';
  end if;
  if p_elapsed_seconds is null or p_expected_result_revision is null
     or p_expected_result_revision < 0 then
    raise exception 'A valid elapsed time and result revision are required' using errcode = '22023';
  end if;

  insert into marathon_private.completion_record_requests(
    event_id, request_id, actor_id, registration_id, elapsed_seconds, expected_result_revision
  ) values (
    p_event_id, p_request_id, v_actor, p_registration_id, p_elapsed_seconds, p_expected_result_revision
  ) on conflict (event_id, request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from marathon_private.completion_record_requests r
    where r.event_id = p_event_id and r.request_id = p_request_id
    for update;
    if v_request.actor_id is distinct from v_actor
       or v_request.registration_id is distinct from p_registration_id
       or v_request.elapsed_seconds is distinct from p_elapsed_seconds
       or v_request.expected_result_revision is distinct from p_expected_result_revision then
      raise exception 'This completion request ID was already used for a different payload'
        using errcode = '23505';
    end if;
    if v_request.outcome is null then
      raise exception 'This completion request did not complete' using errcode = '55000';
    end if;
    return v_request.outcome;
  end if;

  select * into v_setting
  from marathon_private.event_day_settings
  where event_id = p_event_id;
  if not found or not v_setting.timing_enabled or not v_setting.completion_desk_enabled then
    raise exception 'Completion desk is not enabled for this event' using errcode = '42501';
  end if;

  -- Lock registration before result, matching the legacy certificate and
  -- result lifecycle. Payment summary and evidence must agree at commit time.
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
    raise exception 'Completion recording requires a verified payment' using errcode = '42501';
  end if;

  v_minimum_seconds := coalesce((v_setting.minimum_seconds ->> v_registration.race)::integer, 1);
  if p_elapsed_seconds < v_minimum_seconds or p_elapsed_seconds > v_setting.maximum_seconds then
    raise exception 'Elapsed time is outside the approved race range' using errcode = '22023';
  end if;

  select * into v_result
  from marathon_private.race_results rr
  where rr.registration_id = v_registration.id
  for update;

  if found then
    if v_result.revision <> p_expected_result_revision then
      raise exception 'This result changed since the desk screen was opened' using errcode = '40001';
    end if;
    if v_result.status in ('organiser_recorded', 'verified', 'locked') then
      raise exception 'An official result already exists; an event administrator must review it'
        using errcode = '55000';
    end if;
    v_previous := to_jsonb(v_result);
    update marathon_private.race_results
    set elapsed_seconds = p_elapsed_seconds,
        provenance = 'organiser_recorded',
        status = 'organiser_recorded',
        finish_mark_id = null,
        recorded_by = v_actor,
        verified_by = null,
        note = '',
        revision = revision + 1,
        updated_at = clock_timestamp()
    where registration_id = v_registration.id
    returning * into v_result;
  else
    if p_expected_result_revision <> 0 then
      raise exception 'This participant has no result at the expected revision' using errcode = '40001';
    end if;
    v_previous := null;
    insert into marathon_private.race_results(
      registration_id, elapsed_seconds, provenance, status, recorded_by
    ) values (
      v_registration.id, p_elapsed_seconds, 'organiser_recorded', 'organiser_recorded', v_actor
    ) returning * into v_result;
  end if;

  v_outcome := jsonb_build_object(
    'registration_id', v_result.registration_id,
    'race', v_registration.race,
    'elapsed_seconds', v_result.elapsed_seconds,
    'provenance', v_result.provenance,
    'status', v_result.status,
    'result_revision', v_result.revision,
    'certificate_hold', v_result.certificate_hold
  );

  perform marathon_private.record_organizer_audit(
    p_event_id,
    'completion_desk',
    'race_completion_recorded',
    p_request_id,
    jsonb_build_object('registration_id', v_result.registration_id),
    v_result.revision,
    jsonb_build_object(
      'race', v_registration.race,
      'previous_result_present', v_previous is not null,
      'source', v_result.provenance
    )
  );

  update marathon_private.completion_record_requests
  set outcome = v_outcome,
      completed_at = clock_timestamp()
  where event_id = p_event_id and request_id = p_request_id;

  return v_outcome;
end;
$$;

create function marathon_private.review_race_completion(
  p_event_id text,
  p_registration_id uuid,
  p_expected_result_revision integer,
  p_target_status text,
  p_elapsed_seconds integer,
  p_note text,
  p_certificate_hold boolean,
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
  v_setting marathon_private.event_day_settings%rowtype;
  v_registration public.registrations%rowtype;
  v_result marathon_private.race_results%rowtype;
  v_request marathon_private.completion_review_requests%rowtype;
  v_outcome jsonb;
  v_elapsed_seconds integer;
  v_note text := btrim(coalesce(p_note, ''));
  v_hold boolean;
  v_provenance text;
  v_minimum_seconds integer;
  v_previous jsonb;
begin
  v_actor := marathon_private.require_active_capability(p_event_id, 'event_admin');
  if p_registration_id is null or p_request_id is null
     or p_expected_result_revision is null or p_expected_result_revision < 1 then
    raise exception 'A registration, current result revision and request ID are required'
      using errcode = '22023';
  end if;
  if p_target_status not in ('verified', 'correction_required', 'locked')
     or char_length(v_note) not between 5 and 1000
     or p_certificate_hold is null then
    raise exception 'Record a valid result decision, reason and certificate hold'
      using errcode = '22023';
  end if;
  if p_elapsed_seconds is not null and p_elapsed_seconds not between 1 and 172800 then
    raise exception 'Elapsed time is invalid' using errcode = '22023';
  end if;

  insert into marathon_private.completion_review_requests(
    event_id, request_id, actor_id, registration_id, expected_result_revision,
    target_status, elapsed_seconds, note, certificate_hold
  ) values (
    p_event_id, p_request_id, v_actor, p_registration_id, p_expected_result_revision,
    p_target_status, p_elapsed_seconds, v_note, p_certificate_hold
  ) on conflict (event_id, request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from marathon_private.completion_review_requests r
    where r.event_id = p_event_id and r.request_id = p_request_id
    for update;
    if v_request.actor_id is distinct from v_actor
       or v_request.registration_id is distinct from p_registration_id
       or v_request.expected_result_revision is distinct from p_expected_result_revision
       or v_request.target_status is distinct from p_target_status
       or v_request.elapsed_seconds is distinct from p_elapsed_seconds
       or v_request.note is distinct from v_note
       or v_request.certificate_hold is distinct from p_certificate_hold then
      raise exception 'This completion review request ID was already used for a different payload'
        using errcode = '23505';
    end if;
    if v_request.outcome is null then
      raise exception 'This completion review request did not complete' using errcode = '55000';
    end if;
    return v_request.outcome;
  end if;

  select * into v_setting
  from marathon_private.event_day_settings
  where event_id = p_event_id;
  if not found or not v_setting.timing_enabled or not v_setting.completion_desk_enabled then
    raise exception 'Completion desk is not enabled for this event' using errcode = '42501';
  end if;

  select * into v_registration
  from public.registrations r
  where r.id = p_registration_id and r.event_id = p_event_id
  for update;
  if not found or v_registration.payment_status <> 'verified' or not exists (
    select 1
    from marathon_private.payment_attempts a
    where a.registration_id = p_registration_id
      and a.event_id = p_event_id
      and a.status = 'verified'
  ) then
    raise exception 'Confirmed registration was not found' using errcode = '42501';
  end if;

  select * into v_result
  from marathon_private.race_results rr
  where rr.registration_id = v_registration.id
  for update;
  if not found then
    raise exception 'No completion result is available for review' using errcode = '22023';
  end if;
  if v_result.revision <> p_expected_result_revision then
    raise exception 'This result changed since the review screen was opened' using errcode = '40001';
  end if;
  if v_result.status = 'locked' then
    raise exception 'Locked results cannot be changed through the completion desk' using errcode = '55000';
  end if;

  v_elapsed_seconds := coalesce(p_elapsed_seconds, v_result.elapsed_seconds);
  v_minimum_seconds := coalesce((v_setting.minimum_seconds ->> v_registration.race)::integer, 1);
  if v_elapsed_seconds < v_minimum_seconds or v_elapsed_seconds > v_setting.maximum_seconds then
    raise exception 'Elapsed time is outside the approved race range' using errcode = '22023';
  end if;
  v_hold := case when p_target_status = 'correction_required' then true else p_certificate_hold end;
  v_provenance := v_result.provenance;
  if v_elapsed_seconds <> v_result.elapsed_seconds then
    v_provenance := 'organiser_corrected';
  elsif v_result.provenance = 'participant_submitted'
    and p_target_status in ('verified', 'locked') then
    v_provenance := 'organiser_verified';
  end if;

  v_previous := to_jsonb(v_result);
  update marathon_private.race_results
  set elapsed_seconds = v_elapsed_seconds,
      provenance = v_provenance,
      status = p_target_status,
      note = v_note,
      verified_by = case when p_target_status in ('verified', 'locked') then v_actor else null end,
      certificate_hold = v_hold,
      revision = revision + 1,
      updated_at = clock_timestamp()
  where registration_id = v_registration.id
  returning * into v_result;

  v_outcome := jsonb_build_object(
    'registration_id', v_result.registration_id,
    'race', v_registration.race,
    'elapsed_seconds', v_result.elapsed_seconds,
    'provenance', v_result.provenance,
    'status', v_result.status,
    'result_revision', v_result.revision,
    'certificate_hold', v_result.certificate_hold
  );

  perform marathon_private.record_organizer_audit(
    p_event_id,
    'event_admin',
    'race_completion_reviewed',
    p_request_id,
    jsonb_build_object('registration_id', v_result.registration_id),
    v_result.revision,
    jsonb_build_object(
      'race', v_registration.race,
      'previous_result_present', v_previous is not null,
      'target_status', v_result.status,
      'certificate_hold', v_result.certificate_hold,
      'source', v_result.provenance
    )
  );

  update marathon_private.completion_review_requests
  set outcome = v_outcome,
      completed_at = clock_timestamp()
  where event_id = p_event_id and request_id = p_request_id;

  return v_outcome;
end;
$$;

-- Existing participant self-time and own-entry snapshot calls remain available.
-- The broad legacy organiser dispatcher can no longer be reached through the
-- browser-facing RPC; payment review and race-day mutations use narrow
-- capability-gated operations above instead.
create or replace function public.event_day(
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_action not in ('snapshot', 'self_time') then
    raise exception 'Race-day organiser actions must use the capability-gated completion operations'
      using errcode = '42501';
  end if;
  return marathon_private.event_day(p_action, p_payload);
end;
$$;

create function public.completion_desk_queue(
  p_event_id text,
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
  select marathon_private.completion_desk_queue(
    p_event_id, p_race, p_after_registration_id, p_limit
  );
$$;

create function public.record_race_completion(
  p_event_id text,
  p_registration_id uuid,
  p_elapsed_seconds integer,
  p_expected_result_revision integer,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.record_race_completion(
    p_event_id, p_registration_id, p_elapsed_seconds,
    p_expected_result_revision, p_request_id
  );
$$;

create function public.review_race_completion(
  p_event_id text,
  p_registration_id uuid,
  p_expected_result_revision integer,
  p_target_status text,
  p_elapsed_seconds integer,
  p_note text,
  p_certificate_hold boolean,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.review_race_completion(
    p_event_id, p_registration_id, p_expected_result_revision,
    p_target_status, p_elapsed_seconds, p_note, p_certificate_hold, p_request_id
  );
$$;

revoke all on function marathon_private.prepare_certificate_backend(uuid, text, uuid, text),
  public.prepare_certificate_backend(uuid, text, uuid, text),
  marathon_private.validate_completion_request_write(),
  marathon_private.completion_desk_queue(text, text, uuid, integer),
  marathon_private.record_race_completion(text, uuid, integer, integer, uuid),
  marathon_private.review_race_completion(text, uuid, integer, text, integer, text, boolean, uuid),
  public.completion_desk_queue(text, text, uuid, integer),
  public.record_race_completion(text, uuid, integer, integer, uuid),
  public.review_race_completion(text, uuid, integer, text, integer, text, boolean, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.event_day(text, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function marathon_private.prepare_certificate_backend(uuid, text, uuid, text),
  public.prepare_certificate_backend(uuid, text, uuid, text),
  marathon_private.validate_completion_request_write()
  to service_role;
grant execute on function public.event_day(text, jsonb),
  public.completion_desk_queue(text, text, uuid, integer),
  public.record_race_completion(text, uuid, integer, integer, uuid),
  public.review_race_completion(text, uuid, integer, text, integer, text, boolean, uuid)
  to authenticated;

commit;
