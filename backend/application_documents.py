"""Application document generation helpers.

V1 prioritizes preserving DOCX structure where possible. PDF preservation is
reported as approximate because PDFs are not reliably editable as semantic
resume templates.
"""

import base64
import io
import logging
import re
from copy import deepcopy
from typing import Any, Dict, List, Tuple

import docx

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XML_INVALID_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]")
logger = logging.getLogger(__name__)


def sanitize_docx_text(value: Any) -> Any:
    if isinstance(value, str):
        cleaned, removed = XML_INVALID_CONTROL_CHARS.subn("", value)
        if removed:
            logger.warning("DOCX_SANITIZE_REMOVED_CHARS count=%s", removed)
        return cleaned
    if isinstance(value, list):
        return [sanitize_docx_text(item) for item in value]
    if isinstance(value, tuple):
        return tuple(sanitize_docx_text(item) for item in value)
    if isinstance(value, dict):
        return {key: sanitize_docx_text(item) for key, item in value.items()}
    return value


def _safe_text(value: Any) -> str:
    return str(sanitize_docx_text("" if value is None else value))


def _safe_add_paragraph(document: Any, text: Any = "", *args: Any, **kwargs: Any) -> Any:
    return document.add_paragraph(_safe_text(text), *args, **kwargs)


def _safe_set_run_text(run: Any, text: Any) -> None:
    run.text = _safe_text(text)


def build_application_package(profile: Dict[str, Any], generated: Dict[str, Any]) -> Dict[str, Any]:
    profile = sanitize_docx_text(profile)
    generated = sanitize_docx_text(generated)
    original_b64 = profile.get("cv_original_b64")
    original_bytes = base64.b64decode(original_b64) if original_b64 else b""
    original_mime = profile.get("cv_mime") or ""
    original_filename = profile.get("cv_filename") or "cv"
    tailored = generated.get("tailored_resume_structured") or generated.get("tailored_resume") or {}

    if original_mime == DOCX_MIME or original_filename.lower().endswith(".docx"):
        file_bytes, status, notes = _build_preserved_docx(original_bytes, profile, tailored)
        filename = _tailored_filename(original_filename, ".docx")
        mime = DOCX_MIME
    elif original_mime == "application/pdf" or original_filename.lower().endswith(".pdf"):
        file_bytes = _build_clean_docx(profile, tailored)
        filename = _tailored_filename(original_filename, ".docx")
        mime = DOCX_MIME
        status = "approximate"
        notes = (
            "Original PDF was preserved in the profile, but direct PDF template editing "
            "is not reliable in V1. Generated a clean tailored DOCX from the extracted structure."
        )
    else:
        file_bytes = _build_clean_docx(profile, tailored)
        filename = _tailored_filename(original_filename, ".docx")
        mime = DOCX_MIME
        status = "not_supported" if not original_bytes else "approximate"
        notes = "Original file is not a DOCX template. Generated a clean tailored DOCX."

    logger.info("DOCX_BUILD_SUCCESS filename=%s status=%s", filename, status)
    return {
        "tailored_resume_structured": tailored,
        "tailored_cover_letter": generated.get("tailored_cover_letter") or generated.get("cover_letter") or {},
        "application_answers": generated.get("application_answers") or [],
        "tailored_cv_file_b64": base64.b64encode(file_bytes).decode("ascii"),
        "tailored_cv_filename": filename,
        "tailored_cv_mime": mime,
        "template_preservation_status": status,
        "template_preservation_notes": notes,
    }


def cover_letter_to_text(cover_letter: Dict[str, Any]) -> str:
    cover_letter = sanitize_docx_text(cover_letter)
    if isinstance(cover_letter, str):
        return cover_letter
    parts = []
    greeting = cover_letter.get("greeting")
    if greeting:
        parts.append(str(greeting))
    for paragraph in cover_letter.get("paragraphs") or []:
        parts.append(str(paragraph))
    sign_off = cover_letter.get("sign_off")
    if sign_off:
        parts.append(str(sign_off))
    return "\n\n".join(parts).strip()


def _tailored_filename(original_filename: str, suffix: str) -> str:
    stem = original_filename.rsplit(".", 1)[0] if "." in original_filename else original_filename
    return f"{stem}_tailored{suffix}"


def _build_preserved_docx(original_bytes: bytes, profile: Dict[str, Any], tailored: Dict[str, Any]) -> Tuple[bytes, str, str]:
    try:
        document = docx.Document(io.BytesIO(original_bytes))
    except Exception:
        return (
            _build_clean_docx(profile, tailored),
            "approximate",
            "Could not open original DOCX. Generated a clean tailored DOCX instead.",
        )

    replacements = _replacement_pairs(profile, tailored)
    replacements_made = 0
    for old, new in replacements:
        if not old or not new or old == new:
            continue
        replacements_made += _replace_text(document, old, new)

    if replacements_made == 0:
        _append_tailored_section(document, tailored)
        status = "approximate"
        notes = (
            "Original DOCX structure was preserved, but exact source text could not be matched. "
            "Added a tailored content section to the existing document."
        )
    else:
        status = "preserved"
        notes = (
            "Original DOCX structure was reused and matching text was replaced in-place where possible. "
            "Fonts, section layout, margins, tables, and existing styles are preserved by the original document."
        )

    out = io.BytesIO()
    document.save(out)
    return out.getvalue(), status, notes


def _replace_text(document, old: str, new: str) -> int:
    count = 0
    for paragraph in list(document.paragraphs) + _table_paragraphs(document):
        if old in paragraph.text:
            _set_paragraph_text(paragraph, paragraph.text.replace(old, new))
            count += 1
    return count


def _table_paragraphs(document) -> List[Any]:
    paragraphs = []
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                paragraphs.extend(cell.paragraphs)
    return paragraphs


def _set_paragraph_text(paragraph, text: str) -> None:
    first_run = paragraph.runs[0] if paragraph.runs else None
    for run in list(paragraph.runs):
        _safe_set_run_text(run, "")
    run = paragraph.runs[0] if paragraph.runs else paragraph.add_run()
    _safe_set_run_text(run, text)
    if first_run is not None and run is not first_run:
        run.bold = first_run.bold
        run.italic = first_run.italic
        run.underline = first_run.underline
        run.style = first_run.style


def _replacement_pairs(profile: Dict[str, Any], tailored: Dict[str, Any]) -> List[Tuple[str, str]]:
    pairs: List[Tuple[str, str]] = []
    if profile.get("summary") and tailored.get("summary"):
        pairs.append((_safe_text(profile["summary"]), _safe_text(tailored["summary"])))

    original_skills = profile.get("skills") or []
    tailored_skills = tailored.get("skills") or []
    if original_skills and tailored_skills:
        pairs.append((", ".join(map(_safe_text, original_skills)), ", ".join(map(_safe_text, tailored_skills))))

    original_experience = profile.get("experience") or []
    tailored_experience = tailored.get("experience") or []
    for original, tailored_item in zip(original_experience, tailored_experience):
        original_highlights = original.get("highlights") or []
        tailored_highlights = tailored_item.get("highlights") or []
        for old, new in zip(original_highlights, tailored_highlights):
            pairs.append((_safe_text(old), _safe_text(new)))
    return pairs


def _append_tailored_section(document, tailored: Dict[str, Any]) -> None:
    document.add_page_break()
    document.add_heading("Tailored Resume Content", level=1)
    _write_tailored_content(document, tailored)


def _build_clean_docx(profile: Dict[str, Any], tailored: Dict[str, Any]) -> bytes:
    document = docx.Document()
    contact = sanitize_docx_text(deepcopy(profile.get("contact") or {}))
    name = contact.get("name") or "Candidate"
    document.add_heading(_safe_text(name), level=0)
    contact_line = " | ".join(
        _safe_text(contact.get(key))
        for key in ("email", "phone", "location", "linkedin", "website")
        if contact.get(key)
    )
    if contact_line:
        _safe_add_paragraph(document, contact_line)
    _write_tailored_content(document, tailored)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def _write_tailored_content(document, tailored: Dict[str, Any]) -> None:
    if tailored.get("summary"):
        document.add_heading("Summary", level=1)
        _safe_add_paragraph(document, tailored["summary"])

    skills = tailored.get("skills") or []
    if skills:
        document.add_heading("Skills", level=1)
        _safe_add_paragraph(document, ", ".join(map(_safe_text, skills)))

    experience = tailored.get("experience") or []
    if experience:
        document.add_heading("Experience", level=1)
        for item in experience:
            title = " - ".join(str(item.get(key)) for key in ("role", "company") if item.get(key))
            if title:
                _safe_add_paragraph(document, title, style="List Bullet")
            meta = " | ".join(_safe_text(item.get(key)) for key in ("duration", "location") if item.get(key))
            if meta:
                _safe_add_paragraph(document, meta)
            for highlight in item.get("highlights") or []:
                _safe_add_paragraph(document, highlight, style="List Bullet")

    education = tailored.get("education") or []
    if education:
        document.add_heading("Education", level=1)
        for item in education:
            line = " - ".join(_safe_text(item.get(key)) for key in ("degree", "school", "year") if item.get(key))
            if line:
                _safe_add_paragraph(document, line, style="List Bullet")
