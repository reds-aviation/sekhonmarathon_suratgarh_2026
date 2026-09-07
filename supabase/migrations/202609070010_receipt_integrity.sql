-- Persist a cryptographic receipt digest for every registration submitted after
-- this migration. Existing evidence predates server-side hashing and remains
-- explicitly unavailable in the private ledger; this migration never invents
-- a hash by reading, changing, or re-uploading historic receipt files.
begin;

alter table public.registrations
  add column if not exists receipt_digest_sha256 text;

alter table public.registrations
  add constraint registrations_receipt_digest_sha256_format check (
    receipt_digest_sha256 is null
    or receipt_digest_sha256 ~ '^[0-9a-f]{64}$'
  );

-- Registration evidence is still accepted only through the privileged server
-- submission path. The receipt digest is supplied by that server after hashing
-- the exact bytes it stores; browser roles have no INSERT grant on this table.
-- The general immutable-field comparison below also prevents a later update
-- from substituting a different digest.
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

-- Replace the transition trigger from 009. A hash-bearing registration now
-- creates an immutable SHA-256 evidence record. The payment-attempt trigger
-- from 008 remains the single authority for canonical UTR normalization and
-- global source revisions, so neither value is caller-supplied here.
create or replace function marathon_private.sync_payment_attempt_from_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_id uuid;
  v_digest_state text;
  v_digest_sha256 text;
begin
  if tg_op = 'INSERT' then
    if new.receipt_digest_sha256 is null then
      -- This fallback protects an upgrade edge case only. Normal post-010
      -- inserts are rejected above unless the Edge Function supplied a hash.
      v_digest_state := 'legacy_unavailable';
      v_digest_sha256 := null;
    else
      v_digest_state := 'sha256';
      v_digest_sha256 := new.receipt_digest_sha256;
    end if;

    insert into marathon_private.payment_attempts(
      registration_id, event_id, attempt_ordinal, expected_fee_paise,
      transaction_utr, receipt_path, receipt_digest_state,
      receipt_digest_sha256, status, reviewed_at, reviewed_by, review_note,
      submitted_at
    ) values (
      new.id, new.event_id, 1, new.fee_paise,
      new.transaction_id, new.receipt_path, v_digest_state,
      v_digest_sha256, new.payment_status, new.reviewed_at, new.reviewed_by, new.review_note,
      new.created_at
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

commit;
