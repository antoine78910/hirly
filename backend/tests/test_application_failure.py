from application_failure import (
    classify_application_failure,
    should_auto_expire_application,
    text_indicates_offer_expired,
)


def test_text_indicates_offer_expired_french():
    assert text_indicates_offer_expired("Désolé, cette offre a expiré")


def test_classify_offer_expired_from_job_record():
    result = classify_application_failure(
        {"submission_status": "prepared", "application_id": "app_1"},
        job_doc={
            "status": "expired",
            "apply_fulfillment_status": "blocked_expired",
            "validation_reason": "stale_not_seen_recently",
        },
    )
    assert result is not None
    assert result["code"] == "offer_expired"
    assert result["source"] == "job_record"


def test_classify_offer_expired_from_agent_post_submit_errors():
    result = classify_application_failure(
        {"submission_status": "failed", "application_id": "app_1"},
        latest_run={"post_submit_errors": ["Sorry, this offer has expired"]},
    )
    assert result is not None
    assert result["code"] == "offer_expired"
    assert result["source"] == "automation_text"


def test_should_auto_expire_open_application():
    app_doc = {"submission_status": "prepared", "application_id": "app_1"}
    classification = {"code": "offer_expired"}
    assert should_auto_expire_application(app_doc, classification) is True


def test_should_not_auto_expire_submitted_application():
    app_doc = {"submission_status": "submitted", "application_id": "app_1"}
    classification = {"code": "offer_expired"}
    assert should_auto_expire_application(app_doc, classification) is False
