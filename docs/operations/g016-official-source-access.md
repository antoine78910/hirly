# G016 official source access evidence

Classification: `TS_NEW`.

This is the 2026-07-20 fail-closed access decision for the G016 evidence-only
multi-source bakeoff. It does not authorize production activation, canonical
writes, application submission, scraping, deployment or writer transfer.
Machine-readable evidence and captured sample digests live in
`artifacts/job-ingestion/source-policy/g016-official-access-2026-07-20.json`.

## Decision summary

| Source | Official access | Commercial/redisplay finding | Representative feed | G016 decision |
| --- | --- | --- | --- | --- |
| Choisir le Service Public | Credential-free weekly data.gouv CSV | Open Licence 2.0 permits commercial reuse and redisplay with attribution | Fixed 2026-06-28 CSV captured; 183,467 parsed rows and 181,643 unique references | `qualified_evidence_only`; no production |
| BPCE via data.gouv | Credential-free JSON/CSV export | Open Licence 2.0 plus an explicit invitation to display on job platforms | Current capture has 2,070 rows, descriptions and direct apply URLs | `qualified_evidence_only`; redact recruiter PII; no production |
| Other data.gouv datasets | Public catalogue; resource access varies | Catalogue membership is not source-specific rights evidence | No generic feed | `dataset_specific_evidence_required` |
| Apec | XML excerpts only by partnership convention; robots prohibited | Commercial Hirly redisplay is not publicly authorized | No anonymous representative feed | `provider_contract_missing` |
| La Bonne Alternance | Token-gated API and complete JSON download | Published API terms reserve use to non-profit purposes and prohibit commercialization | Technically representative for alternance, but not commercially cleared | `provider_contract_missing` |
| SmartRecruiters | Company-scoped Posting API; official auth guidance conflicts | Career-site/widget use exists, but unrestricted commercial multi-tenant redisplay is not granted | Allowlisted tenants can form a technical sample; no global feed | `provider_contract_missing` |
| Taleez | Tenant public/secret key with scopes; 100 requests/minute | A public key is authentication, not an open-data licence | Company-scoped only; no provider-wide feed | `provider_contract_missing` |

## Approved evidence-only candidates

### Choisir le Service Public

The official [dataset page](https://www.data.gouv.fr/datasets/les-offres-diffusees-sur-choisir-le-service-public)
identifies the DGAFP as publisher, a weekly cadence and Open Licence 2.0. The
[licence](https://www.data.gouv.fr/pages/legal/licences/etalab-2.0) expressly
permits commercial reuse and redistribution when the source and last update are
attributed.

The fixed CSV captured for this review has SHA-256
`a4c34e24156138e89e83a9a98a296214a81f39b4bdf3f89aff83e62069fb1e5b`.
It contains no description or application URL column. At the declared
2026-06-28 snapshot date, 42,660 rows (42,321 unique references) had a complete
publication window covering that date. The resource therefore supports volume,
freshness and dedup evidence, but cannot prove actionable application routes.
Only 18,409 rows (18,242 unique references) covered the 2026-07-20 capture
date, confirming that the delayed cumulative snapshot is not a fresh
active-only feed.

### BPCE via data.gouv

The official [dataset page](https://www.data.gouv.fr/datasets/groupe-bpce-offres-emploi-publiques)
states that the publisher shares all offers, refreshes four times daily and
allows the data to be displayed on job platforms. Open Licence 2.0 applies.

The captured JSON export has SHA-256
`88812357b8bc48fe23d276f041af70798c42453797a84c937929dd8c981434a4`
and 2,070 rows. It includes stable references, descriptions and apply URLs, but
also recruiter names and email addresses. A transport must drop those personal
fields before logs or evidence persistence. Because the export URL is mutable,
each run must bind an exact content digest and never reuse this digest for a
later response.

## Contract-gated sources

- **Apec:** the [partnership page](https://corporate.apec.fr/devenir-partenaire)
  describes XML export by convention. The [site terms](https://www.apec.fr/infos-legales/infos-cgu.html)
  prohibit capturing offer/database content and robot access. No connector or
  sample may scrape the public site.
- **La Bonne Alternance:** the [search API](https://api.apprentissage.beta.gouv.fr/fr/explorer/recherche-offre)
  is technically suitable, but its [terms](https://api.apprentissage.beta.gouv.fr/fr/cgu)
  restrict the route to non-profit use and prohibit commercialization. Hirly
  requires written authorization before any live evidence capture.
- **SmartRecruiters:** the [Posting API](https://developers.smartrecruiters.com/docs/posting-api)
  is company-scoped. The separate [Job Board API](https://developers.smartrecruiters.com/docs/partners-job-board-api)
  is partner/contract based. Public readability is not a general aggregation or
  redisplay licence; exact tenant or partner authorization is required.
- **Taleez:** the [OpenAPI](https://api.taleez.com/) requires a key generated by
  a tenant and exposes that company's jobs. Without authorized tenant keys,
  scopes and redisplay permission, the only valid result is
  `provider_contract_missing`.

## Partnership outreach status

The founder confirmed that partnership or integration requests were submitted
to Greenhouse, Lever, SmartRecruiters and Taleez on 2026-07-20. The outbound
request task is complete for all four providers.

| Provider | Request status | Access/policy status | Next evidence required |
| --- | --- | --- | --- |
| Greenhouse | Submitted 2026-07-20 | Awaiting provider response; no new rights granted | Written partner/tenant terms, mutual-customer or sandbox requirements, permitted listing and application scopes |
| Lever | Submitted 2026-07-20 | Awaiting provider response; no new rights granted | Written partner/tenant terms, regional feed scope, redisplay/retention rights and sandbox credentials |
| SmartRecruiters | Submitted 2026-07-20 | `provider_contract_missing` until accepted terms are recorded | Job Board API agreement, tenant coverage, redistribution/retention terms, quota and sandbox |
| Taleez | Submitted 2026-07-20 | `provider_contract_missing` until accepted terms are recorded | Partner or tenant authorization, API scopes/keys, employer redisplay permission, quota and sandbox |

An application submission is not an approval. No source-policy decision,
trial-readiness flag, production-readiness flag, writer ownership or kill switch
may change until the response is reviewed and immutable evidence is recorded.

## Downstream boundary

G016 transports must consume only the two exact approved candidates above,
bind source/resource identifiers and captured digests, enforce request/byte/time
budgets, persist only noncanonical immutable evidence, and return typed blockers
for every contract-gated source. No result in this document changes the single
canonical-writer rule or production readiness.
