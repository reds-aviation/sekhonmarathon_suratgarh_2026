# Archived: event-day platform authority and operations

> **Archived design — superseded 8 September 2026.** The authenticated Netlify/Supabase event-day platform described below was never deployed and is no longer the event workflow. The public GitHub Pages site provides information and AFNET registration guidance only. Official records stay in the existing internal system and its Excel export. Do not use the activation checklist below for the current event.

The remainder is retained as an engineering record. Its fees and operating assumptions are historical. Current public fees are ₹200 for 5 KM and ₹250 for both 10 KM and 21 KM. Payment is currently through the SI POS machine at Sports Section. All registered participants will receive an event T-shirt and medal. A future private certificate workflow will be planned separately and is not included in the current public release.

## Authority model

| Person | Allowed work |
| --- | --- |
| Participant | Verified-email sign-in, station invitation code, own registration, own payment status, and later own result/certificate where configured. |
| Payment reviewer | Verified email, MFA at AAL2 and an active `payment_reviewer` capability (or `event_admin`). Can use the private payment queue, view a short-lived proof and make an auditable payment decision. |
| T-shirt desk | Verified email, MFA at AAL2 and `tshirt_desk` or `event_admin`. Can record collection only for a verified payment under the final collection rules. |
| Completion desk | Verified email, MFA at AAL2 and `completion_desk` or `event_admin`. Can use approved finish-line tools when enabled. |
| Route publisher | Verified email, MFA at AAL2 and `route_publisher` or `event_admin`. Can publish only the approved route timeline. |
| Event administrator | Verified email, MFA at AAL2 and an active `event_admin` capability. This is a broad role and should be granted sparingly. |

Capabilities are stored privately. They are not a client-side switch, cannot be self-assigned and can be revoked. Privileged actions write a server-timestamped audit record containing the actor, request ID, target and revision.

## Payment evidence and review

1. The participant signs in with a verified email and uses the station invitation code.
2. The secure app validates the selected race and trusted fee, then stores the registration and screenshot in private Supabase storage. The starting state is `pending_review`.
3. The private payment-attempt ledger records the expected fee, normalised UTR, receipt path, integrity state, source revision and review status. Submitted evidence cannot be edited.
4. An eligible reviewer opens the queue. A proof request is authorised and audited before a server creates a short-lived link to the private screenshot.
5. The reviewer matches the evidence with the bank/UPI record and selects `verified` or `rejected`. A rejected payment needs a clear correction reason. The request includes the payment-attempt revision, so a stale screen cannot overwrite another review.
6. Only the verified, invited owner of a rejected entry may submit a correction. It provides a fresh UTR and a new private screenshot, creates a new `pending_review` attempt, and preserves the rejected proof, decision and audit history. UTRs remain unique across all attempts.
7. A retry with the same request ID returns the recorded result; a reused request ID with different content fails. The participant sees only their own resulting status.

Migrations `006`–`010` establish the payment attempts and reviews; migration `013` adds the forward-only correction path. The submission, correction and proof-signer functions must be deployed and rehearsed before production. The sample QR in the preview is not a valid payment endpoint.

## T-shirt collection

The collection desk will operate on **Saturday, 3 October 2026, 09:00–13:30, in front of SBI Bank inside the station**. Migration `012` provides an audited physical-issue ledger. The desk can search only the authenticated verified-payment queue, confirm the participant and record the issued size. It checks both the registration payment summary and a verified payment attempt before it can record collection. An altered size requires a reason; an already issued T-shirt cannot be issued again. A recovery void requires an AAL2 `event_admin`, the current issue revision and a reason, leaving the original issue auditable. Do not rely on a shared spreadsheet edit as the authoritative collection record.

## Race day and results

The platform supports organiser-managed clocks and finish records; it does not claim chip timing. The final operating plan must retain a visible master clock, an independent stopwatch and a paper/manual finish-order backup for leading runners and disputes.

Migration `014` keeps the completion desk disabled by default. Before race day, an administrator must deliberately enable both timing and the completion desk in `event_day_settings`. The capability-gated completion queue and record operation require an AAL2 `completion_desk` user, a verified payment, an approved elapsed-time range, an idempotency request ID and the current result revision. An AAL2 `event_admin` separately reviews, corrects or locks a result with a recorded reason. The former broad browser-facing race-day dispatcher allows only a participant snapshot or self-time; it cannot perform organiser mutations. Participant-reported times, if enabled, remain distinct from organiser-recorded and organiser-reviewed results. Only the approved results workflow can establish prize eligibility. A result change invalidates any previously generated certificate until it is reviewed again.

Certificate generation remains disabled until an approved signer, private signature asset, fonts, verification base URL and certificate settings have been set. The certificate function also requires the exact configured `SITE_ORIGIN` and checks the caller’s verified session before the backend authorises the request. A visual signature on a PDF is not a cryptographic digital signature.

## Route timeline

Do not publish assumed routes, maps or reporting times. Once the route is approved, enter a concise timeline with start/reporting point, control points, hydration/medical points, distance markers, turnaround or finish, and safety instructions in the private route workspace. Migration `015` serves it only to verified, invited members after an AAL2 `route_publisher` or `event_admin` publishes it. The public guide contains neither the route content nor a route-data endpoint. The publisher can revise or withdraw it using the current revision; every change is audited.

## Google Drive and Sheets

Google Drive/Sheets is a private, one-way reporting mirror. It can assist with totals, T-shirt planning, collection lists and post-event analysis. It cannot approve or reject payments, grant roles, change a race-day result or update Supabase in any direction.

Migration `011` provides the mirror. The standalone Apps Script makes HMAC-SHA256 requests with a five-minute timestamp window and a UUID nonce that the database records once. It reads only revision-ordered payment-attempt data, upserts by Registration ID, preserves the Sheet’s local distribution columns and cannot send a review or other state change back. A receipt copy uses a 60-second signed URL and is authorised by its payment-attempt ID, so a corrected proof does not overwrite the prior private proof. Keep the Sheet and receipt folder private to authorised organisers, use a fresh `DRIVE_MIRROR_HMAC_SECRET` of at least 32 characters in both Supabase and Script Properties, and test recovery with synthetic records. The secure Supabase database remains the source of truth.

## Production activation checklist

1. Apply migrations `001` through `015` in a staging Supabase project, in order. Execute access-control, correction, T-shirt, completion and member-route tests with separate participant and organiser accounts.
2. Configure the final HTTPS Netlify app URL in Supabase Auth and Netlify. Confirm that the Pages guide links to this app URL without embedding auth configuration.
3. Set `SITE_ORIGIN` in the Supabase Edge Function secret store to that exact HTTPS Netlify origin — for example, `https://marathon.example.net` — with no path, query, fragment, credentials or wildcard. It must not be the Pages or localhost origin. Configure `DRIVE_MIRROR_HMAC_SECRET` separately in Supabase and the private Apps Script.
4. Deploy `submit-registration`, `correct-payment`, `organiser-payment-proof`, `drive-register` and `certificate` after migrations and origin configuration. Test all CORS and authentication denials before allowing a browser request.
5. Enrol each organiser in MFA, verify their email and grant only the required capability. Test a revoked role and an AAL1 session are denied.
6. Supply the real payee name, UPI ID and QR image. Verify it out of band, then enable payment and registration together under the approved owner procedure.
7. Rehearse the route workspace with synthetic content: draft, publish, revise and withdraw. Confirm an invited participant can view the release while a non-member cannot.
8. Rehearse phone and laptop flows: sign-in, invitation, registration, screenshot upload, rejected-payment correction, private proof access, review, T-shirt collection/void recovery and audit inspection.
9. Rehearse clocks, finish capture, result correction, certificate verification and the paper/manual backup with synthetic staging data. Do not use production clocks for rehearsal; leave completion disabled until the rehearsal is signed off.
10. Create a private Sheet and private receipt folder in the organiser Drive. Set `SPREADSHEET_ID`, `RECEIPTS_FOLDER_ID`, `SUPABASE_DRIVE_ENDPOINT` and the matching `DRIVE_MIRROR_HMAC_SECRET` as Apps Script properties, then enable the scheduled one-way import only after its export, access controls and recovery behaviour are verified.

The tests in this repository exercise database rules with synthetic records. They do not replace a live Supabase/Auth/Storage/Netlify/UPI/Google Drive rehearsal or physical device testing.
