"""Tests for training video uploads."""

import asyncio
import io

import pytest
from fastapi import HTTPException, UploadFile

from training_media import (
    apply_upload_metadata,
    media_public_path,
    merge_preserved_videos,
    save_training_video,
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


def test_media_public_path_module_level():
    path = media_public_path("course_job_search_mastery", "mod_getting_started", None, "en")
    assert path == "/api/training/media/course_job_search_mastery/mod_getting_started/_module/en"


def test_media_public_path_section():
    path = media_public_path("course_job_search_mastery", "mod_warm_up", "sec_wu_sop", "fr")
    assert path.endswith("/mod_warm_up/sec_wu_sop/fr")


@pytest.mark.parametrize("locale", ["de", "es", "it", "de-DE", "es_ES", "it-IT"])
def test_media_public_path_supports_new_training_locales(locale):
    path = media_public_path("course", "mod", "sec_a", locale)
    assert path.endswith(f"/{locale[:2].lower()}")


def test_media_public_path_rejects_unsupported_locale():
    with pytest.raises(HTTPException) as exc:
        media_public_path("course", "mod", "sec_a", "pt")
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


def test_save_training_video_replaces_only_the_selected_locale(tmp_path, monkeypatch):
    import training_media as media

    slot_dir = tmp_path / "course" / "mod" / "sec_a"
    slot_dir.mkdir(parents=True)
    (slot_dir / "de.webm").write_bytes(b"previous German video")
    (slot_dir / "en.mp4").write_bytes(b"English video")
    upload = UploadFile(
        filename="lesson-de.mp4",
        file=io.BytesIO(b"new German video"),
        headers={"content-type": "video/mp4"},
    )

    monkeypatch.setattr(media, "MEDIA_ROOT", tmp_path)
    destination, public_path = asyncio.run(save_training_video(upload, "course", "mod", "sec_a", "de-DE"))

    assert destination == slot_dir / "de.mp4"
    assert destination.read_bytes() == b"new German video"
    assert not (slot_dir / "de.webm").exists()
    assert (slot_dir / "en.mp4").read_bytes() == b"English video"
    assert public_path.endswith("/de")


def test_validate_video_upload_rejects_empty():
    upload = UploadFile(filename="lesson.mp4", file=io.BytesIO(b""))
    with pytest.raises(HTTPException) as exc:
        validate_video_upload(upload, b"")
    assert exc.value.status_code == 400


def test_resolve_media_file_falls_back_to_any_video_in_slot(tmp_path, monkeypatch):
    import training_media as media

    slot_dir = tmp_path / "course" / "mod" / "sec_a"
    slot_dir.mkdir(parents=True)
    video = slot_dir / "swiping features.mp4"
    video.write_bytes(b"fake")

    monkeypatch.setattr(media, "MEDIA_ROOT", tmp_path)
    resolved = media.resolve_media_file("course", "mod", "sec_a", "fr")
    assert resolved == video


def test_resolve_media_file_never_falls_back_to_another_locale(tmp_path, monkeypatch):
    import training_media as media

    slot_dir = tmp_path / "course" / "mod" / "sec_a"
    slot_dir.mkdir(parents=True)
    english_video = slot_dir / "en.mp4"
    english_video.write_bytes(b"fake")

    monkeypatch.setattr(media, "MEDIA_ROOT", tmp_path)
    assert media.resolve_media_file("course", "mod", "sec_a", "en") == english_video
    assert media.resolve_media_file("course", "mod", "sec_a", "fr") is None


def test_merge_preserved_videos_keeps_uploaded_urls():
    seed = {
        "en": {"title": "Warm Up", "video_url": "", "sections": [{"section_id": "sec_a", "video_url": ""}]},
        "fr": {"title": "Chauffer", "video_url": "", "sections": [{"section_id": "sec_a", "video_url": ""}]},
    }
    existing = {
        "i18n": {
            "en": {
                "video_url": "/api/training/media/course/mod/_module/en",
                "sections": [{"section_id": "sec_a", "video_url": "/api/training/media/course/mod/sec_a/en"}],
            },
        },
    }
    merged = merge_preserved_videos(seed, existing)
    assert merged["en"]["video_url"].endswith("/en")
    assert merged["en"]["sections"][0]["video_url"].endswith("/sec_a/en")


def test_upload_metadata_uses_the_requested_new_locale():
    updated = apply_upload_metadata(
        {},
        "sec_a",
        "de-DE",
        "/api/training/media/course/mod/sec_a/de",
        "lesson-de.mp4",
    )
    section = updated["de"]["sections"][0]
    assert section["video_url"].endswith("/de")
    assert section["video_filename"] == "lesson-de.mp4"


def test_merge_preserved_videos_keeps_new_locale_video_only_sections():
    seed = {"en": {"title": "Warm Up", "sections": []}, "fr": {"title": "Chauffer", "sections": []}}
    existing = {
        "i18n": {
            "it": {
                "title": "Riscaldamento",
                "sections": [{"section_id": "sec_a", "video_url": "/api/training/media/course/mod/sec_a/it"}],
            },
        },
    }
    merged = merge_preserved_videos(seed, existing)
    assert merged["it"]["title"] == "Riscaldamento"
    assert merged["it"]["sections"][0]["video_url"].endswith("/it")
