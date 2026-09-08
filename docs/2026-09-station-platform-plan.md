# Suratgarh station website plan

## Purpose

Publish a polished, mobile-first Sekhon Indian Air Force Marathon guide for **Air Force Station Suratgarh — Desert Braves, The Land of Sun and Sand**. The page should help eligible airwarriors and families understand the event, choose a distance, complete the official internal registration process and arrive prepared.

The public website is an information and guidance layer. Registration and payment confirmation remain on the organisation's existing AFNET system, whose internal Excel export is the administrative source of truth.

## Confirmed product boundary

| Surface | Responsibility |
| --- | --- |
| GitHub Pages / Netlify website | Public event information, race fees, AFNET registration instructions, payment guidance, generic route timelines, collection information, contacts and event storytelling. |
| AFNET registration system | Official participant registration and payment-confirmation entry. |
| Internal Excel export | Participant administration, payment reconciliation, T-shirt and medal planning, and post-race completion records. |
| Private certificate workflow (later phase) | To be configured separately after race day from the approved internal export; it is not included in this public release. |

The GitHub Pages site must not contain a public registration form, authentication, participant lookup, payment screenshot upload, transaction-reference collection or organiser dashboard.

## Current event facts

- Race day: Sunday, 4 October 2026.
- Registration deadline: Sunday, 27 September 2026.
- Audience: airwarriors and their families.
- Fees: ₹200 for 5 KM; ₹250 for 10 KM; ₹250 for 21 KM.
- Payment: SI POS machine at Sports Section.
- All registered participants will receive an event T-shirt and medal.
- T-shirt collection: Saturday, 3 October 2026, 09:00–13:30, in front of SBI Bank inside the station.
- Contacts: 8838463776 and 7027964880.
- Reporting and flag-off timings: to be announced after approval.

## Information architecture

### Home

Lead with the Desert Braves identity, Air Force Station Suratgarh, date, eligible audience and one primary **How to register** action. Keep the first phone screen concise. Race cards should show the distance and current fee at a glance.

### Races

Use one compact card per distance. Explain who each distance suits, the fee and the shared participant benefits. Every race action should lead to the same internal-registration guide.

### How to register

Show the official process as a numbered visual sequence:

1. Use an AFNET-connected system.
2. Open AFND at `www.afnd.iaf.in`.
3. Open the Sekhon Marathon Registration pop-up.
4. Select HQ WAC.
5. Open and complete the official registration form.
6. Pay through the SI POS machine at Sports Section.
7. Enter payment-confirmation details in the official portal.

Display the AFNET address as text, not as a public hyperlink. Add a browser-only Yes/No readiness guide for “Registered internally?” and “Payment completed?”. It may reveal the relevant next instruction, but it must not save or transmit the answer.

### Event guide

Keep the practical information task-based: important dates, payment, T-shirt collection, what participants receive, hydration and refreshments, announcements, short practical answers and contact numbers.

### Route overview

Use a simplified timeline for each distance. Show shared start, outward progression, distance turnaround, return and finish. Keep internal station location names, control points and sensitive operational details out of public code and artwork. Label the graphic as an overview and direct participants to the official station brief and marshals for the final course.

### Heritage and gallery

Keep the Sekhon tribute and organiser-supplied event photographs on focused views. Use the station artwork as an editorial identity element and state that it is an artistic impression rather than a route map or flypast announcement.

## Visual and interaction direction

- Give Air Force Station Suratgarh the strongest visual prominence, supported by Desert Braves.
- Retain deep navy, ivory, warm desert gold and restrained green.
- Keep essential text in HTML so it remains readable and accessible on phones.
- Use supplied poster art and historical photographs as selected editorial moments, not repeated backgrounds.
- Use one clear primary action per view and at least 44-pixel touch targets.
- Prefer short cards, timelines and progressive disclosure over long paragraphs.
- Preserve keyboard focus, useful alternative text, strong colour contrast and reduced-motion behaviour.

## Certificate workflow

Certificate email processing is deferred from this release. After race completion, organisers may configure a separate private workflow using the final internal workbook as the single source for certificate identity, email, race category, payment confirmation and completion confirmation. Its validation, rehearsal, batch delivery and audit controls must be approved before use.

The website does not generate certificates or expose the workbook. Only records with confirmed payment and confirmed completion should enter the live certificate batch.

## Delivery sequence

1. Maintain one public GitHub Pages target and remove public links to the retired secure-app flow.
2. Implement the How to register page and the browser-only readiness guide.
3. Update all race fees to ₹200, ₹250 and ₹250.
4. Add generic route timelines without internal station locations.
5. Present T-shirt and medal inclusion, collection information, current POS payment method and contacts consistently.
6. Verify navigation, touch targets, typography, overflow and content at 320, 390, 768 and 1366 pixels.
7. Build the static site and confirm its output contains no registration, authentication, Supabase or payment-upload interface.
8. Publish through GitHub Pages and optionally connect the same static build to Netlify.
9. In a later private phase, rehearse the certificate process with synthetic rows before using the signed-off internal export after race day.

## Information still required

- Approved reporting and flag-off timings.
- Any final participant instructions or safety announcements.
- An authorised QR-payment mechanism, only if it later replaces or supplements the SI POS process.
- Approved certificate artwork and signer details for the later private post-race workflow.

These pending details can be added without changing the architecture.
