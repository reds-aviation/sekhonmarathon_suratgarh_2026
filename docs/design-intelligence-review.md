# Website design intelligence review

Revised 8 September 2026 for the Desert Braves' Sekhon Indian Air Force Marathon website at Air Force Station Suratgarh.

## Product brief

Most visitors will arrive from a station message and open the website on a phone. Their main questions are: Is this the correct event? Which race suits me? What does it cost? How do I register on AFNET? How do I pay? What happens before and on race day?

The chosen design direction is **station-first operational clarity**: a restrained navy, ivory, green and warm-sand system; one strong station illustration; short task-based views; a visible How to register action; and progressive disclosure for race, heritage, gallery and practical detail.

The website is public information only. It does not need sign-in, a participant race desk, a public registration form, payment-proof upload or an organiser portal.

## Audited visitor flow

1. **Recognise the event:** Desert Braves, Air Force Station Suratgarh, date and eligible audience appear immediately.
2. **Choose a distance:** compact 5 KM, 10 KM and 21 KM cards show ₹200, ₹250 and ₹250.
3. **Open How to register:** a seven-step timeline explains the AFNET process and displays `www.afnd.iaf.in` as non-clickable internal-network text.
4. **Check readiness:** two optional Yes/No prompts direct an unregistered participant back to the internal form or an unpaid participant to the Sports Section SI POS machine. Answers remain only in the browser screen.
5. **Prepare for the event:** the Event guide provides collection details, inclusions, contacts, announcements and pending timings.
6. **Understand the course shape:** generic timelines explain outward course, distance turnaround, return and finish without exposing internal station locations.
7. **Return to AFNET when required:** the public site never implies that registration or payment confirmation is complete because a visitor viewed the guide.

## Page hierarchy

| View | Primary task | Content limit |
| --- | --- | --- |
| Home | Recognise event and start registration guidance | Identity, date, audience, race summary and one main action. |
| Races | Compare distances and fees | One short card per category plus shared benefits. |
| How to register | Complete the internal process correctly | Seven steps, current payment method and local readiness guide. |
| Event guide | Prepare for collection and race day | Dates, inclusions, announcements, practical answers and contacts. |
| Why we run | Understand the tribute | Concise verified Sekhon story and one strong quotation from the official citation. |
| Gallery | See event atmosphere | Selected campaign artwork and accurately captioned organiser-supplied archive images. |

## Design decisions

- Keep the home screen concise and remove returning-participant and organiser actions that no longer belong on the public site.
- Use **How to register** as the dominant action. Avoid a conventional “Register here” label because the public page cannot open AFNET for ordinary internet users.
- Retain supplied imagery as strong editorial moments. Keep dates, fees, payment instructions and status in HTML rather than relying on text embedded in posters.
- State the route as a simplified timeline rather than a geographical map. This is easier to read on phones and respects the public-information boundary.
- State plainly that all registered participants receive an event T-shirt and medal. Keep collection date, time and location nearby.
- Mark reporting and flag-off timings as pending until approved rather than showing an assumed schedule.
- Keep help compact: short practical answers plus the two organiser phone numbers.
- Maintain 44-pixel touch targets, visible focus, strong text contrast and reduced-motion support.

## Reference evidence

Thirteen supplied references were previously triaged for transferable patterns such as clear choice cards, staged guidance, strong event identity, progressive disclosure and persistent mobile navigation. Their brands and page compositions were not copied. The [national marathon site](https://sekhoniafmarathon.in/) remains an ideas-only event reference; Delhi-specific routes, claims and operating details are not reused.

## Release checks

- At 320 and 390 pixels, the page has no horizontal overflow and no off-centre panels.
- The first phone view communicates station, event and next action without excessive text.
- All three fees match ₹200, ₹250 and ₹250 everywhere.
- The AFNET address is readable but not a public hyperlink.
- The local readiness guide has no form submission, storage or network request.
- The route timelines contain no internal station location names.
- POS payment, T-shirt collection, T-shirt and medal inclusion, and contact numbers are easy to find.
- No old My entry, organiser login, screenshot upload, QR placeholder or public database language appears in the shipped guide.
- The footer identifies **Flt Lt Balaram Reddy, OIC Sports and Adv** as developer.
- Type checking, automated tests and the static production build pass before publishing.

Post-race certificate generation is intentionally deferred from this release. It can later be configured as a separate private organiser operation based on the signed-off internal Excel export, with approved rehearsal and batch safeguards.
