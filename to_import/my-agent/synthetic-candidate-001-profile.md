# Synthetic Candidate Profile — Alex Mercier (fictional)

> Evaluation input for the Hirly Evidence-Backed Application Agent (v0). Fully synthetic — no real person, employer, or credential.

**Location:** Lisbon, Portugal (EU) · **Experience:** 6 years (2019-04 to present)

This is a readable projection of `synthetic-candidate-evidence.json`, the authoritative evidence source. Every statement below carries its `evidence_id` — the agent must cite these IDs in `claim-map.json`, never invent new ones.

## Employment

- **evidence_001** — Senior Software Engineer, Northlight Labs (Berlin, remote-first), 2022-03–present. Full-stack feature development on a B2B SaaS analytics product. Shipped 3 major features from discovery to GA in 12 months; contributed to a 22% increase in weekly active accounts. *(TypeScript, Node.js, React, PostgreSQL, AWS)*
- **evidence_010** — Software Engineer, Ferro Systems (early-stage HR-tech startup, ~15 employees), 2019-04–2022-02.

## Projects & achievements

- **evidence_002** — AI-assisted support-ticket triage using the Claude API; cut average first-response time by 35%. *(Claude API, TypeScript, Node.js, PostgreSQL)*
- **evidence_008** — Built REST and GraphQL APIs for Ferro Systems, working directly with founders and customers on scope changes.
- **evidence_009** — Direct enterprise-pilot customer support during onboarding (live troubleshooting, technical Q&A).
- **evidence_011** — Took a candidate-matching feature from discovery workshops through production launch with 2 customer design partners.
- **evidence_014** — Mentored 2 junior engineers on code review and onboarding. *(Not team management — see gaps below.)*
- **evidence_016** — Personal, non-production side project: RAG pipeline wired to a Slack bot for internal docs search. *(Python, Claude API, vector DB — explicitly not production/enterprise experience.)*
- **evidence_020** — Improved p95 API latency 40% via query optimization and caching.
- **evidence_021** — Active public GitHub profile with open-source contributions and personal repos (incl. the RAG/Slack-bot project and a TypeScript utility library).

## Skills

| Evidence ID | Skill | Confidence | Note |
|---|---|---|---|
| evidence_003 | TypeScript, Node.js | supported | |
| evidence_004 | React, Redux, React Query | supported | |
| evidence_005 | PostgreSQL | supported | |
| evidence_006 | Python | supported | Scripting/automation only, not primary backend language |
| evidence_007 | AWS (EC2, RDS, S3, Lambda) | supported | Small-team ops, no dedicated DevOps/SRE function |
| evidence_012 | Docker | supported | Local dev + containerized internal services |
| evidence_013 | Kubernetes | **uncertain** | Personal minikube project only — no production experience |
| evidence_017 | Testing (Jest, Playwright) | supported | |
| evidence_019 | Cross-functional collaboration | supported | |

## Education

- **evidence_015** — BSc Computer Science, University of Porto, 2015-09–2019-06.

## Preferences (self-reported, not a verifiable claim)

- **evidence_018** — Prefers direct customer contact and applied-AI product work; open to senior/staff IC tracks.

## Deliberate evidence gaps (for testing the agent's blocking behavior)

These are **not** evidence items — they are fields and claims the agent must recognize as unsupported, uncertain, or candidate-only, and must never fill by inference:

- **No production Kubernetes leadership** — only `evidence_013` (uncertain, personal project).
- **No SOC 2 / security-certification ownership** — zero evidence.
- **No management of a team larger than 3 people** — only `evidence_014` (mentoring 2 engineers).
- **No confirmed salary expectation** — candidate-only.
- **No confirmed work-authorization answer** — candidate-only.
- **No confirmed relocation preference** — candidate-only.
- **No legal attestations on file** — candidate-only.
- **No demographic or legally sensitive information** — must never be inferred or fabricated.
- **No French-language fluency evidenced** — candidate-only question if a role requires it.
- **No B2B SaaS quota-carrying sales experience** — this candidate's evidence is engineering/product, not sales.
- **No formal product-design leadership** — only feature discovery-to-production as an engineer (`evidence_001`, `evidence_011`), not design ownership or B2B2C/luxury design leadership.
