"""Generate AI-tailored CV previews from a local CV and a feed-style job.

This script uses the same LLM extraction and application-generation functions
as the backend. It intentionally fails when OPENAI_API_KEY is missing so a
manual fixture is never mistaken for AI output.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import html
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from application_documents import build_application_package
from llm_client import LLMProviderNotConfigured
from server import (
    User,
    _build_generated_application_doc,
    _build_profile_intelligence,
    claude_generate_application,
    claude_extract_profile,
    extract_cv_text_from_upload,
)


EDGE_PATHS = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)

PDF_THEMES = {
    "modern_pro": {"label": "Modern Pro", "accent": "#245f92", "bg": "#f7fafc", "mode": "band"},
    "luxe_minimal": {"label": "Luxe Minimal", "accent": "#75614a", "bg": "#fcfbf8", "mode": "luxe"},
    "blue_split": {"label": "Blue Split", "accent": "#16467a", "bg": "#f7fbff", "mode": "split"},
}


FEED_STYLE_JOB = {
    "job_id": "demo_job_stripe_account_executive",
    "title": "Account Executive, Enterprise (Hunter)",
    "company": "Stripe",
    "location": "Paris, France",
    "remote": "hybrid",
    "ats_provider": "greenhouse",
    "provider": "demo_feed",
    "tech_stack": ["Salesforce", "CRM", "Payments"],
    "requirements": [
        "Enterprise prospecting and outbound pipeline generation",
        "Account research and territory planning",
        "Discovery conversations with senior stakeholders",
        "Consultative selling and clear commercial communication",
        "CRM hygiene and sales process discipline",
        "French and English business fluency",
        "Interest in payments, fintech, and digital commerce",
    ],
    "description": (
        "Stripe is looking for an Account Executive, Enterprise (Hunter) to build outbound pipeline, "
        "research strategic accounts, run discovery conversations, and communicate Stripe's value to "
        "commercial and product stakeholders. The role requires strong prospecting discipline, CRM hygiene, "
        "clear written and verbal communication in French and English, and interest in payments, fintech, "
        "digital commerce, and helping companies grow online."
    ),
    "clean_description": (
        "Stripe is looking for an Account Executive, Enterprise (Hunter) to build outbound pipeline, "
        "research strategic accounts, run discovery conversations, and communicate Stripe's value to "
        "commercial and product stakeholders. The role requires strong prospecting discipline, CRM hygiene, "
        "clear written and verbal communication in French and English, and interest in payments, fintech, "
        "digital commerce, and helping companies grow online."
    ),
}


def _edge_path() -> Path:
    for path in EDGE_PATHS:
        if path.exists():
            return path
    raise RuntimeError("Microsoft Edge was not found.")


def _esc(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def _tags(items: list[str]) -> str:
    return "".join(f"<span>{_esc(item)}</span>" for item in items if str(item or "").strip())


def _section(title: str, body: str) -> str:
    return f"<section class='section'><h2>{_esc(title)}</h2>{body}</section>"


def _experience_html(experience: list[dict]) -> str:
    blocks = []
    for item in experience:
        bullets = "".join(f"<li>{_esc(bullet)}</li>" for bullet in item.get("highlights") or [])
        blocks.append(
            f"""
            <section class="experience-item">
              <div class="item-head">
                <div>
                  <h3>{_esc(item.get("role"))}</h3>
                  <p>{_esc(item.get("company"))} - {_esc(item.get("location"))}</p>
                </div>
                <strong>{_esc(item.get("duration"))}</strong>
              </div>
              <ul>{bullets}</ul>
            </section>
            """
        )
    return "\n".join(blocks)


def _education_html(education: list[dict]) -> str:
    lines = []
    for item in education:
        parts = [item.get("degree"), item.get("school"), item.get("year")]
        line = " - ".join(str(part) for part in parts if part)
        if line:
            lines.append(f"<li>{_esc(line)}</li>")
    return "<ul>" + "".join(lines) + "</ul>" if lines else ""


def _resume_pdf_html(resume: dict, job: dict, theme_name: str) -> str:
    theme = PDF_THEMES[theme_name]
    contact = resume.get("contact") or {}
    name = contact.get("name") or "Candidate"
    contact_line = " | ".join(
        str(value)
        for value in (
            contact.get("email"),
            contact.get("phone"),
            contact.get("location"),
            contact.get("linkedin"),
            contact.get("website"),
        )
        if value
    )
    core = (
        _section("Target Role", f"<p>{_esc(job.get('title'))} - {_esc(job.get('company'))}, {_esc(job.get('location'))}</p>")
        + _section("Professional Summary", f"<p>{_esc(resume.get('summary'))}</p>")
        + _section("Relevant Focus", f"<div class='skills'>{_tags(resume.get('role_keywords') or [])}</div>")
        + _section("Core Skills", f"<div class='skills'>{_tags(resume.get('skills') or [])}</div>")
        + _section("Professional Experience", _experience_html(resume.get("experience") or []))
        + _section("Languages", f"<div class='skills languages'>{_tags(resume.get('languages') or [])}</div>")
        + _section("Education", _education_html(resume.get("education") or []))
    )
    if theme["mode"] == "split":
        body = f"""
        <main class="page split">
          <aside>
            <p class="eyebrow">AI Tailored Resume</p>
            <h1>{_esc(name)}</h1>
            <p class="headline">{_esc(resume.get("headline"))}</p>
            <div class="contact"><p>{_esc(contact_line)}</p></div>
          </aside>
          <article>{core}</article>
        </main>
        """
    else:
        body = f"""
        <main class="page {theme["mode"]}">
          <header>
            <p class="eyebrow">AI Tailored Resume</p>
            <h1>{_esc(name)}</h1>
            <p class="headline">{_esc(resume.get("headline"))}</p>
            <p class="contact">{_esc(contact_line)}</p>
          </header>
          {core}
        </main>
        """
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>{_esc(theme['label'])}</title>
<style>
@page {{ size: A4; margin: 0; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: {theme['bg']}; color: #171717; font-family: "Aptos", "Segoe UI", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
.page {{ width: 210mm; min-height: 297mm; padding: 16mm 18mm; background: {theme['bg']}; }}
header {{ border-bottom: 1.6px solid {theme['accent']}; padding-bottom: 7px; margin-bottom: 10px; }}
.eyebrow {{ margin: 0 0 4px; text-transform: uppercase; letter-spacing: .12em; font-size: 8px; color: {theme['accent']}; font-weight: 800; }}
h1 {{ margin: 0; font-size: 27px; line-height: 1.03; }}
.headline {{ margin: 5px 0 0; color: {theme['accent']}; font-weight: 700; font-size: 10.8px; }}
.contact {{ margin: 6px 0 0; color: #56616b; font-size: 8.8px; }}
.section {{ margin-top: 8px; }}
h2 {{ margin: 0 0 4px; font-size: 9.6px; text-transform: uppercase; letter-spacing: .09em; color: {theme['accent']}; border-bottom: .8px solid rgba(0,0,0,.14); padding-bottom: 2px; }}
p {{ margin: 0; font-size: 8.9px; line-height: 1.25; }}
.skills {{ display: flex; flex-wrap: wrap; gap: 4px; }}
.skills span {{ border: .8px solid rgba(0,0,0,.16); border-radius: 999px; padding: 2.5px 6px; font-size: 8px; background: rgba(255,255,255,.75); }}
.experience-item {{ margin-top: 6px; break-inside: avoid; }}
.item-head {{ display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }}
h3 {{ margin: 0; font-size: 9.5px; line-height: 1.12; }}
.item-head p {{ margin-top: 1px; color: #56616b; font-size: 8.1px; }}
.item-head strong {{ color: #56616b; font-size: 8px; white-space: nowrap; }}
ul {{ margin: 3px 0 0 13px; padding: 0; }}
li {{ margin: 0 0 1.8px; font-size: 8.25px; line-height: 1.2; }}
.band header {{ background: #ffffff; margin: -4mm -4mm 10px; padding: 7mm 4mm 5mm; border-radius: 10px; border-bottom: 0; box-shadow: 0 8px 24px rgba(26, 61, 91, .08); }}
.luxe header {{ text-align: center; border-bottom: 0; }}
.luxe header:after {{ content: ""; display: block; width: 42mm; height: 1.4px; background: {theme['accent']}; margin: 8px auto 0; }}
.split {{ display: grid; grid-template-columns: 55mm 1fr; gap: 10mm; padding: 0; background: white; }}
.split aside {{ min-height: 297mm; background: {theme['accent']}; color: white; padding: 16mm 7mm; }}
.split aside .eyebrow, .split aside .headline, .split aside .contact {{ color: white; }}
.split aside h1 {{ font-size: 23px; }}
.split aside .contact p {{ margin-top: 7px; overflow-wrap: anywhere; }}
.split article {{ padding: 15mm 14mm 12mm 0; }}
</style></head><body>{body}</body></html>"""


def _export_pdf_previews(resume: dict, job: dict, output_dir: Path) -> list[Path]:
    edge = _edge_path()
    exported: list[Path] = []
    for theme_name in PDF_THEMES:
        html_path = output_dir / f"hirly_ai_{theme_name}_tailored_younes.html"
        pdf_path = output_dir / f"hirly_ai_{theme_name}_tailored_younes.pdf"
        html_path.write_text(_resume_pdf_html(resume, job, theme_name), encoding="utf-8")
        subprocess.run(
            [
                str(edge),
                "--headless",
                "--disable-gpu",
                f"--print-to-pdf={pdf_path}",
                "--no-pdf-header-footer",
                html_path.resolve().as_uri(),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        try:
            html_path.unlink()
        except OSError:
            pass
        exported.append(pdf_path)
    return exported


async def generate(cv_path: Path, output_dir: Path) -> Path:
    if not os.environ.get("OPENAI_API_KEY"):
        raise LLMProviderNotConfigured("OPENAI_API_KEY is required for a real AI tailoring preview.")

    content = cv_path.read_bytes()
    cv_text = await extract_cv_text_from_upload(cv_path.name, content)
    extracted = await claude_extract_profile(cv_text)
    intelligence = _build_profile_intelligence(extracted, cv_text)
    contact = intelligence.get("contact") or extracted.get("contact") or {}
    contact["email"] = "oudrhiriyouneslfim@gmail.com"
    profile = {
        "user_id": "preview_younes",
        "cv_text": cv_text,
        "cv_filename": cv_path.name,
        "cv_mime": "application/pdf" if cv_path.suffix.lower() == ".pdf" else "application/octet-stream",
        "cv_original_b64": base64.b64encode(content).decode("ascii"),
        "contact": contact,
        "summary": extracted.get("summary", ""),
        "skills": intelligence.get("skills") or extracted.get("skills", []),
        "languages": extracted.get("languages", []),
        "experience": extracted.get("experience", []),
        "education": intelligence.get("education") or extracted.get("education", []),
        "target_role": "Account Executive",
        "target_roles": ["Account Executive", "Business Development", "Sales Development"],
        "template_style": extracted.get("template_style", "modern"),
    }
    user = User(user_id="preview_younes", email="oudrhiriyouneslfim@gmail.com", name=contact.get("name") or "Younes Oudrhiri")
    generated = await claude_generate_application(profile, FEED_STYLE_JOB)
    app_doc = _build_generated_application_doc(user, profile, FEED_STYLE_JOB, generated)
    if not app_doc.get("tailored_cv_file_b64"):
        raise RuntimeError(f"AI generation did not produce a CV file: {app_doc.get('generation_error')}")

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / "hirly_ai_tailored_younes_stripe_account_executive.docx"
    out_path.write_bytes(base64.b64decode(app_doc["tailored_cv_file_b64"]))
    app_json = {
        key: value
        for key, value in app_doc.items()
        if key not in {"tailored_cv_file_b64"}
    }
    (output_dir / "hirly_ai_tailored_younes_stripe_account_executive.json").write_text(
        json.dumps(app_json, indent=2, ensure_ascii=False, default=str),
        encoding="utf-8",
    )
    _export_pdf_previews(app_doc.get("tailored_resume_structured") or {}, FEED_STYLE_JOB, output_dir)
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cv", default=r"C:\Users\Younes\Downloads\MY CV (1).pdf")
    parser.add_argument("--output-dir", default=r"C:\Users\Younes\Downloads")
    args = parser.parse_args()
    out_path = asyncio.run(generate(Path(args.cv), Path(args.output_dir)))
    print(out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
