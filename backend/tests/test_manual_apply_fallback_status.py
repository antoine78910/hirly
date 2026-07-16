"""Captcha / bot blocks stay user-visible for self-serve company-site apply."""


def test_blocked_captcha_stays_user_facing(monkeypatch):
    import server

    app = {
        "submission_status": "blocked_captcha",
        "prepared_missing_information": [],
    }
    assert server._effective_manual_status(app) is None
    assert server._user_facing_submission_status(app) == "blocked_captcha"


def test_blocked_without_questions_stays_user_facing():
    import server

    app = {
        "submission_status": "blocked",
        "prepared_missing_information": [],
    }
    assert server._effective_manual_status(app) is None
    assert server._user_facing_submission_status(app) == "blocked"


def test_prepare_failed_still_routes_to_manual_review():
    import server

    app = {
        "submission_status": "prepare_failed",
        "prepared_missing_information": [],
    }
    assert server._effective_manual_status(app) == "manual_review_needed"
    assert server._user_facing_submission_status(app) == "pending"


def test_public_application_doc_exposes_apply_url():
    import server

    app = {"submission_status": "blocked_captcha", "job_id": "j1"}
    job = {
        "job_id": "j1",
        "external_url": "https://jobs.smartrecruiters.com/Accor/example",
        "title": "Role",
        "company": "Accor",
    }
    public = server._public_application_doc(app, job_doc=job)
    assert public["user_facing_submission_status"] == "blocked_captcha"
    assert public["apply_url"] == "https://jobs.smartrecruiters.com/Accor/example"
