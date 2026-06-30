from job_normalization import (
    build_job_fingerprint,
    extract_normalized_job_columns,
    normalize_company_name,
    normalize_text,
    normalize_title,
)


def test_normalize_text():
    assert normalize_text("  D\u00e9veloppeur  S\u00e9nior / Python! ") == "developpeur senior python"
    assert normalize_text("") is None
    assert normalize_text(None) is None


def test_normalize_company_name():
    assert normalize_company_name("Acme, Inc.") == "acme"
    assert normalize_company_name("Soci\u00e9t\u00e9 G\u00e9n\u00e9rale SA") == "societe generale"


def test_normalize_title():
    assert normalize_title("Sr. Digital Marketing Mgr") == "senior digital marketing manager"


def test_build_job_fingerprint_is_stable():
    job = {
        "title": "Marketing Specialist",
        "company": "Acme Inc.",
        "location": "Bordeaux, Nouvelle-Aquitaine, France",
        "contract_type": "Full-time",
        "description": "Own lifecycle campaigns and acquisition channels.",
    }
    same = {
        **job,
        "title": "Marketing   Specialist",
        "company": "ACME",
    }
    assert build_job_fingerprint(job) == build_job_fingerprint(same)


def test_extract_normalized_job_columns_jsearch_like_job():
    job = {
        "job_id": "job_1",
        "title": "Digital Marketing Specialist",
        "company": "Example Ltd",
        "location": "Paris, Ile-de-France, France",
        "country_code": "FR",
        "remote": False,
        "salary_min": 42000,
        "salary_max": 52000,
        "currency": "EUR",
        "posted_at": "2026-06-28T10:00:00+00:00",
        "imported_at": "2026-06-29T10:00:00+00:00",
        "last_seen_at": "2026-06-29T10:00:00+00:00",
        "provider_search_key": "jsearch:marketing:paris:any:fr:fr",
        "ats_provider": "greenhouse",
        "auto_apply_supported": True,
        "manual_fulfillment_ready": True,
        "apply_fulfillment_status": "manual_ready",
        "apply_url_provider": "greenhouse",
        "selected_apply_url": "https://boards.greenhouse.io/example/jobs/123",
        "description": "Marketing role focused on lifecycle campaigns.",
    }
    columns = extract_normalized_job_columns(job)
    assert columns["title"] == "Digital Marketing Specialist"
    assert columns["normalized_title"] == "digital marketing specialist"
    assert columns["company"] == "Example Ltd"
    assert columns["normalized_company"] == "example"
    assert columns["city"] == "Paris"
    assert columns["region"] == "Ile-de-France"
    assert columns["country_code"] == "fr"
    assert columns["remote"] is False
    assert columns["fingerprint"]


def test_extract_normalized_job_columns_missing_optional_fields():
    columns = extract_normalized_job_columns({
        "title": "HR Assistant",
        "company": "People Ops SARL",
    })
    assert columns["normalized_title"] == "hr assistant"
    assert columns["normalized_company"] == "people ops"
    assert columns["city"] is None
    assert columns["fingerprint"]
