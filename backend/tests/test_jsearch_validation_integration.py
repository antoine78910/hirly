import asyncio

from db.supabase_adapter import _supabase_row
from jobs_service import _provider_attempt_queries, build_profile_job_query, upsert_imported_jobs
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


class _Cursor:
    def __init__(self, rows):
        self.rows = rows
    def limit(self, count):
        self.rows = self.rows[:count]
        return self
    async def to_list(self, length):
        return self.rows[:length]


class _Jobs:
    def __init__(self):
        self.rows = []
    def find(self, query, _projection=None):
        field, condition = next(iter(query.items()))
        values = set((condition or {}).get("$in") or [])
        return _Cursor([dict(row) for row in self.rows if row.get(field) in values])
    async def insert_many(self, documents):
        self.rows.extend(dict(document) for document in documents)


class _DB:
    def __init__(self):
        self.jobs = _Jobs()


def test_adapter_normalize_validate_filter_dedup_canonical_integration_branches():
    provider = JSearchProvider(api_key="test")
    raw_records = [
        {
            "job_id": f"branch-{index}",
            "job_title": title,
            "employer_name": "Partenaire Éxemple",
            "job_apply_link": f"https://jobs.lever.co/example/{index}",
            "job_publisher": "Partner Feed",
            "job_description": description,
            "job_city": city,
            "job_country": "France",
            "job_employment_type": contract,
            "job_is_remote": remote,
            "job_posted_at_datetime_utc": posted,
        }
        for index, (title, description, city, contract, remote, posted) in enumerate([
            ("Développeur", "", "", "FULLTIME", False, "2026-07-20T00:00:00Z"),
            ("Ingénieure données", "Unicode ✓", "Saint-Étienne", "PARTTIME", True, None),
            ("Analyste", "Hybrid role", "Paris", "CONTRACTOR", False, "1970-01-01T00:00:00Z"),
            ("Stagiaire", "No salary supplied", "Lyon", "INTERN", False, "2030-01-01T00:00:00Z"),
            ("Rôle inconnu", "Unknown enum is retained", "Remote", "NEW_ENUM", True, None),
        ])
    ]
    query = JobSearchQuery(role="", location="France", country="fr", language="fr")
    normalized = [
        provider.normalize_job(record, query, "2026-07-20T01:00:00Z")
        for record in raw_records
    ]
    assert all(job is not None for job in normalized)

    db = _DB()
    stats = asyncio.run(upsert_imported_jobs(db, normalized))

    assert len(db.jobs.rows) == len(raw_records)
    assert stats["inserted"] == len(raw_records)
    assert stats["write_failed"] == 0
    assert all(row.get("validation_status") for row in db.jobs.rows)
    assert any(row.get("remote") == "remote" for row in db.jobs.rows)
    assert any(row.get("contract_type") == "NEW_ENUM" for row in db.jobs.rows)
