from job_providers.base import JobSearchQuery
from jobs_service import _job_matches_query_location


def test_job_matches_query_location_requires_city_when_location_is_set():
    query = JobSearchQuery(role="Software Engineer", location="Dijon", country="fr", language="fr")
    paris_job = {"location": "Paris (75)", "city": "Paris", "country_code": "fr"}
    dijon_job = {"location": "Dijon (21)", "city": "Dijon", "country_code": "fr"}

    assert _job_matches_query_location(paris_job, query, "50km") is False
    assert _job_matches_query_location(dijon_job, query, "50km") is True


def test_job_matches_query_location_allows_country_only_when_no_city_query():
    query = JobSearchQuery(role="Software Engineer", location=None, country="fr", language="fr")
    paris_job = {"location": "Paris (75)", "city": "Paris", "country_code": "fr"}

    assert _job_matches_query_location(paris_job, query, "50km") is True
