import pytest

from scripts.capture_sr_storage_state import (
    _exit_ip_for_log,
    _proxy_username_for_log,
)


def test_proxy_username_is_always_redacted_in_logs():
    assert _proxy_username_for_log("customer-zone-secret-sid-42") == "[redacted]"
    assert _proxy_username_for_log("") == "-"


@pytest.mark.parametrize(
    ("setting", "raw"),
    [
        (None, '{"ip":"203.0.113.42"}'),
        ("0", '{"ip":"2001:db8::42"}'),
        ("false", "(ip check failed: proxy customer secret)"),
    ],
)
def test_exit_ip_is_masked_by_default(monkeypatch, setting, raw):
    if setting is None:
        monkeypatch.delenv("SR_CAPTURE_LOG_EXIT_IP", raising=False)
    else:
        monkeypatch.setenv("SR_CAPTURE_LOG_EXIT_IP", setting)

    logged = _exit_ip_for_log(raw)

    assert logged.startswith("[masked;")
    assert raw not in logged


@pytest.mark.parametrize("setting", ["1", "true", "yes", "on", "TRUE"])
def test_exit_ip_logging_requires_explicit_opt_in(monkeypatch, setting):
    monkeypatch.setenv("SR_CAPTURE_LOG_EXIT_IP", setting)
    raw = '{"ip":"203.0.113.42"}'

    assert _exit_ip_for_log(raw) == raw
