from db.supabase_adapter import _supabase_row
from jobs_service import _provider_attempt_queries, build_profile_job_query
from job_providers.base import JobSearchQuery
from job_providers.jsearch import JSearchProvider
from job_validation import cheap_validate_job_applyability


def test_jsearch_normalization_uses_central_ats_detection():
    provider = JSearchProvider(api_key="test")
    job = provider.normalize_job(
        {
            "job_id": "ext_1",
            "job_title": "Marketing Manager",
            "employer_name": "Acme",
            "job_apply_link": "https://careers.recruitee.com/acme/jobs/123",
            "job_publisher": "Recruitee",
            "job_description": "Lead growth campaigns.",
            "job_city": "Paris",
            "job_country": "France",
        },
        JobSearchQuery(role="marketing", location="Paris, France", country="fr", language="fr"),
        "2026-06-29T10:00:00+00:00",
    )

    assert job is not None
    assert job["ats_provider"] == "recruitee"
    assert job["apply_url_provider"] == "recruitee"


def test_supabase_upsert_receives_validation_fields():
    job = {
        "job_id": "job_validated",
        "provider": "jsearch",
        "external_id": "ext_validated",
        "title": "Marketing Manager",
        "company": "Acme",
        "external_url": "https://jobs.lever.co/acme/123",
        "description": "Lead campaigns.",
    }
    validated = {**job, **cheap_validate_job_applyability(job)}
    row = _supabase_row("jobs", validated)

    assert row["validation_status"] == "valid"
    assert row["validation_reason"]
    assert row["validation_checked_at"]
    assert row["ats_provider"] == "lever"
    assert row["auto_apply_supported"] is True
    assert row["manual_fulfillment_ready"] is True
    assert row["apply_fulfillment_status"] == "manual_ready"
    assert row["applyability_tier"] == "A"
    assert row["data"]["validation_status"] == "valid"


def test_profile_job_query_uses_country_local_language(monkeypatch):
    monkeypatch.delenv("JSEARCH_LANGUAGE", raising=False)
    query = build_profile_job_query(
        {"target_role": "Software Engineer"},
        location_override="Madrid, Spain",
        location_data_override={"location_label": "Madrid, Spain", "country_code": "es"},
        search_radius="50km",
        role_override="Software Engineer",
    )

    assert query.country == "es"
    assert query.language == "es"


def test_provider_attempt_queries_try_structured_search_before_raw_location():
    provider = JSearchProvider(api_key="test")
    query = JobSearchQuery(
        role="Software Engineer",
        location="saint etienne, FR",
        country="fr",
        language="fr",
        max_pages=1,
        page_size=10,
    )

    attempts = _provider_attempt_queries(query, "70km", provider)

    assert attempts
    assert attempts[0].raw_query is False
    assert attempts[0].location == "saint etienne, FR"
    assert any(item.raw_query for item in attempts[1:])
