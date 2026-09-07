-- Capability-gated payment review operations. Apply after 006--008.
-- Legacy event_day review remains available during the transition, but its
-- registration summaries are mirrored into the private payment-attempt ledger.
begin;

-- A request UUID is an idempotency key for exactly one review payload and one
-- organiser identity. It deliberately stores only the resulting operational
-- snapshot, never a receipt path or participant contact data.
create unique index if not exists payment_attempts_id_event_unique_idx
  on marathon_private.payment_attempts(id, event_id);

create table if not exists marathon_private.payment_review_requests (
  event_id text not null references public.event_config(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  attempt_id uuid not null,
  expected_attempt_revision integer not null check (expected_attempt_revision >= 1),
  requested_status text not null check (requested_status in ('verified', 'rejected')),
  requested_note text not null default '' check (char_length(requested_note) <= 1000),
  outcome jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  primary key (event_id, request_id),
  foreign key (attempt_id, event_id)
    references marathon_private.payment_attempts(id, event_id),
  check (outcome is null or jsonb_typeof(outcome) = 'object'),
  check (
    (outcome is null and completed_at is null)
    or (outcome is not null and completed_at is not null)
  )
);

alter table marathon_private.payment_review_requests enable row level security;
revoke all on table marathon_private.payment_review_requests
  from public, anon, authenticated, service_role;

-- Existing active organisers were seeded as event_admin in 007, so their
-- non-payment event-day tools keep working after MFA. The old boolean now
-- follows that revocable capability rather than the legacy table, preventing
-- a downgraded or capability-revoked session from exposing all payment data.
create or replace function marathon_private.is_organizer(p_event_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    auth.uid() is not null
    and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists (
      select 1 from auth.users u
      where u.id = (select auth.uid())
        and u.email_confirmed_at is not null
        and nullif(btrim(u.email), '') is not null
        and not coalesce(u.is_anonymous, false)
    )
    and exists (
      select 1 from marathon_private.organizer_capabilities c
      where c.event_id = p_event_id
        and c.user_id = (select auth.uid())
        and c.revoked_at is null
        and c.capability = 'event_admin'
    );
$$;

-- Preserve the original registration validation boundary while allowing the
-- new payment_reviewer capability (or event_admin) to write the legacy payment
-- summary. Direct legacy organiser calls continue to be accepted unchanged.
create or replace function marathon_private.validate_registration_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_event public.event_config%rowtype;
  v_email text;
  v_receipt_metadata jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array['payment_status','reviewed_at','reviewed_by','review_note'])
       is distinct from
       (to_jsonb(old) - array['payment_status','reviewed_at','reviewed_by','review_note']) then
      raise exception 'Submitted registration fields are immutable';
    end if;
    if old.payment_status <> 'pending_review' or new.payment_status not in ('verified', 'rejected') then
      raise exception 'Invalid payment review transition';
    end if;
    if not (
      exists (
        select 1 from marathon_private.organizers o
        where o.event_id = new.event_id
          and o.user_id = new.reviewed_by
          and o.revoked_at is null
      )
      or exists (
        select 1 from marathon_private.organizer_capabilities c
        where c.event_id = new.event_id
          and c.user_id = new.reviewed_by
          and c.revoked_at is null
          and c.capability in ('event_admin', 'payment_reviewer')
      )
    ) then
      raise exception 'An active payment reviewer must review the payment';
    end if;
    new.reviewed_at := v_now;
    return new;
  end if;

  select * into v_event from public.event_config e where e.id = new.event_id for share;
  if not found or not v_event.registration_open or not v_event.payment_configured
     or v_now > v_event.registration_deadline then
    raise exception 'Registration is not open';
  end if;
  perform 1 from marathon_private.memberships m where m.event_id = new.event_id
  and m.user_id = new.user_id and m.revoked_at is null for share;
  if not found then
    raise exception 'An active invitation membership is required';
  end if;
  select u.email into v_email from auth.users u where u.id = new.user_id
  and u.email_confirmed_at is not null and not coalesce(u.is_anonymous, false);
  if v_email is null then
    raise exception 'Verified email is required';
  end if;
  new.email := v_email;
  select r.fee_paise into new.fee_paise from public.race_config r
  where r.event_id = new.event_id and r.race = new.race;
  if new.fee_paise is null then
    raise exception 'Invalid race category';
  end if;
  if new.dob > (v_now at time zone 'Asia/Kolkata')::date then
    raise exception 'Date of birth cannot be in the future';
  end if;
  if new.receipt_path !~ (
    '^' || new.user_id::text || '/' || new.submission_id::text || '/receipt\.(jpg|png)$'
  ) then
    raise exception 'Invalid payment receipt path';
  end if;
  select o.metadata into v_receipt_metadata from storage.objects o
  where o.bucket_id = 'payment-receipts' and o.name = new.receipt_path;
  if not found or v_receipt_metadata is null
     or coalesce((v_receipt_metadata->>'size')::bigint, 0) not between 1 and 5242880
     or coalesce(v_receipt_metadata->>'mimetype', '') not in ('image/jpeg','image/png') then
    raise exception 'A valid owned payment receipt is required';
  end if;
  new.full_name := btrim(new.full_name);
  new.city := btrim(new.city);
  new.transaction_id := lower(btrim(new.transaction_id));
  new.payment_status := 'pending_review';
  new.reviewed_at := null;
  new.reviewed_by := null;
  new.review_note := null;
  new.created_at := v_now;
  return new;
end;
$$;

-- Keep the attempt ledger coherent while the legacy registration insert and
-- event_day review routes are still live. A modern review transitions the
-- attempt first, so the second trigger invocation finds no pending attempt.
create or replace function marathon_private.sync_payment_attempt_from_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
begin
  if tg_op = 'INSERT' then
    insert into marathon_private.payment_attempts(
      registration_id, event_id, attempt_ordinal, expected_fee_paise,
      transaction_utr, normalized_utr, receipt_path, receipt_digest_state,
      receipt_digest_sha256, status, reviewed_at, reviewed_by, review_note,
      source_revision, submitted_at
    ) values (
      new.id, new.event_id, 1, new.fee_paise,
      new.transaction_id, 'PENDING', new.receipt_path, 'legacy_unavailable',
      null, new.payment_status, new.reviewed_at, new.reviewed_by, new.review_note,
      1, new.created_at
    ) on conflict (registration_id, attempt_ordinal) do nothing;
    return new;
  end if;

  if old.payment_status = 'pending_review'
     and new.payment_status in ('verified', 'rejected') then
    select a.id into v_attempt_id
    from marathon_private.payment_attempts a
    where a.registration_id = new.id
      and a.event_id = new.event_id
      and a.status = 'pending_review'
    order by a.attempt_ordinal desc
    limit 1
    for update;

    if found then
      update marathon_private.payment_attempts
      set status = new.payment_status,
          reviewed_by = new.reviewed_by,
          review_note = new.review_note
      where id = v_attempt_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists marathon_sync_payment_attempt_after_registration_insert
  on public.registrations;
create trigger marathon_sync_payment_attempt_after_registration_insert
after insert on public.registrations
for each row execute function marathon_private.sync_payment_attempt_from_registration();

drop trigger if exists marathon_sync_payment_attempt_after_registration_review
  on public.registrations;
create trigger marathon_sync_payment_attempt_after_registration_review
after update of payment_status, reviewed_by, review_note on public.registrations
for each row execute function marathon_private.sync_payment_attempt_from_registration();

-- Cover the small transition window where 008 may already have been deployed
-- while legacy registration intake was still active. New rows are normally
-- covered by the insert trigger above; this statement only fills a missing
-- ledger record and does not rewrite any existing evidence.
insert into marathon_private.payment_attempts(
  registration_id, event_id, attempt_ordinal, expected_fee_paise,
  transaction_utr, normalized_utr, receipt_path, receipt_digest_state,
  receipt_digest_sha256, status, reviewed_at, reviewed_by, review_note,
  source_revision, submitted_at
)
select
  r.id, r.event_id, 1, r.fee_paise,
  r.transaction_id, 'PENDING', r.receipt_path, 'legacy_unavailable',
  null, r.payment_status, r.reviewed_at, r.reviewed_by, r.review_note,
  1, r.created_at
from public.registrations r
where not exists (
  select 1 from marathon_private.payment_attempts a
  where a.registration_id = r.id
)
on conflict (registration_id, attempt_ordinal) do nothing;

-- If a legacy review happened after 008's initial backfill but before this
-- migration installed its triggers, preserve that already-recorded decision in
-- the ledger. Terminal evidence is never overwritten here.
update marathon_private.payment_attempts a
set status = r.payment_status,
    reviewed_by = r.reviewed_by,
    review_note = r.review_note
from public.registrations r
where r.id = a.registration_id
  and r.event_id = a.event_id
  and a.status = 'pending_review'
  and r.payment_status in ('verified', 'rejected');

create or replace function marathon_private.payment_review_queue(
  p_event_id text,
  p_status text default 'pending_review',
  p_race text default null,
  p_after_source_revision bigint default null,
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
  v_next bigint := null;
  v_has_more boolean := false;
  v_count integer := 0;
  v_row record;
begin
  perform marathon_private.require_active_capability(p_event_id, 'payment_reviewer');

  if v_status not in ('pending_review', 'verified', 'rejected', 'all') then
    raise exception 'Choose a valid payment status filter' using errcode = '22023';
  end if;
  if v_race is not null and v_race not in ('5', '10', '21') then
    raise exception 'Choose a valid race filter' using errcode = '22023';
  end if;
  if v_limit not between 1 and 100 then
    raise exception 'Payment queue pages contain between 1 and 100 entries' using errcode = '22023';
  end if;
  if p_after_source_revision is not null and p_after_source_revision < 1 then
    raise exception 'The payment queue cursor is invalid' using errcode = '22023';
  end if;

  for v_row in
    select
      a.id as payment_attempt_id,
      a.registration_id,
      r.full_name,
      r.race,
      a.attempt_ordinal,
      a.expected_fee_paise,
      a.transaction_utr,
      a.status,
      a.submitted_at,
      a.revision as attempt_revision,
      a.source_revision,
      (a.receipt_path is not null) as receipt_available
    from marathon_private.payment_attempts a
    join public.registrations r on r.id = a.registration_id and r.event_id = a.event_id
    where a.event_id = p_event_id
      and (v_status = 'all' or a.status = v_status)
      and (v_race is null or r.race = v_race)
      and (p_after_source_revision is null or a.source_revision > p_after_source_revision)
    order by a.source_revision asc, a.id asc
    limit v_limit + 1
  loop
    if v_count >= v_limit then
      v_has_more := true;
      exit;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'payment_attempt_id', v_row.payment_attempt_id,
      'registration_id', v_row.registration_id,
      'full_name', v_row.full_name,
      'race', v_row.race,
      'attempt_ordinal', v_row.attempt_ordinal,
      'expected_fee_paise', v_row.expected_fee_paise,
      'transaction_utr', v_row.transaction_utr,
      'status', v_row.status,
      'submitted_at', v_row.submitted_at,
      'attempt_revision', v_row.attempt_revision,
      'source_revision', v_row.source_revision,
      'receipt_available', v_row.receipt_available
    ));
    v_next := v_row.source_revision;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'items', v_items,
    'next_after_source_revision', v_next,
    'has_more', v_has_more
  );
end;
$$;

create or replace function marathon_private.authorize_payment_receipt(
  p_event_id text,
  p_attempt_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt marathon_private.payment_attempts%rowtype;
begin
  perform marathon_private.require_active_capability(p_event_id, 'payment_reviewer');
  if p_attempt_id is null or p_request_id is null then
    raise exception 'A payment attempt and request ID are required' using errcode = '22023';
  end if;

  select * into v_attempt
  from marathon_private.payment_attempts a
  where a.id = p_attempt_id and a.event_id = p_event_id;
  if not found then
    raise exception 'Payment evidence was not found for this event' using errcode = '22023';
  end if;

  perform marathon_private.record_organizer_audit(
    p_event_id,
    'payment_reviewer',
    'payment_receipt_authorized',
    p_request_id,
    jsonb_build_object(
      'payment_attempt_id', v_attempt.id,
      'registration_id', v_attempt.registration_id
    ),
    v_attempt.revision,
    jsonb_build_object(
      'receipt_digest_state', v_attempt.receipt_digest_state
    )
  );

  return jsonb_build_object(
    'payment_attempt_id', v_attempt.id,
    'storage_bucket', 'payment-receipts',
    'receipt_path', v_attempt.receipt_path,
    'attempt_revision', v_attempt.revision
  );
end;
$$;

create or replace function marathon_private.review_payment_attempt(
  p_event_id text,
  p_attempt_id uuid,
  p_expected_attempt_revision integer,
  p_status text,
  p_note text,
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
  v_status text := btrim(coalesce(p_status, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_registration_id uuid;
  v_registration public.registrations%rowtype;
  v_attempt marathon_private.payment_attempts%rowtype;
  v_request marathon_private.payment_review_requests%rowtype;
  v_outcome jsonb;
begin
  v_actor := marathon_private.require_active_capability(p_event_id, 'payment_reviewer');
  if p_attempt_id is null or p_request_id is null then
    raise exception 'A payment attempt and request ID are required' using errcode = '22023';
  end if;
  if p_expected_attempt_revision is null or p_expected_attempt_revision < 1 then
    raise exception 'The payment evidence revision is required' using errcode = '22023';
  end if;
  if v_status not in ('verified', 'rejected') then
    raise exception 'Choose verified or rejected' using errcode = '22023';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'Payment review notes are limited to 1000 characters' using errcode = '22023';
  end if;
  if v_status = 'rejected' and char_length(v_note) < 5 then
    raise exception 'Explain why the payment needs correction' using errcode = '22023';
  end if;

  select a.registration_id into v_registration_id
  from marathon_private.payment_attempts a
  where a.id = p_attempt_id and a.event_id = p_event_id;
  if not found then
    raise exception 'Payment evidence was not found for this event' using errcode = '22023';
  end if;

  insert into marathon_private.payment_review_requests(
    event_id, request_id, actor_id, attempt_id, expected_attempt_revision,
    requested_status, requested_note
  ) values (
    p_event_id, p_request_id, v_actor, p_attempt_id, p_expected_attempt_revision,
    v_status, v_note
  ) on conflict (event_id, request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from marathon_private.payment_review_requests r
    where r.event_id = p_event_id and r.request_id = p_request_id
    for update;

    if v_request.actor_id is distinct from v_actor
       or v_request.attempt_id is distinct from p_attempt_id
       or v_request.expected_attempt_revision is distinct from p_expected_attempt_revision
       or v_request.requested_status is distinct from v_status
       or v_request.requested_note is distinct from v_note then
      raise exception 'This payment review request ID was already used for a different payload'
        using errcode = '23505';
    end if;
    if v_request.outcome is null then
      raise exception 'This payment review request did not complete' using errcode = '55000';
    end if;
    return v_request.outcome;
  end if;

  -- Match legacy event_day lock ordering: registration before attempt. This
  -- prevents a legacy review and a capability review from deadlocking each
  -- other during the transition period.
  select * into v_registration
  from public.registrations r
  where r.id = v_registration_id and r.event_id = p_event_id
  for update;
  if not found then
    raise exception 'Registration was not found for this payment evidence' using errcode = '22023';
  end if;

  select * into v_attempt
  from marathon_private.payment_attempts a
  where a.id = p_attempt_id and a.event_id = p_event_id
  for update;
  if not found then
    raise exception 'Payment evidence was not found for this event' using errcode = '22023';
  end if;
  if v_attempt.registration_id is distinct from v_registration.id then
    raise exception 'Payment evidence does not belong to this registration' using errcode = '23503';
  end if;
  if v_attempt.revision <> p_expected_attempt_revision then
    raise exception 'Payment evidence changed since this review screen was opened' using errcode = '40001';
  end if;
  if v_attempt.status <> 'pending_review' then
    raise exception 'This payment evidence was already reviewed' using errcode = '55000';
  end if;
  if v_registration.payment_status <> 'pending_review' then
    raise exception 'Registration payment summary is not awaiting review' using errcode = '55000';
  end if;

  update marathon_private.payment_attempts
  set status = v_status,
      reviewed_by = v_actor,
      review_note = nullif(v_note, '')
  where id = v_attempt.id
  returning * into v_attempt;

  update public.registrations
  set payment_status = v_status,
      reviewed_by = v_actor,
      review_note = nullif(v_note, '')
  where id = v_registration.id
  returning * into v_registration;

  v_outcome := jsonb_build_object(
    'payment_attempt_id', v_attempt.id,
    'registration_id', v_registration.id,
    'status', v_attempt.status,
    'attempt_revision', v_attempt.revision,
    'source_revision', v_attempt.source_revision,
    'reviewed_at', v_attempt.reviewed_at
  );

  perform marathon_private.record_organizer_audit(
    p_event_id,
    'payment_reviewer',
    'payment_reviewed',
    p_request_id,
    jsonb_build_object(
      'payment_attempt_id', v_attempt.id,
      'registration_id', v_registration.id
    ),
    v_attempt.revision,
    jsonb_build_object(
      'status', v_attempt.status,
      'expected_attempt_revision', p_expected_attempt_revision,
      'source_revision', v_attempt.source_revision,
      'rejection_reason_recorded', v_attempt.status = 'rejected'
    )
  );

  update marathon_private.payment_review_requests
  set outcome = v_outcome,
      completed_at = clock_timestamp()
  where event_id = p_event_id and request_id = p_request_id;

  return v_outcome;
end;
$$;

-- The API schema exposes only narrow, audited wrappers. The private helpers,
-- evidence ledger and idempotency table receive no browser grants.
create or replace function public.payment_review_queue(
  p_event_id text,
  p_status text default 'pending_review',
  p_race text default null,
  p_after_source_revision bigint default null,
  p_limit integer default 25
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.payment_review_queue(
    p_event_id, p_status, p_race, p_after_source_revision, p_limit
  );
$$;

create or replace function public.authorize_payment_receipt(
  p_event_id text,
  p_attempt_id uuid,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.authorize_payment_receipt(p_event_id, p_attempt_id, p_request_id);
$$;

create or replace function public.review_payment_attempt(
  p_event_id text,
  p_attempt_id uuid,
  p_expected_attempt_revision integer,
  p_status text,
  p_note text,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.review_payment_attempt(
    p_event_id, p_attempt_id, p_expected_attempt_revision, p_status, p_note, p_request_id
  );
$$;

-- Retain event_day for the existing participant and race-day workflow, but
-- retire only its unaudited review_payment branch. Payment decisions now have
-- one capability-gated, revision-checked route above.
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
  if p_action = 'review_payment' then
    raise exception 'Payment review must use the capability-gated payment review operation'
      using errcode = '42501';
  end if;
  return marathon_private.event_day(p_action, p_payload);
end;
$$;

-- Receipt files stay private to their owner. A payment reviewer receives a
-- single audited path authorization above; a server-side signer can turn that
-- authorization into a short-lived URL without reintroducing a browser-wide
-- organiser Storage policy.
drop policy if exists marathon_receipt_read on storage.objects;
create policy marathon_receipt_read on storage.objects for select to authenticated using (
  bucket_id = 'payment-receipts'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

revoke all on function marathon_private.sync_payment_attempt_from_registration()
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.payment_review_queue(text, text, text, bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.authorize_payment_receipt(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.review_payment_attempt(text, uuid, integer, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.payment_review_queue(text, text, text, bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.authorize_payment_receipt(text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.review_payment_attempt(text, uuid, integer, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.event_day(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.event_day(text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.payment_review_queue(text, text, text, bigint, integer),
  public.authorize_payment_receipt(text, uuid, uuid),
  public.review_payment_attempt(text, uuid, integer, text, text, uuid),
  public.event_day(text, jsonb)
  to authenticated;

commit;
