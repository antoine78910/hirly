import importlib.util
from pathlib import Path


def _load_script():
    path = Path(__file__).resolve().parent.parent / "scripts" / "smoke_job_cache_system.py"
    spec = importlib.util.spec_from_file_location("smoke_job_cache_system", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_smoke_helper_defaults_to_dry_run(monkeypatch):
    script = _load_script()
    calls = []

    def fake_call(base_url, token, method, path, payload):
        calls.append((method, path, payload))
        return 200, {"ok": True}

    monkeypatch.setattr(script, "_call", fake_call)
    monkeypatch.setenv("BACKEND_URL", "https://backend.example.com")
    monkeypatch.setenv("ADMIN_AUTH_TOKEN", "token")
    monkeypatch.delenv("DRY_RUN", raising=False)
    assert script.main() == 0
    write_payloads = [payload for _, _, payload in calls if payload is not None]
    assert write_payloads
    assert all(payload.get("dry_run") is True for payload in write_payloads)


def test_smoke_helper_requires_auth_env(monkeypatch, capsys):
    script = _load_script()
    monkeypatch.delenv("BACKEND_URL", raising=False)
    monkeypatch.delenv("ADMIN_AUTH_TOKEN", raising=False)
    assert script.main() == 2
    assert "BACKEND_URL and ADMIN_AUTH_TOKEN are required" in capsys.readouterr().err
