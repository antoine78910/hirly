from scripts.capture_sr_storage_state import (
    _exit_ip_for_log,
    _proxy_username_for_log,
)


def test_proxy_username_is_always_redacted_in_logs():
    assert _proxy_username_for_log("customer-zone-secret-sid-42") == "[redacted]"
    assert _proxy_username_for_log("") == "-"


def test_exit_ip_is_masked_by_default(monkeypatch):
    monkeypatch.delenv("SR_CAPTURE_LOG_EXIT_IP", raising=False)
    raw = '{"ip":"203.0.113.42"}'

    logged = _exit_ip_for_log(raw)

    assert logged.startswith("[masked;")
    assert "203.0.113.42" not in logged


def test_exit_ip_logging_requires_explicit_opt_in(monkeypatch):
    monkeypatch.setenv("SR_CAPTURE_LOG_EXIT_IP", "true")
    raw = '{"ip":"203.0.113.42"}'

    assert _exit_ip_for_log(raw) == raw
