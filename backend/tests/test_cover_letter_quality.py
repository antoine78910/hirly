from cover_letter_quality import (
    build_cover_letter_prompt_section,
    validate_cover_letter_quality,
)


def test_cover_letter_prompt_includes_coherence_and_job_rules():
    prompt = build_cover_letter_prompt_section(
        "Sopra Steria",
        "Data Engineer PySpark",
        {
            "tech_stack": ["Python", "PySpark", "SQL", "Databricks"],
            "requirements": ["ETL", "Spark"],
        },
    )
    assert "coherent" in prompt.lower() or "cohérent" in prompt.lower()
    assert "Sopra Steria" in prompt
    assert "PySpark" in prompt
    assert "je peux attester" in prompt.lower()
    assert "REGLE #1" in prompt


def test_validate_cover_letter_flags_weak_phrase():
    report = validate_cover_letter_quality(
        {
            "subject": "Candidature Data Engineer - Sopra Steria",
            "paragraphs": [
                "Je souhaite rejoindre Sopra Steria.",
                "Je peux me former rapidement sur PySpark.",
            ],
        },
        {"company": "Sopra Steria", "title": "Data Engineer", "tech_stack": ["PySpark"]},
    )
    assert report["status"] == "needs_review"
    assert "weak_cover_letter_phrase" in report["issues"]


def test_validate_cover_letter_passes_strong_bridge():
    report = validate_cover_letter_quality(
        {
            "subject": "Candidature pour le poste de Data Engineer - Sopra Steria",
            "paragraphs": [
                "Rejoindre Sopra Steria represente pour moi l'opportunite de contribuer a des projets data d'envergure.",
                "Chez Deloitte, j'ai analyse des volumes importants de donnees financieres et securise des processus de controle qualite.",
                "Cette rigueur en analyse, SQL et reporting me permet d'aborder des pipelines PySpark et des flux ETL avec methode.",
            ],
        },
        {
            "company": "Sopra Steria",
            "title": "Data Engineer PySpark",
            "tech_stack": ["PySpark", "ETL", "SQL"],
        },
    )
    assert report["status"] == "pass"
    assert "weak_cover_letter_phrase" not in report["issues"]
