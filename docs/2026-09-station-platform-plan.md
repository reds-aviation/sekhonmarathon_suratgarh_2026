# Suratgarh station identity and platform plan

## Purpose

Build a polished, mobile-first Sekhon Indian Air Force Marathon experience for **Air Force Station Suratgarh — Desert Braves, The Land of Sun and Sand**. The public story should bring forward a liveable desert station, its tree-lined regional landscape, the Indian Air Force and the legacy of Fg Offr Nirmal Jit Singh Sekhon, PVC. It must remain clear that any illustrative station artwork is not an official route map.

The event is for airwarriors and their families. Race day is Sunday, 4 October 2026. Confirmed fees are ₹399 for 5 KM and ₹499 for 10 KM and 21 KM. Route details will be supplied later.

## Product split

1. **GitHub Pages public guide**: event identity, race information, gallery, story, contact details, collection information and a link to the secure app.
2. **Netlify secure app**: verified-email sign-in, station invitation-code access, registration, payment screenshot submission, participant race desk and organiser operations.
3. **Supabase**: private database, Auth, private receipt storage, capability enforcement, audit records and the source of truth for event data.
4. **Private Google Drive/Sheet mirror**: operational reporting and analysis only. It does not make payment decisions or modify Supabase records.

This split keeps public event discovery fast and simple while keeping personal data, payment proof and organiser tools off the public site.

## Experience priorities

- Make Air Force Station Suratgarh the visible host, with Desert Braves as the supporting event identity.
- Use navy, ivory, desert gold and restrained green to reflect aviation heritage, sunlight and a maintained desert station.
- Use supplied poster art and historical/event photographs as intentional editorial moments rather than repeated decorative backgrounds. Keep important text in HTML, not embedded only in an image.
- Keep the phone home screen concise. Put the heritage story, gallery, event guide and future route timeline on focused views.
- State clearly that the audience is airwarriors and families only, the payment QR is still being updated, and routes will follow station approval.
- Use direct contact numbers for questions: 8838463776 and 7027964880.
- Display T-shirt collection information prominently: Saturday, 3 October 2026, 09:00–13:30, in front of SBI Bank inside the station.

## Secure workflow

1. Participant signs in with a verified email and enters a station invitation code.
2. Participant selects 5 KM, 10 KM or 21 KM at the confirmed fee and submits the required registration data in the Netlify app.
3. After real payment details are activated, the participant enters the UPI reference and uploads a screenshot to private storage. The payment starts as pending review.
4. An organiser with a verified email, MFA at AAL2 and the relevant capability reviews the evidence against the bank/UPI record. Each action is revision-checked and audited.
5. A rejected payment can be corrected only by the verified, invited owner. The original proof and decision remain immutable; a fresh UTR and screenshot create a separate pending-review payment attempt.
6. The participant sees only their own status. Organisers use the private desk and one-way Drive/Sheet mirror for payment follow-up, T-shirt counts and collection analysis.
7. The collection desk records distribution from the verified-payment list in a separate audit ledger. Race-day completion and certificates remain disabled until the approved operating settings, roles and rehearsal are in place.

## Delivery order

1. Maintain the public-guide and secure-app build separation, including a target test that prevents private app code from entering the Pages bundle.
2. Configure a staging Supabase project and apply migrations `001`–`014` in order. Migrations `012`, `013` and `014` add the audited T-shirt issue ledger, immutable rejected-payment correction and capability-gated race-day completion workflow. Verify participant privacy, invitation membership, payment evidence, correction history, AAL2 capability denials, audit records and the one-way Drive mirror.
3. Create the final HTTPS Netlify app origin, configure it in Supabase Auth, and set Supabase Edge Function `SITE_ORIGIN` to exactly that origin with no path, query, fragment, credentials or wildcard. The Pages guide must link to the app but is never that origin.
4. After migrations and `SITE_ORIGIN` are configured, deploy `submit-registration`, `correct-payment`, `organiser-payment-proof`, `drive-register` and `certificate`. Keep service-role credentials and `DRIVE_MIRROR_HMAC_SECRET` out of browser variables and the public repository.
5. Build the secure organiser payment queue, short-lived screenshot viewer and one-way Google mirror. The mirror must export payment attempts by revision and authorise receipt copies by payment-attempt ID. Remove the historical Sheets payment-review publisher before any live sync.
6. Use the T-shirt collection desk only for registrations whose payment summary and verified payment attempt agree. Record an issued-size change with its reason; reserve a void for an AAL2 event administrator with the issue’s current revision and a reason.
7. Keep race-day completion disabled until the timing plan is approved and rehearsed. Once enabled, require AAL2 `completion_desk` access, verified payment, an idempotent request and an expected result revision; reserve result review or locking for AAL2 `event_admin`.
8. Add the approved route timeline after route details are final. Do not guess route locations or timings.
9. Rehearse every flow on phone and laptop using synthetic accounts and receipts, including a rejected-payment correction, T-shirt collection/void recovery and the disabled-to-enabled race-day transition. Configure real payment details only after that rehearsal.
10. Activate registration only when the final Netlify URL, Supabase/Auth settings, invitation-code process, organiser MFA, payee name, UPI ID and verified QR image are ready.

## Information still required before activation

- Final Netlify HTTPS app URL.
- Supabase project credentials and Auth redirect configuration.
- Supabase Edge Function `SITE_ORIGIN`, set to the exact final Netlify origin, and the private Drive mirror secret configuration.
- Real payee name, UPI ID and QR image.
- Verified organiser email addresses and their required capabilities.
- Station invitation-code circulation and revocation procedure.
- Approved routes, reporting points, control points and safety instructions.
- Approved certificate signer and certificate assets, if certificates will be released.

Until these are supplied, the secure app remains closed and the QR stays a labelled placeholder.
