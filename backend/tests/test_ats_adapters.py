from job_providers.ats_adapters.ashby import AshbyAtsAdapter
from job_providers.ats_adapters.greenhouse import GreenhouseAtsAdapter
from job_providers.ats_adapters.lever import LeverAtsAdapter
from job_providers.ats_adapters.personio import PersonioAtsAdapter
from job_providers.ats_adapters.smartrecruiters import SmartRecruitersAtsAdapter
from job_providers.ats_adapters.teamtailor import TeamtailorAtsAdapter
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
    assert job["auto_apply_supported"] is True


def test_build_smartrecruiters_keyword():
    assert build_smartrecruiters_keyword("EH", "Auxerre") == "Auxerre EH"
    assert build_smartrecruiters_keyword("developer", "Paris") == "Paris developer"


# --- Personio -----------------------------------------------------------
# Fixture modeled directly on a live https://<company>.jobs.personio.com/xml
# response captured during development (fields, nesting, and CDATA usage
# match the real feed exactly).
PERSONIO_XML_SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
  <position>
    <id>2077462</id>
    <subcompany>Acme ApS Germany</subcompany>
    <office>Berlin</office>
    <department>People</department>
    <recruitingCategory>Germany</recruitingCategory>
    <name>(Junior) Talent Acquisition Specialist (m/w/d)</name>
    <jobDescriptions></jobDescriptions>
    <employmentType>permanent</employmentType>
    <seniority>entry-level</seniority>
    <schedule>full-time</schedule>
    <keywords>Talent Acquisition,Recruiter</keywords>
    <occupation>recruiting_and_sourcing</occupation>
    <occupationCategory>human_resources</occupationCategory>
    <createdAt>2025-04-30T18:00:25+00:00</createdAt>
  </position>
  <position>
    <id>2616841</id>
    <subcompany>Acme Inc.</subcompany>
    <office>New York</office>
    <department>MCC</department>
    <recruitingCategory>US</recruitingCategory>
    <name>BDR Team Manager</name>
    <jobDescriptions>
      <jobDescription>
        <name>About the job</name>
        <value><![CDATA[Acme is on a mission. <br><br>We are scaling fast.]]></value>
      </jobDescription>
      <jobDescription>
        <name>What you&#039;ll do</name>
        <value><![CDATA[<ul><li>Build the team from zero</li></ul>]]></value>
      </jobDescription>
    </jobDescriptions>
    <employmentType>permanent</employmentType>
    <seniority>manager</seniority>
    <schedule>full-time</schedule>
    <keywords>Sales</keywords>
    <occupation>sales</occupation>
    <occupationCategory>sales</occupationCategory>
    <createdAt>2026-05-01T12:00:00+00:00</createdAt>
  </position>
</workzag-jobs>
"""


def test_personio_source_key_extraction():
    adapter = PersonioAtsAdapter()
    assert adapter.extract_source_key_from_url("https://acme.jobs.personio.com/job/2616841") == "acme"
    assert adapter.extract_source_key_from_url("https://acme.jobs.personio.de/xml?language=en") == "acme"
    assert adapter.extract_source_key_from_url("https://boards.greenhouse.io/acme") is None


def test_personio_parse_positions_skips_empty_description():
    adapter = PersonioAtsAdapter()
    rows = adapter.parse_positions(PERSONIO_XML_SAMPLE, tld="com")
    assert len(rows) == 2
    assert rows[0]["id"] == "2077462"
    assert rows[0]["_sections"] == []
    assert rows[1]["_sections"][0]["title"] == "About the job"


def test_personio_normalize_job():
    adapter = PersonioAtsAdapter()
    rows = adapter.parse_positions(PERSONIO_XML_SAMPLE, tld="com")
    job = adapter.normalize_job(rows[1], source_key="acme")
    assert job["provider"] == "personio"
    assert job["ats_provider"] == "personio"
    assert job["external_id"] == "acme:2616841"
    assert job["company"] == "Acme Inc."
    assert job["location"] == "New York"
    assert job["selected_apply_url"] == "https://acme.jobs.personio.com/job/2616841"
    assert "Build the team from zero" in job["description"]
    assert job["auto_apply_supported"] is True


def test_personio_normalize_job_returns_none_without_id_or_title():
    adapter = PersonioAtsAdapter()
    assert adapter.normalize_job({"name": "Missing id"}, source_key="acme") is None
    assert adapter.normalize_job({"id": "1"}, source_key="acme") is None


# --- Teamtailor -----------------------------------------------------------
# Fixtures modeled directly on a live Teamtailor career site captured during
# development: the listing page renders plain server-side <a href> job
# links, and each job detail page carries a schema.org JobPosting JSON-LD
# block (the same structured data ATSes emit for Google for Jobs SEO).
TEAMTAILOR_LISTING_SAMPLE = """
<li class="w-full">
  <div class="relative flex flex-col items-center py-6 text-center">
    <a class="flex" data-turbo="false" href="https://acme.teamtailor.com/jobs/8010892-midmarket-sdr-uk">
      <span class="absolute inset-0"></span>
      MidMarket SDR - UK
    </a>
    <div class="mt-1 text-md"><span>Sales</span><span>&middot;</span><span>London</span></div>
  </div>
</li>
<li class="w-full">
  <div class="relative flex flex-col items-center py-6 text-center">
    <a class="flex" data-turbo="false" href="/jobs/7952282-legal-counsel">
      <span class="absolute inset-0"></span>
      Legal Counsel
    </a>
    <div class="mt-1 text-md"><span>Legal</span><span>&middot;</span><span>Stockholm</span></div>
  </div>
</li>
"""

TEAMTAILOR_DETAIL_SAMPLE = """<html><head>
<script type="application/ld+json">
{
  "@context": "http://schema.org/",
  "@type": "JobPosting",
  "title": "Legal Counsel",
  "description": "&lt;h4&gt;&lt;strong&gt;Join us&lt;/strong&gt;&lt;/h4&gt;&lt;p&gt;Great team.&lt;/p&gt;",
  "identifier": {"@type": "PropertyValue", "name": "Acme", "value": "7952282"},
  "datePosted": "2026-06-22T17:18:51+02:00",
  "employmentType": "FULL_TIME",
  "hiringOrganization": {"@type": "Organization", "name": "Acme Inc", "logo": "https://x/y.png", "sameAs": "https://acme.teamtailor.com"},
  "jobLocation": [{"@type":"Place","address":{"streetAddress":"Some St 1","addressLocality":"Stockholm","postalCode":"116 21","addressCountry":"SE","addressRegion":"Sweden","@type":"PostalAddress"}}]
}
</script>
</head><body></body></html>"""


def test_teamtailor_source_key_extraction():
    adapter = TeamtailorAtsAdapter()
    assert adapter.extract_source_key_from_url("https://acme.teamtailor.com/jobs") == "acme"
    assert adapter.extract_source_key_from_url("https://owlco.na.teamtailor.com/jobs/1-foo") == "owlco.na"
    assert adapter.extract_source_key_from_url("https://teamtailor.com/en/") is None
    assert adapter.extract_source_key_from_url("https://boards.greenhouse.io/acme") is None


def test_teamtailor_extract_job_urls_handles_absolute_and_relative_links():
    adapter = TeamtailorAtsAdapter()
    urls = adapter.extract_job_urls(TEAMTAILOR_LISTING_SAMPLE, "https://acme.teamtailor.com")
    assert urls == [
        "https://acme.teamtailor.com/jobs/8010892-midmarket-sdr-uk",
        "https://acme.teamtailor.com/jobs/7952282-legal-counsel",
    ]


def test_teamtailor_extract_job_posting_parses_ldjson():
    adapter = TeamtailorAtsAdapter()
    posting = adapter.extract_job_posting(TEAMTAILOR_DETAIL_SAMPLE, "https://acme.teamtailor.com/jobs/7952282-legal-counsel")
    assert posting["title"] == "Legal Counsel"
    assert posting["identifier"]["value"] == "7952282"
    assert posting["_url"] == "https://acme.teamtailor.com/jobs/7952282-legal-counsel"


def test_teamtailor_normalize_job():
    adapter = TeamtailorAtsAdapter()
    posting = adapter.extract_job_posting(TEAMTAILOR_DETAIL_SAMPLE, "https://acme.teamtailor.com/jobs/7952282-legal-counsel")
    job = adapter.normalize_job(posting, source_key="acme")
    assert job["provider"] == "teamtailor"
    assert job["ats_provider"] == "teamtailor"
    assert job["external_id"] == "acme:7952282"
    assert job["company"] == "Acme Inc"
    assert job["location"] == "Stockholm, Sweden"
    assert job["country_code"] == "se"
    assert job["selected_apply_url"] == "https://acme.teamtailor.com/jobs/7952282-legal-counsel"
    assert "Join us" in job["description"]
    assert job["auto_apply_supported"] is True


def test_teamtailor_extract_job_posting_returns_none_without_ldjson():
    adapter = TeamtailorAtsAdapter()
    assert adapter.extract_job_posting("<html><body>no data here</body></html>", "https://acme.teamtailor.com/jobs/1-x") is None
