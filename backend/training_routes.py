"""Training course and creator CRM API routes."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

import training_service as training


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


def register_training_routes(router: APIRouter, get_current_user, db) -> None:
    async def _require_creator(user):
        creator = await training.get_creator_by_user_id(db, user.user_id)
        if not creator:
            raise HTTPException(status_code=403, detail="Creator access required")
        return creator

    @router.get("/training/catalog")
    async def training_catalog(
        user=Depends(get_current_user),
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
        user=Depends(get_current_user),
        lang: str = Query("en"),
    ):
        locale = training._normalize_lang(lang)
        detail = await training.get_course_detail(db, course_id, user.user_id, locale)
        if not detail:
            raise HTTPException(status_code=404, detail="Course not found")
        return detail

    @router.post("/training/courses/{course_id}/enroll")
    async def training_enroll(course_id: str, user=Depends(get_current_user)):
        try:
            enrollment = await training.enroll_user(db, user.user_id, course_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "enrollment": enrollment}

    @router.post("/training/courses/{course_id}/modules/{module_id}/complete")
    async def training_complete_module(course_id: str, module_id: str, user=Depends(get_current_user)):
        try:
            result = await training.complete_module(db, user.user_id, course_id, module_id)
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, **result}

    @router.post("/training/creator/register")
    async def training_creator_register(body: CreatorRegisterBody, user=Depends(get_current_user)):
        creator = await training.register_creator(db, user.model_dump(), body.display_name)
        return {"ok": True, "creator": creator}

    @router.get("/training/creator/dashboard")
    async def training_creator_dashboard(user=Depends(get_current_user)):
        creator = await _require_creator(user)
        return await training.creator_dashboard(db, creator["creator_id"])

    @router.get("/training/creator/students")
    async def training_creator_students(user=Depends(get_current_user)):
        creator = await _require_creator(user)
        students = await training.list_creator_students(db, creator["creator_id"])
        return {"students": students}

    @router.get("/training/creator/leads")
    async def training_creator_leads(user=Depends(get_current_user)):
        creator = await _require_creator(user)
        leads = await training.list_creator_leads(db, creator["creator_id"])
        return {"leads": leads, "stages": training.CRM_STAGES}

    @router.post("/training/creator/leads")
    async def training_creator_create_lead(body: LeadCreateBody, user=Depends(get_current_user)):
        creator = await _require_creator(user)
        lead = await training.create_lead(db, creator["creator_id"], body.model_dump())
        return {"ok": True, "lead": lead}

    @router.patch("/training/creator/leads/{lead_id}")
    async def training_creator_update_lead(lead_id: str, body: LeadUpdateBody, user=Depends(get_current_user)):
        creator = await _require_creator(user)
        try:
            lead = await training.update_lead(db, creator["creator_id"], lead_id, body.model_dump(exclude_unset=True))
        except ValueError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"ok": True, "lead": lead}
