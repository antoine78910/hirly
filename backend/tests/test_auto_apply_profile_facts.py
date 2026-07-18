"""Tests for CV/profile fact derivation used by auto-apply resolution."""
from auto_apply.profile_facts import (
    derive_profile_facts,
    education_level_label,
    estimate_years_experience,
    match_select_option,
)
from apply_agent.agent import build_candidate_context
from application_blueprint import (
    ApplicationBlueprint, Complexity, FieldType, FieldValidation, NormalizedField,
)
from auto_apply.resolver import resolve


PROFILE = {
    "contact": {
        "first_name": "Ada",
        "last_name": "Lovelace",
        "email": "ada@example.com",
        "phone": "+33600000000",
        "location": "Paris",
        "linkedin": "https://linkedin.com/in/ada",
    },
    "seniority": "mid",
    "skills": ["Python", "SQL", "React"],
    "languages": ["French - Native", "English - Fluent"],
    "experience": [
        {
            "role": "Software Engineer",
            "company": "Acme",
            "duration": "01/2020 - Present",
        },
        {
            "role": "Intern",
            "company": "Beta",
            "duration": "6 mois",
        },
    ],
    "education": [
        {"degree": "Master Informatique", "school": "Dauphine", "year": "2019"},
    ],
    "application_defaults": {
        "city": "Paris",
        "country": "France",
        "postal_code": "75001",
        "salary_expectation": "45000",
        "availability": "Immédiate",
    },
}


def test_estimate_years_from_duration_ranges():
    years = estimate_years_experience(PROFILE)
    assert years is not None
    # ~6y current role + 0.5y internship
    assert years >= 5.5


def test_education_level_from_master_degree():
    assert education_level_label(PROFILE) == "Bac+5"


def test_derive_profile_facts_exposes_core_keys():
    facts = derive_profile_facts(PROFILE)
    assert facts["education_level"] == "Bac+5"
    assert facts["current_title"] == "Software Engineer"
    assert facts["current_company"] == "Acme"
    assert facts["availability"] == "Immédiate"
    assert "Python" in facts["skills"]
    assert facts["years_experience"] >= 5


def test_match_select_option_experience_bucket():
    options = ["Débutant", "1-2 ans", "3-5 ans", "5-10 ans", "10 ans et plus"]
    assert match_select_option(4, options) == "3-5 ans"
    assert match_select_option(7, options) == "5-10 ans"
    assert match_select_option("Bac+5", ["Bac", "Bac+2", "Bac+3", "Bac+5", "Doctorat"]) == "Bac+5"


def test_build_candidate_context_includes_derived_facts():
    ctx = build_candidate_context(PROFILE, {"application_id": "app1"}, {"email": "ada@example.com", "name": "Ada Lovelace"})
    assert "profile.derived.years_experience" in ctx
    assert ctx["profile.derived.education_level"] == "Bac+5"
    assert ctx["profile.derived.current_title"] == "Software Engineer"
    assert ctx.get("profile.application_defaults.years_experience") is not None


def _bp(fields):
    return ApplicationBlueprint(
        provider="taleez",
        fields=fields,
        complexity=Complexity.STANDARD,
        estimated_compatibility_score=0.8,
    )


def test_resolver_fills_experience_and_education_from_derived():
    ctx = build_candidate_context(PROFILE, {}, {"email": "ada@example.com"})
    fields = [
        NormalizedField(
            "experience_level", FieldType.SELECT, required=True, supported=True,
            label="Votre expérience",
            validation=FieldValidation(
                sensitive=True,
                allowed_options=["Débutant", "1-2 ans", "3-5 ans", "5-10 ans", "10 ans et plus"],
            ),
        ),
        NormalizedField(
            "education_level", FieldType.SELECT, required=True, supported=True,
            label="Votre niveau d'étude",
            validation=FieldValidation(
                sensitive=True,
                allowed_options=["Bac", "Bac+2", "Bac+3", "Bac+5", "Doctorat"],
            ),
        ),
        NormalizedField(
            "years", FieldType.TEXT, required=True, supported=True,
            label="Années d'expérience",
            validation=FieldValidation(sensitive=True),
        ),
        NormalizedField(
            "availability", FieldType.SELECT, required=False, supported=True,
            label="Disponibilité",
            validation=FieldValidation(
                sensitive=True,
                allowed_options=["Immédiate", "Préavis de 1 mois", "Préavis de 3 mois"],
            ),
        ),
    ]
    answers, unresolved = resolve(_bp(fields), ctx, PROFILE)
    by_key = {a.field_key: a for a in answers}
    assert unresolved == []
    assert by_key["education_level"].value == "Bac+5"
    assert by_key["experience_level"].value in {"5-10 ans", "3-5 ans", "10 ans et plus"}
    assert by_key["years"].value
    assert by_key["availability"].value == "Immédiate"
    assert by_key["education_level"].source.startswith("profile.")


def test_resolver_still_does_not_guess_visa():
    ctx = build_candidate_context(PROFILE, {}, {})
    fields = [
        NormalizedField(
            "visa", FieldType.VISA_STATUS, required=True, supported=True,
            label="Are you authorized to work?",
            validation=FieldValidation(sensitive=True),
        ),
    ]
    answers, unresolved = resolve(_bp(fields), ctx, PROFILE)
    assert answers == []
    assert [f.key for f in unresolved] == ["visa"]
