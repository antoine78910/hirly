import json

from job_providers.ats_detection import (
    APPLICATION_CAPABILITIES,
    _BUNDLED_CAPABILITY_CATALOGUE_PATH,
    _REPOSITORY_CAPABILITY_CATALOGUE_PATH,
    _load_application_capabilities,
    PRIMARY_AUTO_APPLY_ATS,
    detect_ats_from_html,
    detect_ats_from_url,
    detect_job_platform,
    is_known_job_board_or_discovery_domain,
    is_known_login_required_domain,
)


def test_detect_public_ats_urls():
    cases = {
        "https://boards.greenhouse.io/acme/jobs/123": "greenhouse",
        "https://job-boards.greenhouse.io/acme/jobs/123": "greenhouse",
        "https://jobs.lever.co/acme/123": "lever",
        "https://jobs.ashbyhq.com/acme/123": "ashby",
        "https://careers.recruitee.com/acme/jobs/123": "recruitee",
        "https://jobs.smartrecruiters.com/acme/123": "smartrecruiters",
        "https://acme.wd3.myworkdayjobs.com/jobs/job/123": "workday",
        "https://careers-acme.icims.com/jobs/123": "icims",
        "https://acme.teamtailor.com/jobs/123": "teamtailor",
        "https://careers.flatchr.io/fr/company/acme/jobs/123": "flatchr",
        "https://app.taleez.com/careers/acme/jobs/123": "taleez",
        "https://acme.werecruit.io/jobs/123": "werecruit",
        "https://acme.digitalrecruiters.com/offer/123": "digitalrecruiters",
        "https://acme.jobaffinity.fr/jobs/123": "jobaffinity",
        "https://apply.workable.com/acme/j/123": "workable",
        "https://jobs.personio.com/job/123": "personio",
        "https://acme.bamboohr.com/careers/123": "bamboohr",
        "https://jobs.sap.com/job/123": "successfactors",
        "https://careers-acme.breezy.hr/p/123-title/apply": "breezyhr",
    }
    for url, provider in cases.items():
        assert detect_ats_from_url(url) == provider
        assert detect_job_platform(url)["category"] == "direct_ats"


def test_primary_auto_apply_ats_requires_the_full_runtime_capability():
    expected = {
        "greenhouse",
        "smartrecruiters",
        "taleez",
        "teamtailor",
        "jobaffinity",
    }
    assert PRIMARY_AUTO_APPLY_ATS == expected
    assert PRIMARY_AUTO_APPLY_ATS == {
        provider
        for provider, capability in APPLICATION_CAPABILITIES.items()
        if capability["driverRegistered"]
        and capability["queuePermitted"]
        and capability["noSubmitVerified"]
    }
    assert {"lever", "ashby", "werecruit", "flatchr", "personio", "breezyhr"}.isdisjoint(
        PRIMARY_AUTO_APPLY_ATS
    )


def test_application_capability_catalogue_has_strict_boolean_fields():
    required = {
        "urlDetection",
        "inventoryConnector",
        "tenantExtraction",
        "driverRegistered",
        "queuePermitted",
        "noSubmitVerified",
    }
    assert APPLICATION_CAPABILITIES
    for capability in APPLICATION_CAPABILITIES.values():
        assert set(capability) == required
        assert all(isinstance(capability[field], bool) for field in required)
        assert capability["urlDetection"]
        if capability["queuePermitted"] or capability["noSubmitVerified"]:
            assert capability["driverRegistered"]


def test_backend_bundled_capability_catalogue_matches_reviewed_source():
    reviewed = json.loads(
        _REPOSITORY_CAPABILITY_CATALOGUE_PATH.read_text(encoding="utf-8")
    )
    bundled = json.loads(
        _BUNDLED_CAPABILITY_CATALOGUE_PATH.read_text(encoding="utf-8")
    )
    assert bundled == reviewed


def test_backend_root_deployment_loads_bundled_capability_catalogue():
    capabilities = _load_application_capabilities(
        (_BUNDLED_CAPABILITY_CATALOGUE_PATH,)
    )
    assert capabilities == APPLICATION_CAPABILITIES
    assert {
        provider
        for provider, capability in capabilities.items()
        if capability["driverRegistered"]
        and capability["queuePermitted"]
        and capability["noSubmitVerified"]
    } == PRIMARY_AUTO_APPLY_ATS


def test_detect_html_markers():
    assert detect_ats_from_html("<a href='https://jobs.lever.co/acme/123'>Apply</a>") == "lever"


def test_reject_login_and_discovery_domains():
    for url in (
        "https://www.linkedin.com/jobs/view/123",
        "https://www.indeed.com/viewjob?jk=123",
        "https://www.glassdoor.com/job-listing/123",
        "https://candidat.francetravail.fr/offres/recherche/detail/123",
        "https://www.hellowork.com/fr-fr/emplois/123.html",
        "https://www.apec.fr/candidat/recherche-emploi.html",
        "https://www.welcometothejungle.com/fr/companies/acme/jobs/123",
        "https://www.monster.com/job-openings/123",
        "https://www.ziprecruiter.com/jobs/123",
    ):
        assert is_known_login_required_domain(url)
        assert detect_job_platform(url)["category"] == "account_required"

    for url in (
        "https://www.google.com/search?q=marketing+jobs&ibp=htl;jobs",
        "https://www.simplyhired.com/job/123",
        "https://www.talent.com/view?id=123",
        "https://www.adzuna.com/details/123",
        "https://jooble.org/job/123",
    ):
        assert is_known_job_board_or_discovery_domain(url)
        assert detect_job_platform(url)["category"] == "discovery_only"
