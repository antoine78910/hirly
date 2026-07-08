"""Record-tools API routes (interview simulator templates)."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

import record_tools_service as service
from record_tools_access import require_record_tools_user


def register_record_tools_routes(
    router: APIRouter,
    get_current_user,
    db,
    require_record_tools_user_dep,
) -> None:
    @router.get("/record-tools/interview-templates")
    async def list_interview_templates(user=Depends(require_record_tools_user_dep)):
        templates = await service.list_interview_templates(db)
        return {"templates": templates}

    @router.get("/record-tools/interview-templates/{template_id}")
    async def get_interview_template(template_id: str, user=Depends(require_record_tools_user_dep)):
        payload = await service.get_interview_template(db, template_id)
        if not payload:
            raise HTTPException(status_code=404, detail="Template not found")
        return payload

    @router.get("/record-tools/interview-templates/{template_id}/audio")
    async def get_interview_template_audio(template_id: str, user=Depends(require_record_tools_user_dep)):
        doc = await service.get_template_doc(db, template_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Template not found")
        path = service.resolve_template_audio_path(doc)
        if not path:
            raise HTTPException(status_code=404, detail="Audio file not found")
        return FileResponse(
            path,
            media_type=doc.get("audio_mime") or "audio/mpeg",
            filename=doc.get("original_filename") or path.name,
        )

    @router.post("/record-tools/interview-templates")
    async def create_interview_template(
        name: str = Form(...),
        segments: str = Form(...),
        split_settings: str = Form("{}"),
        duration_seconds: Optional[float] = Form(None),
        audio: UploadFile = File(...),
        user=Depends(require_record_tools_user_dep),
    ):
        try:
            parsed_segments: List[Dict[str, Any]] = json.loads(segments)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid segments JSON") from exc
        try:
            parsed_settings: Dict[str, Any] = json.loads(split_settings or "{}")
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="Invalid split_settings JSON") from exc

        audio_bytes = await audio.read()
        try:
            payload = await service.create_interview_template(
                db,
                user_id=user.user_id,
                user_name=getattr(user, "name", None) or getattr(user, "email", None) or "Creator",
                name=name,
                segments=parsed_segments,
                split_settings=parsed_settings,
                original_filename=audio.filename or "audio.mp3",
                audio_bytes=audio_bytes,
                audio_mime=audio.content_type or "audio/mpeg",
                duration_seconds=duration_seconds,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return payload
