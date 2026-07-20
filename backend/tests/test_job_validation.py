import job_validation
from job_validation import cheap_validate_job_applyability


def _job(url, **extra):
    return {
        "job_id": "job_test",
        "title": "Marketing Manager",
        "company": "Acme",
        "external_url": url,
        "description": "Lead acquisition campaigns.",
        **extra,
    }


def test_valid_greenhouse_job_is_tier_a():
    result = cheap_validate_job_applyability(_job("https://boards.greenhouse.io/acme/jobs/123"))
    assert result["validation_status"] == "valid"
    assert result["applyability_tier"] == "A"
    assert result["ats_provider"] == "greenhouse"
    assert result["auto_apply_supported"] is True


def test_valid_lever_job_is_tier_b_without_registered_driver():
    result = cheap_validate_job_applyability(_job("https://jobs.lever.co/acme/123"))
    assert result["validation_status"] == "valid"
    assert result["applyability_tier"] == "B"
    assert result["ats_provider"] == "lever"
    assert result["auto_apply_supported"] is False


def test_valid_ashby_job_is_tier_b_without_registered_driver():
    result = cheap_validate_job_applyability(_job("https://jobs.ashbyhq.com/acme/123"))
    assert result["validation_status"] == "valid"
    assert result["applyability_tier"] == "B"
    assert result["ats_provider"] == "ashby"
    assert result["auto_apply_supported"] is False


def test_linkedin_apply_url_is_tier_d():
    result = cheap_validate_job_applyability(_job("https://www.linkedin.com/jobs/view/123"))
    assert result["validation_status"] == "invalid"
    assert result["applyability_tier"] == "D"
    assert result["requires_login"] is True
    assert result["rejection_reason"] == "login_or_account_required"


def test_france_travail_apply_url_is_tier_d():
    result = cheap_validate_job_applyability(_job("https://candidat.francetravail.fr/offres/recherche/detail/123"))
    assert result["validation_status"] == "invalid"
    assert result["applyability_tier"] == "D"
    assert result["requires_account_creation"] is True


def test_missing_apply_url_is_tier_e():
    result = cheap_validate_job_applyability(_job(None))
    assert result["validation_status"] == "invalid"
    assert result["applyability_tier"] == "E"
    assert result["rejection_reason"] == "missing_apply_url"


def test_unknown_company_career_url_is_tier_c():
    result = cheap_validate_job_applyability(_job("https://careers.acme.com/jobs/123"))
    assert result["validation_status"] == "unknown"
    assert result["applyability_tier"] == "C"
    assert result["manual_fulfillment_ready"] is True


def test_expired_job_is_tier_e():
    result = cheap_validate_job_applyability(_job("https://boards.greenhouse.io/acme/jobs/123", description="This job is no longer available."))
    assert result["validation_status"] == "invalid"
    assert result["applyability_tier"] == "E"
    assert result["rejection_reason"] == "expired_or_closed"


def test_validator_failure_returns_unknown(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("broken")

    monkeypatch.setattr(job_validation, "classify_apply_link", boom)
    result = cheap_validate_job_applyability(_job("https://boards.greenhouse.io/acme/jobs/123"))
    assert result["validation_status"] == "unknown"
    assert result["applyability_tier"] == "C"
