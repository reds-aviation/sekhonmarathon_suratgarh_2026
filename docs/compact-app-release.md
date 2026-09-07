# Compact mobile guide: scope and verification

6 September 2026 · Air Force Station Suratgarh · Desert Braves

## Public-guide experience

The phone experience keeps the first screen useful: host-station identity, date, race choices and clear routes to the Event guide and the secure app. Longer tribute, gallery and practical information are kept on separate views so the home screen does not become a long scroll.

The public guide uses the Suratgarh visual system: deep navy for authority, ivory reading surfaces, restrained canal-green actions and warm desert-gold accents. Public Sans is used for reading and Barlow Condensed for event display copy. The artwork is an impression of a thriving desert station and surrounding region; it is not a route map.

The compact guide includes:

1. Home, Races, Event guide and My entry shortcuts with direct links and keyboard focus handling.
2. Expandable 5 KM, 10 KM and 21 KM choices, displaying the confirmed fees: ₹399, ₹499 and ₹499.
3. The two organiser contact numbers directly in the Event guide: 8838463776 and 7027964880.
4. T-shirt collection details: Saturday, 3 October 2026, 09:00–13:30, in front of SBI Bank inside the station.
5. A 2025 memories gallery using supplied Suratgarh photographs. The warm-up video is intentionally excluded.
6. Clear language and consistent typography, including the corrected `Supreme` and `Sacrifice` copy in the Sekhon tribute.

Routes, reporting guidance and payment details stay concise until approved. The route view will become an approved timeline once the station route is finalised.

## Public and secure boundaries

GitHub Pages is only the public guide. It must not serve registration, authenticated participant records, payment uploads or organiser operations. The Pages build is compiled without the private app modules or Supabase browser configuration.

The Netlify app will contain sign-in, station-code registration, the participant’s own entry and authorised organiser tools. The preview call to action remains closed until the final Netlify/Supabase configuration and payment details are ready. Its sample QR is visibly marked **YET TO UPDATE** and cannot be used for payment.

The secure release includes three additional guards: migration `012` records a physical T-shirt issue only after verified payment; migration `013` lets an invited participant correct a rejected payment only by creating a new immutable proof and pending-review attempt; migration `014` keeps finish-line completion disabled until an AAL2 completion desk and approved timing settings are deliberately enabled. The Google Sheet remains a one-way private mirror and is never a way to change these records.

Before any secure-app deployment, apply migrations `001`–`014` in staging, create the final HTTPS Netlify origin, and set Supabase Edge Function `SITE_ORIGIN` to exactly that origin with no path, query, fragment, credentials or wildcard. Then deploy `submit-registration`, `correct-payment`, `organiser-payment-proof`, `drive-register` and `certificate`, test their origin and sign-in denials, and only then rehearse the app. The Pages guide cannot be used as `SITE_ORIGIN`.

## Responsive checks to retain

Before any release, check the built public guide and secure app at 320 × 740, 390 × 844 and 1366 × 768 or wider:

| Check | Expected result |
| --- | --- |
| Navigation | No horizontal overflow; direct links land on a useful heading; touch targets remain at least 44 px. |
| Race choice | The selected distance and confirmed fee stay visible and readable. |
| Guide content | Phone numbers and T-shirt collection details are easy to find. |
| Artwork and gallery | Images crop without obscuring essential copy; supplied photos remain credited where required. |
| Secure-app handoff | Public actions point to the configured HTTPS Netlify app and never expose a localhost address. |
| Payment preview | Payment acceptance and screenshot upload remain unavailable until real payment details and backend configuration are active. |
| Correction and collection | A rejected entry shows a correction path without making another payment; organiser collection is available only after verified payment. |
| Race-day guard | Completion tools remain unavailable until the approved timing and completion-desk settings are enabled for rehearsed organisers. |
| Accessibility | Keyboard navigation, focus return, image alternatives and colour contrast remain intact. |

Use `pnpm typecheck`, `pnpm test` and `pnpm run verify:targets` before a release. Physical iPhone Safari and Android browser checks remain required before opening registration.

## Launch state

No participant data, payment screenshot, payment decision or Google Drive sharing is created by the public-guide build. The secure backend remains blocked until the final Netlify origin, Supabase project, exact `SITE_ORIGIN`, verified organiser accounts, real UPI configuration and staging rehearsal are ready.
