"""User feedback routes."""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

import feedback_service as feedback
import feedback_store as store
from feedback_store import (
    FEEDBACK_FEATURE_CREATOR,
    FEEDBACK_FEATURE_USER,
    FEEDBACK_TRAINING_COMPLETION,
)


class TrainingCompletionFeedbackBody(BaseModel):
    course_id: str = Field(..., min_length=1)
    beneficial: str = Field(..., min_length=1)
    rating: int = Field(..., ge=1, le=5)
    message: str = ""


def register_feedback_routes(api_router: APIRouter, get_current_user, require_admin=None, db=None) -> None:
    @api_router.post("/feedback/suggest-feature")
    async def suggest_feature(
        message: str = Form(...),
        category: str = Form("feature"),
        audience: str = Form("user"),
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
                db,
                user_email=getattr(user, "email", "") or "",
                user_name=getattr(user, "name", "") or "",
                user_id=getattr(user, "user_id", "") or "",
                category=category_norm,
                message=message,
                attachments=attachments,
                audience=audience,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Could not send suggestion") from exc

        return {"ok": True, **result}

    @api_router.post("/feedback/training-completion")
    async def training_completion_feedback(
        body: TrainingCompletionFeedbackBody,
        user=Depends(get_current_user),
    ):
        try:
            result = await feedback.submit_training_completion_feedback(
                db,
                user_email=getattr(user, "email", "") or "",
                user_name=getattr(user, "name", "") or "",
                user_id=getattr(user, "user_id", "") or "",
                course_id=body.course_id.strip(),
                beneficial=body.beneficial,
                rating=body.rating,
                message=body.message,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Could not save feedback") from exc

        return result

    if require_admin is None:
        return

    @api_router.get("/admin/feedback")
    async def admin_list_feedback(
        tab: Optional[str] = None,
        limit: int = 100,
        admin=Depends(require_admin),
    ):
        tab_norm = (tab or "users").strip().lower()
        if tab_norm == "creators":
            features = await store.list_submissions(db, FEEDBACK_FEATURE_CREATOR, limit=limit)
            training = await store.list_submissions(db, FEEDBACK_TRAINING_COMPLETION, limit=limit)
            return {
                "tab": "creators",
                "feature_suggestions": features,
                "training_feedback": training,
            }
        if tab_norm == "training":
            return {
                "tab": "training",
                "training_feedback": await store.list_submissions(db, FEEDBACK_TRAINING_COMPLETION, limit=limit),
            }
        return {
            "tab": "users",
            "feature_suggestions": await store.list_submissions(db, FEEDBACK_FEATURE_USER, limit=limit),
        }

    @api_router.get("/admin/feedback/{submission_id}")
    async def admin_get_feedback(submission_id: str, admin=Depends(require_admin)):
        row = await store.get_submission(db, submission_id)
        if not row:
            raise HTTPException(status_code=404, detail="Feedback not found")
        return {"submission": row}

    @api_router.post("/admin/feedback/backfill-resend")
    async def admin_backfill_feedback_from_resend(admin=Depends(require_admin)):
        from feedback_resend_backfill import backfill_feedback_from_resend

        stats = await backfill_feedback_from_resend(db)
        return {"ok": True, **stats}
