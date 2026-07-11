"""Shared interview simulator MP3 templates for record-tools."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import llm_client

TEMPLATES_DIR = Path(__file__).resolve().parent / "data" / "interview_simulator_templates"
COLLECTION = "interview_simulator_templates"
MAX_AUDIO_BYTES = 25 * 1024 * 1024


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public_template(doc: Dict[str, Any], *, include_segments: bool = False) -> Dict[str, Any]:
    segments = doc.get("segments") or []
    payload = {
        "template_id": doc.get("template_id"),
        "name": doc.get("name") or "Untitled",
        "duration_seconds": doc.get("duration_seconds"),
        "segment_count": len(segments),
        "created_by_name": doc.get("created_by_name") or "Creator",
        "original_filename": doc.get("original_filename") or "",
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }
    if include_segments:
        payload["segments"] = segments
        payload["split_settings"] = doc.get("split_settings") or {}
        payload["audio_url"] = f"/api/record-tools/interview-templates/{doc.get('template_id')}/audio"
    return payload


async def list_interview_templates(db) -> List[Dict[str, Any]]:
    rows = await db[COLLECTION].find({}, {"_id": 0}).sort("created_at", -1).to_list(200)
    return [_public_template(row) for row in rows]


async def get_interview_template(db, template_id: str) -> Optional[Dict[str, Any]]:
    doc = await db[COLLECTION].find_one({"template_id": template_id}, {"_id": 0})
    if not doc:
        return None
    return _public_template(doc, include_segments=True)


def resolve_template_audio_path(doc: Dict[str, Any]) -> Optional[Path]:
    rel = doc.get("audio_path")
    if not rel:
        return None
    path = TEMPLATES_DIR / Path(rel).name
    return path if path.exists() else None


async def create_interview_template(
    db,
    *,
    user_id: str,
    user_name: str,
    name: str,
    segments: List[Dict[str, Any]],
    split_settings: Dict[str, Any],
    original_filename: str,
    audio_bytes: bytes,
    audio_mime: str,
    duration_seconds: Optional[float] = None,
) -> Dict[str, Any]:
    if not name.strip():
        raise ValueError("Template name is required")
    if not segments:
        raise ValueError("At least one segment is required")
    if not audio_bytes:
        raise ValueError("Audio file is required")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise ValueError("Audio file is too large (max 25 MB)")

    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    template_id = f"tpl_{uuid.uuid4().hex[:12]}"
    ext = ".mp3"
    if original_filename.lower().endswith(".wav"):
        ext = ".wav"
    elif original_filename.lower().endswith(".m4a"):
        ext = ".m4a"
    filename = f"{template_id}{ext}"
    audio_path = TEMPLATES_DIR / filename
    audio_path.write_bytes(audio_bytes)

    now = _now_iso()
    doc = {
        "template_id": template_id,
        "name": name.strip(),
        "created_by_user_id": user_id,
        "created_by_name": (user_name or "Creator").strip() or "Creator",
        "original_filename": original_filename or filename,
        "audio_mime": audio_mime or "audio/mpeg",
        "audio_path": filename,
        "duration_seconds": duration_seconds,
        "segments": segments,
        "split_settings": split_settings or {},
        "created_at": now,
        "updated_at": now,
    }
    await db[COLLECTION].insert_one(doc)
    return _public_template(doc, include_segments=True)


async def get_template_doc(db, template_id: str) -> Optional[Dict[str, Any]]:
    return await db[COLLECTION].find_one({"template_id": template_id}, {"_id": 0})


def _overlap_seconds(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


async def transcribe_segments(
    *,
    audio_bytes: bytes,
    original_filename: str,
    segments: List[Dict[str, Any]],
) -> Dict[str, str]:
    """Transcribe the audio once, then align Whisper's timed segments onto our step boundaries."""
    if not audio_bytes:
        raise ValueError("Audio file is required")
    if not segments:
        return {}

    result = await llm_client.transcribe_audio_bytes(audio_bytes, filename=original_filename or "audio.mp3")
    whisper_segments = result.get("segments") or []

    transcripts: Dict[str, str] = {}
    for step in segments:
        step_id = step.get("id")
        if not step_id:
            continue
        start = float(step.get("start") or 0)
        end = float(step.get("end") or 0)
        matches = [
            w for w in whisper_segments
            if _overlap_seconds(start, end, float(w.get("start") or 0), float(w.get("end") or 0)) > 0
        ]
        matches.sort(key=lambda w: float(w.get("start") or 0))
        text = " ".join(w.get("text", "") for w in matches).strip()
        transcripts[step_id] = text

    return transcripts
