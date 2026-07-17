import os

from apply_agent.browser_env import load_browser_secrets
from apply_agent.runtime_browser_config import RUNTIME_STICKY_SID, bundled_storage_state_json


def test_runtime_defaults_inject_sticky_and_cookies():
    os.environ.pop("BROWSER_PROXY_STICKY_SID", None)
    os.environ.pop("BROWSER_STORAGE_STATE_JSON", None)
    os.environ.pop("BROWSER_HEADLESS", None)
    load_browser_secrets(override=True)
    assert os.environ.get("BROWSER_PROXY_STICKY_SID") == str(RUNTIME_STICKY_SID)
    assert os.environ.get("BROWSER_PROXY_STICKY") == "1"
    assert os.environ.get("BROWSER_HEADLESS") == "0"
    bundled = bundled_storage_state_json()
    assert bundled
    assert os.environ.get("BROWSER_STORAGE_STATE_JSON") == bundled


def test_bundled_storage_has_cookies():
    import json

    data = json.loads(bundled_storage_state_json())
    assert isinstance(data.get("cookies"), list)
    assert len(data["cookies"]) >= 1
