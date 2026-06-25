"""User feedback routes."""

from __future__ import annotations

from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

import feedback_service as feedback


def register_feedback_routes(api_router: APIRouter, get_current_user) -> None:
    @api_router.post("/feedback/suggest-feature")
    async def suggest_feature(
        message: str = Form(...),
        category: str = Form("feature"),
        files: List[UploadFile] = File(default=[]),
        user=Depends(get_current_user),
    ):
        category_norm = (category or "feature").strip().lower()
        if category_norm not in {"feature", "problem", "other"}:
            raise HTTPException(status_code=400, detail="Invalid category")

        attachments = []
        for upload in files[: feedback.MAX_ATTACHMENTS]:
            if not upload.filename:
                continue
            content = await upload.read()
            if not content:
                continue
            attachments.append((
                upload.filename,
                content,
                upload.content_type or "application/octet-stream",
            ))

        try:
            result = await feedback.send_feature_suggestion(
                user_email=getattr(user, "email", "") or "",
                user_name=getattr(user, "name", "") or "",
                user_id=getattr(user, "user_id", "") or "",
                category=category_norm,
                message=message,
                attachments=attachments,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Could not send suggestion") from exc

        return {"ok": True, **result}
