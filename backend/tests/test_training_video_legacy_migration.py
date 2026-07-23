"""Tests for the dry-run-first legacy training video migration command."""

import asyncio
import importlib.util
import sys
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "migrate_training_videos_to_supabase.py"
SPEC = importlib.util.spec_from_file_location("training_video_legacy_migration", SCRIPT_PATH)
assert SPEC and SPEC.loader
legacy_migration = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = legacy_migration
SPEC.loader.exec_module(legacy_migration)


def test_discovery_maps_the_legacy_localized_layout_to_private_paths(tmp_path):
    video_path = tmp_path / "course" / "mod" / "sec_a" / "fr.mp4"
    video_path.parent.mkdir(parents=True)
    video_path.write_bytes(b"french video")

    videos, skipped = legacy_migration.discover_legacy_training_videos(tmp_path)

    assert skipped == []
    assert len(videos) == 1
    video = videos[0]
    assert video.source_path == video_path
    assert video.locale == "fr"
    assert video.content_type == "video/mp4"
    assert video.storage_path == "course/mod/sec_a/fr"


def test_discovery_skips_an_unlabelled_legacy_drop_in_without_guessing_its_locale(tmp_path):
    video_path = tmp_path / "course" / "mod" / "sec_a" / "swiping examples.mp4"
    video_path.parent.mkdir(parents=True)
    video_path.write_bytes(b"video")

    videos, skipped = legacy_migration.discover_legacy_training_videos(tmp_path)

    assert videos == []
    assert len(skipped) == 1
    assert "unsupported locale filename" in skipped[0]


def test_dry_run_plans_without_creating_a_database_adapter(tmp_path, monkeypatch):
    video_path = tmp_path / "course" / "mod" / "_module" / "de.webm"
    video_path.parent.mkdir(parents=True)
    video_path.write_bytes(b"german video")
    videos, skipped = legacy_migration.discover_legacy_training_videos(tmp_path)

    def fail_if_called():
        raise AssertionError("dry run must not construct a database adapter")

    monkeypatch.setattr(legacy_migration, "create_database_adapter", fail_if_called)

    summary = asyncio.run(legacy_migration.migrate_legacy_training_videos(videos, apply=False))

    assert skipped == []
    assert summary == {"discovered": 1, "migrated": 0, "planned": 1, "failed": []}


def test_apply_uploads_before_persisting_localized_storage_metadata(tmp_path, monkeypatch):
    video_path = tmp_path / "course" / "mod" / "sec_a" / "it.m4v"
    video_path.parent.mkdir(parents=True)
    video_path.write_bytes(b"italian video")
    videos, skipped = legacy_migration.discover_legacy_training_videos(tmp_path)
    assert skipped == []

    events = []

    class Collection:
        async def find_one(self, _filter, _projection):
            return {
                "course_id": "course",
                "module_id": "mod",
                "i18n": {"it": {"title": "Modulo", "sections": [{"section_id": "sec_a", "title": "Lezione"}]}},
            }

        async def update_one(self, _filter, update):
            events.append(("metadata", _filter, update))

    class Db:
        def __init__(self):
            self.training_modules = Collection()

        async def close(self):
            events.append(("closed",))

    async def store(path, content, content_type):
        events.append(("storage", path, content, content_type))

    monkeypatch.setattr(legacy_migration, "create_database_adapter", Db)
    monkeypatch.setattr(legacy_migration, "store_training_video_object", store)

    summary = asyncio.run(legacy_migration.migrate_legacy_training_videos(videos, apply=True))

    assert summary == {"discovered": 1, "migrated": 1, "planned": 0, "failed": []}
    assert events[0] == ("storage", "course/mod/sec_a/it", b"italian video", "video/x-m4v")
    assert events[1][0] == "metadata"
    saved_section = events[1][2]["$set"]["i18n"]["it"]["sections"][0]
    assert saved_section["video_storage_path"] == "course/mod/sec_a/it"
    assert saved_section["video_url"] == ""
    assert events[-1] == ("closed",)
