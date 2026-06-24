"""Tests for training video uploads."""

import io

import pytest
from fastapi import HTTPException, UploadFile

from training_media import (
    media_public_path,
    merge_preserved_videos,
    validate_video_upload,
)


def test_media_public_path_module_level():
    path = media_public_path("course_job_search_mastery", "mod_getting_started", None, "en")
    assert path == "/api/training/media/course_job_search_mastery/mod_getting_started/_module/en"


def test_media_public_path_section():
    path = media_public_path("course_job_search_mastery", "mod_warm_up", "sec_wu_sop", "fr")
    assert path.endswith("/mod_warm_up/sec_wu_sop/fr")


def test_validate_video_upload_accepts_mp4():
    upload = UploadFile(filename="lesson.mp4", file=io.BytesIO(b"fake"), headers={"content-type": "video/mp4"})
    ext = validate_video_upload(upload, b"fake")
    assert ext == ".mp4"


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
