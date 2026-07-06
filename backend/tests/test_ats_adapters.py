from job_providers.ats_adapters.ashby import AshbyAtsAdapter
from job_providers.ats_adapters.greenhouse import GreenhouseAtsAdapter
from job_providers.ats_adapters.lever import LeverAtsAdapter
from job_providers.ats_adapters.smartrecruiters import SmartRecruitersAtsAdapter
from smartrecruiters_search import build_smartrecruiters_keyword


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


def test_smartrecruiters_source_key_extraction():
    adapter = SmartRecruitersAtsAdapter()
    assert adapter.extract_source_key_from_url("https://jobs.smartrecruiters.com/BoschGroup/744000135866249-project") == "BoschGroup"
    assert adapter.extract_posting_id_from_url("https://jobs.smartrecruiters.com/BoschGroup/744000135866249-project") == "744000135866249"


def test_smartrecruiters_normalization():
    adapter = SmartRecruitersAtsAdapter()
    job = adapter.normalize_job(
        {
            "id": "744000135866249",
            "name": "Retail Associate",
            "releasedDate": "2026-01-01T00:00:00.000Z",
            "location": {"city": "Auxerre", "country": "fr", "fullLocation": "Auxerre, France"},
            "company": {"identifier": "HM", "name": "H&M"},
            "typeOfEmployment": {"label": "Part-time"},
        },
        source_key="HM",
        detail={
            "postingUrl": "https://jobs.smartrecruiters.com/HM/744000135866249-retail-associate",
            "applyUrl": "https://jobs.smartrecruiters.com/HM/744000135866249-retail-associate?oga=true",
            "jobAd": {
                "sections": {
                    "jobDescription": {"title": "Job Description", "text": "Welcome customers and keep the store tidy."},
                    "qualifications": {"title": "Qualifications", "text": "Retail experience is a plus."},
                }
            },
        },
    )
    assert job["provider"] == "smartrecruiters"
    assert job["ats_provider"] == "smartrecruiters"
    assert job["external_id"] == "HM:744000135866249"
    assert job["location"] == "Auxerre, France"
    assert job["job_description_sections"]
    assert job["selected_apply_url"].endswith("?oga=true")


def test_build_smartrecruiters_keyword():
    assert build_smartrecruiters_keyword("EH", "Auxerre") == "Auxerre EH"
    assert build_smartrecruiters_keyword("developer", "Paris") == "Paris developer"
