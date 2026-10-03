# Certificate issuance

This Netlify Function issues unique numbers for participant-declared finish certificates. It does not check a registration roster or independently verify race completion. The PDF must display the finish time as **self-reported**.

## Enable the final release

After checking the final template, set these project environment variables using the Netlify UI, CLI or API, then create a fresh production deploy:

```text
CERTIFICATES_ENABLED=true
CERTIFICATE_TEMPLATE_VERSION=finisher-2026-v1
```

Both are required. Missing, false or mismatched configuration keeps issuance closed. Variables in `netlify.toml` are build configuration and cannot enable runtime issuance. Availability opens at the later of an enabled release and **4 October 2026, 10:30 a.m. IST** (`2026-10-04T05:00:00Z`). Certificate issue date is fixed at **4 October 2026**. To hold new issuance, set `CERTIFICATES_ENABLED=false` and redeploy.

## API

- `GET /.netlify/functions/certificates?action=status`: availability, scheduled opening, server time and declaration. It exposes no participant records.
- `POST /.netlify/functions/certificates`: JSON from the same origin or the explicitly allowed GitHub Pages origin `https://reds-aviation.github.io`, containing UUID-v4 `requestId`, `name`, `race` (`5`, `10` or `21`), `finishTime` (`HH:MM:SS`, 00:00:01–23:59:59) and `completionDeclared: true`.
- `201`: new immutable issuance record. `200`: an identical request was already issued. `409`: the same request ID was used with different details. `403`: release held or scheduled. `429`: temporary request limit. `503`: storage could not confirm a durable write; retry the same request ID.

The client should keep a random request ID against a hash of its normalized name/race/time combination. Re-entering the same details on that browser uses the same number. A different browser or clearing browser storage may create another certificate; without identity verification this system cannot guarantee one certificate per human.

GitHub Pages can call the deployed Netlify endpoint using narrowly scoped CORS. Only the same origin and `https://reds-aviation.github.io` receive an allow-origin header. POST preflight permits only `Content-Type`; wildcard origins and credentialed requests are not enabled. `Vary: Origin` is set. CORS limits browser access and is not identity verification.

## Durable private storage

Netlify Blobs provisions credentials automatically inside Netlify Functions. Production records use site-wide namespace `sekhon-finisher-2026` in Singapore. Runtime `context.deploy.context` chooses production storage; each preview deploy has a separate namespace and cannot overwrite production records. No blob URL, list operation, public read endpoint or roster is exposed.

Records contain name, race, self-reported time, issue timestamp/date, template version, status and certificate number. Only hashed request identifiers, fingerprints and time-scoped hashed IPs are used as lookup/quota keys. No email, phone, service number, raw IP or payment details are collected.

Atomic `onlyIfNew` reservations prevent certificate-number collisions. Request records are immutable and concurrent retries return the single winning certificate. Losing random reservations remain reserved forever, so their numbers cannot be reused. Strong reads and conditional-write read-back guard against unconfirmed provider writes, including the SDK's empty-ETag failure case.

## Capacity and limits

- Native platform limit: 2,000 requests/minute per domain and IP. It also covers status requests and may allow a short enforcement lag. The frontend shares status checks and normally caches them for five minutes, so a shared station connection can accommodate a 500-participant arrival burst without status polling consuming the whole allowance.
- Durable limit: 600 new certificate requests per connection per 10-minute window, accommodating families and up to 500 participants sharing a station connection.
- Durable global limit: 3,000 new requests per UTC day. Independent immutable quota slots avoid a shared mutable counter. Concurrent retries of the same request consume one slot; already-issued retries consume none.
- Quota probe work is bounded to 64 attempts. In exceptional congestion a request can be limited before every slot is filled; retry later.
- PDF creation happens in the browser, keeping server compute small. Storage/API failures do not issue unpersisted certificates.

The test suite covers 500 concurrent distinct connections and 500 new certificates on one connection. These are local correctness tests, not a guarantee of live Netlify throughput. Live publication must confirm the function was bundled, both runtime variables are applied, status is scheduled before release, and early POST returns `403` without storage writes.

## Free-plan budget

Netlify currently includes Functions, Blobs and two code-based rate-limit rules on its free plan. Its monthly credit limit still applies. Current published rates are 300 free credits/month, 15 credits/production deploy, 20 credits/GB bandwidth, 10 credits/GB-hour compute and 2 credits/10,000 web requests. Inspect the account's actual plan and remaining usage before publication. Neither 500 downloads nor repeated deployments are an unlimited-free guarantee.

Official references:

- [Blobs API, conditional writes and consistency](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Runtime environment variables and redeployment](https://docs.netlify.com/build/functions/environment-variables/)
- [Functions runtime Context and configuration](https://docs.netlify.com/build/functions/api/)
- [Free-plan code-based rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- [Current usage pricing](https://www.netlify.com/pricing/)
