import json

import pytest

from creator_social_registry import REGISTRY_PATH, add_creator, load_registry, save_registry


def test_add_creator_persists_handle(tmp_path, monkeypatch):
    registry_path = tmp_path / "creators.json"
    monkeypatch.setattr("creator_social_registry.REGISTRY_PATH", registry_path)
    save_registry([])

    row = add_creator(platform="tiktok", handle="@newcreator", name="New Creator")
    assert row["handle"] == "newcreator"
    assert row["platform"] == "tiktok"
    assert row["creator_id"]

    stored = json.loads(registry_path.read_text(encoding="utf-8"))
    assert len(stored) == 1
    assert stored[0]["handle"] == "newcreator"


def test_add_creator_rejects_duplicate(tmp_path, monkeypatch):
    registry_path = tmp_path / "creators.json"
    monkeypatch.setattr("creator_social_registry.REGISTRY_PATH", registry_path)
    save_registry([
        {
            "creator_id": "eva",
            "name": "Eva",
            "platform": "tiktok",
            "handle": "hirlyjob",
            "profile_url": "https://www.tiktok.com/@hirlyjob",
            "tags": [],
        },
    ])

    with pytest.raises(ValueError, match="already tracked"):
        add_creator(platform="tiktok", handle="hirlyjob")
