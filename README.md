# Sekhon Indian Air Force Marathon 2026 · Desert Braves

**Air Force Station Suratgarh — The Land of Sun and Sand.**

Public event guide: <https://reds-aviation.github.io/sekhonmarathon_suratgarh_2026/>
Repository: <https://github.com/reds-aviation/sekhonmarathon_suratgarh_2026>

This project has two deliberately separate website targets:

- **GitHub Pages** is the public guide. It carries the event story, race information, gallery, contact information and a link to the secure app. It contains no participant records, Supabase credentials or registration interface.
- **Netlify** will host the authenticated event app. It is the only place for sign-in, station-code registration, payment screenshot upload, a participant’s own race desk and organiser operations.

The public guide is currently live. The secure app is not yet activated because the final Netlify URL, Supabase project, real UPI details and organiser accounts have not been supplied. The payment QR shown in the preview is intentionally marked **YET TO UPDATE** and cannot receive a payment.

## Event facts

| Item | Confirmed detail |
| --- | --- |
| Race day | Sunday, 4 October 2026 |
| Registration deadline | Sunday, 27 September 2026, 23:59 IST |
| Audience | Airwarriors and their families, using a verified email sign-in and station invitation code |
| 5 KM fee | ₹399 |
| 10 KM fee | ₹499 |
| 21 KM fee | ₹499 |
| T-shirt collection | Saturday, 3 October 2026, 09:00–13:30, in front of SBI Bank inside the station |
| Contact | 8838463776 · 7027964880 |
| Route | To be published after station approval |

Race timing, route geometry, registration opening and payment acceptance all remain closed until their operational inputs are approved. A participant can never use the preview QR as proof of payment.

## How private data is protected

The authenticated app uses Supabase Auth, a private PostgreSQL data store and private Supabase Storage.

- A participant can view only their own registration and payment status.
- Payment screenshots stay in the private `payment-receipts` bucket. They have no public URL.
- A reviewer must use a verified email and multi-factor authentication at **AAL2**. Their access is granted explicitly for an event capability such as `payment_reviewer`, `tshirt_desk`, `completion_desk`, `route_publisher` or `event_admin`.
- Capability grants, payment-review decisions and private-proof access are audited with an actor, request ID, server time and revision.
- Payment evidence is kept as an immutable attempt ledger. Every review is revision-checked and idempotent, so a retry cannot create a second decision.
- A receipt viewer must obtain a short-lived server-signed link after database authorisation. Storage paths and service-role keys never enter the browser bundle.
- A rejected payment is corrected only by its verified, invited owner. The original proof and review remain on record; a fresh UTR and private screenshot create a new `pending_review` attempt. A correction cannot overwrite an earlier proof or reuse a UTR.
- Physical T-shirt handover is recorded in a separate, audited issue ledger. The desk can issue only to a registration whose payment summary **and** a verified payment attempt agree. An administrator can void an issue only with its current revision and a recorded reason.

The confirmed payment workflow is: select a race → sign in and use the station invitation code → enter the real UPI reference and upload a screenshot → receive `pending_review` status → an authorised organiser checks it against the bank/UPI record → receive `verified` or `rejected` status. If rejected, the participant supplies a new reference and replacement screenshot from their own entry; the system creates a new immutable attempt for review while retaining the rejected attempt. A screenshot is evidence only; it does not approve a payment automatically.

## Google Drive and Google Sheets

The organiser’s Google Sheet is a **one-way operational mirror** of the secure app. It is useful for private totals, payment follow-up, T-shirt-size planning and distribution reporting, but it is never the payment decision system.

- The app database remains the source of truth for registrations, evidence and payment status.
- A server-authorised sync exports changed payment-attempt revisions and upserts the private organiser Sheet by Registration ID. The current receipt copy is authorised by its payment-attempt ID, so a correction never mutates an earlier private proof.
- Changes made in Sheets must not approve, reject or otherwise change a participant’s record in Supabase.
- Keep the Sheet and receipt folder private to authorised organisers. Do not enable link sharing or place participant data in the public GitHub repository.

The deployed mirror accepts only HMAC-signed, timestamped, single-use requests from the private Apps Script. It rejects browser origins and replayed requests. Screenshots are copied through a 60-second server-signed URL into the private Drive folder; their Storage paths never reach the Sheet or a browser. A correction uses a different payment-attempt ID, so its receipt copy stays separate from the prior proof. Configure the Supabase `DRIVE_MIRROR_HMAC_SECRET` and the matching Apps Script property separately, with at least 32 characters.

## Local development

Use Node 24 and pnpm 11.

```text
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm run build:pages
pnpm run build:app
```

`pnpm dev` starts the authenticated-app target. `pnpm run dev:pages` starts the public-guide target. `pnpm run verify:targets` builds both targets and confirms that the Pages output does not contain private registration or Supabase code.

Copy `.env.example` to `.env.local` for local work. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are browser-safe only for the Netlify app target. Never put a service-role key, SMTP credential, Drive secret or deployment token in a `VITE_` variable or source file. `SITE_ORIGIN` belongs in the Supabase Edge Function secret store, not the browser build; it must be the one final HTTPS Netlify origin with no path, query or fragment.

## Activation sequence

1. Create a new Supabase project and apply migrations `001` through `014` in order to a staging project first, then production. Migrations `012`, `013` and `014` add the T-shirt issue ledger, immutable rejected-payment correction, and capability-gated race-day completion workflow. They keep collection and completion closed unless explicitly enabled.
2. Create the final Netlify site, then configure verified email sign-in, disable anonymous sign-in and configure production mail delivery. Set the Supabase Site URL and allowed redirect URLs to the final HTTPS **Netlify app** address, not the GitHub Pages guide.
3. Set `VITE_APP_URL`, `VITE_AUTH_REDIRECT_URL`, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the protected Netlify/GitHub production environment. The Pages build must receive the final Netlify URL only for its secure-app handoff.
4. Before deploying browser-facing functions, set Supabase Edge Function `SITE_ORIGIN` to exactly that single HTTPS Netlify origin, for example `https://marathon.example.net`. It must have no path, query, fragment, credentials or wildcard. Do not use the Pages URL or a localhost URL. Set `DRIVE_MIRROR_HMAC_SECRET` separately in Supabase and the private Apps Script.
5. Deploy the function set after migrations: `submit-registration`, `correct-payment`, `organiser-payment-proof`, `drive-register` and `certificate`. Rehearse the functions with staging identities before configuring the private Drive mirror. The function runtime service-role key stays only in Supabase; it is never a browser or Netlify `VITE_` value.
6. Create the station invitation-code process and grant organiser capabilities only to confirmed organiser accounts. Enrol organisers in MFA before enabling any organiser capability. There is no self-enrolment path for organisers.
7. Create the private Sheet and receipt folder, set the Apps Script properties, and test a one-way synthetic sync. Test participant isolation, short-lived proof access, duplicate UTR rejection, rejected-payment correction, review audit records, T-shirt issue/void audit records and Sheets updates.
8. Supply the final payee name, UPI ID and QR image. Update `event_config` only after the QR has been independently checked. Then set `payment_configured=true` and `registration_open=true` together through the approved owner procedure.
9. Rehearse a full phone and laptop flow with non-production accounts: email sign-in, invitation code, registration, screenshot upload, correction after rejection, organiser review, T-shirt collection and void recovery, completion-desk enablement, results review and certificate access. Only then invite participants.

## Race-day and collection operation

The app is designed for organiser-managed clocks and finish records; it does not claim chip timing. The final route should be published as an approved visual timeline only after route details, control points and reporting guidance are confirmed. Race-day completion is disabled by default. It requires both approved timing and completion-desk settings, an AAL2 `completion_desk` capability, a verified payment, an idempotent request and the current result revision. An AAL2 `event_admin` separately reviews or locks a recorded result before certificate release.

For collection, organisers will work from the private, verified-payment list and record the requested/issued T-shirt size at the designated desk on 3 October. This must remain an authenticated organiser action, with an audit trail and a clear exception note for any size change.

See [event-day operations](docs/event-day-platform.md) for authority boundaries and activation checks, and [the station platform plan](docs/2026-09-station-platform-plan.md) for the delivery sequence.

## Validation limits

The repository’s automated checks cover target separation, registration data rules, access controls and payment-review behaviour using synthetic records. They do not prove a live Supabase, Netlify, email, UPI, Google Drive, Android, iPhone or physical finish-line workflow. Those systems require staging rehearsal and final operator approval before launch.
