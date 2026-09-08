# Sekhon Indian Air Force Marathon 2026 · Desert Braves

**Air Force Station Suratgarh — The Land of Sun and Sand**

Public event guide: <https://reds-aviation.github.io/sekhonmarathon_suratgarh_2026/>

This repository publishes a mobile-first event and registration-guidance website on GitHub Pages and Netlify. It does not register participants, accept payments, upload payment proof or store personal information.

The organisation's existing AFNET system remains the single registration and payment-confirmation channel. Its internal Excel export remains the source for participant administration and post-race certificate distribution.

## Confirmed event information

| Item | Detail |
| --- | --- |
| Race day | Sunday, 4 October 2026 |
| Registration deadline | Sunday, 27 September 2026 |
| Eligible participants | Airwarriors and their families |
| 5 KM fee | ₹200 |
| 10 KM fee | ₹250 |
| 21 KM fee | ₹250 |
| Payment | SI POS machine at Sports Section |
| T-shirt collection | Saturday, 3 October 2026, 09:00–13:30, in front of SBI Bank inside the station |
| Participant benefits | All registered participants will receive an event T-shirt and medal |
| Contact | 8838463776 · 7027964880 |

Reporting and flag-off timings will be published only after approval. A QR-payment option may be added later if an authorised QR becomes available; the current website does not display or accept a QR payment.

## Participant journey

The main website action is **How to register**. It explains the internal process without presenting AFNET as a public internet link:

1. Use an AFNET-connected system and open AFND at `www.afnd.iaf.in`.
2. Open **Sekhon Marathon Registration** from the pop-up window.
3. Scroll down and select **HQ WAC**.
4. Open the official registration page.
5. Enter the required participant details.
6. Pay the correct race fee at Sports Section through the SI POS machine.
7. Enter the required payment-confirmation details in the official internal portal.

The page includes a simple Yes/No readiness guide. Its answers stay only in the open browser screen and are not saved or transmitted:

- If the participant has not registered internally, it shows the AFNET steps.
- If the participant has not paid, it directs them to the Sports Section SI POS machine.
- If both steps are complete, it reminds them to retain their official portal confirmation.

## Website structure

- **Home:** event identity, date, audience, race choices and the main How to register action.
- **Races:** 5 KM, 10 KM and 21 KM descriptions with the confirmed fees.
- **How to register:** AFNET procedure, local readiness guide and current payment method.
- **Event guide:** important dates, T-shirt collection, inclusions, announcements, contacts and short practical answers.
- **Route overview:** a simplified public timeline for each distance. It communicates course progression without publishing internal station locations or presenting an operational map.
- **Why we run and gallery:** the legacy of Fg Offr Nirmal Jit Singh Sekhon, PVC, and organiser-supplied event imagery.

## Participant data and certificates

The public website has no participant database. Organisers should treat the final internal Excel export as the single source of truth for:

- official registration identity;
- participant name and email;
- selected race category;
- payment confirmation; and
- race completion confirmation.

Certificate email processing is intentionally deferred from this public-site release. After race day, organisers may configure a separate private workflow from the signed-off internal Excel export. It must use only records with both payment and race-completion confirmation. Its implementation, sender configuration, rehearsal and delivery controls will be reviewed separately and are not part of this repository's published website.

Keep the participant workbook, certificate template, generated PDFs and audit sheet private to authorised organisers. They must never be copied into this repository or exposed through GitHub Pages.

## Local development

Use Node 22 or newer and pnpm.

```text
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm run build:pages
pnpm run build:netlify
pnpm run test:targets
```

`pnpm dev` opens the same public-guide target that is deployed. The production output is written to `dist/pages`.

## Publishing

Push the approved change to `main`. The GitHub Pages workflow runs type checking, focused linting, automated tests and the static build before publishing `dist/pages`.

To publish the same website on Netlify, connect this GitHub repository in Netlify and keep the detected settings from [netlify.toml](netlify.toml): build command `pnpm run build:netlify` and publish directory `dist/netlify`. Netlify supplies its own site URL during the build, so canonical links and asset paths work at the Netlify root. No database or environment secrets are required.

Before a public release, verify the built site at phone and laptop widths. Confirm that:

- the How to register steps are easy to follow;
- the AFNET address is displayed as text and cannot be opened as a public link;
- the correct fees are ₹200, ₹250 and ₹250;
- no registration form, sign-in, payment upload or participant record is present;
- the simplified route timeline contains no sensitive internal locations;
- the T-shirt collection information and contact numbers are easy to find; and
- the footer credit reads **Developed by Flt Lt Balaram Reddy, OIC Sports and Adv**.

## Archived backend work

The repository retains earlier Supabase and receipt-upload designs for engineering reference only. They are superseded and are not part of the current website, deployment or registration process. Netlify is now supported only as an additional static host. See [the archived backend architecture](docs/backend-architecture.md) and [the archived event-day platform plan](docs/event-day-platform.md) for the historical design.
