# Programmatic SEO (pSEO) Rules (Hirly)

These rules define how to create **scalable, indexable landing pages** (programmatic SEO) without triggering duplicate/thin content issues.

## PROMPT SEO – HIRLY (App job matching)

You must follow this prompt when generating or rewriting any blog/article content for Hirly.

Tu es rédacteur SEO senior + copywriter tech/startup, spécialisé recherche d'emploi, recrutement, matching de carrière et outils RH.
Tu écris pour l'app Hirly.

🎯 Objectifs (ordre de priorité)

SEO : ranker sur une intention claire (informationnelle ou commerciale) avec un champ lexical riche et précis

Autorité : prouver l'expertise avec des éléments concrets (frameworks, checklists, comparaisons, chiffres, méthodes réelles)

Conversion : pousser à l'inscription subtilement, uniquement via des liens internes vers Hirly (jamais agressif)

### 1) Entrées possibles

Je peux te fournir :

Option A : un sujet / mot-clé / URL → tu crées tout de zéro

Option B : du contenu existant → tu réécris + améliores + enrichis (sans trahir le sens)

Si un champ est vide → tu le génères.
Tu peux exploiter une URL pour déduire le sujet + l'intention.

### 2) Contraintes structure (app / blog)

Le H1 existe déjà → ne jamais écrire de H1

Dans le contenu, utilise uniquement :

## pour H2

### pour H3

Minimum 5 sections H2

Paragraphes denses, utiles, actionnables (zéro remplissage)

### 3) SEO interne (NE PAS AFFICHER)

Avant d'écrire, tu définis en interne uniquement :

1 mot-clé principal

8–12 mots-clés secondaires

1 intention dominante : informationnelle + commerciale (mix naturel)

⚠️ Tu n'affiches jamais ces listes dans la sortie.

### 4) Autorité : "prouver" (OBLIGATOIRE)

Tu dois inclure au moins 2 éléments concrets parmi :

une checklist actionnable

un mini plan étape-par-étape

2–3 exemples réels (stacks, outils, workflows, profils candidats)

une section erreurs fréquentes + impacts réels

un mini plan d'action 7 jours (si pertinent)

### 5) Réputation / conformité (ultra critique)

❌ Interdits :

encourager / expliquer / normaliser des pratiques borderline ou illégitimes

promesses garanties ("tu trouveras un emploi en X jours")

formulations "arnaque / miracle"

Si le sujet touche à la recherche d'emploi :

tu parles de résultats comme conséquences (méthode, régularité, préparation, stack d'outils)

évite les promesses magiques → préfère
raccourcis douteux, méthodes bancales, au détriment de la crédibilité

✅ Modif obligatoire (anti-raccourcis)

Dans l'introduction (1er ou 2e paragraphe), ajoute 1 phrase courte rappelant que l'objectif est de maximiser ses chances sans raccourcis douteux et sans abîmer sa crédibilité, sans moraliser.

### 6) Liens & CTA (STRICT – app)

Je te fournis une liste de liens autorisés.

Règles non négociables

Exactement 2 liens dans l'article

1 lien au milieu (CTA soft)

1 lien dans la conclusion (CTA final)

Liens uniquement depuis la liste fournie

Aucune URL inventée

Aucun lien externe

Format Markdown uniquement :
[Texte d'ancre](URL)

❌ Interdits :

HTML

"clique ici"

"CTA", "CTA soft", "CTA final"

CTA = phrases naturelles, intégrées au texte, ton app sobre.

### 7) Règle blog interne (TRÈS STRICT)

❌ Interdiction totale de :

lier vers un autre article du blog

citer "un autre article"

proposer "article lié"

### 8) FAQ (OBLIGATOIRE)

Ajouter :

## FAQ

Avec 4 à 6 questions :

alignées recherches Google

objections avant inscription

réponses courtes, utiles, concrètes

### 9) Meta (ULTRA STRICT)

MetaTitle

Hirly ajoute automatiquement
| Hirly

👉 Tu écris le MetaTitle sans "Hirly"
Contrainte :

len(MetaTitle + " | Hirly") ≤ 70

MetaDescription

150–160 caractères EXACT

orientée clic + bénéfice

sans blabla

sans liste d'outils inutile

### 10) Style (anti-bullshit)

❌ Interdit :

phrases creuses

remplissage

répétitions

promesses irréalistes

✅ Style :

expert

clair

direct

crédible

app-native

### 11) Variabilité obligatoire (structure)

À chaque génération, tu choisis 1 modèle différent parmi :

Mythes → Réalité → Méthode → Exemples → Erreurs → FAQ

Diagnostic → Causes → Solutions → Mise en pratique → Mesure → FAQ

Étude de cas (réaliste) → Leçons → Framework → Checklist → FAQ

Guide étape par étape → Outils / repères → Variantes selon profil → Pièges → FAQ

Comparatif d'approches → Quand choisir quoi → Process → Checklist → FAQ

⚠️ Interdiction de répéter exactement le même enchaînement sur deux articles.

### 12) Input

Voici la liste de liens autorisés :
👉 (à remplacer par les liens Hirly)

Voici l'article / le sujet :
👉 [À fournir]

## Where pSEO lives in this repo

- Frontend: `frontend/src/`
- Marketing content examples:
  - Blog pages under `frontend/src/pages/Blog/` or similar
  - Landing pages (how-it-works, comparison pages, etc.)
  - Sitemap generation (static or server-side)

## Canonical + host rules (critical)

- The canonical host is **`https://hirly.app`**.
- Always set canonical to the clean URL path.
- Avoid indexable duplicates across hosts.

## URL structures (pSEO logic) — non‑negotiable

### Core principle

**URLs describe content for humans first, engines second.**
Target keywords do **not** need to exactly match the URL.

At scale, URLs must:

- communicate intent
- remain readable
- follow a predictable hierarchy
- scale without refactoring

### Keywords ≠ URLs (critical distinction)

- **Keywords** are query language.
- **URLs** are information architecture.

Exact match is optional. **Clarity is mandatory.**

### URL structure best practices (mandatory)

1. **Clean & readable**
   - lowercase only
   - hyphens `-` between words
   - no spaces/underscores/special chars
   - remove stop words when possible
   - remove promotional fluff

2. **Logical hierarchy**

Prefer a consistent hierarchy:

- `/category/subcategory/specific-page/`

Rules:

- consistent site‑wide
- scales linearly
- predictable patterns

3. **Include key identifiers only**

Encode only:

- main category
- defining attribute
- location (if relevant)
- specific entity (optional)

No extra adjectives.

4. **URL length**

- ideal: **< 60 characters**
- keep only essential words

### Common pSEO URL templates (Hirly context)

- **Job category based**: `/{job-category}/jobs/`
  - example: `/developer/jobs/`, `/marketing/jobs/`
- **Comparisons**: `/compare/{app1}-vs-{app2}/`
  - example: `/compare/hirly-vs-linkedin/`
- **How‑to**: `/how-to/{action}/{subject}/`
  - example: `/how-to/find/developer-jobs/`
- **Location based**: `/jobs/{location}/{category}/`
  - example: `/jobs/paris/developer/`
- **Use case**: `/for/{profile}/`
  - example: `/for/junior-developers/`, `/for/career-changers/`

### URL mistakes to avoid

- keyword stuffing in URL
- query params for core page types
- file extensions (`.php`, `.html`)
- opaque IDs (e.g. `?id=123`)

## pSEO page generation strategy

### Supported pSEO patterns

- **Dynamic routes** for large sets (recommended):
  - `/blog/[slug]`
  - `/jobs/[location]/[category]`, `/compare/[app-a]-vs-[app-b]` (examples)
- **Hybrid**: static routes for top pages + dynamic for long tail.

## Content templates (core pSEO concept)

Content templates are the cornerstone of programmatic SEO.

They provide the structure and framework for generating hundreds, or even thousands, of pages efficiently, all while maintaining consistency and relevance.

Think of them as blueprints — you design the structure once, and then populate it with different data to create unique pages. This is far more efficient than writing each page from scratch.

### Why are content templates crucial?

- **Scalability**: Enable rapid creation of a large volume of pages, targeting a vast array of long-tail keywords.
- **Consistency**: Ensure uniform structure, formatting, and SEO elements across all pages.
- **Efficiency**: Save significant time and resources compared to manual content creation.
- **Maintainability**: Easier to update and modify content across the entire site — change the template, and all pages using it are updated.

### Template structure

A well-designed template acts like a skeleton (structure), while data provides the "flesh".

It typically includes these key sections, each dynamically populated:

| Section | Description |
|---|---|
| 📝 Title Tag | Dynamically generated based on the page's specific focus (e.g., "[JOB_CATEGORY] jobs in [CITY]"). |
| 📑 Meta Description | Unique description tailored to the page's content, including a call to action. |
| 📚 H1 Heading | The main heading, usually reflecting the primary keyword phrase. |
| 🚀 Introduction | A brief overview of the topic, engaging the user and setting the context. Must be varied across pages to avoid duplication. |
| 🧩 Main Content Sections (H2, H3) | The core of the page, providing detailed information, comparisons, or data. Modular, allowing flexibility and reuse. |
| 📊 Images / Tables / Charts | Optional. Present data in an easily digestible format; can be dynamically generated. |
| 📞 Call to Action (CTA) | Encourage a specific action (e.g., "Find jobs now", "Try Hirly for free"). A/B test CTAs. |
| 🔗 Related Links | Internal links to other relevant pages, generated from semantic relationships. |

### Fixed elements vs dynamic placeholders

**Fixed elements** (consistent parts):

- Overall page layout
- Section headings
- Navigation elements

**Dynamic placeholders** (variable content that makes each page unique):

- Job category
- Location
- Profile type
- Data-driven content

### Using placeholders

Placeholders are special tags that get replaced with actual data when the page is generated.

Example:

```html
<h1>Best [JOB_CATEGORY] Jobs in [CITY]</h1>

<p>
  Looking for [JOB_CATEGORY] jobs in [CITY]? Hirly matches you to the best offers
  and handles your application automatically.
</p>

<h2>How Hirly works for [JOB_CATEGORY] roles</h2>

<ul>
  <li>Swipe on curated [JOB_CATEGORY] opportunities</li>
  <li>Hirly builds your tailored application in seconds</li>
  <li>One tap to submit directly to the ATS</li>
</ul>
```

⚠️ **Choose meaningful placeholder names**

Use descriptive placeholder names that clearly indicate the type of data they represent (e.g., `[JOB_CATEGORY]` instead of `[VALUE_1]`).

### Content variation (mandatory)

Templates provide consistency, but you must introduce variation to avoid duplicate content.

Rule of thumb:

- Aim for **60–70% unique text**
- Use placeholders for the variable data

Strategies:

- **Different introductory paragraphs**: Create several intro variations, choose one per page (human-reviewed).
- **Alternative phrasing**: Vary sentence structure; avoid robotic synonym swaps.
- **Varying order**: Randomize item order when listing.
- **Unique data combinations**: Fundamental — each page must combine data in a unique way.
- **Dynamic sections**: Include optional sections based on data availability.

### Template examples (simplified)

**1) Location-based job template**

```html
<h1>[JOB_CATEGORY] Jobs in [CITY]</h1>
<p>Find the best [JOB_CATEGORY] jobs in [CITY]. Hirly matches your profile and handles the application.</p>
<h2>Why Hirly for [JOB_CATEGORY] in [CITY]</h2>
<ul>
  <li>Curated [JOB_CATEGORY] offers updated daily</li>
  <li>AI-tailored application for each role</li>
  <li>Direct ATS submission (Greenhouse, Lever)</li>
</ul>
<a href="/signup">Start matching [JOB_CATEGORY] jobs in [CITY]</a>
```

**2) Profile-based template**

```html
<h1>Hirly for [PROFILE_TYPE]</h1>
<p>Are you a [PROFILE_TYPE] looking for the right opportunity? Hirly matches your profile to jobs that fit.</p>
<h2>What Hirly does for [PROFILE_TYPE]</h2>
<table>
  <tr><th>Feature</th><th>How it helps [PROFILE_TYPE]</th></tr>
  <tr><td>Swipe feed</td><td>Curated jobs matching [PROFILE_TYPE] skills</td></tr>
  <tr><td>AI application</td><td>Tailored CV + cover letter in seconds</td></tr>
  <tr><td>ATS submission</td><td>Direct apply to [PROFILE_TYPE] target companies</td></tr>
</table>
<a href="/signup">Try Hirly as a [PROFILE_TYPE]</a>
```

**3) Comparison template**

```html
<h1>Hirly vs [COMPETITOR]: Which is Better for Job Seekers?</h1>
<p>Comparing Hirly and [COMPETITOR]? We've analyzed their features and workflow to help you decide.</p>
<h2>Hirly vs [COMPETITOR] - Feature Comparison</h2>
<table>
  <tr><th>Feature</th><th>Hirly</th><th>[COMPETITOR]</th></tr>
  <tr><td>Job matching</td><td>[HIRLY_MATCHING]</td><td>[COMPETITOR_MATCHING]</td></tr>
  <tr><td>Auto-application</td><td>[HIRLY_AUTO]</td><td>[COMPETITOR_AUTO]</td></tr>
  <tr><td>ATS integration</td><td>[HIRLY_ATS]</td><td>[COMPETITOR_ATS]</td></tr>
</table>
<p>Our recommendation: [RECOMMENDATION]</p>
```

## Finding and using data for your pages

### 1) Internal data (first and best source)

Internal data is data you already possess or collect as part of your operations:

- Job categories and sectors available in the app
- Supported cities/locations
- User profiles (anonymized — never expose PII)
- ATS integrations list (Greenhouse, Lever)
- Feature list (swipe, AI application, auto-submit)

Advantages:

- **Accuracy** (you control it)
- **Relevance** (tied to your product/market)
- **Cost** (already owned)
- **Exclusivity** (competitive edge)

### 2) External APIs (third-party data)

APIs allow retrieving structured data from external services:

- Job data: JSearch, Greenhouse, Lever (already integrated)
- Location: Google Maps / OSM Nominatim (already integrated)
- Salary benchmarks: Glassdoor API, levels.fyi
- Hiring trends: LinkedIn, Stack Overflow Developer Survey

⚠️ **API considerations**

- Cost (usage-based pricing)
- Rate limits (implement retry/backoff)
- Terms of Service compliance
- Data reliability & availability monitoring

### Data cleaning and transformation (mandatory)

Raw data almost always needs cleaning:

- Handle missing values (drop, impute, leave blank)
- Remove duplicates
- Correct errors/typos
- Standardize formats (job titles, locations, salary ranges)

### Data validation (mandatory)

Bad data creates bad pages at scale.

- Sanity checks (empty job categories, invalid locations, outliers)
- Cross-reference between sources
- Automated tests (types/ranges/consistency)
- Periodic manual review of samples

## Automating content creation

### 1) Scripting (Python example)

```python
data = [
    {"city": "Paris", "job_category": "Developer", "url_slug": "developer-paris"},
    {"city": "Lyon", "job_category": "Marketing", "url_slug": "marketing-lyon"},
]

template = """
---
title: "{job_category} Jobs in {city} | Hirly"
description: "Find the best {job_category} jobs in {city}. Hirly matches your profile and handles applications automatically."
---

<h1>{job_category} Jobs in {city}</h1>
<p>Discover curated {job_category} opportunities in {city} and apply in one tap with Hirly.</p>
<a href="/signup">Start matching {job_category} jobs in {city}</a>
"""

for item in data:
    page_content = template.format(**item)
    filename = f"{item['url_slug']}.mdx"
    with open(f"pages/jobs/{filename}", "w") as f:
        f.write(page_content)
```

Real-world scripts must include:

- Error handling (missing data, invalid values, network issues)
- Rate limiting (APIs)
- Data cleaning/transforms integrated
- Templating engine (e.g., Jinja2) for conditionals/loops
- Logging and configuration management
- Automated deployment
- Incremental updates (only regenerate affected pages)

### Scaling considerations

- Server resources (SSG recommended for large pSEO sets)
- API rate limits
- Processing time (batching, scheduling, queues)
- Incremental updates instead of full rebuilds

### Quality control (non-negotiable)

- Review a representative sample (data accuracy, formatting, readability, links)
- Automated checks (broken links, HTML validity, duplication signals)
- Human editing for high-value pages

### Content uniqueness rules (avoid thin/duplicate pages)

Each pSEO URL must have:

- A unique **H1** including the long‑tail keyword
- A unique first paragraph (no templated identical intros)
- At least **2–3 unique sections** derived from the entity data
  - e.g. "Best for…", "How it works", "Available jobs", "FAQ", "Alternatives"
- Internal links to:
  - parent hub page
  - 2–6 related entities (same category, same intent)

Do **not** generate near‑identical pages that only swap one token.

## Metadata rules (SEO basics)

For every pSEO page:

- `title`: includes keyword + brand (Hirly)
- `description`: includes keyword, benefit, and differentiator
- `canonical`: correct clean URL
- OpenGraph:
  - correct `url`
  - image with `alt`
- Robots:
  - default index/follow for real pages
  - set `index: false` for:
    - search result pages (e.g. `/jobs?q=…`)
    - parameterized duplicates (`?sort=`, `?page=` if not canonicalized)

## Structured data rules for pSEO

- Always add JSON‑LD on entity pages:
  - Blog post: `Article`
  - Landing pages: `WebApplication` or `SoftwareApplication`
  - Job listing hubs: `JobPosting` (only if real listings)
  - FAQ sections: `FAQPage`
  - Comparisons: consider `ItemList` only if data is real

All JSON‑LD must use `https://hirly.app` for absolute IDs/URLs.

## Ensuring Content Uniqueness at Scale

### 1) Spinning (Strongly Discouraged)

Content spinning is strongly discouraged.

- Poor Quality: Spun content almost always suffers from poor readability.
- Google Penalties: Google's algorithms detect low-quality, spun content.
- Fails to add value.

### 2) Data-Driven Uniqueness: The Foundation of Good pSEO

By leveraging unique combinations of data, you create pages that are inherently different.

**Unique Data Combinations:**

- Job pages: unique city + category + seniority combinations
- Profile pages: unique profile type + sector + use case
- Comparison pages: unique competitor + differentiator combination

**Dynamic Content Sections:** Include sections in your template that are populated with different content based on the page's specific focus.

### 3) Long-Tail Keyword Targeting: Naturally Unique

Instead of: "jobs"

Target:

- "best developer jobs in Paris without mass-applying"
- "how to find a marketing job without LinkedIn"
- "job matching app for career changers under 30"

### 4) Regular Audits: Maintaining Uniqueness Over Time

**Tools:**

- SEMrush / Ahrefs: Site Audit for duplicate content
- Siteliner: free duplicate content scanner
- Google Search Console: Coverage report for indexing issues

**Process:**

- Run regular scans (monthly or quarterly)
- Identify pages with significant content overlap
- Take action:
  - Rewrite the content to make it more unique
  - Add more data or unique information
  - Combine similar pages into a single, more comprehensive page (and use 301 redirects)
  - Noindex the page if it's not essential for SEO

## Indexation + discovery rules

- Every pSEO URL must be discoverable via:
  - **Sitemap**: must include the full set (or at least the important subset)
  - **Internal links**: add HTML links from:
    - hub pages (category indexes)
    - footer (high‑level hubs like `/blog`, `/jobs`, `/compare`)

If GSC says "No referring sitemap detected" / "No referring page detected", treat it as a discovery failure:

- Add it to sitemap
- Add 2–3 internal links from already indexed pages

## Pagination + faceted navigation

- Avoid indexation of faceted duplicates:
  - example: `/jobs?q=keyword` should be `noindex`
- For paginated lists:
  - Canonicalize to the main listing page

## Technical URL implementation rules (server‑side)

### URL rewriting / normalization

- enforce clean URLs server‑side
- normalize trailing slashes consistently
- avoid indexable param variants (tracking params, filters, PPC tags)

### Redirects

- use **301** for permanent redirects
- handle variations (www/non‑www, http/https, legacy paths)
- avoid redirect chains

### Canonicals (reminder)

- canonical must match the final clean URL
- prevent duplication from:
  - tracking params
  - filters
  - pagination
  - PPC tags

## Performance rules (pSEO scale)

pSEO multiplies pages, so performance must be consistent:

- Keep pages as lightweight as possible (avoid heavy JS for marketing content).
- Load analytics lazily.
- Don't autoplay large media.
- Use caching / `revalidate` appropriately for dynamic content.

## Implementation checklist (for any new pSEO route)

- URL is:
  - clean (lowercase, hyphens, no params)
  - readable and intent‑driven (no stuffing)
  - hierarchical and scalable
- Keyword included in: title + meta description + H1 + first sentence (URL does not require exact match)
- Canonical path set
- JSON‑LD added (Article/FAQ/WebApplication etc.)
- Internal links added (hub + related)
- Included in sitemap
- `robots.txt` still allows indexing
- Build passes: `npm run build` in `frontend/`

## Advanced pSEO techniques (safe use)

### Dynamic content (controlled)

Dynamic ≠ random.

Allowed personalization (only if server‑side and factual):

- location
- date/year
- data freshness
- job category

Do not:

- change the core meaning
- hide critical content behind JS only
- generate infinite combinations

### PPC × pSEO synergy

Use PPC to:

- identify high‑converting modifiers
- validate intent
- feed pSEO templates

Use pSEO to:

- improve PPC Quality Score
- reduce CPC
- scale high‑intent landing pages

### Content freshness at scale

Approved freshness levers:

- update job datasets
- refresh dates where relevant
- add new job categories / locations
- update comparisons

Never fake freshness.

### AI for uniqueness (assistant, not publisher)

AI may be used to:

- vary intros/outros
- rephrase sections
- generate unique metas
- avoid template repetition

Rules:

- semantic meaning must remain
- factual accuracy mandatory
- human review required
- brand voice consistency

## Final URL & page contract (summary)

Every programmatic page MUST satisfy:

- **URL**: clean, readable, hierarchical, canonicalized, scalable
- **Page**: unique title, unique meta description, one H1, logical H2/H3, correct canonical, indexable, internally linked

## Updated Cursor master directive

Act strictly as the **Programmatic SEO Agent** for Hirly.
For every generated URL and page:

- prioritize **user intent** over keyword match
- enforce **clean, hierarchical URLs**
- validate **canonical correctness**
- avoid keyword stuffing
- ensure scalability

Reject any output that violates these rules.
