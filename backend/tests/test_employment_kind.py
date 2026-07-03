from employment_kind import (
    classify_employment_kind,
    contract_type_to_job_types,
    enrich_job_employment_kind,
    employment_kind_rank_bonus,
    job_matches_job_types,
    resolve_profile_contract_type,
)


def test_contract_type_to_job_types():
    assert contract_type_to_job_types("permanent") == ["full_time"]
    assert contract_type_to_job_types("apprenticeship") == ["apprenticeship"]
    assert contract_type_to_job_types("summer_job") == ["summer_job"]


def test_resolve_profile_contract_type_from_extras():
    profile = {"extras": {"onboarding": {"contract_type": "fixed_term"}}}
    assert resolve_profile_contract_type(profile) == "fixed_term"


def test_classify_french_contracts():
    assert classify_employment_kind({"title": "Alternance développeur web"}) == "apprenticeship"
    assert classify_employment_kind({"title": "CDI Chef de projet"}) == "full_time"
    assert classify_employment_kind({"title": "Job d'été vendanges Bordeaux"}) == "summer_job"


def test_job_matches_job_types_cdi():
    job = {"title": "Responsable marketing CDI", "location": "Lyon"}
    assert job_matches_job_types(job, ["full_time"])
    assert not job_matches_job_types(job, ["internship"])


def test_enrich_job_employment_kind():
    job = enrich_job_employment_kind({"title": "Stage communication"})
    assert job["employment_kind"] == "internship"


def test_employment_kind_rank_bonus():
    job = {"title": "Alternance commerce"}
    assert employment_kind_rank_bonus(job, ["apprenticeship"]) == 20
    assert employment_kind_rank_bonus(job, ["full_time"]) == -25
