# Sekhon Indian Air Force Marathon 2026 · Desert Braves

**Air Force Station Suratgarh — The Land of Sun and Sand**

Public event guide: <https://reds-aviation.github.io/sekhonmarathon_suratgarh_2026/>

This repository publishes a mobile-first event guide on GitHub Pages and the existing Netlify site. It does not register participants, accept payments or upload payment proof. The Certificate page provides an invalid visual preview before release. After the organiser enables the private Netlify service and the 4 October 2026, 8:00 a.m. IST gate passes, participants may submit their name, race and self-reported finish time for a numbered PDF download.

The organisation's existing AFNET system remains the single registration and payment-confirmation channel. The public certificate flow is participant-declared and does not verify completion against an official roster.

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
- **Certificate:** personal visual preview, release status, and gated numbered PDF download after the event.
- **Event guide:** important dates, T-shirt collection, inclusions, announcements, contacts and short practical answers.
- **Route overview:** a simplified public timeline for each distance. It communicates course progression without publishing internal station locations or presenting an operational map.
- **Why we run and gallery:** the legacy of Fg Offr Nirmal Jit Singh Sekhon, PVC, and organiser-supplied event imagery.

## Participant data and certificates

Before release, the Certificate page renders a visibly invalid preview in the browser without reserving a number or sending participant details to the issuance service. Live issuance requires both the server switch and matching template version as well as the 8:00 a.m. IST gate on 4 October 2026. The service stores only the details needed for an issued certificate in private Netlify Blobs; the PDF is rendered in the participant's browser. The form collects no email, phone number, service number or payment details.

Completion and finish time are participant-declared. The public service cannot establish official race results or confirm eligibility from the internal AFNET records. Keep official participant workbooks private and do not publish them through the site or repository. See [the certificate release notes](docs/post-run-certificate-release.md) for the deployment and verification procedure.

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

To publish the same website on the existing Netlify project, keep the settings from [netlify.toml](netlify.toml): build command `pnpm run build:netlify`, publish directory `dist/netlify`, and function directory `netlify/functions`. The certificate service also requires the runtime variables documented in [the function README](netlify/functions/certificates/README.md). Uploading `dist/netlify` alone does not deploy the function.

Before a public release, verify the built site at phone and laptop widths. Confirm that:

- the How to register steps are easy to follow;
- the AFNET address is displayed as text and cannot be opened as a public link;
- the correct fees are ₹200, ₹250 and ₹250;
- no registration form, sign-in, payment upload or participant record is present;
- the simplified route timeline contains no sensitive internal locations;
- the T-shirt collection information and contact numbers are easy to find; and
- the footer credit reads **Developed by Flt Lt Balaram Reddy, OIC Sports and Adv**.

## Archived backend work

The repository retains earlier Supabase and receipt-upload designs for engineering reference only. They are superseded and are not part of the current public registration process. Certificate issuance uses the private Netlify Function described above. See [the archived backend architecture](docs/backend-architecture.md) and [the archived event-day platform plan](docs/event-day-platform.md) for historical designs.
