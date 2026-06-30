from db.supabase_adapter import _supabase_row


def test_supabase_job_upsert_row_includes_normalized_columns():
    row = _supabase_row("jobs", {
        "job_id": "job_test",
        "provider": "jsearch",
        "external_id": "external_test",
        "title": "Sr. Product Marketing Manager",
        "company": "Acme Inc.",
        "location": "London, England, United Kingdom",
        "remote": False,
        "salary_min": 70000,
        "salary_max": 90000,
        "currency": "GBP",
        "provider_search_key": "jsearch:marketing:london:any:gb:en",
        "manual_fulfillment_ready": True,
        "apply_fulfillment_status": "manual_ready",
        "applyability_tier": "good",
        "description": "Own product positioning and launches.",
    })

    assert row["job_id"] == "job_test"
    assert row["provider"] == "jsearch"
    assert row["external_id"] == "external_test"
    assert row["title"] == "Sr. Product Marketing Manager"
    assert row["normalized_title"] == "senior product marketing manager"
    assert row["company"] == "Acme Inc."
    assert row["normalized_company"] == "acme"
    assert row["city"] == "London"
    assert row["country_code"] == "gb"
    assert row["provider_search_key"] == "jsearch:marketing:london:any:gb:en"
    assert row["manual_fulfillment_ready"] is True
    assert row["applyability_tier"] == "good"
    assert row["fingerprint"]
    assert row["data"]["job_id"] == "job_test"


def test_supabase_ats_source_row_includes_indexed_columns():
    row = _supabase_row("ats_company_sources", {
        "ats_provider": "greenhouse",
        "source_key": "acme",
        "company_name": "Acme",
        "careers_url": "https://boards.greenhouse.io/acme",
        "country_code": "fr",
        "is_active": True,
    })

    assert row["id"] == "greenhouse:acme"
    assert row["ats_provider"] == "greenhouse"
    assert row["source_key"] == "acme"
    assert row["company_name"] == "Acme"
    assert row["is_active"] is True
    assert row["data"]["id"] == "greenhouse:acme"
