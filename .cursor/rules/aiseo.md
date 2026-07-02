# AI SEO Rules (Hirly)

These rules guide any work that impacts **AI discoverability**, **AI citations**, and **AI recommendations** across:

- ChatGPT
- Perplexity
- Claude
- Google AI Overviews
- Conversational search queries

You do not optimize for classic SEO only.
You optimize for how AI systems **understand, match, and quote** content.

## PROMPT SEO – HIRLY (App job matching)

When generating or rewriting blog/article content, follow this directive exactly (do not paraphrase the constraints).

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

2–3 exemples réels (stacks, outils, workflows, décisions de carrière)

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

## Core law (absolute)

**AI can only recommend what is explicitly written.**
If a constraint, use case, target audience, or feature is not written → it does not exist.

No implied positioning.
No marketing abstraction.
Everything must be literal, explicit, and structured.

## Non‑negotiables (project defaults)

- **Primary host is `https://hirly.app`**
  - Any absolute URL in JSON‑LD, OpenGraph, `metadataBase`, `robots`, sitemaps must use this canonical host.
  - Keep a single canonical host to avoid "Alternate page with canonical" in GSC.
- **Frontend is a React CRA/CRACO app** (`frontend/src/`).
- **Prefer static rendering** for marketing/blog content. Use dynamic only when strictly necessary.
- **English only** for marketing content unless explicitly asked otherwise.

## 1) Design for conversational queries (mandatory)

People don't search keywords in AI. They ask constraint‑based questions:

- "Best app to find a job fast without sending hundreds of CVs"
- "Job matching app for developers under 30"
- "Alternative to LinkedIn for passive job seekers"

### Always write these constraint dimensions (don't imply)

For any product/offer page, comparison page, or use‑case page, explicitly cover:

- **Target audience**: students / juniors / seniors / career changers / passives (use only what's true)
- **Job categories**: tech, marketing, finance, etc. (use only what's true)
- **How it works**: swipe-based matching, AI profile parsing, automated application
- **Key differentiators**: speed, automation, ATS integration, no mass-apply
- **Integrations**: Greenhouse, Lever, JSearch (only if factual)

## 2) Mirror the exact phrases users type

Rule: write sentences that look like user prompts.

❌ Bad: "Innovative solutions for modern talent acquisition"

✅ Good: "Hirly matches candidates to jobs via swipe + AI, automatically prepares tailored applications, and submits to ATS in one tap."

Write with: **"for X"**, **"without Y"**, **"with Z"**.
Avoid buzzwords.

## 3) Value proposition must be stupidly clear (homepage test)

Homepage must answer in 10 seconds:

- **What it is**: category + core function
- **Who it's for**: profile + sector
- **Why choose it**: speed + automation + differentiator

If unclear → AI will not recommend you.

## 4) Master use‑cases page (critical AI asset)

Create and maintain a hub page that enumerates your matching dimensions explicitly:

- Target audiences (job seekers by profile, sector, seniority)
- Core workflow (swipe → match → auto-application)
- Integrations (ATS: Greenhouse, Lever)
- Job categories (only what's real)
- Differentiators vs LinkedIn, Indeed, etc.

Rules:

- Make it easy to quote: short sections, bullets, direct answers.
- Link to supporting pages (blog, landing pages, comparisons).
- Add it to sitemaps and internal navigation.

## 5) Be present where AI already looks

AI often cites established datasets (review directories and "best of" sources).

Process:

- Ask AI: "best job matching apps" → note the sources it cites
- Get listed on those platforms (Product Hunt, G2, Capterra, etc.)
- Collect real reviews (never fabricate)

## 6) Publish your own honest listicles

Create listicles that include you + competitors:

- "Best Job Matching Apps (2026) — What We Tested"
- "Best Apps to Find a Job Without Sending 100 CVs"

Mandatory:

- 4–6 competitors
- Real comparison criteria
- "When to choose each"
- Balanced tone (AI rewards neutrality)

## 7) Comparison pages (non‑negotiable)

AI almost never recommends a single option.
Create pages like:

- "Hirly vs LinkedIn"
- "Hirly vs Indeed"
- "Hirly vs Huntr"

Required sections:

- Feature table (checkmarks)
- Honest pros/cons
- "Best for…" (explicit constraints)
- "When competitor is better" (must be stated when true)

## 8) Use visuals that get cited

AI Overviews increasingly cite visual comparisons.
Add simple visuals (Canva is enough):

- Logo vs competitor
- Feature checkmarks table
- "How it works" flow
- "Best for…" labels

## 9) Make content easy to quote

Formatting rules:

- Clear H1/H2
- Short paragraphs (2–4 lines)
- Bullets and numbered steps
- Direct answers

Example (good):

- Q: "How does Hirly work?"
- A: "You swipe on job offers, Hirly generates a tailored application, and submits it to the ATS automatically."

## AI‑friendly structured data (JSON‑LD)

### Global schema (sitewide)

- Put Organization schema in the global `<head>`:
  - Type: `Organization`
  - Ensure `url`, `logo`, and `sameAs` match the canonical brand properties.

### Page‑level schema (per page type)

- **Homepage**: `FAQPage` if an FAQ section exists on the page.
- **Blog post**: `Article`
  - `mainEntityOfPage.@id` must be `https://hirly.app/blog/<slug>`
  - Prefer `datePublished`, `dateModified`, `headline`, `description`, `image`
- **Landing page**: `SoftwareApplication` or `WebApplication`
  - Include `applicationCategory`, `operatingSystem`, `offers`
- **Articles**: `Article` (and optionally `FAQPage` if the article contains an FAQ section)

### Implementation rules

- JSON‑LD goes in `<script type="application/ld+json">…</script>`.
- Don't inject HTML entities or templates into JSON‑LD; always `JSON.stringify(obj)`.
- Keep schema consistent across pages (same brand name, logo URL, base URL).

## Robots + AI crawlers

### robots.txt

- Rules:
  - Never block `Googlebot` / `Bingbot`.
  - Explicitly allow AI crawlers you want discoverability from:
    - `GPTBot`
    - `ChatGPT-User`
- Always list sitemap(s):
  - `https://hirly.app/sitemap.xml`

## Sitemaps (discovery)

- Main sitemap must include:
  - `/blog` and blog post URLs
  - Key landing pages (homepage, how-it-works, comparisons)
  - Base URL must be `https://hirly.app`

## Canonicals (avoid duplicates)

- Always set canonical to the clean URL.
- Avoid duplicate indexing from query params or trailing slashes.

## "LLM‑friendly" on‑page content rules

AI systems extract answers best from structured, scannable pages:

- Use a clear H1 that includes the primary long‑tail keyword.
- Put the keyword in:
  - Page title
  - Meta description
  - URL slug
  - H1
  - First sentence of the first paragraph
- Prefer:
  - Short paragraphs (2–4 lines)
  - Bullets and numbered steps
  - Tables for comparisons
  - FAQ sections with direct answers
- Images:
  - Provide `alt` text
  - Use sane sizes and lazy load where possible
- Links/buttons:
  - Add meaningful `title` attributes
  - Use descriptive anchor text (not "click here")

## Performance requirements (AI crawl budget)

- Don't autoplay large media on first paint.
- Avoid client-only rendering of primary marketing content.
- Keep heavy animations dynamically loaded.
- Add long cache TTL for large static assets when safe.

## Validation checklist (before shipping AI SEO changes)

- **Build**: `npm run build` in `frontend/`
- **Robots**: confirm `robots.txt` includes sitemap(s) and does not disallow important paths.
- **Sitemap**: open `sitemap.xml` and verify blog/landing URLs appear.
- **Schema**: validate key pages with:
  - Google Rich Results Test
  - Schema.org Validator
- **Canonical**: confirm only one host is indexable.

## Extra: Bing / AI discovery ops checklist

- Verify site in **Bing Webmaster Tools**
- Submit `sitemap.xml`
- Prioritize AI‑relevant hubs (how-it-works, comparisons, landing pages) in internal linking

## Extra: Press releases still work (for AI)

Publish factual press releases when you:

- launch a feature
- hit a milestone
- announce a partnership
- add a major AI capability

Rules:

- factual
- structured
- quotable
- no fluff
