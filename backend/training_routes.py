"""Training course and creator CRM API routes."""

from __future__ import annotations

import mimetypes
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

import training_service as training
from training_media import resolve_media_file
from creator_invite_store import (
    INVITE_TYPE_TRAINING,
    create_standalone_invitation,
    list_training_invites,
)


class CreatorRegisterBody(BaseModel):
    display_name: Optional[str] = None


class LeadCreateBody(BaseModel):
    name: str = ""
    email: str = ""
    stage: str = "new"
    source: str = "manual"
    notes: str = ""


class LeadUpdateBody(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    stage: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None


class TrainingActivityBody(BaseModel):
    module_id: str
    section_id: Optional[str] = None


class QuizSubmitBody(BaseModel):
    answers: Dict[str, str] = Field(default_factory=dict)


def register_training_routes(
    router: APIRouter,
    get_current_user,
    db,
    require_training_user,
    get_training_access_payload,
) -> None:
    async def _require_creator(user):
        creator = await training.get_creator_by_user_id(db, user.user_id)
        if not creator:
            raise HTTPException(status_code=403, detail="Creator access required")
        return creator

    @router.get("/training/access")
    async def training_access_status(user=Depends(get_current_user)):
        return await get_training_access_payload(user)

    @router.get("/training/catalog")
    async def training_catalog(
        user=Depends(require_training_user),
        lang: str = Query("en"),
    ):
        locale = training._normalize_lang(lang)
        courses = await training.list_published_courses(db, locale)
        enrollments = await training.list_user_enrollments(db, user.user_id, locale)
        creator = await training.get_creator_by_user_id(db, user.user_id)
        return {
            "courses": courses,
            "my_courses": enrollments,
            "is_training_creator": creator is not None,
            "creator_id": (creator or {}).get("creator_id"),
            "lang": locale,
        }

    @router.get("/training/courses/{course_id}")
    async def training_course_detail(
        course_id: str,
        user=Depends(require_training_user),
        lang: str = Query("en"),
    ):
        locale = training._normalize_lang(lang)
        detail = await training.get_course_detail(db, course_id, user.user_id, locale)
        if not detail:
            raise HTTPException(status_code=404, detail="Course not found")
        return detail

    @router.post("/training/courses/{course_id}/enroll")
    async def training_enroll(course_id: str, user=Depends(require_training_user)):
        try:
            enrollment = await training.enroll_user(db, user.user_id, course_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "enrollment": enrollment}

    @router.post("/training/courses/{course_id}/modules/{module_id}/complete")
    async def training_complete_module(course_id: str, module_id: str, user=Depends(require_training_user)):
        try:
            result = await training.complete_module(db, user.user_id, course_id, module_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return {"ok": True, **result}

    @router.post("/training/courses/{course_id}/activity")
    async def training_track_activity(course_id: str, body: TrainingActivityBody, user=Depends(require_training_user)):
        try:
            result = await training.track_activity(
                db, user.user_id, course_id, body.module_id, body.section_id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, **result}

    @router.post("/training/courses/{course_id}/quizzes/{quiz_id}/submit")
    async def training_submit_quiz(
        course_id: str,
        quiz_id: str,
        body: QuizSubmitBody,
        user=Depends(require_training_user),
    ):
        try:
            result = await training.submit_quiz(db, user.user_id, course_id, quiz_id, body.answers)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, **result}

    @router.post("/training/creator/register")
    async def training_creator_register(body: CreatorRegisterBody, user=Depends(require_training_user)):
        creator = await training.register_creator(db, user.model_dump(), body.display_name)
        return {"ok": True, "creator": creator}

    @router.get("/training/creator/dashboard")
    async def training_creator_dashboard(user=Depends(require_training_user)):
        creator = await _require_creator(user)
        return await training.creator_dashboard(db, creator["creator_id"])

    @router.get("/training/creator/students")
    async def training_creator_students(user=Depends(require_training_user)):
        creator = await _require_creator(user)
        students = await training.list_creator_students(db, creator["creator_id"])
        return {"students": students}

    @router.get("/training/creator/leads")
    async def training_creator_leads(user=Depends(require_training_user)):
        creator = await _require_creator(user)
        leads = await training.list_creator_leads(db, creator["creator_id"])
        return {"leads": leads, "stages": training.CRM_STAGES}

    @router.post("/training/creator/leads")
    async def training_creator_create_lead(body: LeadCreateBody, user=Depends(require_training_user)):
        creator = await _require_creator(user)
        lead = await training.create_lead(db, creator["creator_id"], body.model_dump())
        return {"ok": True, "lead": lead}

    @router.patch("/training/creator/leads/{lead_id}")
    async def training_creator_update_lead(lead_id: str, body: LeadUpdateBody, user=Depends(require_training_user)):
        creator = await _require_creator(user)
        try:
            lead = await training.update_lead(db, creator["creator_id"], lead_id, body.model_dump(exclude_unset=True))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "lead": lead}

    @router.get("/training/media/{course_id}/{module_id}/{section_part}/{lang}")
    async def training_media_stream(
        course_id: str,
        module_id: str,
        section_part: str,
        lang: str,
    ):
        media_path = resolve_media_file(course_id, module_id, section_part, lang)
        if not media_path:
            raise HTTPException(status_code=404, detail="Video not found")
        mime, _ = mimetypes.guess_type(str(media_path))
        return FileResponse(
            media_path,
            media_type=mime or "video/mp4",
            filename=media_path.name,
        )


def register_training_admin_routes(router: APIRouter, require_admin_user, db) -> None:
    @router.get("/admin/training/videos")
    async def admin_training_videos_list(
        admin=Depends(require_admin_user),
        course_id: str = Query("course_job_search_mastery"),
    ):
        return await training.admin_training_videos(db, course_id)

    @router.post("/admin/training/videos")
    async def admin_training_video_upload(
        course_id: str = Form(...),
        module_id: str = Form(...),
        lang: str = Form("en"),
        section_id: Optional[str] = Form(None),
        file: UploadFile = File(...),
        admin=Depends(require_admin_user),
    ):
        try:
            result = await training.upload_training_video(
                db,
                course_id,
                module_id,
                section_id or None,
                lang,
                file,
            )
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return result

    @router.get("/admin/training/invites")
    async def admin_training_invites_list(admin=Depends(require_admin_user)):
        return {"invites": list_training_invites()}

    @router.post("/admin/training/invites")
    async def admin_training_invites_create(
        payload: Dict[str, Any],
        admin=Depends(require_admin_user),
    ):
        invitation = create_standalone_invitation(
            course_id=(payload.get("course_id") or "course_job_search_mastery").strip(),
            email_hint=(payload.get("email_hint") or "").strip(),
            label=(payload.get("label") or "").strip(),
            invite_type=INVITE_TYPE_TRAINING,
        )
        return {
            "ok": True,
            "invitation": invitation,
            "code": invitation.get("code"),
            "course_id": invitation.get("course_id"),
            "invite_type": INVITE_TYPE_TRAINING,
        }
