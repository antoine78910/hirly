"""Export aesthetic CV template previews as PDFs.

The previews are generated from HTML/CSS and printed with local Microsoft Edge.
They use the original template directions as visual references while keeping the
content selectable and one-page.
"""

from __future__ import annotations

import argparse
import html
import subprocess
from pathlib import Path


EDGE_PATHS = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)


RESUME = {
    "name": "Younes Oudrhiri",
    "headline": "Tailored for Account Executive, Enterprise (Hunter) | Stripe",
    "email": "oudrhiriyouneslfim@gmail.com",
    "phone": "07784167674",
    "location": "London, United Kingdom",
    "linkedin": "linkedin.com/in/YounesOudrhiri",
    "summary": (
        "Economics and Mathematics student with customer-facing sales experience, market analysis exposure, "
        "and bilingual French-English communication. Relevant to enterprise account roles through prospect "
        "research, customer conversations, segmentation work, and disciplined commercial execution."
    ),
    "skills": [
        "Enterprise Prospect Research",
        "Customer-Facing Sales",
        "Market Segmentation",
        "Account Targeting",
        "Outbound Planning",
        "Discovery Preparation",
        "Pipeline Hygiene",
        "Commercial Analysis",
        "Financial Statement Exposure",
        "Quantitative Reasoning",
        "Stakeholder Communication",
        "Basic Python",
    ],
    "languages": [
        "French - Native",
        "English - Full professional",
    ],
    "experience": [
        {
            "role": "Front of House Team Member",
            "company": "Benugo",
            "dates": "09/2022 - Present",
            "location": "Egham, United Kingdom",
            "bullets": [
                "Handled high-volume customer orders, payments, and service recovery while maintaining a calm commercial presence.",
                "Built daily customer communication habits through direct conversations, issue resolution, and reliable service delivery.",
                "Coordinated with front-of-house colleagues to keep service flow consistent during peak periods.",
            ],
        },
        {
            "role": "Market Analyst Intern",
            "company": "Dama Bio and Tech",
            "dates": "07/2022 - 09/2022",
            "location": "Casablanca, Morocco",
            "bullets": [
                "Analyzed market segments and customer targets to support positioning for an e-commerce cosmetics business.",
                "Reviewed financial statement inputs and commercial data to inform practical go-to-market decisions.",
                "Prepared market plans connecting product positioning, customer segments, and online sales opportunities.",
            ],
        },
        {
            "role": "Sales and Production Assistant",
            "company": "Conico Icecream Shop",
            "dates": "07/2019 - 08/2019",
            "location": "Malaga, Spain",
            "bullets": [
                "Managed direct customer sales and product preparation in a multilingual retail environment.",
                "Tracked stock needs and supported replenishment to keep products available during service windows.",
            ],
        },
    ],
    "education": [
        "BSc Economics and Mathematics, Royal Holloway, University of London",
    ],
}


THEMES = {
    "ats_classic": {
        "title": "ATS Classic",
        "accent": "#111111",
        "muted": "#555555",
        "bg": "#ffffff",
        "body": "classic",
    },
    "modern_pro": {
        "title": "Modern Pro",
        "accent": "#245f92",
        "muted": "#52606d",
        "bg": "#f7fafc",
        "body": "band",
    },
    "executive_compact": {
        "title": "Executive Compact",
        "accent": "#2d2926",
        "muted": "#6d6259",
        "bg": "#fbfaf7",
        "body": "compact",
    },
    "luxe_minimal": {
        "title": "Luxe Minimal",
        "accent": "#75614a",
        "muted": "#68625c",
        "bg": "#fcfbf8",
        "body": "luxe",
    },
    "studio_slate": {
        "title": "Studio Slate",
        "accent": "#344453",
        "muted": "#66727d",
        "bg": "#f5f7f8",
        "body": "studio",
    },
    "blue_split": {
        "title": "Blue Split",
        "accent": "#16467a",
        "muted": "#52657a",
        "bg": "#f7fbff",
        "body": "split",
    },
}

JOB = {
    "title": "Account Executive, Enterprise (Hunter)",
    "company": "Stripe",
    "location": "Paris, France",
    "keywords": [
        "Enterprise prospecting",
        "Outbound pipeline",
        "Account research",
        "Discovery",
        "Commercial analysis",
        "French and English",
    ],
}


def _edge_path() -> Path:
    for path in EDGE_PATHS:
        if path.exists():
            return path
    raise RuntimeError("Microsoft Edge was not found.")


def esc(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def list_items(items: list[str]) -> str:
    return "".join(f"<li>{esc(item)}</li>" for item in items)


def skill_tags(items: list[str]) -> str:
    return "".join(f"<span>{esc(item)}</span>" for item in items)


def experience_blocks() -> str:
    blocks = []
    for item in RESUME["experience"]:
        bullets = list_items(item["bullets"])
        blocks.append(
            f"""
            <section class="experience-item">
              <div class="item-head">
                <div>
                  <h3>{esc(item["role"])}</h3>
                  <p>{esc(item["company"])} - {esc(item["location"])}</p>
                </div>
                <strong>{esc(item["dates"])}</strong>
              </div>
              <ul>{bullets}</ul>
            </section>
            """
        )
    return "\n".join(blocks)


def section(title: str, body: str) -> str:
    return f"<section class='section'><h2>{esc(title)}</h2>{body}</section>"


def render_html(template_name: str) -> str:
    theme = THEMES[template_name]
    body_class = theme["body"]
    skills = skill_tags(RESUME["skills"])
    languages = skill_tags(RESUME["languages"])
    keywords = skill_tags(JOB["keywords"])
    education = list_items(RESUME["education"])
    experience = experience_blocks()

    core = (
        section("Target Role", f"<p>{esc(JOB['title'])} - {esc(JOB['company'])}, {esc(JOB['location'])}</p>")
        + section("Professional Summary", f"<p>{esc(RESUME['summary'])}</p>")
        + section("Core Skills", f"<div class='skills'>{skills}</div>")
        + section("Role Keywords", f"<div class='skills keywords'>{keywords}</div>")
        + section("Professional Experience", experience)
        + section("Languages", f"<div class='skills languages'>{languages}</div>")
        + section("Education", f"<ul>{education}</ul>")
    )

    if body_class == "split":
        body = f"""
        <main class="page split">
          <aside>
            <p class="eyebrow">Tailored Resume</p>
            <h1>{esc(RESUME["name"])}</h1>
            <p class="headline">{esc(RESUME["headline"])}</p>
            <div class="contact">
              <p>{esc(RESUME["email"])}</p><p>{esc(RESUME["phone"])}</p>
              <p>{esc(RESUME["location"])}</p><p>{esc(RESUME["linkedin"])}</p>
            </div>
          </aside>
          <article>{core}</article>
        </main>
        """
    else:
        body = f"""
        <main class="page {body_class}">
          <header>
            <p class="eyebrow">{esc(theme["title"])}</p>
            <h1>{esc(RESUME["name"])}</h1>
            <p class="headline">{esc(RESUME["headline"])}</p>
            <p class="contact">
              {esc(RESUME["email"])} | {esc(RESUME["phone"])} | {esc(RESUME["location"])} | {esc(RESUME["linkedin"])}
            </p>
          </header>
          {core}
        </main>
        """

    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>{esc(theme["title"])} Resume</title>
<style>
@page {{ size: A4; margin: 0; }}
* {{ box-sizing: border-box; }}
body {{
  margin: 0;
  background: {theme["bg"]};
  color: #171717;
  font-family: "Aptos", "Segoe UI", Arial, sans-serif;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}}
.page {{
  width: 210mm;
  min-height: 297mm;
  padding: 18mm 19mm;
  background: {theme["bg"]};
}}
header {{ border-bottom: 1.6px solid {theme["accent"]}; padding-bottom: 8px; margin-bottom: 13px; }}
.eyebrow {{ margin: 0 0 4px; text-transform: uppercase; letter-spacing: .12em; font-size: 8.5px; color: {theme["accent"]}; font-weight: 800; }}
h1 {{ margin: 0; font-size: 29px; line-height: 1.03; letter-spacing: .01em; }}
.headline {{ margin: 5px 0 0; color: {theme["accent"]}; font-weight: 700; font-size: 11.4px; }}
.contact {{ margin: 6px 0 0; color: {theme["muted"]}; font-size: 9.4px; }}
.section {{ margin-top: 11px; }}
h2 {{ margin: 0 0 5px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .1em; color: {theme["accent"]}; border-bottom: .8px solid rgba(0,0,0,.14); padding-bottom: 3px; }}
p {{ margin: 0; font-size: 9.8px; line-height: 1.34; }}
.skills {{ display: flex; flex-wrap: wrap; gap: 5px; }}
.skills span {{ border: .8px solid rgba(0,0,0,.16); border-radius: 999px; padding: 3px 7px; font-size: 8.8px; background: rgba(255,255,255,.72); }}
.keywords span {{ background: rgba(255,255,255,.9); border-style: solid; }}
.languages span {{ border-radius: 4px; }}
.experience-item {{ margin-top: 8px; break-inside: avoid; }}
.item-head {{ display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }}
h3 {{ margin: 0; font-size: 10.5px; line-height: 1.2; }}
.item-head p {{ margin-top: 1px; color: {theme["muted"]}; font-size: 9px; }}
.item-head strong {{ color: {theme["muted"]}; font-size: 8.8px; white-space: nowrap; }}
ul {{ margin: 4px 0 0 14px; padding: 0; }}
li {{ margin: 0 0 2.5px; font-size: 9.2px; line-height: 1.27; }}
.band header {{ background: #ffffff; margin: -5mm -5mm 13px; padding: 8mm 5mm 6mm; border-radius: 12px; border-bottom: 0; box-shadow: 0 8px 24px rgba(26, 61, 91, .08); }}
.compact {{ padding: 13mm 16mm; }}
.compact h1 {{ font-size: 25px; }}
.compact .section {{ margin-top: 8px; }}
.compact li {{ font-size: 8.8px; line-height: 1.2; }}
.luxe header {{ text-align: center; border-bottom: 0; }}
.luxe header:after {{ content: ""; display: block; width: 44mm; height: 1.4px; background: {theme["accent"]}; margin: 8px auto 0; }}
.luxe .skills span {{ border-color: rgba(117,97,74,.28); background: #fffdf8; }}
.studio {{ background: linear-gradient(90deg, #eef2f5 0, #eef2f5 13mm, {theme["bg"]} 13mm); }}
.studio header {{ border-bottom: 0; padding-left: 5mm; }}
.studio h2 {{ border-bottom: 0; border-left: 3px solid {theme["accent"]}; padding-left: 6px; }}
.split {{ display: grid; grid-template-columns: 58mm 1fr; gap: 11mm; padding: 0; background: white; }}
.split aside {{ min-height: 297mm; background: {theme["accent"]}; color: white; padding: 17mm 8mm; }}
.split aside .eyebrow, .split aside .headline, .split aside .contact {{ color: white; }}
.split aside h1 {{ font-size: 24px; }}
.split aside .contact p {{ margin-top: 7px; overflow-wrap: anywhere; }}
.split article {{ padding: 17mm 15mm 15mm 0; }}
</style>
</head>
<body>{body}</body>
</html>"""


def export_templates(output_dir: Path, template_names: list[str] | None = None) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    edge = _edge_path()
    exported: list[Path] = []
    selected = template_names or list(THEMES)
    for template_name in selected:
        if template_name not in THEMES:
            raise ValueError(f"Unknown template: {template_name}")
        html_path = output_dir / f"hirly_{template_name}_tailored_preview.html"
        pdf_path = output_dir / f"hirly_stripe_{template_name}_tailored_younes.pdf"
        html_path.write_text(render_html(template_name), encoding="utf-8")
        cmd = [
            str(edge),
            "--headless",
            "--disable-gpu",
            f"--print-to-pdf={pdf_path}",
            "--no-pdf-header-footer",
            html_path.resolve().as_uri(),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        exported.append(pdf_path)
    return exported


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default=r"C:\Users\Younes\Downloads")
    parser.add_argument("--templates", default="modern_pro,luxe_minimal,blue_split")
    args = parser.parse_args()
    templates = [item.strip() for item in args.templates.split(",") if item.strip()]
    for path in export_templates(Path(args.output_dir), templates):
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
