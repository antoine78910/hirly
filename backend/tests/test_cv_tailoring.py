from cv_tailoring import (
    apply_minimal_resume_tailoring,
    build_base_resume_from_profile,
    strip_internal_cv_instructions,
    validate_minimal_tailoring_preserved,
)


PROFILE = {
    "contact": {"name": "Aboubacar DIALLO", "email": "a@example.com", "location": "Melun"},
    "template_style": "modern",
    "summary": "Auditeur financier avec 4 saisons d'experience en Big Four (Deloitte), specialise en controle interne.",
    "skills": ["Audit", "Excel avance", "Controle interne", "SQL", "Python", "Reporting"],
    "languages": ["French - Native"],
    "experience": [
        {
            "role": "Auditeur financier",
            "company": "Deloitte",
            "duration": "4 saisons",
            "location": "Paris",
            "highlights": [
                "Membre de l'equipe Industries & Services sur un groupe de 9-10 filiales.",
                "Controles financiers et revues analytiques sur grands volumes.",
            ],
        },
        {
            "role": "Stage audit",
            "company": "KPMG",
            "duration": "6 mois",
            "location": "Paris",
            "highlights": ["Support aux missions de controle interne."],
        },
    ],
    "education": [{"degree": "Master Audit", "school": "Dauphine", "year": "2020"}],
}


def test_strip_internal_instructions():
    raw = "Auditeur financier. Informations techniques specifiques (PySpark, Data Factory) a ajouter si detenues."
    cleaned = strip_internal_cv_instructions(raw)
    assert "PySpark" not in cleaned
    assert "ajouter" not in cleaned.lower()
    assert "Auditeur financier" in cleaned


def test_apply_minimal_tailoring_preserves_experience_text():
    generated = {
        "resume_tailoring": {
            "headline": "Auditeur Financier | Data Analysis | Controle Interne | Excel Avance",
            "summary": "Auditeur financier avec 4 saisons chez Deloitte (Big Four), habitue aux grands volumes et a la rigueur analytique.",
            "skills_order": [1, 3, 4, 0, 2, 5],
            "experience_order": [0, 1],
        }
    }
    tailored = apply_minimal_resume_tailoring(PROFILE, generated)
    assert tailored["experience"][0]["company"] == "Deloitte"
    assert "9-10 filiales" in tailored["experience"][0]["highlights"][0]
    assert tailored["skills"][0] == "Excel avance"
    assert tailored["headline"].startswith("Auditeur Financier")


def test_legacy_full_resume_output_is_stripped_to_minimal():
    generated = {
        "tailored_resume_structured": {
            "headline": "Data Engineer",
            "summary": "Souhait de candidater pour un poste data.",
            "skills": ["Python", "Audit", "SQL"],
            "experience": [
                {
                    "role": "Analyste data",
                    "company": "Deloitte",
                    "duration": "2024",
                    "highlights": ["Analyse et traitement de donnees."],
                }
            ],
        }
    }
    tailored = apply_minimal_resume_tailoring(PROFILE, generated)
    report = validate_minimal_tailoring_preserved(PROFILE, tailored)
    assert report["status"] == "pass"
    assert tailored["experience"][0]["highlights"][0].startswith("Membre de l'equipe")
    assert len(tailored["experience"]) == 2


def test_build_base_resume_from_profile():
    base = build_base_resume_from_profile(PROFILE)
    assert len(base["experience"]) == 2
    assert base["skills"][0] == "Audit"
