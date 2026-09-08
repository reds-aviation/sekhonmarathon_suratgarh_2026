# Compact mobile guide: scope and verification

8 September 2026 · Air Force Station Suratgarh · Desert Braves

## Public experience

The phone experience keeps the first screen useful: host-station identity, event date, eligible audience, race choices and a clear **How to register** action. The heritage story, gallery and detailed guidance sit on focused views so the home page does not become a long book-like scroll.

The public guide uses the Suratgarh visual system: deep navy for authority, ivory reading surfaces, restrained green for actions and warm desert-gold accents. Public Sans supports body text and Barlow Condensed supports event display copy. The artwork is an impression of a thriving desert station and its surrounding region; it is not a route map or a promise of a flypast.

The compact guide includes:

1. Direct Home, Races, How to register and Event guide navigation with visible keyboard focus.
2. Compact 5 KM, 10 KM and 21 KM choices at ₹200, ₹250 and ₹250.
3. A seven-step AFNET registration guide with the internal AFND address displayed as non-clickable text.
4. A browser-only Yes/No readiness guide that neither saves nor sends participant answers.
5. The current payment instruction: use the SI POS machine at Sports Section.
6. A simplified public route timeline for each distance, without internal station locations.
7. Both contact numbers: 8838463776 and 7027964880.
8. T-shirt collection on Saturday, 3 October 2026, 09:00–13:30, in front of SBI Bank inside the station.
9. A clear statement that all registered participants will receive an event T-shirt and medal.
10. A 2025 memories gallery using organiser-supplied Suratgarh photographs. The warm-up video remains excluded.

## Public and internal boundaries

GitHub Pages is the primary public website and Netlify may host the identical static build. Neither host serves registration, participant records, payment uploads, transaction-number collection, certificate delivery or organiser operations.

Official registration and payment confirmation take place through the organisation's existing AFNET system. The internal Excel export is the source for participant administration. Post-race certificate delivery is intentionally deferred to a later private organiser phase; no certificate-mailing tool is included in this public release.

The earlier Netlify/Supabase app and Google Drive receipt-mirror proposal is superseded. Its source and documents may remain in the repository as archived engineering material, but no part of that flow is included in the public release.

## Responsive checks to retain

Before each release, check the built guide at 320 × 740, 390 × 844, 768 × 1024 and 1366 × 768 or wider:

| Check | Expected result |
| --- | --- |
| Navigation | No horizontal overflow; actions land on a useful heading; touch targets are at least 44 pixels. |
| Home hierarchy | Host identity, date and How to register action are understandable without a long initial scroll. |
| Race choice | Distance and current fee remain visible and readable. |
| Registration guide | AFNET steps retain their order; the internal address is text rather than a public hyperlink. |
| Readiness guide | Yes/No choices reveal accurate next steps and do not persist after reload. |
| Route timeline | The sequence is readable on phone and contains no internal station locations. |
| Event guide | Contacts, POS payment, participant benefits and T-shirt collection are easy to find. |
| Artwork and gallery | Images crop without hiding essential HTML copy; archive captions remain accurate. |
| Accessibility | Keyboard navigation, focus order, alternative text, text sizing and colour contrast remain intact. |
| Privacy | No sign-in, public registration form, participant lookup, screenshot upload or third-party data request is present. |

Run `pnpm typecheck`, `pnpm test`, `pnpm run build:pages`, `pnpm run build:netlify` and `pnpm run test:targets` before publishing. Verify each final deployed URL on a physical Android phone and iPhone before circulation.

## Release state

The static public guide can be published without a registration backend. Reporting and flag-off timings remain marked as pending until approved. An authorised QR may be added later; until then, only the SI POS payment instruction should appear.
