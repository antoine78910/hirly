# Sprout France job source

## Status and non-activation boundary

On 2026-07-21 the operator attested that Hirly is authorized to access and use
the Sprout API. Sprout does not provide a service credential, so the approved
credential shape is a dedicated dummy-account session stored only in runtime
secret storage. No bearer, refresh token, cookie or account identity is stored
in this repository.

That attestation does not activate production ingestion by itself. The
checked-in registration remains `unverified`, writer `none`, disabled for
transport, incremental refresh and backfill, and protected by both provider and
source `FR` kill switches until the policy reference, secret reference, writer,
page size and canary are configured together.

Do not make a live request, retain a live response, or enable a write until a
review records all of the following without secrets:

- permission for API access, commercial use, redisplay and full-text retention;
- deletion, expiry and lifecycle obligations;
- an approved dedicated-account credential flow, refresh procedure and rate limit;
- one TypeScript writer owner, an approved page size and a canary rollback;
- provider and source policy approval for `FR`.

Credentials belong only in runtime secret storage. Tasks carry a reference such
as `secret://sprout/france-api`, never a bearer, refresh token, cookie,
authorization header, account email or token-shaped value. Credentials pasted
into interactive sessions are ephemeral qualification credentials and must
never be copied into code, fixtures, logs or task payloads.

## Redacted observed API contract

The bounded read-only discovery observed an authenticated HTTPS `GET` jobs
endpoint and a location-suggestion endpoint. Host and path details are kept in
the reviewed secret/policy evidence rather than task payloads. Redirects,
cookies, non-HTTPS origins and arbitrary URLs from response pagination are not
trusted.

### Response wrapper

| Field | Observed shape | Contract treatment |
| --- | --- | --- |
| `message` | scalar | observed; semantics unverified |
| `jobs` | array | required ingestion collection; consume exactly once |
| `results` | array | observed mirror; never ingest or persist a second copy |
| `count` | non-negative integer | required for drift evidence, not a completeness proof |
| `next` | nullable pagination value | untrusted; extract only a numeric offset from a relative query |
| `previous` | nullable pagination value | observed only; never follow it |

Wrapper disagreement between `jobs` and `results` is schema-drift telemetry and
a stop condition. It is not permission to combine both arrays.

### Observed job fields

The following names were observed in a bounded sample. “Observed” does not mean
required or non-null across the corpus. The raw schema/normalizer owns exact
nullable rules and preserves sanitized unknown source fields; production must
stop on incompatible shape drift rather than silently discard data.

| Group | Fields | Required/nullable status |
| --- | --- | --- |
| Identity | `id` | required for accepted inventory; stability still requires characterization |
| Core display | `title`, `company`, `summary`, `rawDescription`, `oneLiner` | observed; nullability outside the sample is unverified |
| Provenance | `source`, `sourceId`, `employerId`, `companyId`, `checkedBy` | observed; never replace Sprout `id` as canonical identity |
| URLs/assets | `postingUrl`, `companyLogo` | observed; posting URL must pass canonical apply/ATS selection |
| Lifecycle | `status`, `createdAt`, `updatedAt`, `lastCheckedAt`, `postedAt` | observed; nullable/invalid/future timestamps stay raw and do not establish freshness |
| Compensation | `salaryMin`, `salaryMax`, `currency` | observed; zero and null semantics are unverified |
| Classification | `industry`, `educationLevel`, `jobLevel`, `jobTypes`, `workLocation`, SOC/O*NET fields, `minExperience` | observed; enum coverage is not exhaustive |
| Requirements | `desiredQualifications`, `requiredQualifications`, `restrictions`, `responsibilities`, `skills`, `schedule` | observed arrays/scalars; precise nullability unverified |
| Benefits/mobility | `benefits`, `h1b`, `relocationAssistance` | observed; preserve source meaning without coercing unknown values |
| Company metadata | `companySize` | observed; nullability unverified |
| Geography | `locations` | required non-empty evidence for accepted France rows |

Each observed location may contain country, city, region, code and coordinates.
An accepted France row needs at least one normalized `FR` location. Preserve the
complete location array, select a deterministic primary location, and treat zero
coordinates as unknown rather than `(0,0)`. Unknown-only and non-FR-only rows
are quarantined/counted and never committed as France inventory.

## France query shape

`/locations/suggest` returned a France country selection with
`countryCode=FR`, `isCountry=true`, latitude `47.1106` and longitude `2.7834`.
The jobs endpoint accepted it only as an Axios-style nested object, including
keys such as `location[address]`, `location[countryCode]`,
`location[isCountry]`, `location[latitude]`, `location[longitude]` and the
observed `location[radius]`. A plain `location=France` failed validation.

| Parameter | Observed behavior | Full-France policy |
| --- | --- | --- |
| `offset` | numeric offset | checkpoint-owned, monotonic |
| `limit` | default observed as 10 | use only a manually qualified persisted page size |
| nested `location[...]` | required country object | send the characterized `FR` country object |
| `jobTitle`, `jobCategory` | the validated browser shape sends explicit empty values | send explicit empty values; do not enumerate titles/categories |
| `types[]` | accepted values included `FULL_TIME`, `PART_TIME`, `INTERNSHIP` | omit; list is not exhaustive |
| `experienceLevels[]` | accepted `ENTRY`, `MID`, `SENIOR`, `EXECUTIVE`; `MID` reduced the observed count from 69,108 to 17,721 | omit |
| `workLocations[]` | accepted `IN_PERSON`, `HYBRID`, `REMOTE` | omit; list is not exhaustive |
| `postedDate` | accepted `any`, `24h`, `30d` | use `any` for backfill |
| `location[radius]=50` | accepted with country mode | semantics unverified; retain until bounded equivalence proves omission safe |
| `includeUnknownWorkLocation` | accepted | semantics unverified; unknown-only rows cannot enter France inventory |
| `minimumSalary=0` / unknown salary switch | accepted | zero/unknown inclusion semantics unverified |
| `additionalRequirements=[]` | required scalar empty-list encoding in the validated request; the similarly named array-key encoding failed validation | preserve the scalar `[]` value |
| company/industry filters | visible/accepted inputs | omit; semantics and union behavior unverified |

Never enumerate every currently visible filter value to simulate “all”; future
enum values would be silently excluded.

### Bounded live qualification — 2026-07-21

One repository-generated `limit=1`, `offset=0` request using the France country
object returned HTTP 200. It reported `count=69,944`, returned one job whose
location country code was `FR`, and exposed equal-length `jobs` and `results`
wrappers. The request used the bearer and refresh headers only; browser cookies
were not required. No response body was retained and no database write ran.

The count is a point-in-time provider report, not a completeness guarantee. The
qualification proves the serialized query shape, not page-size stability,
pagination stability, credential refresh, corpus-wide country containment or
permission expiry behavior. Those remain activation gates.

The executable no-write qualification helpers live in
`apps/worker/src/providers/sprout/qualification.ts`. The comparison matrix is
hard-capped at six one-row requests with a minimum two-second delay and reports
only counts, one sampled ID, byte size, and wrapper disagreement. Page-size
qualification is a separate manually authorized trial capped at three requests
and a caller-supplied response-byte budget. Neither helper writes jobs or changes
source configuration; an operator must review the artifact before persisting an
approved page size.

## Pagination and checkpoint safety

The persisted checkpoint is
`{ version, offset, pageSize, observedTotal, watermark }`. `pageSize` is approved
only by a manual no-write qualification of at most three requests with explicit
byte/time limits and delay. It is never probed during a scheduled run.

One worker task fetches and atomically commits at most one page. `next` is not
followed. The runtime accepts only a numeric offset or a relative query with one
numeric `offset`, requires it to equal `current offset + returned item count`,
and rebuilds the next request from the approved query. Absolute/protocol-relative
URLs, repeats, gaps, backward offsets, empty progressing pages, totals below the
observed range and incomplete terminal pages stop without committing or
advancing the checkpoint.

The page writer must atomically persist sanitized raw snapshots, canonical rows,
source occurrences, metrics and the next checkpoint under the current lease and
Sprout writer epoch. A retry therefore replays the last committed offset. A
401/403, repeated 429, malformed body, schema/wrapper drift, byte breach,
country leak, abort or lease loss leaves the input checkpoint unchanged.

## Rate, lifecycle and observability

- concurrency is always `1`;
- the disabled registration starts at no more than one request per minute;
- honor `Retry-After`; use bounded exponential backoff with jitter;
- emit requests, bytes, latency, status classes, fetched/accepted/rejected,
  country leakage, timestamp anomalies, dedup/upsert counts, freshness,
  fulfillment readiness, checkpoint lag and reported-total drift;
- a failed, aborted, unauthorized or incomplete France scope never expires
  missing inventory;
- future or malformed `postedAt` values remain evidence but do not count as
  fresh inventory.

## Qualification, activation and rollback

1. Pass fixture-only contract, checkpoint and secret-scan tests.
2. With reviewed authorization, run a bounded no-write qualification.
3. Enable only shadow/no-canonical-write mode and compare country validity,
   schema rejection, freshness, applyability and duplicates.
4. Run a one-page canary and read back identity, raw linkage, occurrence and
   checkpoint evidence before raising any cap. Record the evidence reference,
   exactly one committed page, and the single-writer check in the activation
   record.
5. Exercise rollback and record evidence that both `FR` kill switches,
   scheduling, transport, outstanding tasks and the writer claim can all be
   stopped or released. Backfill and incremental modes fail closed until every
   canary read-back and rollback check is recorded as passed.
6. Stop immediately on authorization/policy expiry, auth failure, repeated rate
   limiting, drift, leakage, duplicate regression or fulfillment degradation.

Rollback order is: set the provider and source `FR` kill switches, disable the
schedule and transport, stop outstanding tasks, preserve raw evidence and the
last checkpoint, confirm there is no writer claim, then remove Sprout from any
preferred feed group. Emergency rollback does not delete raw evidence or
pre-existing canonical rows.

Production completeness cannot be claimed from unit tests. It additionally
requires written authorization, characterized stable pagination, bounded canary
read-back and no regression in inventory, duplicates, freshness or fulfillment.
