from jobs_service import build_profile_job_query


def test_build_profile_job_query_includes_contract_hint():
    query = build_profile_job_query({
        "target_role": "Developer",
        "target_location": "Lyon, France",
        "contract_type": "apprenticeship",
    })
    assert query.contract_hint == "alternance"


def test_build_profile_job_query_reads_contract_from_extras():
    query = build_profile_job_query({
        "target_role": "Sales",
        "target_location": "Bordeaux, France",
        "extras": {"onboarding": {"contract_type": "summer_job"}},
    })
    assert query.contract_hint == "job été"
