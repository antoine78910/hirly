from apply_agent.browser_env import load_browser_secrets, rotate_sticky_sid, secrets_path


def test_load_browser_secrets_reads_sidecar(monkeypatch, tmp_path):
    secrets = tmp_path / ".browser-secrets.env"
    secrets.write_text(
        "BROWSER_PROXY_STICKY_SID=777\nBROWSER_PROXY_STICKY=1\n",
        encoding="utf-8",
    )
    monkeypatch.setattr("apply_agent.browser_env.SECRETS_PATH", secrets)
    monkeypatch.setattr("apply_agent.browser_env._BACKEND_ROOT", tmp_path)
    monkeypatch.setattr("apply_agent.browser_env.STORAGE_RAILWAY_PATH", tmp_path / "missing.txt")
    monkeypatch.setattr("apply_agent.browser_env.STORAGE_JSON_PATH", tmp_path / "missing.json")
    monkeypatch.delenv("BROWSER_PROXY_STICKY_SID", raising=False)
    load_browser_secrets(override=True)
    import os

    assert os.environ.get("BROWSER_PROXY_STICKY_SID") == "777"


def test_rotate_sticky_sid(tmp_path, monkeypatch):
    secrets = tmp_path / ".browser-secrets.env"
    secrets.write_text("BROWSER_PROXY_STICKY_SID=1\n", encoding="utf-8")
    monkeypatch.setattr("apply_agent.browser_env.SECRETS_PATH", secrets)
    rotate_sticky_sid(424)
    assert "BROWSER_PROXY_STICKY_SID=424" in secrets.read_text(encoding="utf-8")
    assert secrets_path() == secrets
