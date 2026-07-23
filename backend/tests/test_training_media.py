"""Tests for private Supabase Storage-backed training video uploads."""

import asyncio
import io
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException, UploadFile

import training_media as media
import training_service as training
from training_media import (
    apply_upload_metadata,
    create_training_video_signed_url,
    merge_preserved_videos,
    save_training_video,
    training_video_storage_path,
    validate_video_upload,
)
from training_service import (
    SEED_COURSE_ID,
    SEED_CREATOR_ID,
    _normalize_lang,
    COURSE_I18N,
    MODULE_I18N,
    MODULE_SEED,
    sync_training_locale_content,
)


class _Collection:
    def __init__(self, document):
        self.document = document
        self.update = None

    async def find_one(self, *_args, **_kwargs):
        return self.document

    async def update_one(self, _filter, update):
        self.update = update


class _LocaleSyncDb:
    def __init__(self):
        self.training_courses = _Collection(
            {"course_id": SEED_COURSE_ID, "i18n": {"de": {"title": "Sprechende Köpfe"}}},
        )
        self.training_creators = _Collection(
            {"creator_id": SEED_CREATOR_ID, "i18n": {"de": {"display_name": "Hirly Akademie"}}},
        )


@pytest.mark.parametrize("locale", ["en", "fr-FR", "de-DE", "es_ES", "it"])
def test_training_video_storage_path_is_locale_specific(locale):
    path = training_video_storage_path("course_job_search_mastery", "mod_warm_up", "sec_wu_sop", locale)
    assert path == f"course_job_search_mastery/mod_warm_up/sec_wu_sop/{locale[:2].lower()}"


def test_training_video_storage_path_uses_module_marker_for_module_video():
    assert training_video_storage_path("course", "mod", None, "en") == "course/mod/_module/en"


def test_storage_migration_creates_a_private_video_bucket():
    repo_root = Path(__file__).resolve().parents[2]
    migration = (repo_root / "supabase/migrations/20260723214754_training_video_storage_bucket.sql").read_text()
    assert "'training-videos'" in migration
    assert "false" in migration
    assert "No storage.objects policies" in migration


def test_training_video_storage_path_rejects_unsupported_locale():
    with pytest.raises(HTTPException) as exc:
        training_video_storage_path("course", "mod", "sec_a", "pt")
    assert exc.value.status_code == 400


@pytest.mark.parametrize("locale", ["en", "fr-FR", "de-DE", "es_ES", "it"])
def test_training_service_keeps_supported_locale_for_localized_content(locale):
    assert _normalize_lang(locale) == locale[:2].lower()


def test_training_locale_sync_preserves_added_locale_packs():
    db = _LocaleSyncDb()
    asyncio.run(sync_training_locale_content(db))
    assert db.training_courses.update["$set"]["i18n"]["de"]["title"] == "Sprechende Köpfe"
    assert db.training_creators.update["$set"]["i18n"]["de"]["display_name"] == "Hirly Akademie"


def test_seeded_training_content_has_complete_english_and_french_packs():
    assert set(COURSE_I18N) >= {"en", "fr"}
    for locale in ("en", "fr"):
        assert COURSE_I18N[locale]["title"]
        assert COURSE_I18N[locale]["description"]

    for module in MODULE_SEED:
        packs = MODULE_I18N[module["module_id"]]
        assert set(packs) >= {"en", "fr"}
        assert packs["en"]["title"]
        assert packs["fr"]["title"]
        assert packs["en"]["description"]
        assert packs["fr"]["description"]
        assert [section["section_id"] for section in packs["en"]["sections"]] == [
            section["section_id"] for section in packs["fr"]["sections"]
        ]


def test_validate_video_upload_accepts_mp4():
    upload = UploadFile(filename="lesson.mp4", file=io.BytesIO(b"fake"), headers={"content-type": "video/mp4"})
    ext = validate_video_upload(upload, b"fake")
    assert ext == ".mp4"


def test_save_training_video_uploads_private_object_and_returns_signed_url(monkeypatch):
    calls = []

    async def fake_storage_request(method, endpoint, **kwargs):
        calls.append((method, endpoint, kwargs))
        if endpoint.startswith("/storage/v1/object/sign/"):
            return httpx.Response(200, json={"signedURL": "/storage/v1/object/sign/training-videos/course/mod/sec_a/de?token=signed"})
        return httpx.Response(200, json={"Key": "course/mod/sec_a/de"})

    monkeypatch.setattr(media, "_storage_api_request", fake_storage_request)
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "server-only-key")
    upload = UploadFile(
        filename="lesson-de.mp4",
        file=io.BytesIO(b"new German video"),
        headers={"content-type": "video/mp4"},
    )

    storage_path, signed_url = asyncio.run(save_training_video(upload, "course", "mod", "sec_a", "de-DE"))

    assert storage_path == "course/mod/sec_a/de"
    assert signed_url == "https://example.supabase.co/storage/v1/object/sign/training-videos/course/mod/sec_a/de?token=signed"
    assert calls[0][0] == "POST"
    assert calls[0][1] == "/storage/v1/object/training-videos/course/mod/sec_a/de"
    assert calls[0][2]["content"] == b"new German video"
    assert calls[0][2]["headers"] == {
        "Content-Type": "video/mp4",
        "x-upsert": "true",
        "cache-control": "3600",
    }
    assert calls[1][1].startswith("/storage/v1/object/sign/training-videos/course/mod/sec_a/de")


def test_create_signed_url_requires_server_storage_configuration(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_SECRET_KEY", raising=False)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(create_training_video_signed_url("course/mod/_module/en"))
    assert exc.value.status_code == 503


def test_validate_video_upload_rejects_empty():
    upload = UploadFile(filename="lesson.mp4", file=io.BytesIO(b""))
    with pytest.raises(HTTPException) as exc:
        validate_video_upload(upload, b"")
    assert exc.value.status_code == 400


def test_validate_video_upload_rejects_an_unsupported_video_mime_type():
    upload = UploadFile(
        filename="lesson.avi",
        file=io.BytesIO(b"not a supported lesson video"),
        headers={"content-type": "video/x-msvideo"},
    )
    with pytest.raises(HTTPException) as exc:
        validate_video_upload(upload, b"not a supported lesson video")
    assert exc.value.status_code == 400


def test_resolve_media_file_falls_back_to_a_single_unlabelled_legacy_video(tmp_path, monkeypatch):
    slot_dir = tmp_path / "course" / "mod" / "sec_a"
    slot_dir.mkdir(parents=True)
    video = slot_dir / "swiping features.mp4"
    video.write_bytes(b"fake")

    monkeypatch.setattr(media, "MEDIA_ROOT", tmp_path)
    assert media.resolve_media_file("course", "mod", "sec_a", "fr") == video


def test_resolve_media_file_never_falls_back_to_another_locale(tmp_path, monkeypatch):
    slot_dir = tmp_path / "course" / "mod" / "sec_a"
    slot_dir.mkdir(parents=True)
    english_video = slot_dir / "en.mp4"
    english_video.write_bytes(b"fake")

    monkeypatch.setattr(media, "MEDIA_ROOT", tmp_path)
    assert media.resolve_media_file("course", "mod", "sec_a", "en") == english_video
    assert media.resolve_media_file("course", "mod", "sec_a", "fr") is None


def test_merge_preserved_videos_keeps_private_paths():
    seed = {
        "en": {"title": "Warm Up", "video_url": "", "sections": [{"section_id": "sec_a", "video_url": ""}]},
        "fr": {"title": "Chauffer", "video_url": "", "sections": [{"section_id": "sec_a", "video_url": ""}]},
    }
    existing = {
        "i18n": {
            "en": {
                "video_storage_path": "course/mod/_module/en",
                "sections": [{"section_id": "sec_a", "video_storage_path": "course/mod/sec_a/en"}],
            },
        },
    }
    merged = merge_preserved_videos(seed, existing)
    assert merged["en"]["video_storage_path"] == "course/mod/_module/en"
    assert merged["en"]["video_url"] == ""
    assert merged["en"]["sections"][0]["video_storage_path"] == "course/mod/sec_a/en"


def test_upload_metadata_uses_a_private_path_for_the_requested_locale():
    updated = apply_upload_metadata(
        {},
        "sec_a",
        "de-DE",
        "course/mod/sec_a/de",
        "lesson-de.mp4",
    )
    section = updated["de"]["sections"][0]
    assert section["video_storage_path"] == "course/mod/sec_a/de"
    assert section["video_url"] == ""
    assert section["video_filename"] == "lesson-de.mp4"


def test_merge_preserved_videos_keeps_new_locale_video_only_sections():
    seed = {"en": {"title": "Warm Up", "sections": []}, "fr": {"title": "Chauffer", "sections": []}}
    existing = {
        "i18n": {
            "it": {
                "title": "Riscaldamento",
                "sections": [{"section_id": "sec_a", "video_storage_path": "course/mod/sec_a/it"}],
            },
        },
    }
    merged = merge_preserved_videos(seed, existing)
    assert merged["it"]["title"] == "Riscaldamento"
    assert merged["it"]["sections"][0]["video_storage_path"] == "course/mod/sec_a/it"


def test_authorized_course_detail_resolves_private_paths_to_signed_urls(monkeypatch):
    async def fake_signed_url(path):
        return f"https://example.supabase.co/signed/{path}"

    monkeypatch.setattr(training, "create_training_video_signed_url", fake_signed_url)
    module = {
        "i18n": {
            "de": {
                "video_storage_path": "course/mod/_module/de",
                "sections": [{"section_id": "sec_a", "video_storage_path": "course/mod/sec_a/de"}],
            },
        },
    }

    localized = asyncio.run(training._resolve_localized_video_urls(module, "de"))

    assert localized["video_url"] == "https://example.supabase.co/signed/course/mod/_module/de"
    assert localized["sections"][0]["video_url"] == "https://example.supabase.co/signed/course/mod/sec_a/de"
    assert "video_storage_path" not in localized
    assert "video_storage_path" not in localized["sections"][0]


def test_upload_training_video_persists_path_not_signed_url(monkeypatch):
    collection = _Collection({"module_id": "mod", "course_id": "course", "i18n": {"en": {}}})

    class Db:
        training_modules = collection

    async def fake_save(*_args, **_kwargs):
        return "course/mod/_module/en", "https://example.supabase.co/temporary-signed-url"

    monkeypatch.setattr(training, "save_training_video", fake_save)
    upload = UploadFile(filename="lesson.mp4", file=io.BytesIO(b"video"), headers={"content-type": "video/mp4"})

    result = asyncio.run(training.upload_training_video(Db(), "course", "mod", None, "en", upload))

    saved = collection.update["$set"]
    assert saved["i18n"]["en"]["video_storage_path"] == "course/mod/_module/en"
    assert saved["i18n"]["en"]["video_url"] == ""
    assert saved["video_storage_path"] == "course/mod/_module/en"
    assert saved["video_url"] == ""
    assert result["video_url"] == "https://example.supabase.co/temporary-signed-url"
