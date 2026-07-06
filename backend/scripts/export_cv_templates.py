"""Export sample generated CV templates as DOCX files.

This creates inspectable template previews from the same backend generator used
for tailored application packages. It does not edit source PDFs directly.
"""

from __future__ import annotations

import argparse
import base64
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from application_documents import SUPPORTED_GENERATED_TEMPLATES, build_application_package


SAMPLE_PROFILE = {
    "contact": {
        "name": "Alex Martin",
        "email": "alex.martin@email.com",
        "phone": "+33 6 00 00 00 00",
        "location": "Paris, France",
        "linkedin": "linkedin.com/in/alexmartin",
        "website": "alexmartin.com",
    },
    "cv_filename": "alex_martin.pdf",
    "cv_mime": "application/pdf",
    "cv_original_b64": base64.b64encode(b"%PDF-1.4 template preview").decode("ascii"),
}


def _sample_generation(template_name: str) -> dict:
    return {
        "tailored_resume_structured": {
            "template_recommendation": template_name,
            "headline": "Business Development Representative",
            "contact": SAMPLE_PROFILE["contact"],
            "summary": (
                "Business development representative experienced in B2B prospecting, CRM hygiene, "
                "account research, and pipeline generation for SaaS and service-driven teams."
            ),
            "skills": [
                "Outbound Prospecting",
                "Lead Qualification",
                "Pipeline Generation",
                "Account Research",
                "Discovery Calls",
                "Salesforce",
                "HubSpot",
                "LinkedIn Sales Navigator",
                "Apollo",
                "CRM Hygiene",
                "Sales Messaging",
                "French",
                "English",
            ],
            "experience": [
                {
                    "role": "Business Development Representative",
                    "company": "Northstar Software",
                    "duration": "2022-2024",
                    "location": "Paris, France",
                    "highlights": [
                        "Built targeted prospect lists for mid-market accounts using LinkedIn Sales Navigator and CRM research.",
                        "Qualified inbound and outbound opportunities through structured discovery calls and account notes.",
                        "Improved CRM hygiene by standardizing lead status, next steps, and handoff notes for account executives.",
                    ],
                },
                {
                    "role": "Sales Development Intern",
                    "company": "MarketFlow",
                    "duration": "2021-2022",
                    "location": "Madrid, Spain",
                    "highlights": [
                        "Supported outbound campaigns by researching decision makers and preparing concise value-led messages.",
                        "Tracked campaign performance in HubSpot and summarized qualified lead patterns for the sales team.",
                    ],
                },
            ],
            "education": [
                {
                    "degree": "Master in Digital Business and Management",
                    "school": "Madrid Business School",
                    "year": "2021",
                }
            ],
        },
    }


def export_templates(output_dir: Path) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    exported = []
    for template_name in sorted(SUPPORTED_GENERATED_TEMPLATES):
        package = build_application_package(SAMPLE_PROFILE, _sample_generation(template_name))
        content = base64.b64decode(package["tailored_cv_file_b64"])
        out_path = output_dir / f"hirly_{template_name}_template.docx"
        out_path.write_bytes(content)
        exported.append(out_path)
    return exported


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="./generated_cv_templates")
    args = parser.parse_args()

    exported = export_templates(Path(args.output_dir))
    for path in exported:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
