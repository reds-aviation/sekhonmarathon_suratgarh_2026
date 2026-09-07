-- Private payment-evidence ledger. Apply after 202609070006_confirmed_race_fees.sql
-- and 202609070007_organiser_roles.sql. It deliberately leaves the legacy
-- public.registrations payment fields and all legacy callers intact.
begin;

create sequence if not exists marathon_private.payment_attempt_source_revision_seq
  as bigint;

-- The composite candidate key prevents an attempt from being attached to a
-- registration belonging to a different event.
create unique index if not exists registrations_id_event_unique_idx
  on public.registrations(id, event_id);

create table if not exists marathon_private.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null,
  event_id text not null,
  attempt_ordinal integer not null check (attempt_ordinal >= 1),
  expected_fee_paise integer not null check (expected_fee_paise > 0),
  transaction_utr text not null check (char_length(btrim(transaction_utr)) between 6 and 96),
  normalized_utr text not null check (normalized_utr ~ '^[A-Z0-9]{6,64}$'),
  receipt_path text not null check (char_length(btrim(receipt_path)) between 1 and 1024),
  receipt_digest_state text not null default 'sha256'
    check (receipt_digest_state in ('sha256', 'legacy_unavailable')),
  receipt_digest_sha256 text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'verified', 'rejected', 'superseded')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  revision integer not null default 1 check (revision >= 1),
  source_revision bigint not null unique check (source_revision >= 1),
  submitted_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_attempts_receipt_digest_state check (
    (receipt_digest_state = 'sha256' and receipt_digest_sha256 ~ '^[0-9a-f]{64}$')
    or (receipt_digest_state = 'legacy_unavailable' and receipt_digest_sha256 is null)
  ),
  constraint payment_attempts_review_state check (
    (status = 'pending_review' and reviewed_at is null and reviewed_by is null and review_note is null)
    or (status in ('verified', 'rejected', 'superseded') and reviewed_at is not null and reviewed_by is not null)
  ),
  constraint payment_attempts_registration_event_fkey
    foreign key (registration_id, event_id)
    references public.registrations(id, event_id),
  unique (registration_id, attempt_ordinal)
);

create unique index if not exists payment_attempts_event_normalized_utr_unique_idx
  on marathon_private.payment_attempts(event_id, normalized_utr);

-- A registration has one current payment decision at most. Rejected and
-- superseded evidence stays in the ledger and cannot become active again.
create unique index if not exists payment_attempts_one_active_per_registration_idx
  on marathon_private.payment_attempts(registration_id)
  where status in ('pending_review', 'verified');

create index if not exists payment_attempts_event_review_idx
  on marathon_private.payment_attempts(event_id, status, source_revision);

-- Evidence values are immutable once stored. The only supported later change
-- is an auditable terminal status transition, which obtains fresh server
-- timestamps and a globally ordered mirror revision.
create or replace function marathon_private.validate_payment_attempt_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_normalized_utr text;
  v_registration_fee integer;
begin
  if nullif(btrim(new.transaction_utr), '') is null then
    raise exception 'A payment reference is required' using errcode = '22023';
  end if;

  v_normalized_utr := upper(regexp_replace(btrim(new.transaction_utr), '[^A-Za-z0-9]', '', 'g'));
  if v_normalized_utr !~ '^[A-Z0-9]{6,64}$' then
    raise exception 'Payment reference must normalize to 6–64 letters or digits'
      using errcode = '22023';
  end if;

  if tg_op = 'INSERT' then
    select r.fee_paise into v_registration_fee
    from public.registrations r
    where r.id = new.registration_id
      and r.event_id = new.event_id;

    if not found then
      raise exception 'Payment attempt must reference its registration event'
        using errcode = '23503';
    end if;
    if new.expected_fee_paise <> v_registration_fee then
      raise exception 'Expected payment fee must match the registration fee snapshot'
        using errcode = '23514';
    end if;

    new.normalized_utr := v_normalized_utr;
    new.revision := 1;
    new.source_revision := nextval('marathon_private.payment_attempt_source_revision_seq'::regclass);
    new.created_at := v_now;
    new.updated_at := v_now;
    if new.submitted_at is null then
      new.submitted_at := v_now;
    end if;

    if new.status = 'pending_review' then
      if new.reviewed_at is not null or new.reviewed_by is not null or new.review_note is not null then
        raise exception 'Pending payment attempts cannot carry a review'
          using errcode = '23514';
      end if;
    elsif new.reviewed_at is null or new.reviewed_by is null then
      raise exception 'Terminal payment attempts require reviewer metadata'
        using errcode = '23514';
    end if;
  else
    if new.id is distinct from old.id
      or new.registration_id is distinct from old.registration_id
      or new.event_id is distinct from old.event_id
      or new.attempt_ordinal is distinct from old.attempt_ordinal
      or new.expected_fee_paise is distinct from old.expected_fee_paise
      or new.transaction_utr is distinct from old.transaction_utr
      or new.normalized_utr is distinct from old.normalized_utr
      or new.receipt_path is distinct from old.receipt_path
      or new.receipt_digest_state is distinct from old.receipt_digest_state
      or new.receipt_digest_sha256 is distinct from old.receipt_digest_sha256
      or new.submitted_at is distinct from old.submitted_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Payment evidence is immutable once submitted' using errcode = '55000';
    end if;

    if new.status = old.status then
      raise exception 'Payment attempt changes require a status transition'
        using errcode = '55000';
    end if;
    if not (
      (old.status = 'pending_review' and new.status in ('verified', 'rejected', 'superseded'))
      or (old.status = 'verified' and new.status = 'superseded')
    ) then
      raise exception 'Invalid payment attempt status transition' using errcode = '23514';
    end if;
    if new.reviewed_by is null then
      raise exception 'Terminal payment attempts require a reviewer' using errcode = '23514';
    end if;

    new.normalized_utr := old.normalized_utr;
    new.reviewed_at := v_now;
    new.revision := old.revision + 1;
    new.source_revision := nextval('marathon_private.payment_attempt_source_revision_seq'::regclass);
    new.submitted_at := old.submitted_at;
    new.created_at := old.created_at;
    new.updated_at := v_now;
  end if;

  return new;
end;
$$;

drop trigger if exists marathon_validate_payment_attempt_write
  on marathon_private.payment_attempts;
create trigger marathon_validate_payment_attempt_write
before insert or update on marathon_private.payment_attempts
for each row execute function marathon_private.validate_payment_attempt_write();

-- Every historic registration remains visible to the private ledger. Historic
-- receipt files predate file hashing, so their digest state is explicit rather
-- than inventing a digest that was never recorded.
insert into marathon_private.payment_attempts (
  registration_id,
  event_id,
  attempt_ordinal,
  expected_fee_paise,
  transaction_utr,
  normalized_utr,
  receipt_path,
  receipt_digest_state,
  receipt_digest_sha256,
  status,
  reviewed_at,
  reviewed_by,
  review_note,
  submitted_at
)
select
  r.id,
  r.event_id,
  1,
  r.fee_paise,
  r.transaction_id,
  upper(regexp_replace(btrim(r.transaction_id), '[^A-Za-z0-9]', '', 'g')),
  r.receipt_path,
  'legacy_unavailable',
  null,
  r.payment_status,
  r.reviewed_at,
  r.reviewed_by,
  r.review_note,
  r.created_at
from public.registrations r
order by r.created_at, r.id
on conflict (registration_id, attempt_ordinal) do nothing;

alter table marathon_private.payment_attempts enable row level security;

-- This table is deliberately private. Future Edge Functions can operate with
-- service_role only after completing their own authenticated capability checks.
revoke all on table marathon_private.payment_attempts from public, anon, authenticated;
grant select, insert, update, delete on table marathon_private.payment_attempts to service_role;
revoke all on sequence marathon_private.payment_attempt_source_revision_seq
  from public, anon, authenticated;
grant usage, select on sequence marathon_private.payment_attempt_source_revision_seq to service_role;
revoke all on function marathon_private.validate_payment_attempt_write()
  from public, anon, authenticated;
grant execute on function marathon_private.validate_payment_attempt_write() to service_role;

commit;
