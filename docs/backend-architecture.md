# Archived: proposed Suratgarh marathon backend

> **Archived design — superseded 8 September 2026.** This Supabase/Netlify registration and payment-upload proposal was never deployed and is not part of the current product. Official registration and payment confirmation now remain on the organisation's existing AFNET system; the public GitHub Pages website collects no participant data. Do not follow the activation steps below for the current event.

The content below is retained only as an engineering record of the earlier proposal. Its seeded fees, deployment sequence and operational assumptions are historical. Current public fees are ₹200 for 5 KM and ₹250 for both 10 KM and 21 KM. The active architecture is documented in the [repository README](../README.md).

## Files and validation

- `001_marathon_schema.sql`: public event/race configuration, private membership/code/counter tables, private registration rows, RLS, redemption RPC, registration validation trigger and private receipt bucket.
- `002_organizer_setup.sql`: owner-only random-code issuer plus commented organizer/payment configuration examples. It does not issue a code or open registrations merely by being run.
- `validate-schema.mjs`: actual PostgreSQL execution through PGlite with mock Supabase Auth and Storage schemas.
- `validation-report.json`: 23 passing focused checks; includes the test limitations.

The two foundation files are useful for design review. Production activation applies the complete ordered migration chain `001`–`015` as the project owner, first in staging. The foundation scripts preserve event/race seed data and replace their own functions, triggers and policies; they are not an upgrade migration for an arbitrary existing schema with different columns or constraints. Never expose `marathon_private` in Data API settings. Do not publish the test fixtures or install its PGlite dependency in the frontend.

## Frontend and Edge Function contract

Public read-only tables:

- `event_config`: singleton row `id = 'suratgarh-2026'`; `registration_open = false`, `payment_configured = false`; `event_starts_at = 2026-10-04T05:00:00+05:30`; `registration_deadline = 2026-09-27T23:59:59+05:30`; nullable `payment_qr_url`, `payee_name`, `upi_id`, `contact_phone`, `contact_email`.
- `race_config`: `event_id`, `race`, `fee_paise`; race keys `5`, `10`, `21`. Migration `006` sets the confirmed fees to 39900, 49900 and 49900 paise. Both tables grant anonymous/authenticated SELECT only.

Authenticated RPCs:

```js
const { data, error } = await supabase.rpc('redeem_invitation', {
  p_code: stationInvitationCode,
  p_event_id: 'suratgarh-2026',
});
// Expected business failures use HTTP 200 with data.ok === false.
// Check both `error` and `data.ok`; do not infer success from HTTP status.

const { data: membership } = await supabase.rpc('get_my_membership', {
  p_event_id: 'suratgarh-2026',
});
// `is_organizer` is an AAL2 event-admin compatibility summary only.
// It does not grant any payment, collection, completion or route operation.
```

Redemption success codes: `membership_granted`, `already_member`. Failure codes: `authentication_required`, `verified_email_required`, `event_unavailable`, `contact_organizer`, `invalid_invitation`, `rate_limited`. The last includes `retry_after_seconds`. Five wrong codes within 15 minutes cause a 15-minute cooldown. The account row lock serializes concurrent calls; expected failure paths return JSON so their counter updates commit. An unknown event never compares a secret code. Already granted members can see their own membership regardless of the current code. Revoked members cannot self-restore.

`submit-registration` is an **authenticated Edge Function**, receiving multipart `payload` JSON and `receipt` bytes. JSON contains `submission_id` plus `full_name`, `mobile`, `dob`, `gender`, `race`, `tshirt`, `blood_group`, `emergency_contact`, `city`, `participant_type`, `transaction_id`, `consent`. The Edge Function controls `event_id`, `user_id`, `email`, `fee_paise`, `receipt_path`, status and review fields. Do not copy arbitrary JSON keys into a database write.

Canonical input values:

- Phones: Indian mobile numbers matching `[6-9][0-9]{9}`.
- Gender: `male`, `female`, `other`, `prefer_not_to_say`.
- T-shirt: `XS`, `S`, `M`, `L`, `XL`, `XXL`, `XXXL`.
- Blood group: `A+`, `A-`, `B+`, `B-`, `AB+`, `AB-`, `O+`, `O-`, `Unknown` (ASCII hyphens).
- Participant type: `airwarrior`, `family`.
- Transaction ID: `[A-Za-z0-9-]{6,64}`, lowercased and trimmed by the DB; globally unique within this event, across participants.
- Consent: literal boolean `true`; DOB not in the future.

The backend must:

1. Verify the user JWT against Supabase Auth; never trust a JSON `user_id`. Confirm email verification and non-anonymous account. Call the membership RPC using the caller's JWT, not a service-role client (the latter has no end-user identity).
2. Check for an existing `(user_id, submission_id)` **before uploading**. Return the existing receipt/registration reference for an identical retry; reject a reused ID with different participant data. Preserve already stored results if a retry arrives after closing time. Do not overwrite files.
3. Validate JSON types/lengths/enums, current membership, event open/payment configured flags and deadline. Fetch fee from trusted race configuration. Reject arbitrary event IDs.
4. Validate JPEG/PNG signatures and decode/validate the image where feasible, with a strict request/file size cap of 5 MiB. MIME headers and filename suffixes alone are not enough.
5. Upload to private bucket `payment-receipts` with service-role credentials and `upsert: false`, using the server-generated path `<verified-user-UUID>/<submission_id>/receipt.jpg` or `receipt.png`. No browser storage INSERT/UPDATE/DELETE policy exists.
6. Insert the registration through the service-role client. The trigger rechecks membership, event and stored receipt, uses canonical Auth email, recalculates fee and forces `pending_review`.
7. On a failed insert, remove only the object **created by this request** through the Storage API. Do not remove an existing successful registration's receipt during a concurrent retry. Handle uniqueness failures by re-reading the existing same-user submission; a duplicate transaction ID is a separate validation error. Avoid exposing another participant's details in error messages.

Storage and database insertion are separate transactions. Before launch, test simultaneous retries. An orphan sweep may be needed after a function crash; it must avoid in-progress/referenced objects and use the Storage API, not direct object-row deletion. User IDs plus submission UUIDs make paths unambiguous but do not themselves authorize access.

`registrations` is in `public` for service-role REST access, with RLS-private rows. Owners can SELECT their own rows. An AAL2 `event_admin` has a compatibility summary path, while payment, collection, completion and route work use their separate capability-checked operations; desk users do not receive broad direct registration access. Browser clients cannot write registrations. The DB permits only `pending_review -> verified/rejected`. Successful submission means pending review, not confirmed payment.

## Member route timeline

Migration `015` keeps operational route data in a private table. A verified active member can read only a published timeline through the narrow member RPC. An AAL2 `route_publisher` or `event_admin` can save, publish, revise or withdraw it through revision-checked, retry-safe and audited operations. GitHub Pages has no route endpoint or route content.

## Organizer setup

1. Allow new email Auth sign-ups; require email confirmation; disable anonymous sign-ins. Use a custom SMTP provider. For numerical email OTP instead of a magic link, configure the mail template to send `{{ .Token }}`. Confirm exact production redirect/site URLs.
2. Apply the full ordered migration chain `001`–`015`, first in staging. Keep the private schema unexposed and the `payment-receipts` bucket private. On a new project there should be no broad existing Storage policies granting user writes or unrelated reads; permissive RLS policies combine with OR.
3. Deploy the Edge Function with backend-only secret credentials and caller authentication. The frontend receives only Supabase URL and publishable key. No station code, code hash, service key or SMTP secret belongs in a frontend environment variable or Git repository.
4. Have organisers sign in, verify their email and enrol MFA, then grant their verified Auth UUIDs explicit capabilities in `marathon_private.organizer_capabilities`. The first platform owner may receive `event_admin`; desk staff receive only the required capability. No role is taken from client-editable user metadata.
5. Run `select * from marathon_private.issue_station_invitation('Station distribution');` in SQL Editor when ready. It generates a UUID-derived random 122-bit code and stores SHA-256 only; copy the one-time plaintext result into the approved station distribution channel. Do not commit the returned code or log redemption payloads. Rotation revokes previous codes, **not memberships already granted**.
6. Add the real QR URL, verified payee name/UPI ID and station contacts, then set `payment_configured` and `registration_open` true. An expired deadline still blocks registration even if the open flag remains true.

Possession of a shared station code authorizes access; it does not independently prove airwarrior/family status. A per-Auth-UUID counter limits guessing on one account but does not prevent someone obtaining a forwarded valid code or creating many confirmed accounts. Configure Supabase's Auth rate limits/CAPTCHA appropriate to expected registration traffic. No membership list is shipped publicly.

## Primary documentation used

- [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration): public sign-up, confirmation and anonymous settings.
- [Passwordless email sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless): OTP/magic links and automatic user creation.
- [Custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp): built-in mail service restrictions and production SMTP setup.
- [API security](https://supabase.com/docs/guides/api/securing-your-api): explicit grants, RLS and exposed schemas.
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): private definer helpers, caller UUID and fixed search paths.
- [Securing Edge Functions](https://supabase.com/docs/guides/functions/auth): authenticated caller JWTs and backend privileges.
- [Storage ownership](https://supabase.com/docs/guides/storage/security/ownership): service-role uploads have no end-user owner ID; this design binds access to server-controlled UUID paths.
- [Storage policies](https://supabase.com/docs/guides/storage/security/access-control): separate read/upload/overwrite permissions.
- [Bucket creation and restrictions](https://supabase.com/docs/guides/storage/buckets/creating-buckets): private bucket, MIME allowlist and file size limit.
- [Storage schema](https://supabase.com/docs/guides/storage/schema/design): inspect metadata using SQL; manipulate objects only through the Storage API.
- [PostgreSQL exception behavior](https://www.postgresql.org/docs/18/plpgsql-control-structures.html#PLPGSQL-ERROR-TRAPPING): raised errors roll back persistent changes, hence normal JSON failures for invitation attempts.
- [PostgreSQL INSERT concurrency](https://www.postgresql.org/docs/18/sql-insert.html): `ON CONFLICT` atomic behavior; the attempt row then uses `FOR UPDATE`.
- [PGlite documentation](https://pglite.dev/docs/): local PostgreSQL test runtime; single connection cannot validate real parallel lock contention.

## Remaining integration verification

The 23 local checks execute PostgreSQL statements and RLS with Supabase service schemas stubbed. Before opening, validate live Auth email delivery, JWT rejection, browser-to-Edge CORS, the exact Storage upload metadata, server-side JPEG/PNG checks and size limits, account A/account B/organizer receipt access, expiry, concurrent retries and cleanup behavior. No live database, backend deployment or real registration was used in these tests.
