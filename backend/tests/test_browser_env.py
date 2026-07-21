import json
import os
import subprocess
from pathlib import Path

import pytest

from apply_agent import browser_env
from apply_agent.runtime_browser_config import (
    apply_runtime_browser_defaults,
    browser_storage_state_json,
    validate_runtime_browser_environment,
)

_BROWSER_ENV_KEYS = (
    "BROWSER_PROXY",
    "BROWSER_PROXY_STICKY",
    "BROWSER_PROXY_STICKY_SID",
    "BROWSER_PROXY_STICKY_TTL",
    "BROWSER_STORAGE_STATE",
    "BROWSER_STORAGE_STATE_JSON",
    "BROWSER_HEADLESS",
)


def clear_browser_environment(monkeypatch):
    for key in _BROWSER_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def test_runtime_config_does_not_inject_browser_credentials_or_state(monkeypatch):
    clear_browser_environment(monkeypatch)

    apply_runtime_browser_defaults(force=True)

    assert all(key not in os.environ for key in _BROWSER_ENV_KEYS)


def test_load_browser_secrets_uses_only_untracked_environment(monkeypatch, tmp_path):
    clear_browser_environment(monkeypatch)
    monkeypatch.setattr(browser_env, "_BACKEND_ROOT", tmp_path)
    monkeypatch.setattr(browser_env, "SECRETS_PATH", tmp_path / ".browser-secrets.env")

    browser_env.load_browser_secrets(override=True)

    assert all(key not in os.environ for key in _BROWSER_ENV_KEYS)


def test_inline_storage_state_is_validated_without_rewriting(monkeypatch):
    clear_browser_environment(monkeypatch)
    value = json.dumps({"cookies": [], "origins": []})
    monkeypatch.setenv("BROWSER_STORAGE_STATE_JSON", value)

    validate_runtime_browser_environment()

    assert browser_storage_state_json() == value
    assert os.environ["BROWSER_STORAGE_STATE_JSON"] == value


@pytest.mark.parametrize(
    "value",
    (
        "not-json",
        "[]",
        '{"cookies": {}, "origins": []}',
        '{"cookies": [], "origins": {}}',
    ),
)
def test_invalid_inline_storage_state_fails_closed(monkeypatch, value):
    clear_browser_environment(monkeypatch)
    monkeypatch.setenv("BROWSER_STORAGE_STATE_JSON", value)

    with pytest.raises(RuntimeError):
        validate_runtime_browser_environment()


def test_ambiguous_or_partial_browser_secret_configuration_fails_closed(monkeypatch):
    clear_browser_environment(monkeypatch)
    monkeypatch.setenv("BROWSER_STORAGE_STATE_JSON", '{"cookies": [], "origins": []}')
    monkeypatch.setenv("BROWSER_STORAGE_STATE", "/run/secrets/browser-state.json")
    with pytest.raises(RuntimeError, match="only one"):
        validate_runtime_browser_environment()

    clear_browser_environment(monkeypatch)
    monkeypatch.setenv("BROWSER_PROXY_STICKY", "true")
    with pytest.raises(RuntimeError, match="STICKY_SID"):
        validate_runtime_browser_environment()

    clear_browser_environment(monkeypatch)
    monkeypatch.setenv("BROWSER_PROXY_STICKY_SID", "123")
    with pytest.raises(RuntimeError, match="BROWSER_PROXY"):
        validate_runtime_browser_environment()


def test_rotate_sticky_sid_changes_process_environment_not_tracked_source(monkeypatch):
    clear_browser_environment(monkeypatch)
    config_path = Path(browser_env.__file__).with_name("runtime_browser_config.py")
    before = config_path.read_bytes()

    browser_env.rotate_sticky_sid(321)

    assert os.environ["BROWSER_PROXY_STICKY_SID"] == "321"
    assert config_path.read_bytes() == before


def test_repository_tracks_only_empty_browser_storage_example():
    root = Path(__file__).resolve().parents[2]
    tracked = subprocess.run(
        ["git", "ls-files", "--", "backend/apply_agent/data"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.splitlines()

    assert tracked == ["backend/apply_agent/data/sr_storage_state.example.json"]
    example = json.loads((root / tracked[0]).read_text(encoding="utf-8"))
    assert example == {"cookies": [], "origins": []}


def test_runtime_sources_do_not_bundle_browser_secrets():
    root = Path(__file__).resolve().parents[2]
    runtime_source = (root / "backend/apply_agent/runtime_browser_config.py").read_text(
        encoding="utf-8"
    )
    capture_source = (root / "backend/scripts/capture_sr_storage_state.py").read_text(
        encoding="utf-8"
    )

    forbidden_runtime_fragments = (
        "RUNTIME_BROWSER_PROXY",
        "RUNTIME_STICKY_SID",
        "BUNDLED_STORAGE_STATE_PATH",
        'os.environ["BROWSER_PROXY"] =',
        'os.environ["BROWSER_STORAGE_STATE_JSON"] =',
    )
    assert not any(fragment in runtime_source for fragment in forbidden_runtime_fragments)
    assert "apply_agent/data/sr_storage_state.json" not in capture_source
    assert "git add apply_agent/data" not in capture_source
