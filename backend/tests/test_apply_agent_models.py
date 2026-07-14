from apply_agent.models import ApplyRunResult


def test_apply_run_result_to_dict_includes_submission_email_default():
    result = ApplyRunResult(provider="greenhouse", application_url="https://example.com", domain="example.com")
    assert result.to_dict()["submission_email"] == ""


def test_apply_run_result_to_dict_includes_submission_email_when_set():
    result = ApplyRunResult(provider="greenhouse", application_url="https://example.com", domain="example.com")
    result.submission_email = "app_abc123@inbox.tryhirly.com"
    assert result.to_dict()["submission_email"] == "app_abc123@inbox.tryhirly.com"
