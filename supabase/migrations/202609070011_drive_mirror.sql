-- One-way private Google Drive / Sheets mirror. The organiser spreadsheet may
-- import operational data, but it is never an authority for payment decisions.
-- Apply after 202609070010_receipt_integrity.sql.
begin;

create table if not exists marathon_private.drive_mirror_nonces (
  nonce uuid primary key,
  request_timestamp timestamptz not null,
  request_digest_sha256 text not null
    check (request_digest_sha256 ~ '^[0-9a-f]{64}$'),
  action text not null check (action in ('sync', 'receipt')),
  received_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null
);

create index if not exists drive_mirror_nonces_expiry_idx
  on marathon_private.drive_mirror_nonces(expires_at);

alter table marathon_private.drive_mirror_nonces enable row level security;
revoke all on table marathon_private.drive_mirror_nonces from public, anon, authenticated;
grant select, insert, delete on table marathon_private.drive_mirror_nonces to service_role;

-- The Edge Function verifies the HMAC before this function runs. Persisting a
-- body digest and nonce here makes the short request window single-use even if
-- a captured signed request is replayed. The wrapper below is executable only
-- by service_role; browser roles never receive this capability.
create or replace function marathon_private.claim_drive_mirror_nonce(
  p_nonce uuid,
  p_timestamp_epoch bigint,
  p_request_digest_sha256 text,
  p_action text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_timestamp timestamptz;
  v_action text := btrim(coalesce(p_action, ''));
  v_digest text := lower(btrim(coalesce(p_request_digest_sha256, '')));
begin
  if p_nonce is null then
    raise exception 'A mirror request nonce is required' using errcode = '22023';
  end if;
  if p_timestamp_epoch is null or p_timestamp_epoch < 0
     or p_timestamp_epoch > 4102444800 then
    raise exception 'The mirror request timestamp is invalid' using errcode = '22023';
  end if;
  if v_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'The mirror request digest is invalid' using errcode = '22023';
  end if;
  if v_action not in ('sync', 'receipt') then
    raise exception 'The mirror request action is invalid' using errcode = '22023';
  end if;

  v_timestamp := timestamptz 'epoch' + p_timestamp_epoch * interval '1 second';
  if v_timestamp < v_now - interval '5 minutes'
     or v_timestamp > v_now + interval '5 minutes' then
    raise exception 'The mirror request timestamp is outside the five minute window'
      using errcode = '28000';
  end if;

  -- A short retention buffer helps keep this private table compact without
  -- weakening replay protection: an expired request can no longer pass the
  -- timestamp gate above.
  delete from marathon_private.drive_mirror_nonces
  where expires_at < v_now - interval '1 day';

  insert into marathon_private.drive_mirror_nonces(
    nonce, request_timestamp, request_digest_sha256, action, expires_at
  ) values (
    p_nonce, v_timestamp, v_digest, v_action, v_timestamp + interval '5 minutes'
  ) on conflict (nonce) do nothing;

  if not found then
    raise exception 'This mirror request nonce was already used' using errcode = '23505';
  end if;

  return jsonb_build_object('accepted', true);
end;
$$;

-- Only this private read operation can expose participant data to the server
-- integration. It is ordered by the payment-evidence revision, which lets the
-- Sheet safely upsert one stable registration row when a payment is reviewed.
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
      (r.receipt_path is not null) as receipt_available
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

-- The HMAC integration may ask for a fresh signed URL, but never receives a
-- direct Storage policy or an unrestricted file listing. The Edge Function
-- deliberately strips this storage path from its HTTP response.
create or replace function marathon_private.drive_mirror_receipt(
  p_event_id text,
  p_registration_id uuid
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
  if nullif(btrim(p_event_id), '') is null or p_registration_id is null then
    raise exception 'A mirror event and registration reference are required'
      using errcode = '22023';
  end if;

  select r.receipt_path into v_receipt_path
  from public.registrations r
  where r.id = p_registration_id and r.event_id = p_event_id
    and exists (
      select 1 from marathon_private.payment_attempts a
      where a.registration_id = r.id and a.event_id = r.event_id
    );
  if not found or nullif(btrim(v_receipt_path), '') is null then
    raise exception 'The payment receipt was not found' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'storage_bucket', 'payment-receipts',
    'receipt_path', v_receipt_path
  );
end;
$$;

-- API-schema wrappers stay invisible to normal browser roles. Service-role
-- Edge Functions call these narrow operations after HMAC verification.
create or replace function public.claim_drive_mirror_nonce(
  p_nonce uuid,
  p_timestamp_epoch bigint,
  p_request_digest_sha256 text,
  p_action text
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.claim_drive_mirror_nonce(
    p_nonce, p_timestamp_epoch, p_request_digest_sha256, p_action
  );
$$;

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

create or replace function public.drive_mirror_receipt(
  p_event_id text,
  p_registration_id uuid
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select marathon_private.drive_mirror_receipt(p_event_id, p_registration_id);
$$;

revoke all on function marathon_private.claim_drive_mirror_nonce(uuid, bigint, text, text)
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.drive_mirror_batch(text, bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function marathon_private.drive_mirror_receipt(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_drive_mirror_nonce(uuid, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.drive_mirror_batch(text, bigint, integer)
  from public, anon, authenticated;
revoke all on function public.drive_mirror_receipt(text, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_drive_mirror_nonce(uuid, bigint, text, text),
  public.drive_mirror_batch(text, bigint, integer),
  public.drive_mirror_receipt(text, uuid)
  to service_role;

commit;
