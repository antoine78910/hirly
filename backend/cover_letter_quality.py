"""Cover letter prompt rules and quality checks for tailored applications."""

from __future__ import annotations

import re
from typing import Any, Dict, List


# Phrases that signal weakness or lack of fit — discouraged in generated letters.
WEAK_COVER_LETTER_PHRASES = (
    "je peux attester",
    "je peux me former rapidement",
    "former rapidement",
    "je suis pret a apprendre",
    "je suis prête à apprendre",
    "bien que je n'aie pas",
    "bien que je n'ai pas",
    "je n'ai pas encore d'experience",
    "je n'ai pas encore d'expérience",
    "sans experience directe",
    "sans expérience directe",
    "motivé à apprendre",
    "motivée à apprendre",
    "passionné par les nouvelles technologies",
    "passionnée par les nouvelles technologies",
    "candidature spontanée",
    "profil polyvalent",
    "dynamique et motivé",
    "dynamique et motivée",
)


def _job_keywords_blob(job: Dict[str, Any]) -> str:
    parts: List[str] = []
    for key in ("title", "description", "clean_description"):
        value = job.get(key)
        if value:
            parts.append(str(value))
    for item in job.get("requirements") or []:
        parts.append(str(item))
    for item in job.get("tech_stack") or []:
        parts.append(str(item))
    return " ".join(parts).lower()


def build_cover_letter_prompt_section(
    company_name: str,
    job_title: str,
    job: Dict[str, Any] | None = None,
) -> str:
    """Recruiter-facing cover letter rules injected into the application generation prompt."""
    tech_stack = job.get("tech_stack") or [] if job else []
    requirements = job.get("requirements") or [] if job else []
    tech_hint = ", ".join(str(item) for item in tech_stack[:12]) if tech_stack else "voir description et requirements"
    req_hint = "; ".join(str(item) for item in requirements[:8]) if requirements else "voir description"

    return f"""LETTRE DE MOTIVATION — REGLES OBLIGATOIRES (PRIORITE MAXIMALE)

La lettre doit convaincre un recruteur humain. Elle repond explicitement a cette question :
"Pourquoi le parcours de ce candidat est-il coherent avec le poste de {job_title} chez {company_name} ?"

REGLE #1 — LA PLUS IMPORTANTE
Explique TOUJOURS pourquoi le parcours actuel du candidat est coherent avec le poste vise,
surtout en cas de reconversion ou d'ecart entre le metier actuel et le poste cible.
Identifie les points de transfert credibles entre le CV et l'offre, par exemple :
analyse de donnees, volumes importants, automatisation, controle qualite, rigueur,
documentation, reporting, Excel avance, audit, conformite, scripting, SQL, Python, ETL.
Relie chaque pont au poste avec un exemple concret tire du CV (entreprise, mission, contexte).
Exemple de pont valide :
"Au cours de mes missions chez [entreprise du CV], j'ai analyse des volumes importants de donnees,
assure leur coherence et participe a la securisation des processus de controle. Cette experience m'a
donne une solide culture de la qualite des donnees et de l'analyse, des competences que je souhaite
mettre au service de projets d'ingenierie de donnees."

REGLE #2 — ANCRAGE DANS L'OFFRE
- Parle concretement du poste "{job_title}" et des exigences de l'offre.
- Cite au moins 3 competences, outils ou themes explicites de l'offre parmi :
  tech_stack={tech_hint} ; requirements={req_hint} ; description.
  (ex. Python, SQL, PySpark, Spark, ETL, Databricks, Data Factory, cloud, pipelines — selon l'offre)
- Si le candidat ne maitrise pas directement un outil de l'offre, montre la competence TRANSFERABLE
  la plus proche issue du CV, sans pretendre maitriser l'outil.
- N'affirme jamais une maitrise d'un outil, certification ou experience absents du CV.

REGLE #3 — PHRASE SPECIFIQUE A L'ENTREPRISE
- Inclure au moins une phrase dediee a {company_name} (secteur, type de projets, envergure,
  reputation, mission) qui ne pourrait pas s'appliquer identiquement a une autre entreprise.
  Exemple : "Rejoindre {company_name} represente pour moi l'opportunite de contribuer a des projets
  data d'envergure dans un environnement reconnu pour son expertise technologique."

REGLE #4 — STRUCTURE RECOMMANDEE (3 a 4 paragraphes)
1. Accroche : motivation pour "{job_title}" chez {company_name} + phrase entreprise specifique.
2. Pont parcours → poste : experiences du CV reliees aux exigences (donnees, volumes, qualite, rigueur…).
3. Alignement technique/metier : mots-cles de l'offre + preuves factuelles du CV.
4. Conclusion : disponibilite, contribution concrete, formule de politesse professionnelle.

INTERDIT
- Lettres generiques qui pourraient etre envoyees a n'importe quelle entreprise ou poste.
- Paragraphes qui ne mentionnent ni le poste, ni l'entreprise, ni les exigences cles de l'offre.
- Phrases qui suggerent un manque de competences : "je peux attester", "je peux me former rapidement",
  "je suis pret a apprendre", "bien que je n'aie pas d'experience en…", "sans experience directe".
- Inventer experience, diplome, certification ou maitrise d'outil absents du CV.

FORMAT
- Si cover_letter_reference est fourni dans le profil candidat, adapte le ton et la structure sans copier mot pour mot.
- Sinon, utilise le template french_formal (format lettre professionnelle francaise).
- Mentionne {company_name} dans au moins un paragraphe du corps.
- L'objet doit inclure le titre du poste et le nom de l'entreprise.
- Redige en francais sauf si l'offre est clairement redigee en anglais.
- Reste factuel : n'invente aucune experience, diplome ou competence absente du CV."""


def validate_cover_letter_quality(
    cover_letter: Dict[str, Any],
    job: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    """Lightweight quality report for generated cover letters."""
    paragraphs = cover_letter.get("paragraphs") or []
    body = " ".join(str(p) for p in paragraphs).lower()
    subject = str(cover_letter.get("subject") or "").lower()
    full_text = f"{subject} {body}"

    warnings: List[str] = []
    issues: List[str] = []

    if len(paragraphs) < 3:
        warnings.append("cover_letter_too_short")

    company = str((job or {}).get("company") or cover_letter.get("recipient_company") or "").strip()
    if company and company.casefold() not in full_text:
        warnings.append("company_not_mentioned_in_body")

    job_title = str((job or {}).get("title") or "").strip()
    if job_title:
        title_tokens = [token for token in re.split(r"\W+", job_title.lower()) if len(token) > 3]
        if title_tokens and not any(token in full_text for token in title_tokens[:3]):
            warnings.append("job_title_not_reflected")

    for phrase in WEAK_COVER_LETTER_PHRASES:
        if phrase in full_text:
            issues.append("weak_cover_letter_phrase")
            break

    if job:
        blob = _job_keywords_blob(job)
        tech_hits = sum(1 for item in (job.get("tech_stack") or []) if str(item).lower() in full_text)
        if (job.get("tech_stack") or []) and tech_hits == 0:
            warnings.append("job_tech_stack_not_reflected")

    status = "needs_review" if issues or len(warnings) >= 3 else "pass"
    if issues:
        status = "needs_review"

    return {
        "status": status,
        "issues": issues,
        "warnings": warnings,
        "paragraph_count": len(paragraphs),
    }
