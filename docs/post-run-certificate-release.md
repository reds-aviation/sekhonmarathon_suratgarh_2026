# Post-run certificate release - 3 October 2026

## Published experience

Home and phone navigation lead to the Certificate screen. A prominent finisher announcement replaces the registration call to action. The user enters a name, 5/10/21 km category and finish time, then confirms completion. A numeric phone keyboard formats six timing digits as HH:MM:SS. Before release, the page can render a visibly marked, non-downloadable sample from entered details without reserving a number or writing participant data to the service. The page shows its private-storage notice before live submission.

Completion is participant-declared and finish time is self-reported. This implementation does not match names to an official roster and must not be described as independently verified. No email, mobile number, payment detail or service number is collected by the certificate form.

The supplied certificate layout was edited using the built-in image-generation tool to clear variable fields and remove the sample QR. The heading is corrected to "Certificate of Successful Completion." Selectable participant text is placed over the image. Issuing authority is preserved as supplied: Air Cmde Deepankar Nautiyal, AOC 35 WG. The final PDF draws a scannable QR above that printed authority block. Its entire plain-text payload is exactly `Air Cmde Deepankar Nautiyal`; it contains no participant details, URL or certificate-verification claim. The caption states that it is not a digital signature. Issue date is 04 October 2026.

Website credit: Website created by Flt Lt B. Reddy (38703).

## Service and activation

GitHub Pages hosts the public website. Its certificate form calls the private Netlify Function on the existing Netlify site with explicitly allowed CORS. The service stores immutable number reservations and minimal issuance records in private Netlify Blobs. PDFs are generated in the participant's browser; certificate data is never shipped as a public spreadsheet or roster.

Netlify deployment still requires account access. Until the service is deployed and enabled, the public form cannot produce a live certificate number. The sample preview is expressly invalid and never calls the issuance service.

Set runtime `CERTIFICATES_ENABLED=true` and `CERTIFICATE_TEMPLATE_VERSION=finisher-2026-v1` on the Netlify project and redeploy the source, including `netlify/functions`. A drag-and-drop upload of `dist/netlify` alone does not deploy the service. Issuance and downloads then open no earlier than 8:00 a.m. IST on 4 October 2026 (`2026-10-04T02:30:00Z`). To hold issuance, set the enabled switch false and redeploy. The invalid visual preview remains available while downloads are held.

Before enabling, check the deployed status endpoint, ensure early POST requests return 403, confirm the two runtime variables, private storage, and CORS. Perform a post-release organiser trial with an authorised participant and inspect the PDF before advertising that downloads are live.

## Repeated downloads

Random numbers are atomically reserved and never reused. A hash of the normalized name/category/time selects a browser-held request ID; no plaintext participant details are stored locally. Retries and repeated entries with the same spelling or capitalization reuse the issued number on that browser. Another browser, clearing browser storage or changing the details can create another certificate. The system guarantees non-repeated numbers, not one certificate per person.

## Verification

Relevant build, type and lint checks pass. Backend tests include 500 concurrent requests on distinct connections and 500 requests sharing one connection, immutable retries, collision handling, outages, validation, release timing and restricted CORS. These are local correctness tests, not a measured guarantee of production throughput.

Browser checks cover 320 px, 390 px and 1440 px in WebKit with a controlled API: date lock, declaration required, nonzero timing, connection failure and retry, PDF download, repeated ID, no horizontal overflow and no runtime errors. PWA tests separately confirm that API requests and participant details are not cached. English and mixed Hindi/English PDF layouts were inspected.

The original web font defaulted to Thin in the test browser. Static licensed Public Sans 400/600/700 instances now provide reliable readable weights, with a glyph-level regression check. Certificate typography uses serif Latin text and licensed Noto fallback for Devanagari.
