"""Training course video uploads backed by private Supabase Storage.

The persistent media object path is stored with the localized training content.
Learners receive a short-lived signed URL only after the normal training-access
check has succeeded. Local files remain readable solely as a legacy fallback for
records uploaded before Supabase Storage was introduced.
"""

from __future__ import annotations

from copy import deepcopy
import logging
import mimetypes
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urljoin

import httpx
from fastapi import HTTPException, UploadFile

logger = logging.getLogger(__name__)

MAX_VIDEO_BYTES = 500 * 1024 * 1024  # 500 MB
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v"}
ALLOWED_VIDEO_MIMES = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-m4v",
}

# This directory is not used for new uploads. It continues to support legacy
# content until it has been migrated to the private bucket.
MEDIA_ROOT = Path(__file__).resolve().parent / "data" / "training_videos"
DEFAULT_COURSE_ID = "course_job_search_mastery"
TRAINING_VIDEO_BUCKET = "training-videos"
TRAINING_VIDEO_SIGNED_URL_TTL_SECONDS = 60 * 60
TRAINING_VIDEO_LOCALES = ("en", "fr", "de", "es", "it")

# Canonical upload targets (module + optional section).
VIDEO_SLOTS: List[Dict[str, Any]] = [
    {"module_id": "mod_getting_started", "section_id": None, "label": "Getting Started"},
    {"module_id": "mod_warm_up", "section_id": "sec_wu_sop", "label": "Warm Up — SOP"},
    {"module_id": "mod_warm_up", "section_id": "sec_wu_posts", "label": "Warm Up — Posts"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_filming", "label": "Creating Content — Filming"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_hirly", "label": "Creating Content — Hirly"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_hirly_var_resume_zoom", "label": "Hirly Variation FR — CV zoom"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_hirly_var_resume_upload", "label": "Hirly Variation FR — CV upload POV"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_hirly_var_swipe_pov", "label": "Hirly Variation FR — Swipe POV"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_hirly_var_swipe_brand", "label": "Hirly Variation FR — Swipe grande entreprise"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_hirly_var_ai_resume", "label": "Hirly Variation FR — CV IA adapté"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_hirly_var_ai_letter", "label": "Hirly Variation FR — Lettre IA"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_hirly_var_history_scroll", "label": "Hirly Variation FR — Historique scroll"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_hirly_var_history_count", "label": "Hirly Variation FR — Historique volume"},
    {"module_id": "mod_creating_content", "section_id": "sec_cc_editing", "label": "Creating Content — Editing"},
    {"module_id": "mod_account_management", "section_id": None, "label": "Account Management"},
    {"module_id": "mod_submit_drafts", "section_id": None, "label": "Submit Drafts"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_swiping", "label": "Content Bank — Swiping"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_history_short", "label": "Content Bank — History (short)"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_history_long", "label": "Content Bank — History (long)"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_cv_short", "label": "Content Bank — CV (short)"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_cv_long", "label": "Content Bank — CV (long)"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_cover_letter_ai", "label": "Content Bank — Cover letter AI"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_green_screen", "label": "Content Bank — Green screen example"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_tablet_example", "label": "Content Bank — Tablet example"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_laptop_example", "label": "Content Bank — Laptop example"},
    {"module_id": "mod_content_bank", "section_id": "sec_cb_laptop_without_talking", "label": "Content Bank — Laptop without talking"},
]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_segment(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", (value or "").strip())
    if not cleaned:
        raise HTTPException(status_code=400, detail="Invalid path segment")
    return cleaned


def normalize_training_video_locale(lang: Optional[str]) -> str:
    """Return a supported two-letter locale for stored training videos."""
    raw = (lang or "").strip().lower().replace("_", "-")
    locale = raw.split("-", 1)[0]
    if locale not in TRAINING_VIDEO_LOCALES:
        supported = ", ".join(TRAINING_VIDEO_LOCALES)
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported training video locale '{lang}'. Use one of: {supported}.",
        )
    return locale


def slot_section_part(section_id: Optional[str]) -> str:
    return _safe_segment(section_id) if section_id else "_module"


def training_video_storage_path(
    course_id: str,
    module_id: str,
    section_id: Optional[str],
    lang: str,
) -> str:
    """Return the stable, extension-free private Storage object path."""
    return "/".join((
        _safe_segment(course_id),
        _safe_segment(module_id),
        slot_section_part(section_id),
        normalize_training_video_locale(lang),
    ))


# Legacy local-file helpers. New uploads must use training_video_storage_path.
def slot_storage_dir(course_id: str, module_id: str, section_id: Optional[str]) -> Path:
    return (
        MEDIA_ROOT
        / _safe_segment(course_id)
        / _safe_segment(module_id)
        / slot_section_part(section_id)
    )


def ensure_training_video_dirs(course_id: str = DEFAULT_COURSE_ID) -> List[Path]:
    """Create local legacy folders for migration/development support only."""
    created: List[Path] = []
    MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
    for slot in VIDEO_SLOTS:
        dest_dir = slot_storage_dir(course_id, slot["module_id"], slot.get("section_id"))
        dest_dir.mkdir(parents=True, exist_ok=True)
        gitkeep = dest_dir / ".gitkeep"
        if not gitkeep.is_file():
            gitkeep.write_text("", encoding="utf-8")
        created.append(dest_dir)
    return created


def resolve_media_file(course_id: str, module_id: str, section_part: str, lang: str) -> Optional[Path]:
    """Find a legacy local video without crossing locale boundaries."""
    base = MEDIA_ROOT / _safe_segment(course_id) / _safe_segment(module_id) / _safe_segment(section_part)
    normalized_lang = normalize_training_video_locale(lang)
    if not base.is_dir():
        return None
    for ext in ALLOWED_VIDEO_EXTENSIONS:
        candidate = base / f"{normalized_lang}{ext}"
        if candidate.is_file():
            return candidate

    candidates = [
        path
        for ext in ALLOWED_VIDEO_EXTENSIONS
        for path in base.glob(f"*{ext}")
        if path.is_file()
        and path.name != ".gitkeep"
        and path.stem.lower() not in TRAINING_VIDEO_LOCALES
    ]
    if not candidates:
        return None

    lang_hint = normalized_lang.lower()
    for path in sorted(candidates, key=lambda item: item.name.lower()):
        if lang_hint in path.stem.lower():
            return path
    return candidates[0] if len(candidates) == 1 else None


def _guess_ext(filename: str, content_type: Optional[str]) -> str:
    name_lower = (filename or "").lower()
    for ext in ALLOWED_VIDEO_EXTENSIONS:
        if name_lower.endswith(ext):
            return ext
    if content_type:
        guessed = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if guessed and guessed.lower() in ALLOWED_VIDEO_EXTENSIONS:
            return guessed.lower()
    return ".mp4"


def validate_video_upload(file: UploadFile, content: bytes) -> str:
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(content) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=400, detail="Video exceeds 500 MB limit")

    ext = _guess_ext(file.filename or "", file.content_type)
    mime = (file.content_type or mimetypes.guess_type(file.filename or "")[0] or "").split(";")[0].strip().lower()
    if mime and mime not in ALLOWED_VIDEO_MIMES:
        raise HTTPException(status_code=400, detail="Only video files are allowed (MP4, WebM, MOV, M4V)")
    return ext


def _supabase_storage_config() -> Tuple[str, str]:
    url = (os.environ.get("SUPABASE_URL") or "").strip().rstrip("/")
    for api_suffix in ("/rest/v1", "/auth/v1"):
        if url.endswith(api_suffix):
            url = url[: -len(api_suffix)]
    secret = (os.environ.get("SUPABASE_SECRET_KEY") or "").strip()
    if not url or not secret:
        raise HTTPException(status_code=503, detail="Training video storage is not configured")
    return url, secret


async def _storage_api_request(
    method: str,
    endpoint: str,
    *,
    content: Optional[bytes] = None,
    json: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
) -> httpx.Response:
    """Issue a private Storage API call using the server-only Supabase secret."""
    base_url, secret = _supabase_storage_config()
    request_headers = {"apikey": secret, "Authorization": f"Bearer {secret}"}
    if headers:
        request_headers.update(headers)
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10, read=90, write=180, pool=10)) as client:
            return await client.request(
                method,
                f"{base_url}{endpoint}",
                content=content,
                json=json,
                headers=request_headers,
            )
    except httpx.HTTPError as exc:
        logger.warning("Supabase training video Storage request failed: %s", exc)
        raise HTTPException(status_code=502, detail="Training video storage is unavailable") from exc


def _require_storage_success(response: httpx.Response, action: str) -> None:
    if response.is_success:
        return
    logger.warning("Supabase training video Storage %s failed with status %s", action, response.status_code)
    raise HTTPException(status_code=502, detail=f"Training video storage could not {action}")


async def create_training_video_signed_url(storage_path: str) -> str:
    """Return a short-lived URL for one private training-video object."""
    if not storage_path:
        return ""
    encoded_path = quote(storage_path, safe="/")
    response = await _storage_api_request(
        "POST",
        f"/storage/v1/object/sign/{TRAINING_VIDEO_BUCKET}/{encoded_path}",
        json={"expiresIn": TRAINING_VIDEO_SIGNED_URL_TTL_SECONDS},
    )
    _require_storage_success(response, "sign the video")
    try:
        signed_path = response.json().get("signedURL") or response.json().get("signedUrl")
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Training video storage returned an invalid signed URL") from exc
    if not isinstance(signed_path, str) or not signed_path:
        raise HTTPException(status_code=502, detail="Training video storage returned an invalid signed URL")
    if signed_path.startswith(("https://", "http://")):
        return signed_path
    base_url, _ = _supabase_storage_config()
    return urljoin(f"{base_url}/", signed_path.lstrip("/"))


async def store_training_video_object(
    storage_path: str,
    content: bytes,
    content_type: str,
) -> None:
    """Upsert a validated training video at its stable private Storage path."""
    response = await _storage_api_request(
        "POST",
        f"/storage/v1/object/{TRAINING_VIDEO_BUCKET}/{quote(storage_path, safe='/')}",
        content=content,
        headers={
            "Content-Type": content_type,
            "x-upsert": "true",
            "cache-control": "3600",
        },
    )
    _require_storage_success(response, "upload the video")


async def save_training_video(
    file: UploadFile,
    course_id: str,
    module_id: str,
    section_id: Optional[str],
    lang: str,
) -> Tuple[str, str]:
    """Upload a locale-specific video and return its storage path and signed URL."""
    content = await file.read()
    validate_video_upload(file, content)
    storage_path = training_video_storage_path(course_id, module_id, section_id, lang)
    content_type = (file.content_type or mimetypes.guess_type(file.filename or "")[0] or "video/mp4").split(";", 1)[0]
    await store_training_video_object(storage_path, content, content_type)
    return storage_path, await create_training_video_signed_url(storage_path)


def _find_section(sections: List[Dict[str, Any]], section_id: str) -> Optional[Dict[str, Any]]:
    for section in sections or []:
        if section.get("section_id") == section_id:
            return section
    return None


def apply_video_storage_path_to_module_doc(
    module_doc: Dict[str, Any],
    section_id: Optional[str],
    lang: str,
    video_storage_path: str,
) -> Dict[str, Any]:
    """Return the localized pack updated with a stable private Storage path."""
    locale = normalize_training_video_locale(lang)
    i18n = dict(module_doc.get("i18n") or {})
    pack = dict(i18n.get(locale) or {})

    if section_id:
        sections = [dict(s) for s in (pack.get("sections") or [])]
        target = _find_section(sections, section_id)
        if target is None:
            sections.append({
                "section_id": section_id,
                "title": section_id,
                "video_storage_path": video_storage_path,
                "video_url": "",
                "content": [],
            })
        else:
            target["video_storage_path"] = video_storage_path
            target["video_url"] = ""
        pack["sections"] = sections
    else:
        pack["video_storage_path"] = video_storage_path
        pack["video_url"] = ""

    i18n[locale] = pack
    return i18n


def slot_has_video(module_doc: Dict[str, Any], slot: Dict[str, Any], lang: str) -> bool:
    locale = normalize_training_video_locale(lang)
    pack = (module_doc.get("i18n") or {}).get(locale) or {}
    section_id = slot.get("section_id")
    if section_id:
        section = _find_section(pack.get("sections") or [], section_id) or {}
        return bool(section.get("video_storage_path") or section.get("video_url"))
    return bool(pack.get("video_storage_path") or pack.get("video_url"))


def slot_video_meta(module_doc: Dict[str, Any], slot: Dict[str, Any], lang: str) -> Dict[str, Any]:
    locale = normalize_training_video_locale(lang)
    pack = (module_doc.get("i18n") or {}).get(locale) or {}
    section_id = slot.get("section_id")
    if section_id:
        video = _find_section(pack.get("sections") or [], section_id) or {}
    else:
        video = pack
    storage_path = video.get("video_storage_path") or ""
    url = video.get("video_url") or ""
    return {
        "video_storage_path": storage_path,
        "video_url": url,
        "video_filename": video.get("video_filename") or "",
        "video_uploaded_at": video.get("video_uploaded_at") or "",
        "has_video": bool(storage_path or url),
    }


def apply_upload_metadata(
    i18n: Dict[str, Any],
    section_id: Optional[str],
    lang: str,
    video_storage_path: str,
    filename: str,
) -> Dict[str, Any]:
    i18n = apply_video_storage_path_to_module_doc({"i18n": i18n}, section_id, lang, video_storage_path)
    locale = normalize_training_video_locale(lang)
    pack = i18n[locale]
    stamp = _now()
    if section_id:
        for section in pack.get("sections") or []:
            if section.get("section_id") == section_id:
                section["video_filename"] = filename
                section["video_uploaded_at"] = stamp
                break
    else:
        pack["video_filename"] = filename
        pack["video_uploaded_at"] = stamp
    i18n[locale] = pack
    return i18n


def _preserve_video_metadata(target: Dict[str, Any], previous: Dict[str, Any]) -> bool:
    """Copy a new private path or a legacy URL, including admin upload metadata."""
    storage_path = previous.get("video_storage_path")
    legacy_url = previous.get("video_url")
    if not storage_path and not legacy_url:
        return False
    if storage_path:
        target["video_storage_path"] = storage_path
        target["video_url"] = ""
    else:
        target["video_url"] = legacy_url
    target["video_filename"] = previous.get("video_filename", "")
    target["video_uploaded_at"] = previous.get("video_uploaded_at", "")
    return True


def merge_preserved_videos(seed_i18n: Dict[str, Any], existing: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep uploaded private paths, legacy URLs, and locale packs when re-seeding."""
    if not existing:
        return deepcopy(seed_i18n)

    merged = deepcopy(seed_i18n)
    existing_i18n = existing.get("i18n") or {}

    for lang, prev in existing_i18n.items():
        if not isinstance(prev, dict):
            continue
        if lang not in merged:
            merged[lang] = deepcopy(prev)
            continue

        pack = deepcopy(merged.get(lang) or {})
        _preserve_video_metadata(pack, prev)

        prev_sections = {s.get("section_id"): s for s in (prev.get("sections") or []) if s.get("section_id")}
        if prev_sections:
            next_sections = []
            seen_section_ids = set()
            for section in pack.get("sections") or []:
                section = deepcopy(section)
                section_id = section.get("section_id")
                seen_section_ids.add(section_id)
                prev_section = prev_sections.get(section_id)
                if prev_section:
                    _preserve_video_metadata(section, prev_section)
                next_sections.append(section)

            for section_id, prev_section in prev_sections.items():
                if section_id not in seen_section_ids and (
                    prev_section.get("video_storage_path") or prev_section.get("video_url")
                ):
                    next_sections.append(deepcopy(prev_section))
            pack["sections"] = next_sections

        merged[lang] = pack

    return merged


if __name__ == "__main__":
    dirs = ensure_training_video_dirs()
    print(f"Ensured {len(dirs)} legacy training video slot folder(s) under {MEDIA_ROOT}")
    for path in dirs:
        print(f"  {path.relative_to(MEDIA_ROOT)}")
