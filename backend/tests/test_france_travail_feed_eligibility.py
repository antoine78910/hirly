from job_providers.apply_eligibility import (
    classify_apply_link,
    is_france_travail_offer,
    is_manual_fulfillment_ready,
)
from job_providers.base import JobSearchQuery
from job_providers.france_travail import FranceTravailProvider
from job_validation import cheap_validate_job_applyability
from jobs_service import _provider_attempt_queries

import server

def test_france_travail_apply_link_is_manual_ready():
    url = "https://candidat.francetravail.fr/offres/recherche/detail/048KLTP"
    result = classify_apply_link(url, source="France Travail")
    assert result["apply_fulfillment_status"] == "manual_ready"
    assert result["manual_fulfillment_ready"] is True


def test_france_travail_cheap_validation_is_feed_visible():
    url = "https://candidat.francetravail.fr/offres/recherche/detail/048KLTP"
    job = {
        "provider": "france_travail",
        "source": "France Travail",
        "external_url": url,
        "selected_apply_url": url,
        "title": "Developpeur web",
        "company": "Acme",
        "location": "Dijon (21)",
        "city": "Dijon",
        "country_code": "fr",
    }
    validation = cheap_validate_job_applyability(job)
    assert validation["applyability_tier"] == "C"
    assert validation["validation_status"] in {"valid", "unknown"}
    assert validation["manual_fulfillment_ready"] is True
    assert validation["requires_login"] is False
    assert server._job_is_blocked_for_feed({**job, **validation}) is False
    assert server._job_is_applyable({**job, **validation}) is True
    assert is_manual_fulfillment_ready({**job, **validation}) is True


def test_legacy_tier_d_france_travail_job_still_visible_in_feed(monkeypatch):
    url = "https://candidat.francetravail.fr/offres/recherche/detail/048KLTP"
    job = {
        "job_id": "job_ft_1",
        "title": "Developpeur web",
        "company": "Acme",
        "location": "Dijon (21)",
        "city": "Dijon",
        "country_code": "fr",
        "description": "Developpeur logiciel JavaScript.",
        "provider": "france_travail",
        "source": "France Travail",
        "external_id": "048KLTP",
        "external_url": url,
        "selected_apply_url": url,
        "validation_status": "invalid",
        "applyability_tier": "D",
        "manual_fulfillment_ready": False,
        "apply_fulfillment_status": "blocked_user_account_required",
        "requires_login": True,
        "requires_account_creation": True,
        "posted_at": "2026-06-01T10:00:00+00:00",
        "imported_at": "2026-06-01T10:00:00+00:00",
    }
    assert server._job_is_blocked_for_feed(job) is False
    assert server._job_is_applyable(job) is True


def test_is_france_travail_offer_false_when_direct_external_apply_url():
    """A France Travail offer whose contact.urlPostulation points to the
    employer's own ATS should NOT be treated as the FT-only manual flow."""
    assert is_france_travail_offer(
        provider="france_travail",
        source="France Travail",
        url="https://boards.greenhouse.io/acme/jobs/12345",
    ) is False
    assert is_france_travail_offer(
        provider="france_travail",
        source="France Travail",
        url="https://candidat.francetravail.fr/offres/recherche/detail/048KLTP",
    ) is True
    assert is_france_travail_offer(provider="france_travail", source="France Travail", url="") is True


def test_france_travail_direct_apply_url_gets_normal_ats_classification():
    url = "https://boards.greenhouse.io/acme/jobs/12345"
    result = classify_apply_link(url, source="France Travail")
    assert result["apply_fulfillment_status"] == "manual_ready"
    assert result["apply_url_provider"] == "greenhouse"


def test_france_travail_provider_uses_single_attempt_query():
    provider = FranceTravailProvider(client_id="PAR_test", client_secret="secret")
    query = JobSearchQuery(role="Software Engineer", location="Dijon", country="fr", language="fr", radius_km=50)
    attempts = _provider_attempt_queries(query, "50km", provider)
    assert len(attempts) == 1
    assert attempts[0].role == "Software Engineer"
