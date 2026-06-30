from job_providers.ats_adapters.ashby import AshbyAtsAdapter
from job_providers.ats_adapters.greenhouse import GreenhouseAtsAdapter
from job_providers.ats_adapters.lever import LeverAtsAdapter


def test_greenhouse_source_key_extraction():
    adapter = GreenhouseAtsAdapter()
    assert adapter.extract_source_key_from_url("https://boards.greenhouse.io/acme") == "acme"
    assert adapter.extract_source_key_from_url("https://job-boards.greenhouse.io/acme/jobs/123") == "acme"


def test_greenhouse_normalization():
    adapter = GreenhouseAtsAdapter()
    job = adapter.normalize_job(
        {"id": 123, "title": "Marketing Manager", "absolute_url": "https://boards.greenhouse.io/acme/jobs/123", "location": {"name": "Paris, France"}, "content": "<p>Lead launches</p>"},
        source_key="acme",
    )
    assert job["provider"] == "greenhouse"
    assert job["ats_provider"] == "greenhouse"
    assert job["external_id"] == "acme:123"
    assert job["selected_apply_url"] == "https://boards.greenhouse.io/acme/jobs/123"
    assert job["location"] == "Paris, France"


def test_lever_source_key_extraction():
    adapter = LeverAtsAdapter()
    assert adapter.extract_source_key_from_url("https://jobs.lever.co/acme") == "acme"
    assert adapter.extract_source_key_from_url("https://jobs.lever.co/acme/posting-123") == "acme"


def test_lever_normalization():
    adapter = LeverAtsAdapter()
    job = adapter.normalize_job(
        {
            "id": "posting-123",
            "text": "Digital Marketing Specialist",
            "hostedUrl": "https://jobs.lever.co/acme/posting-123",
            "descriptionPlain": "Own acquisition campaigns",
            "categories": {"location": "Bordeaux, France", "team": "Marketing", "commitment": "Full-time"},
            "createdAt": 1710000000000,
        },
        source_key="acme",
    )
    assert job["provider"] == "lever"
    assert job["ats_provider"] == "lever"
    assert job["external_id"] == "acme:posting-123"
    assert job["team"] == "Marketing"
    assert job["selected_apply_url"] == "https://jobs.lever.co/acme/posting-123"


def test_ashby_source_key_extraction():
    adapter = AshbyAtsAdapter()
    assert adapter.extract_source_key_from_url("https://jobs.ashbyhq.com/acme") == "acme"
    assert adapter.extract_source_key_from_url("https://jobs.ashbyhq.com/acme/abc123") == "acme"


def test_ashby_normalization():
    adapter = AshbyAtsAdapter()
    job = adapter.normalize_job(
        {
            "id": "abc123",
            "title": "Growth Marketer",
            "jobUrl": "https://jobs.ashbyhq.com/acme/abc123",
            "locationName": "Lyon, France",
            "descriptionHtml": "<p>Run lifecycle campaigns</p>",
            "departmentName": "Marketing",
            "employmentType": "Full-time",
        },
        source_key="acme",
    )
    assert job["provider"] == "ashby"
    assert job["ats_provider"] == "ashby"
    assert job["external_id"] == "acme:abc123"
    assert job["department"] == "Marketing"
    assert job["selected_apply_url"] == "https://jobs.ashbyhq.com/acme/abc123"
