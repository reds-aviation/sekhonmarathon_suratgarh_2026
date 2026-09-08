# Mobile app foundation

The site now includes the foundation for installation from a phone browser: a web-app manifest, a dedicated Desert Braves monogram icon, standalone launch metadata and a public offline information page. This remains a website; no Android package or App Store application has been built or released.

## Current behaviour

- The manifest uses relative identity, start URL and scope. They resolve to `/sekhonmarathon_suratgarh_2026/` on GitHub Pages and `/` on Netlify, keeping the installed experience limited to the selected event site. MDN describes how [manifest scope](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope), [start URL](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/start_url) and [identity](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id) control the installed experience.
- Supporting browsers can offer installation from the manifest. Browser support and installation UI vary; [MDN's installation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) explains this enhancement.
- The worker registers only in production builds, over a secure context, after page load. Local development does not register it. A production preview on localhost can be used for controlled testing because localhost is treated as secure, as described by [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
- Only `offline.html` and the three app icons are precached. The worker does not cache the event pages or JavaScript application bundle, so published dates, fees and instructions are fetched fresh. The public site has no participant records, authentication, payment screenshot or certificate data to cache, and it queues no submissions.
- When opening the homepage, the worker fetches the current document with HTTP caching bypassed. On a network failure, it serves a dedicated connection-needed screen with organiser phone links and a retry link. An already-open browser tab may still show the page loaded before connectivity was lost; visitors should reconnect before relying on event updates.
- Only explicit public file names are eligible for cache reads. No extension-based rules apply to arbitrary images, PDFs or other URLs. Cross-origin requests, writes, authorization headers and range requests bypass the worker. This is intentionally stricter than a general [network-first caching example](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching).
- Worker updates follow the normal lifecycle, without forced activation or reload while a visitor is reading. Close existing tabs/app windows and reopen to adopt an installed update. Bump the worker cache version when changing its offline page or icons.

The `DB` icon is a purpose-made app monogram with a sun and canal motif. It is not an official military crest. PNGs are provided at 192, 512 and 180 pixels, with key content inside the maskable safe area.

## Android installation and later Play release

For the current web version, open the public site in a supporting Android browser and use its install/add-to-home-screen option when offered. The installed icon opens the same hosted site.

A later Google Play release is a separate deliverable. A Trusted Web Activity wrapper is one possible path, using a tool such as Bubblewrap; it requires a signed Android build and verified association between the application and owned website. Google's [Trusted Web Activity guide](https://developer.chrome.com/docs/android/trusted-web-activity/quick-start) documents these steps.

For this GitHub Pages project, Digital Asset Links must be served at the **origin root** (`https://reds-aviation.github.io/.well-known/assetlinks.json`), not just inside the marathon repository path. Decide between configuring the account's root site and using an owned event domain before packaging. Do not invent an application ID, signing key, store account or release policy approval. Prepare the store listing, privacy/data declarations and current Play requirements only when that release is commissioned.

## iPhone installation

Open the live site in Safari, use Share, choose **Add to Home Screen**, enable **Open as Web App** when offered, then tap Add. Apple describes the flow in its [iPhone guide](https://support.apple.com/en-ie/guide/iphone/iphea86e5236/ios). The icon launches the hosted web experience; this does not create an App Store release.

## Verification and remaining device work

Automated checks exercise the worker's public allowlist, fresh-document fetch, explicit offline fallback, private-request bypass and scoped cache cleanup. TypeScript and a production build must pass before deployment. PNG dimensions and manifest paths can be checked from the generated build.

These checks do not establish physical-device installability. Before announcing mobile-app support, use real Android and iPhone devices to verify:

1. Install from the deployed HTTPS URL; check icon, name, standalone launch and project scope.
2. Open online, close/reopen, then enable airplane mode. The connection-needed page should appear with usable phone links. First-ever offline visits cannot work before the offline resources have been installed; browser storage eviction can remove them later.
3. Reconnect and retry; confirm the current website, How to register guide and race fees return.
4. Exercise keyboard navigation, the browser-only Yes/No readiness guide and the simplified route timelines. Confirm the guide creates no participant record and no private data enters Cache Storage.
5. Publish a test update. Confirm there is no forced reload while a visitor is reading, then close and reopen to adopt the new version.

No physical-device tests, push notifications, participant registration, background uploads or app-store releases are claimed by this foundation. Official registration remains on AFNET.
