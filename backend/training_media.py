"""Training course video uploads (filesystem storage + streaming)."""

from __future__ import annotations

from copy import deepcopy
import mimetypes
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException, UploadFile

MAX_VIDEO_BYTES = 500 * 1024 * 1024  # 500 MB
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v"}
ALLOWED_VIDEO_MIMES = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/x-m4v",
}

MEDIA_ROOT = Path(__file__).resolve().parent / "data" / "training_videos"
DEFAULT_COURSE_ID = "course_job_search_mastery"
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


def slot_storage_dir(course_id: str, module_id: str, section_id: Optional[str]) -> Path:
    return (
        MEDIA_ROOT
        / _safe_segment(course_id)
        / _safe_segment(module_id)
        / slot_section_part(section_id)
    )


def ensure_training_video_dirs(course_id: str = DEFAULT_COURSE_ID) -> List[Path]:
    """Create on-disk folders for every canonical upload slot (plus .gitkeep)."""
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


def media_storage_path(course_id: str, module_id: str, section_id: Optional[str], lang: str, ext: str) -> Path:
    return slot_storage_dir(course_id, module_id, section_id) / f"{normalize_training_video_locale(lang)}{ext.lower()}"


def media_public_path(course_id: str, module_id: str, section_id: Optional[str], lang: str) -> str:
    section_part = slot_section_part(section_id)
    return (
        f"/api/training/media/{_safe_segment(course_id)}/{_safe_segment(module_id)}/"
        f"{section_part}/{normalize_training_video_locale(lang)}"
    )


def resolve_media_file(course_id: str, module_id: str, section_part: str, lang: str) -> Optional[Path]:
    base = MEDIA_ROOT / _safe_segment(course_id) / _safe_segment(module_id) / _safe_segment(section_part)
    normalized_lang = normalize_training_video_locale(lang)
    if not base.is_dir():
        return None
    for ext in ALLOWED_VIDEO_EXTENSIONS:
        candidate = base / f"{normalized_lang}{ext}"
        if candidate.is_file():
            return candidate

    # Support legacy manual drop-ins (for example, "swiping features.mp4") without
    # ever serving a video uploaded for a different locale.  A named en.mp4 must
    # not silently become the French or German lesson just because it is the only
    # file in the slot.
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

    # A single unlabelled legacy file has no claimed locale and remains available
    # during migration.  Multiple unlabelled files are ambiguous, so do not guess.
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
    if mime and mime not in ALLOWED_VIDEO_MIMES and not mime.startswith("video/"):
        raise HTTPException(status_code=400, detail="Only video files are allowed (MP4, WebM, MOV)")
    return ext


async def save_training_video(
    file: UploadFile,
    course_id: str,
    module_id: str,
    section_id: Optional[str],
    lang: str,
) -> Tuple[Path, str]:
    content = await file.read()
    ext = validate_video_upload(file, content)
    locale = normalize_training_video_locale(lang)
    dest = media_storage_path(course_id, module_id, section_id, locale, ext)
    dest.parent.mkdir(parents=True, exist_ok=True)

    for existing in dest.parent.glob(f"{locale}.*"):
        if existing.is_file():
            existing.unlink()

    dest.write_bytes(content)
    return dest, media_public_path(course_id, module_id, section_id, lang)


def _find_section(sections: List[Dict[str, Any]], section_id: str) -> Optional[Dict[str, Any]]:
    for section in sections or []:
        if section.get("section_id") == section_id:
            return section
    return None


def apply_video_url_to_module_doc(
    module_doc: Dict[str, Any],
    section_id: Optional[str],
    lang: str,
    video_url: str,
) -> Dict[str, Any]:
    """Return updated i18n pack for the given language."""
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
                "video_url": video_url,
                "content": [],
            })
        else:
            target["video_url"] = video_url
        pack["sections"] = sections
    else:
        pack["video_url"] = video_url

    i18n[locale] = pack
    return i18n


def slot_has_video(module_doc: Dict[str, Any], slot: Dict[str, Any], lang: str) -> bool:
    locale = normalize_training_video_locale(lang)
    pack = (module_doc.get("i18n") or {}).get(locale) or {}
    section_id = slot.get("section_id")
    if section_id:
        section = _find_section(pack.get("sections") or [], section_id)
        return bool((section or {}).get("video_url"))
    return bool(pack.get("video_url"))


def slot_video_meta(module_doc: Dict[str, Any], slot: Dict[str, Any], lang: str) -> Dict[str, Any]:
    locale = normalize_training_video_locale(lang)
    pack = (module_doc.get("i18n") or {}).get(locale) or {}
    section_id = slot.get("section_id")
    if section_id:
        section = _find_section(pack.get("sections") or [], section_id) or {}
        url = section.get("video_url") or ""
        filename = section.get("video_filename") or ""
        uploaded_at = section.get("video_uploaded_at") or ""
    else:
        url = pack.get("video_url") or ""
        filename = pack.get("video_filename") or ""
        uploaded_at = pack.get("video_uploaded_at") or ""

    return {
        "video_url": url,
        "video_filename": filename,
        "video_uploaded_at": uploaded_at,
        "has_video": bool(url),
    }


def apply_upload_metadata(
    i18n: Dict[str, Any],
    section_id: Optional[str],
    lang: str,
    video_url: str,
    filename: str,
) -> Dict[str, Any]:
    i18n = apply_video_url_to_module_doc({"i18n": i18n}, section_id, lang, video_url)
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


def merge_preserved_videos(seed_i18n: Dict[str, Any], existing: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Keep uploaded video URLs and locale packs when re-seeding module catalog."""
    if not existing:
        return deepcopy(seed_i18n)

    merged = deepcopy(seed_i18n)
    existing_i18n = existing.get("i18n") or {}

    for lang, prev in existing_i18n.items():
        if not isinstance(prev, dict):
            continue
        if lang not in merged:
            # A translated locale may be managed outside the seed fixture. It must
            # survive a catalog refresh, including its uploaded video metadata.
            merged[lang] = deepcopy(prev)
            continue

        prev = existing_i18n.get(lang) or {}
        pack = deepcopy(merged.get(lang) or {})
        if prev.get("video_url"):
            pack["video_url"] = prev["video_url"]
            pack["video_filename"] = prev.get("video_filename", "")
            pack["video_uploaded_at"] = prev.get("video_uploaded_at", "")

        prev_sections = {s.get("section_id"): s for s in (prev.get("sections") or []) if s.get("section_id")}
        if prev_sections:
            next_sections = []
            seen_section_ids = set()
            for section in pack.get("sections") or []:
                section = deepcopy(section)
                section_id = section.get("section_id")
                seen_section_ids.add(section_id)
                prev_section = prev_sections.get(section_id)
                if prev_section and prev_section.get("video_url"):
                    section["video_url"] = prev_section["video_url"]
                    section["video_filename"] = prev_section.get("video_filename", "")
                    section["video_uploaded_at"] = prev_section.get("video_uploaded_at", "")
                next_sections.append(section)

            # Some canonical upload slots are intentionally video-only and do
            # not have a seed section. Preserve those entries as well.
            for section_id, prev_section in prev_sections.items():
                if section_id not in seen_section_ids and prev_section.get("video_url"):
                    next_sections.append(deepcopy(prev_section))
            pack["sections"] = next_sections

        merged[lang] = pack

    return merged


if __name__ == "__main__":
    dirs = ensure_training_video_dirs()
    print(f"Ensured {len(dirs)} training video slot folder(s) under {MEDIA_ROOT}")
    for path in dirs:
        print(f"  {path.relative_to(MEDIA_ROOT)}")
