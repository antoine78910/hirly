# Application Pack — Alex Mercier (fictional) → LSSM Tech "Tech Builder / Architect" Path

> **Status: BLOCKED — draft ready for candidate review, but the application cannot be completed until the candidate supplies required personal fields (see "Unresolved candidate questions").**
> This pack is a draft only. It does **not** authorize or constitute submission of any application.

---

## 1. Role & company summary

- **Company:** LSSM Tech ("Living Systems, Scaling Metamorphosis") — self-described as "building regenerative infrastructures for the AI-accelerated era."
- **Path / role applied to:** "Tech Builder Path" → **"Apply to Join the Architects"** ("Join the select group of architects building the future's digital foundations").
- **Job source:** `https://lssm.tech/tech-builder` (fetched successfully; extractable text and application form present).
- **Nature of the posting:** The posting is a **thematic / manifesto-style** recruitment page rather than a conventional job description. It describes a philosophy of building ("Move beyond features. Build ecosystems.") organized around four themes — *Reusable Tech Bricks*, *Decay-Resistant Systems*, *Learning Architectures*, and *Co-Evolving Architectures* — and then presents a short multi-step application form.
- **Important extraction caveat:** The posting lists **no explicit hard requirements** (no required years, no required stack, no degree/certification/language requirements, no location/authorization statements). The "material requirements" in Section 3 are therefore **inferred from the posting's themes and vocabulary**, not quoted mandatory criteria. They are labelled as thematic, and no requirement has been invented beyond what the page states.

---

## 2. Job source & readability note

- URL fetched: `https://lssm.tech/tech-builder`
- Read reliably: **Yes** — the page returned extractable text including the four thematic sections and a working application form ("Apply to Join the Architects", steps 1–2–3 with a "Continue" button). Because it was readable and is clearly a recruitment/application page, this pack proceeds without requesting pasted text.
- Note: The visible form exposes step markers "1 / 2 / 3" and a "Continue" button, so **additional form steps may exist beyond the fields captured below**. Only the fields rendered in the fetched text are treated as known; any later-step fields are unknown and are flagged as such.

---

## 3. Material requirements (thematic — inferred from posting language, not quoted mandatory criteria)

| # | Requirement theme (posting's own language) | Must-have vs nice-to-have | Notes |
|---|---|---|---|
| R1 | **Systems / architecture thinking** — "Architect the Future", "Move beyond features. Build ecosystems." | Thematic core | Posting frames the role as "architect," not feature-coder. |
| R2 | **Reusable, modular components** — "Reusable Tech Bricks", "Modular Tech Bricks", "Code evolves. Systems breathe." | Thematic | Reuse / modular design. |
| R3 | **Maintainable, decay-resistant systems** — "Decay-Resistant Systems", "Stop technical entropy before it starts", "Technical Debt Evolution" | Thematic | Reducing tech debt / long-term maintainability / performance. |
| R4 | **Applied AI for the "AI-accelerated era"** — "Learning Architectures … structures that self-adapt and teach", "Co-Evolving Architectures", "regenerative infrastructures for the AI-accelerated era" | Thematic | Suggests hands-on AI/LLM product work. |
| R5 | **Digital-foundations / infrastructure engineering** — "building the future's digital foundations", "infrastructures" | Thematic | Cloud/infra/platform work implied. |
| R6 | **Public technical footprint** — form requests Portfolio URL + GitHub Username | Requested field | Public portfolio / GitHub expected. |

No explicit seniority, stack, certification, management, sales, or language requirement is stated on the page.

---

## 4. Application questions / form fields the posting asks for

Captured from the fetched form (steps 1–3, "Continue"):

1. **Full Name** (text)
2. **Email** (text)
3. **Primary Technical Expertise** (dropdown — "Select your primary expertise"; option list not visible in fetched text)
4. **Years of Experience** (dropdown — "Select your experience level"; bucket options not visible)
5. **Portfolio URL** (text)
6. **GitHub Username** (text)

No salary, work-authorization, relocation, legal-attestation, or demographic fields appear in the captured form. (If a later step requests any of these, they must be answered by the candidate — see Limitations.)

---

## 5. Requirement-to-evidence map

Built **before** drafting. Each requirement maps to the most specific supported evidence; gaps and uncertainties are stated explicitly.

| Requirement | Matching evidence (evidence_id) | Support | Comment |
|---|---|---|---|
| **R1 — Systems / architecture thinking** | evidence_001 (leads full-stack feature dev, discovery→GA), evidence_008 (built REST/GraphQL APIs), evidence_020 (query/caching optimization), evidence_011 (feature discovery→launch) | Supported *as senior-engineer systems work* | ⚠️ A claim of formal **architecture/design leadership** is **uncertain** (see gap G6). Frame as engineering-level systems work, not "architect" title ownership. |
| **R2 — Reusable / modular components** | evidence_004 (shared React component libraries + state mgmt), evidence_021 (small TypeScript utility library) | Supported | Directly maps to "reusable tech bricks." |
| **R3 — Decay-resistant / maintainable systems** | evidence_020 (40% p95 latency reduction via query optimization + caching), evidence_017 (Jest/Playwright test suites), evidence_005 (schema design + migrations) | Supported | Maps to "stop technical entropy." |
| **R4 — Applied AI** | evidence_002 (**production** Claude API support-triage feature, −35% first-response time), evidence_016 (**personal / non-production** RAG→Slack bot) | Supported (with scope labels) | evidence_016 must be labelled personal/non-production; only evidence_002 is production applied AI. |
| **R5 — Digital foundations / infrastructure** | evidence_007 (AWS EC2/RDS/S3/Lambda, small team, no dedicated DevOps/SRE), evidence_012 (Docker) | Supported | ⚠️ Production **Kubernetes** / infra-at-scale leadership is **uncertain** (gap G1); only a personal minikube learning project exists (evidence_013). |
| **R6 — Public footprint (Portfolio + GitHub)** | evidence_021 (active public GitHub with OSS + personal repos) | Supported (existence only) | ⚠️ The actual **portfolio URL and GitHub username/handle are NOT in the evidence file** — candidate must provide (see Unresolved questions). |
| **Form: Full Name** | Profile field `name` = "Alex Mercier (fictional)" | Provided | Synthetic/fictional identity per file. |
| **Form: Years of Experience** | evidence_010 (Ferro 2019-04→2022-02) + evidence_001 (Northlight 2022-03→present); profile `years_experience` = "6" | Supported (range) | Continuous experience since 2019-04. Exact dropdown bucket unknown. |
| **Form: Primary Technical Expertise** | evidence_003 (TypeScript/Node.js), evidence_004 (React) | Supported | Dropdown option list unknown; candidate picks closest match. |
| **Form: Email** | — | Not provided | Candidate-only. |

---

## 6. Candidate fit & gaps

### Strong, supported fit
- **Full-stack engineering depth since 2019** (evidence_001, evidence_003, evidence_004, evidence_010) — TypeScript/Node.js + React across two companies.
- **Production applied AI** (evidence_002) — shipped a Claude-API support-triage feature that cut first-response time 35%. This is the strongest match to LSSM's "AI-accelerated era" / "learning architectures" framing.
- **Reusable/modular building** (evidence_004, evidence_021) — shared component libraries and a TypeScript utility library map cleanly to "reusable tech bricks."
- **Fighting technical entropy** (evidence_020, evidence_017, evidence_005) — measurable performance work, automated testing, and disciplined schema/migration work map to "decay-resistant systems."
- **End-to-end ownership + customer contact** (evidence_009, evidence_011, evidence_013-*no*, evidence_019) — discovery-to-production delivery and direct customer/founder collaboration, consistent with a small "architect network."
- **Cloud operation without a safety net** (evidence_007) — ran AWS services in a small team with no dedicated DevOps/SRE.

### Gaps / do-not-claim (explicitly blocked)
- **G1 — Production Kubernetes / infrastructure-at-scale leadership:** *uncertain.* Only a personal, non-production minikube learning project exists (evidence_013). Do **not** claim production K8s or leading infrastructure.
- **G2 — SOC 2 / security-certification ownership:** *unsupported.* No evidence. Do **not** claim.
- **G3 — Managing a team > 3 / direct reports:** *unsupported.* Only mentoring of **two** engineers is evidenced (evidence_014). Do **not** imply team management.
- **G4 — French-language fluency:** *unsupported.* No evidence. (Not requested by this posting; flagged only if a later step asks.)
- **G5 — Quota-carrying B2B SaaS sales:** *unsupported.* Candidate evidence is engineering/product, not sales. (Not requested by this posting.)
- **G6 — Formal product/design or architecture leadership:** *uncertain.* Evidence supports taking features from discovery to production **as an engineer** (evidence_001, evidence_011), not formal design/architecture leadership or visual/product-design ownership. Given the role's "architect" title, frame contributions at the engineering/systems level and mark any "architecture leadership" claim as uncertain.

---

## 7. Tailored application draft

### 7a. Proposed answers to the captured form fields

| Field | Proposed answer | Basis / status |
|---|---|---|
| **Full Name** | Alex Mercier | Profile field `name` (fictional/synthetic). |
| **Email** | *[CANDIDATE TO PROVIDE]* | Not in evidence file — candidate-only. |
| **Primary Technical Expertise** | *Full-stack software engineering (TypeScript / Node.js backend + React frontend), with applied-AI/LLM product work* | Supported by evidence_003, evidence_004, evidence_002. **Dropdown options unknown — candidate should select the closest available option and confirm.** |
| **Years of Experience** | ~6 years (continuous professional software engineering since 2019-04; likely falls in a "5–10 years" band) | Supported by evidence_010 + evidence_001; profile states "6". **Exact dropdown bucket unknown — candidate confirms.** |
| **Portfolio URL** | *[CANDIDATE TO PROVIDE]* | The file confirms an active public GitHub (evidence_021) but contains **no portfolio URL**. Candidate-only. |
| **GitHub Username** | *[CANDIDATE TO PROVIDE]* | evidence_021 confirms a public GitHub profile exists, but the **actual username/handle is not in the file**. Candidate-only. |

### 7b. Tailored narrative (for a cover-note field, a later form step, or outreach)

> *Uses only supported claims; tuned to LSSM's own vocabulary. All statements trace to evidence_ids in the claim map.*

I'm a full-stack software engineer who has spent the last ~6 years (since 2019) shipping products from discovery to general availability, most recently as a Senior Software Engineer at Northlight Labs leading full-stack feature development for a B2B SaaS analytics product (evidence_001). Your framing — *"move beyond features, build ecosystems"* — matches how I already try to work: three features I took from discovery to GA in a year contributed to a 22% rise in weekly active accounts (evidence_001).

On **reusable tech bricks**: I've built and maintained shared React component libraries with Redux/React Query state management (evidence_004) and I keep a small library of TypeScript utilities in the open (evidence_021) — reuse is a habit, not an afterthought.

On **decay-resistant systems / stopping technical entropy**: I cut p95 latency on a high-traffic analytics endpoint by 40% through query optimization and caching (evidence_020), I design schemas and migrations for production PostgreSQL (evidence_005), and I keep systems honest with Jest/Playwright test suites (evidence_017).

On **learning architectures for the AI-accelerated era**: I designed and shipped a **production** AI-assisted support-triage feature built on the Claude API for ticket summarization and routing, cutting average first-response time by 35% (evidence_002). Outside work, I've also built a personal, **non-production** retrieval-augmented-generation Slack bot for internal-docs search to keep learning in the space (evidence_016).

On **digital foundations**: I've deployed and operated services on AWS — EC2, RDS, S3, Lambda — as part of a small team with no dedicated DevOps/SRE function (evidence_007), and I use Docker for local dev and containerized internal services (evidence_012).

I work best close to users: I've supported enterprise pilot customers through onboarding with live troubleshooting and technical Q&A (evidence_009), gathered requirements with customer design partners to take a candidate-matching feature to launch (evidence_011), and collaborated cross-functionally with product, design, and customer success (evidence_019). I've also mentored two junior engineers on code review and onboarding (evidence_014). I hold a BSc in Computer Science from the University of Porto (evidence_015).

*Two honesty notes I want to keep straight with you:* my Kubernetes exposure is a personal learning project, not production (evidence_013), and my strengths are engineering and applied-AI product delivery rather than formal architecture-title leadership — I'd want to align on exactly what "architect" means in your team before overclaiming.

---

## 8. Unresolved candidate questions (only the candidate can answer)

1. **Email address** — required by the form; not in the evidence file.
2. **Portfolio URL** — required by the form; no portfolio URL in the file (a public GitHub exists per evidence_021, but no portfolio link).
3. **GitHub username/handle** — required by the form; evidence_021 confirms a public GitHub profile exists but does not include the actual handle/URL.
4. **Primary Technical Expertise (dropdown)** — confirm which provided option best matches "full-stack software engineering (TS/Node + React, applied AI)"; the option list wasn't visible.
5. **Years of Experience (dropdown)** — confirm the correct bucket (profile says 6; continuous since 2019-04).
6. **Meaning of "Architect"** — confirm whether the role expects formal architecture/design leadership; current evidence supports senior-engineer systems work, not formal design leadership (gap G6).
7. **Any later-step / hidden form fields** — the form shows steps 1–3 and a "Continue" button; fields beyond those captured are unknown and may include items only the candidate can answer.
8. **If later steps ask for salary expectation, work authorization, relocation, legal attestations, or demographic info** — these are **not** in the evidence file and must be answered by the candidate (see Limitations).

---

## 9. Limitations

- **Draft only — not submitted.** This pack does not authorize, trigger, or represent a submitted application. No callback, interview, offer, or outcome is implied.
- **Thematic requirements.** The posting states no explicit hard requirements; Section 3 requirements are inferred from the page's themes/vocabulary. No requirement or qualification was invented.
- **No claim beyond evidence.** Every application claim traces to a `supported` evidence_id. Items that are `uncertain`, `unsupported`, or scope-limited (production K8s, security-cert ownership, team management >3, formal architecture/design leadership, French fluency, sales) are blocked or scope-labelled per the evidence file's `known_capability_gaps`.
- **Personal / legally sensitive fields left for the candidate.** Salary expectation, work authorization, relocation preference, legal attestations, and demographic information are marked `not_provided` in the evidence file and are **not** inferred here. This posting's captured form does not request them; if a later step does, the candidate must answer.
- **Identity is synthetic.** "Alex Mercier" is a fictional evaluation profile (`candidate_synthetic_001`).
- **Form completeness.** Only fields present in the fetched page are addressed; later steps (if any) are unknown.
