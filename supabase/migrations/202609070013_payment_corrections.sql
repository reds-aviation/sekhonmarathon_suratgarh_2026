-- A rejected payment is corrected by adding a new proof, never by replacing
-- the original evidence. Apply after 202609070012_tshirt_collections.sql.
begin;

-- This is both an idempotency ledger and the participant-facing audit trail for
-- a correction. It deliberately holds no public Storage URL. The outcome is
-- written exactly once by the same transaction that creates the replacement
-- payment attempt and resets the registration summary to pending review.
create table if not exists marathon_private.payment_correction_requests (
  event_id text not null references public.event_config(id),
  request_id uuid not null,
  actor_id uuid not null references auth.users(id),
  registration_id uuid not null,
  transaction_utr text not null check (char_length(btrim(transaction_utr)) between 6 and 64),
  normalized_utr text not null check (normalized_utr ~ '^[A-Z0-9]{6,64}$'),
  receipt_path text not null check (char_length(btrim(receipt_path)) between 1 and 1024),
  receipt_digest_sha256 text not null check (receipt_digest_sha256 ~ '^[0-9a-f]{64}$'),
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

create index if not exists payment_correction_requests_registration_idx
  on marathon_private.payment_correction_requests(event_id, registration_id, created_at desc);

alter table marathon_private.payment_correction_requests enable row level security;
revoke all on table marathon_private.payment_correction_requests
  from public, anon, authenticated;
grant select, insert, update, delete on table marathon_private.payment_correction_requests
  to service_role;

-- The request's caller input is immutable. The sole legal later change is the
-- private function attaching its completed operational outcome.
create or replace function marathon_private.validate_payment_correction_request_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized_utr text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Payment correction audit records are immutable' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    new.transaction_utr := lower(btrim(new.transaction_utr));
    v_normalized_utr := upper(regexp_replace(new.transaction_utr, '[^A-Za-z0-9]', '', 'g'));
    if new.transaction_utr !~ '^[A-Za-z0-9-]{6,64}$'
       or v_normalized_utr !~ '^[A-Z0-9]{6,64}$' then
      raise exception 'Enter a valid payment reference' using errcode = '22023';
    end if;
    new.normalized_utr := v_normalized_utr;
    new.receipt_digest_sha256 := lower(btrim(new.receipt_digest_sha256));
    if new.receipt_digest_sha256 !~ '^[0-9a-f]{64}$' then
      raise exception 'A server-computed receipt SHA-256 digest is required'
        using errcode = '22023';
    end if;
    if new.outcome is not null or new.completed_at is not null then
      raise exception 'Payment correction outcomes are assigned by the server'
        using errcode = '42501';
    end if;
    new.created_at := clock_timestamp();
    return new;
  end if;

  if (to_jsonb(new) - array['outcome', 'completed_at'])
     is distinct from
     (to_jsonb(old) - array['outcome', 'completed_at']) then
    raise exception 'Payment correction request details are immutable' using errcode = '55000';
  end if;
  if old.outcome is not null or old.completed_at is not null
     or new.outcome is null or new.completed_at is null then
    raise exception 'Payment correction outcomes are immutable' using errcode = '55000';
  end if;
  new.completed_at := clock_timestamp();
  return new;
end;
$$;

drop trigger if exists marathon_validate_payment_correction_request_write
  on marathon_private.payment_correction_requests;
create trigger marathon_validate_payment_correction_request_write
before insert or update or delete on marathon_private.payment_correction_requests
for each row execute function marathon_private.validate_payment_correction_request_write();

-- Participants do not need organiser MFA to correct a rejected payment, but
-- they must use their own verified account and retain station membership.
create or replace function marathon_private.require_active_member(p_event_id text)
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
  if nullif(btrim(p_event_id), '') is null then
    raise exception 'An event is required' using errcode = '22023';
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
  if not exists (
    select 1
    from marathon_private.memberships m
    where m.event_id = p_event_id
      and m.user_id = v_actor
      and m.revoked_at is null
  ) then
    raise exception 'An active station invitation membership is required' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- The forward-only payment correction transaction. It locks the registration
-- first, matching payment review and T-shirt collection, then creates a fresh
-- immutable attempt. A retry with the same request ID returns the original
-- completed result and can never submit a second proof.
create or replace function marathon_private.submit_payment_correction(
  p_event_id text,
  p_registration_id uuid,
  p_transaction_utr text,
  p_receipt_path text,
  p_receipt_digest_sha256 text,
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
  v_transaction_utr text := lower(btrim(coalesce(p_transaction_utr, '')));
  v_normalized_utr text;
  v_receipt_path text := btrim(coalesce(p_receipt_path, ''));
  v_receipt_digest_sha256 text := lower(btrim(coalesce(p_receipt_digest_sha256, '')));
  v_receipt_metadata jsonb;
  v_registration public.registrations%rowtype;
  v_previous_attempt marathon_private.payment_attempts%rowtype;
  v_new_attempt marathon_private.payment_attempts%rowtype;
  v_request marathon_private.payment_correction_requests%rowtype;
  v_outcome jsonb;
begin
  v_actor := marathon_private.require_active_member(p_event_id);
  if p_registration_id is null or p_request_id is null then
    raise exception 'A registration and correction request ID are required' using errcode = '22023';
  end if;
  if v_transaction_utr !~ '^[A-Za-z0-9-]{6,64}$' then
    raise exception 'Enter a valid payment reference' using errcode = '22023';
  end if;
  v_normalized_utr := upper(regexp_replace(v_transaction_utr, '[^A-Za-z0-9]', '', 'g'));
  if v_normalized_utr !~ '^[A-Z0-9]{6,64}$' then
    raise exception 'Enter a valid payment reference' using errcode = '22023';
  end if;
  if v_receipt_digest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A server-computed receipt SHA-256 digest is required' using errcode = '22023';
  end if;
  if v_receipt_path !~ (
    '^' || v_actor::text || '/payment-corrections/' || p_registration_id::text
    || '/' || p_request_id::text || '/receipt\.(jpg|png)$'
  ) then
    raise exception 'Invalid payment correction receipt path' using errcode = '22023';
  end if;

  -- Acquire the same primary lock used by other payment-related operations.
  select * into v_registration
  from public.registrations r
  where r.id = p_registration_id and r.event_id = p_event_id
  for update;
  if not found then
    raise exception 'Registration was not found for this event' using errcode = '22023';
  end if;
  if v_registration.user_id is distinct from v_actor then
    raise exception 'You can correct only your own payment' using errcode = '42501';
  end if;

  insert into marathon_private.payment_correction_requests(
    event_id, request_id, actor_id, registration_id, transaction_utr,
    normalized_utr, receipt_path, receipt_digest_sha256
  ) values (
    p_event_id, p_request_id, v_actor, p_registration_id, v_transaction_utr,
    v_normalized_utr, v_receipt_path, v_receipt_digest_sha256
  ) on conflict (event_id, request_id) do nothing
  returning * into v_request;

  if not found then
    select * into v_request
    from marathon_private.payment_correction_requests c
    where c.event_id = p_event_id and c.request_id = p_request_id
    for update;

    if v_request.actor_id is distinct from v_actor
       or v_request.registration_id is distinct from p_registration_id
       or v_request.transaction_utr is distinct from v_transaction_utr
       or v_request.normalized_utr is distinct from v_normalized_utr
       or v_request.receipt_path is distinct from v_receipt_path
       or v_request.receipt_digest_sha256 is distinct from v_receipt_digest_sha256 then
      raise exception 'This payment correction request ID was already used for a different payload'
        using errcode = '23505';
    end if;
    if v_request.outcome is null then
      raise exception 'This payment correction request did not complete' using errcode = '55000';
    end if;
    return v_request.outcome;
  end if;

  if v_registration.payment_status <> 'rejected' then
    raise exception 'Only a rejected payment can be corrected' using errcode = '55000';
  end if;

  select * into v_previous_attempt
  from marathon_private.payment_attempts a
  where a.registration_id = v_registration.id
    and a.event_id = p_event_id
  order by a.attempt_ordinal desc
  limit 1
  for update;
  if not found or v_previous_attempt.status <> 'rejected' then
    raise exception 'The current payment evidence is not eligible for correction'
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from marathon_private.payment_attempts a
    where a.registration_id = v_registration.id
      and a.event_id = p_event_id
      and a.status in ('pending_review', 'verified')
  ) then
    raise exception 'This registration already has current payment evidence'
      using errcode = '55000';
  end if;

  -- The Edge Function validates the actual bytes and signature. The database
  -- also verifies the immutable private object metadata before it accepts the
  -- digest and canonical correction path.
  select o.metadata into v_receipt_metadata
  from storage.objects o
  where o.bucket_id = 'payment-receipts' and o.name = v_receipt_path;
  if not found or v_receipt_metadata is null
     or coalesce((v_receipt_metadata->>'size')::bigint, 0) not between 1 and 5242880
     or (v_receipt_path like '%.jpg' and coalesce(v_receipt_metadata->>'mimetype', '') <> 'image/jpeg')
     or (v_receipt_path like '%.png' and coalesce(v_receipt_metadata->>'mimetype', '') <> 'image/png') then
    raise exception 'A valid owned payment correction receipt is required' using errcode = '22023';
  end if;

  -- Preserve global normalized-UTR uniqueness even across rejected history.
  -- The unique index remains the concurrent-writer backstop for this check.
  if exists (
    select 1
    from marathon_private.payment_attempts a
    where a.event_id = p_event_id and a.normalized_utr = v_normalized_utr
  ) then
    raise exception 'This payment reference has already been submitted' using errcode = '23505';
  end if;

  insert into marathon_private.payment_attempts(
    registration_id, event_id, attempt_ordinal, expected_fee_paise,
    transaction_utr, receipt_path, receipt_digest_state, receipt_digest_sha256,
    status
  ) values (
    v_registration.id, p_event_id, v_previous_attempt.attempt_ordinal + 1,
    v_registration.fee_paise, v_transaction_utr, v_receipt_path,
    'sha256', v_receipt_digest_sha256, 'pending_review'
  ) returning * into v_new_attempt;

  -- This update is accepted only while the correction request above is active
  -- in the same transaction; the registration trigger retains the normal
  -- pending -> verified/rejected review boundary for every other caller.
  update public.registrations
  set transaction_id = v_transaction_utr,
      receipt_path = v_receipt_path,
      receipt_digest_sha256 = v_receipt_digest_sha256,
      payment_status = 'pending_review',
      reviewed_at = null,
      reviewed_by = null,
      review_note = null
  where id = v_registration.id and event_id = p_event_id;

  v_outcome := jsonb_build_object(
    'registration_id', v_registration.id,
    'payment_attempt_id', v_new_attempt.id,
    'status', v_new_attempt.status,
    'attempt_ordinal', v_new_attempt.attempt_ordinal,
    'attempt_revision', v_new_attempt.revision,
    'source_revision', v_new_attempt.source_revision
  );

  update marathon_private.payment_correction_requests
  set outcome = v_outcome,
      completed_at = clock_timestamp()
  where event_id = p_event_id and request_id = p_request_id;

  return v_outcome;
end;
$$;

-- Retain the post-010 registration intake checks, but permit exactly one new
-- transition: a verified, invited owner may move their own rejected summary
-- back to pending only through the immutable correction-request ledger above.
create or replace function marathon_private.validate_registration_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.event_config%rowtype;
  v_email text;
  v_receipt_metadata jsonb;
  v_now timestamptz := clock_timestamp();
  v_actor uuid;
  v_normalized_utr text;
begin
  if tg_op = 'UPDATE' then
    if old.payment_status = 'rejected' and new.payment_status = 'pending_review' then
      if (to_jsonb(new) - array[
        'payment_status', 'reviewed_at', 'reviewed_by', 'review_note',
        'transaction_id', 'receipt_path', 'receipt_digest_sha256'
      ]) is distinct from (
        to_jsonb(old) - array[
          'payment_status', 'reviewed_at', 'reviewed_by', 'review_note',
          'transaction_id', 'receipt_path', 'receipt_digest_sha256'
        ]
      ) then
        raise exception 'Submitted registration fields are immutable';
      end if;
      if new.reviewed_at is not null or new.reviewed_by is not null or new.review_note is not null then
        raise exception 'Corrected payments must return to pending review' using errcode = '23514';
      end if;
      v_actor := marathon_private.require_active_member(new.event_id);
      if v_actor is distinct from old.user_id then
        raise exception 'You can correct only your own payment' using errcode = '42501';
      end if;
      new.transaction_id := lower(btrim(new.transaction_id));
      v_normalized_utr := upper(regexp_replace(new.transaction_id, '[^A-Za-z0-9]', '', 'g'));
      new.receipt_digest_sha256 := lower(btrim(new.receipt_digest_sha256));
      if new.transaction_id !~ '^[A-Za-z0-9-]{6,64}$'
         or v_normalized_utr !~ '^[A-Z0-9]{6,64}$'
         or new.receipt_digest_sha256 !~ '^[0-9a-f]{64}$' then
        raise exception 'A valid payment correction is required' using errcode = '22023';
      end if;
      select o.metadata into v_receipt_metadata
      from storage.objects o
      where o.bucket_id = 'payment-receipts' and o.name = new.receipt_path;
      if not found or v_receipt_metadata is null
         or coalesce((v_receipt_metadata->>'size')::bigint, 0) not between 1 and 5242880
         or (new.receipt_path like '%.jpg' and coalesce(v_receipt_metadata->>'mimetype', '') <> 'image/jpeg')
         or (new.receipt_path like '%.png' and coalesce(v_receipt_metadata->>'mimetype', '') <> 'image/png') then
        raise exception 'A valid owned payment correction receipt is required' using errcode = '22023';
      end if;
      if not exists (
        select 1
        from marathon_private.payment_correction_requests c
        where c.event_id = new.event_id
          and c.registration_id = new.id
          and c.actor_id = v_actor
          and c.transaction_utr = new.transaction_id
          and c.normalized_utr = v_normalized_utr
          and c.receipt_path = new.receipt_path
          and c.receipt_digest_sha256 = new.receipt_digest_sha256
          and c.outcome is null
      ) then
        raise exception 'Payment corrections must be submitted through the protected correction flow'
          using errcode = '42501';
      end if;
      return new;
    end if;

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
  new.receipt_digest_sha256 := lower(btrim(new.receipt_digest_sha256));
  if new.receipt_digest_sha256 is null
     or new.receipt_digest_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'A server-computed receipt SHA-256 digest is required';
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

-- The Drive mirror is intentionally a current operational spreadsheet. Every
-- source revision now carries the evidence belonging to that exact payment
-- attempt, and receipt access uses attempt ID rather than a mutable
-- registration summary. The original rejected file remains private in Storage
-- and any earlier Drive copy remains a separate private file.
create or replace function marathon_private.drive_mirror_batch(
  p_event_id text,
  p_after_source_revision bigint default 0,
  p_limit integer default 50
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_after bigint := coalesce(p_after_source_revision, 0);
  v_limit integer := coalesce(p_limit, 50);
  v_items jsonb := '[]'::jsonb;
  v_next bigint := v_after;
  v_has_more boolean := false;
  v_count integer := 0;
  v_row record;
begin
  if nullif(btrim(p_event_id), '') is null
     or not exists (select 1 from public.event_config e where e.id = p_event_id) then
    raise exception 'The mirror event is invalid' using errcode = '22023';
  end if;
  if v_after < 0 then
    raise exception 'The mirror cursor is invalid' using errcode = '22023';
  end if;
  if v_limit not between 1 and 100 then
    raise exception 'Mirror pages contain between 1 and 100 entries' using errcode = '22023';
  end if;

  for v_row in
    select
      a.source_revision,
      a.id as payment_attempt_id,
      a.status as payment_attempt_status,
      a.attempt_ordinal,
      a.revision as payment_attempt_revision,
      a.transaction_utr,
      r.id as registration_id,
      r.created_at as registered_at,
      r.full_name,
      r.mobile,
      r.email,
      r.dob,
      r.gender,
      r.participant_type,
      r.city,
      r.race,
      r.fee_paise,
      r.tshirt,
      r.blood_group,
      r.emergency_contact,
      r.payment_status,
      r.reviewed_at as payment_reviewed_at,
      (a.receipt_path is not null) as receipt_available
    from marathon_private.payment_attempts a
    join public.registrations r
      on r.id = a.registration_id and r.event_id = a.event_id
    where a.event_id = p_event_id
      and a.source_revision > v_after
    order by a.source_revision asc, a.id asc
    limit v_limit + 1
  loop
    if v_count >= v_limit then
      v_has_more := true;
      exit;
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'source_revision', v_row.source_revision,
      'registration_id', v_row.registration_id,
      'registered_at', v_row.registered_at,
      'full_name', v_row.full_name,
      'mobile', v_row.mobile,
      'email', v_row.email,
      'dob', v_row.dob,
      'gender', v_row.gender,
      'participant_type', v_row.participant_type,
      'city', v_row.city,
      'race', v_row.race,
      'fee_paise', v_row.fee_paise,
      'tshirt', v_row.tshirt,
      'blood_group', v_row.blood_group,
      'emergency_contact', v_row.emergency_contact,
      'transaction_utr', v_row.transaction_utr,
      'payment_status', v_row.payment_status,
      'payment_reviewed_at', v_row.payment_reviewed_at,
      'payment_attempt_id', v_row.payment_attempt_id,
      'payment_attempt_status', v_row.payment_attempt_status,
      'payment_attempt_ordinal', v_row.attempt_ordinal,
      'payment_attempt_revision', v_row.payment_attempt_revision,
      'receipt_available', v_row.receipt_available
    ));
    v_next := v_row.source_revision;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object(
    'records', v_items,
    'next_after_source_revision', v_next,
    'has_more', v_has_more
  );
end;
$$;

drop function if exists marathon_private.drive_mirror_receipt(text, uuid);
create function marathon_private.drive_mirror_receipt(
  p_event_id text,
  p_payment_attempt_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_receipt_path text;
begin
  if nullif(btrim(p_event_id), '') is null or p_payment_attempt_id is null then
    raise exception 'A mirror event and payment attempt reference are required'
      using errcode = '22023';
  end if;
  select a.receipt_path into v_receipt_path
  from marathon_private.payment_attempts a
  where a.event_id = p_event_id and a.id = p_payment_attempt_id;
  if not found or nullif(btrim(v_receipt_path), '') is null then
    raise exception 'The payment receipt was not found' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'payment_attempt_id', p_payment_attempt_id,
    'storage_bucket', 'payment-receipts',
    'receipt_path', v_receipt_path
  );
end;
$$;

-- API-schema wrappers are service-integration-only. Browser roles cannot
-- enumerate a registration's historic proofs or obtain a Storage path.
create or replace function public.drive_mirror_batch(
  p_event_id text,
  p_after_source_revision bigint default 0,
  p_limit integer default 50
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.drive_mirror_batch(
    p_event_id, p_after_source_revision, p_limit
  );
$$;

drop function if exists public.drive_mirror_receipt(text, uuid);
create function public.drive_mirror_receipt(
  p_event_id text,
  p_payment_attempt_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.drive_mirror_receipt(p_event_id, p_payment_attempt_id);
$$;

-- This narrow wrapper is the only public-schema operation available to an
-- authenticated participant. It derives ownership from auth.uid(); callers
-- cannot supply a user ID, fee, status, storage bucket, or review decision.
create or replace function public.submit_payment_correction(
  p_event_id text,
  p_registration_id uuid,
  p_transaction_utr text,
  p_receipt_path text,
  p_receipt_digest_sha256 text,
  p_request_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.submit_payment_correction(
    p_event_id, p_registration_id, p_transaction_utr, p_receipt_path,
    p_receipt_digest_sha256, p_request_id
  );
$$;

revoke all on function marathon_private.validate_payment_correction_request_write()
  from public, anon, authenticated;
revoke all on function marathon_private.require_active_member(text)
  from public, anon, authenticated;
revoke all on function marathon_private.submit_payment_correction(text, uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.drive_mirror_batch(text, bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.drive_mirror_receipt(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.submit_payment_correction(text, uuid, text, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.drive_mirror_batch(text, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.drive_mirror_receipt(text, uuid)
  from public, anon, authenticated;
grant execute on function public.submit_payment_correction(text, uuid, text, text, text, uuid)
  to authenticated;
grant execute on function public.drive_mirror_batch(text, bigint, integer),
  public.drive_mirror_receipt(text, uuid)
  to service_role;
grant execute on function marathon_private.require_active_member(text)
  to service_role;

commit;
