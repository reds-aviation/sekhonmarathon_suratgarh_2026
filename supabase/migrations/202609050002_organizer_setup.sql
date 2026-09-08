-- OPTIONAL owner-only helper. Run after 001_marathon_schema.sql as postgres.
-- Never expose marathon_private in Data API settings.
begin;

create or replace function marathon_private.issue_station_invitation(
  p_label text,
  p_expires_at timestamptz default null,
  p_event_id text default 'suratgarh-2026',
  p_revoke_previous boolean default true
) returns table(invitation_id uuid, invitation_code text, expires_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare
  v_deadline timestamptz;
  v_expiry timestamptz;
  v_now timestamptz := clock_timestamp();
  v_code text := replace(gen_random_uuid()::text, '-', '');
begin
  select e.registration_deadline into v_deadline from public.event_config e
  where e.id = p_event_id for update;
  if not found or v_deadline <= v_now then
    raise exception 'Event must exist and still accept memberships';
  end if;
  if p_label is null or char_length(btrim(p_label)) not between 1 and 100 then
    raise exception 'An organizer label is required';
  end if;
  v_expiry := coalesce(p_expires_at, v_deadline);
  if v_expiry <= v_now or v_expiry > v_deadline then
    raise exception 'Code expiry must be in the future, no later than the registration deadline';
  end if;
  if p_revoke_previous then
    update marathon_private.invitations i set revoked_at = v_now
    where i.event_id = p_event_id and i.revoked_at is null;
  end if;
  return query
    insert into marathon_private.invitations(event_id, label, code_sha256, expires_at)
    values (p_event_id, btrim(p_label), encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_expiry)
    returning id, v_code, marathon_private.invitations.expires_at;
end;
$$;
revoke all on function marathon_private.issue_station_invitation(text,timestamptz,text,boolean)
  from public, anon, authenticated, service_role;

commit;

-- Run these individually and replace placeholders. Do not commit the generated
-- code, organizer UUID, final payment data, or real contacts to this design file.

-- Generate a code only once ready to distribute it through station channels.
-- The result contains the plaintext code ONCE; only its SHA-256 is persisted.
-- select * from marathon_private.issue_station_invitation('Station distribution');

-- After migration 007, grant an AAL2 verified organizer only the required
-- capability. Start with event_admin for the initial platform owner; add
-- narrower desk capabilities separately as needed.
-- insert into marathon_private.organizer_capabilities(event_id, user_id, capability)
-- values ('suratgarh-2026', '<VERIFIED-ORGANIZER-AUTH-UUID>'::uuid, 'event_admin')
-- on conflict (event_id, user_id, capability) do update set revoked_at = null;

-- Configure actual payment details and station contacts before opening.
-- update public.event_config set
--   payment_qr_url = 'https://<ACTUAL-PUBLISHED-PAYMENT-QR-URL>',
--   payee_name = '<ACTUAL-PAYEE>',
--   upi_id = '<ACTUAL-UPI-ID>',
--   contact_phone = '<ACTUAL-STATION-CONTACT>',
--   contact_email = '<ACTUAL-STATION-EMAIL>',
--   payment_configured = true,
--   registration_open = true,
--   updated_at = now()
-- where id = 'suratgarh-2026';

-- Close new registrations and uploads without removing existing records.
-- update public.event_config set registration_open = false, updated_at = now()
-- where id = 'suratgarh-2026';

-- Revoke a membership. A revoked user cannot redeem again to self-restore.
-- update marathon_private.memberships set revoked_at = now()
-- where event_id = 'suratgarh-2026' and user_id = '<AUTH-UUID>'::uuid;

-- Rotating an invitation revokes old codes, NOT memberships already granted.
