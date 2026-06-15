"""Training courses, enrollments, and creator CRM."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SEED_CREATOR_ID = "creator_swiipr_official"
SEED_COURSE_ID = "course_job_search_mastery"

CRM_STAGES = ["new", "contacted", "qualified", "enrolled", "won", "lost"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _pct(completed: List[str], total: int) -> int:
    if total <= 0:
        return 0
    return min(100, round((len(completed) / total) * 100))


async def get_creator_by_user_id(db, user_id: str) -> Optional[Dict[str, Any]]:
    return await db.training_creators.find_one({"user_id": user_id}, {"_id": 0})


async def is_training_creator(db, user_id: str) -> bool:
    creator = await get_creator_by_user_id(db, user_id)
    return creator is not None


async def register_creator(db, user: Dict[str, Any], display_name: Optional[str] = None) -> Dict[str, Any]:
    existing = await get_creator_by_user_id(db, user["user_id"])
    if existing:
        return existing

    creator_id = f"creator_{uuid.uuid4().hex[:12]}"
    doc = {
        "creator_id": creator_id,
        "user_id": user["user_id"],
        "email": user.get("email"),
        "display_name": display_name or user.get("name") or "Creator",
        "bio": "",
        "created_at": _now(),
    }
    await db.training_creators.insert_one(doc)
    return doc


def _public_course(course: Dict[str, Any], module_count: int = 0) -> Dict[str, Any]:
    return {
        "course_id": course["course_id"],
        "title": course.get("title"),
        "subtitle": course.get("subtitle"),
        "description": course.get("description"),
        "thumbnail_url": course.get("thumbnail_url"),
        "level": course.get("level", "Beginner"),
        "module_count": module_count,
        "duration_minutes": course.get("duration_minutes"),
        "creator_id": course.get("creator_id"),
    }


async def list_published_courses(db) -> List[Dict[str, Any]]:
    courses = await db.training_courses.find({"published": True}).sort("created_at", -1).to_list(200)
    out = []
    for course in courses:
        modules = await db.training_modules.find({"course_id": course["course_id"]}).to_list(200)
        out.append(_public_course(course, len(modules)))
    return out


async def get_course_detail(db, course_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    course = await db.training_courses.find_one({"course_id": course_id}, {"_id": 0})
    if not course or not course.get("published"):
        return None

    modules = await db.training_modules.find({"course_id": course_id}).sort("sort_order", 1).to_list(200)
    enrollment = None
    if user_id:
        enrollment = await db.training_enrollments.find_one(
            {"user_id": user_id, "course_id": course_id},
            {"_id": 0},
        )

    completed = set((enrollment or {}).get("completed_module_ids") or [])
    module_rows = []
    for mod in modules:
        module_rows.append({
            "module_id": mod["module_id"],
            "title": mod.get("title"),
            "description": mod.get("description"),
            "video_url": mod.get("video_url"),
            "duration_seconds": mod.get("duration_seconds"),
            "sort_order": mod.get("sort_order", 0),
            "completed": mod["module_id"] in completed,
        })

    progress = (enrollment or {}).get("progress_percent")
    if progress is None and module_rows:
        progress = _pct(list(completed), len(module_rows))

    creator = await db.training_creators.find_one({"creator_id": course.get("creator_id")}, {"_id": 0})

    return {
        "course": _public_course(course, len(module_rows)),
        "modules": module_rows,
        "enrollment": {
            "enrolled": enrollment is not None,
            "progress_percent": progress or 0,
            "completed_module_ids": list(completed),
        },
        "creator": {
            "display_name": (creator or {}).get("display_name"),
            "bio": (creator or {}).get("bio"),
        } if creator else None,
    }


async def enroll_user(db, user_id: str, course_id: str) -> Dict[str, Any]:
    course = await db.training_courses.find_one({"course_id": course_id, "published": True}, {"_id": 0})
    if not course:
        raise ValueError("Course not found")

    existing = await db.training_enrollments.find_one({"user_id": user_id, "course_id": course_id}, {"_id": 0})
    if existing:
        return existing

    enrollment_id = f"enr_{uuid.uuid4().hex[:12]}"
    doc = {
        "enrollment_id": enrollment_id,
        "user_id": user_id,
        "course_id": course_id,
        "progress_percent": 0,
        "completed_module_ids": [],
        "enrolled_at": _now(),
        "updated_at": _now(),
    }
    await db.training_enrollments.insert_one(doc)
    return doc


async def complete_module(db, user_id: str, course_id: str, module_id: str) -> Dict[str, Any]:
    enrollment = await db.training_enrollments.find_one({"user_id": user_id, "course_id": course_id}, {"_id": 0})
    if not enrollment:
        enrollment = await enroll_user(db, user_id, course_id)

    module = await db.training_modules.find_one({"module_id": module_id, "course_id": course_id}, {"_id": 0})
    if not module:
        raise ValueError("Module not found")

    completed = list(enrollment.get("completed_module_ids") or [])
    if module_id not in completed:
        completed.append(module_id)

    modules = await db.training_modules.find({"course_id": course_id}).to_list(200)
    progress = _pct(completed, len(modules))

    await db.training_enrollments.update_one(
        {"enrollment_id": enrollment["enrollment_id"]},
        {"$set": {
            "completed_module_ids": completed,
            "progress_percent": progress,
            "updated_at": _now(),
        }},
    )
    return {"progress_percent": progress, "completed_module_ids": completed}


async def list_user_enrollments(db, user_id: str) -> List[Dict[str, Any]]:
    enrollments = await db.training_enrollments.find({"user_id": user_id}).sort("updated_at", -1).to_list(100)
    out = []
    for enr in enrollments:
        course = await db.training_courses.find_one({"course_id": enr["course_id"]}, {"_id": 0})
        if not course:
            continue
        modules = await db.training_modules.find({"course_id": enr["course_id"]}).to_list(200)
        out.append({
            **_public_course(course, len(modules)),
            "progress_percent": enr.get("progress_percent", 0),
            "enrolled_at": enr.get("enrolled_at"),
        })
    return out


async def creator_dashboard(db, creator_id: str) -> Dict[str, Any]:
    courses = await db.training_courses.find({"creator_id": creator_id}).to_list(200)
    course_ids = [c["course_id"] for c in courses]
    enrollments = []
    for cid in course_ids:
        rows = await db.training_enrollments.find({"course_id": cid}).to_list(500)
        enrollments.extend(rows)
    leads = await db.training_crm_leads.find({"creator_id": creator_id}).sort("updated_at", -1).to_list(500)

    completed = sum(1 for e in enrollments if int(e.get("progress_percent") or 0) >= 100)
    avg_progress = 0
    if enrollments:
        avg_progress = round(sum(int(e.get("progress_percent") or 0) for e in enrollments) / len(enrollments))

    stage_counts: Dict[str, int] = {stage: 0 for stage in CRM_STAGES}
    for lead in leads:
        stage = lead.get("stage") or "new"
        stage_counts[stage] = stage_counts.get(stage, 0) + 1

    return {
        "stats": {
            "courses": len(courses),
            "students": len(enrollments),
            "completed_students": completed,
            "avg_progress": avg_progress,
            "leads": len(leads),
        },
        "stage_counts": stage_counts,
        "recent_enrollments": enrollments[:8],
        "recent_leads": leads[:8],
    }


async def list_creator_students(db, creator_id: str) -> List[Dict[str, Any]]:
    courses = await db.training_courses.find({"creator_id": creator_id}).to_list(200)
    course_map = {c["course_id"]: c for c in courses}
    out = []
    for cid in course_map:
        enrollments = await db.training_enrollments.find({"course_id": cid}).sort("updated_at", -1).to_list(500)
        for enr in enrollments:
            user = await db.users.find_one({"user_id": enr["user_id"]}, {"_id": 0, "email": 1, "name": 1})
            course = course_map[cid]
            out.append({
                "enrollment_id": enr["enrollment_id"],
                "user_id": enr["user_id"],
                "email": (user or {}).get("email"),
                "name": (user or {}).get("name"),
                "course_id": cid,
                "course_title": course.get("title"),
                "progress_percent": enr.get("progress_percent", 0),
                "updated_at": enr.get("updated_at"),
            })
    out.sort(key=lambda row: row.get("updated_at") or "", reverse=True)
    return out


async def list_creator_leads(db, creator_id: str) -> List[Dict[str, Any]]:
    return await db.training_crm_leads.find({"creator_id": creator_id}).sort("updated_at", -1).to_list(500)


async def create_lead(db, creator_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    lead_id = f"lead_{uuid.uuid4().hex[:12]}"
    doc = {
        "lead_id": lead_id,
        "creator_id": creator_id,
        "email": payload.get("email"),
        "name": payload.get("name"),
        "stage": payload.get("stage") or "new",
        "source": payload.get("source") or "manual",
        "notes": payload.get("notes") or "",
        "created_at": _now(),
        "updated_at": _now(),
    }
    await db.training_crm_leads.insert_one(doc)
    return doc


async def update_lead(db, creator_id: str, lead_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    lead = await db.training_crm_leads.find_one({"lead_id": lead_id, "creator_id": creator_id}, {"_id": 0})
    if not lead:
        raise ValueError("Lead not found")
    updates = {k: v for k, v in payload.items() if k in ("name", "email", "stage", "notes", "source") and v is not None}
    updates["updated_at"] = _now()
    await db.training_crm_leads.update_one({"lead_id": lead_id}, {"$set": updates})
    return {**lead, **updates}


async def seed_training_content(db) -> None:
    """Seed default Swiipr course + creator if missing."""
    try:
        existing = await db.training_courses.find_one({"course_id": SEED_COURSE_ID}, {"_id": 0})
        if existing:
            return

        now = _now()
        creator = {
            "creator_id": SEED_CREATOR_ID,
            "user_id": "system_creator",
            "email": "academy@hirly.app",
            "display_name": "Hirly Academy",
            "bio": "Official job search training from the Hirly team.",
            "created_at": now,
        }
        await db.training_creators.update_one(
            {"creator_id": SEED_CREATOR_ID},
            {"$set": creator},
            upsert=True,
        )

        course = {
            "course_id": SEED_COURSE_ID,
            "creator_id": SEED_CREATOR_ID,
            "title": "Job Search Mastery",
            "subtitle": "Land more interviews with a smarter workflow",
            "description": "A step-by-step video course on targeting roles, tailoring applications, and staying consistent with Hirly.",
            "thumbnail_url": "/onboarding/intro-3.png",
            "level": "Beginner",
            "duration_minutes": 42,
            "status": "published",
            "published": True,
            "created_at": now,
            "updated_at": now,
        }
        await db.training_courses.insert_one(course)

        modules = [
            {
                "module_id": "mod_welcome",
                "course_id": SEED_COURSE_ID,
                "title": "Welcome & mindset",
                "description": "How top candidates structure their search.",
                "video_url": "https://www.youtube.com/embed/ZXsQAXxvvxo",
                "duration_seconds": 420,
                "sort_order": 1,
                "created_at": now,
            },
            {
                "module_id": "mod_targeting",
                "course_id": SEED_COURSE_ID,
                "title": "Build your target list",
                "description": "Pick roles, locations, and companies worth your time.",
                "video_url": "https://www.youtube.com/embed/WEDIj9JBTC8",
                "duration_seconds": 540,
                "sort_order": 2,
                "created_at": now,
            },
            {
                "module_id": "mod_cv",
                "course_id": SEED_COURSE_ID,
                "title": "CV that gets replies",
                "description": "Tailor your resume for each swipe in seconds.",
                "video_url": "https://www.youtube.com/embed/Tt08Km5IYb0",
                "duration_seconds": 600,
                "sort_order": 3,
                "created_at": now,
            },
            {
                "module_id": "mod_swipe",
                "course_id": SEED_COURSE_ID,
                "title": "Swipe & apply smart",
                "description": "Volume with quality — your daily Swiipr routine.",
                "video_url": "https://www.youtube.com/embed/9No-FiEInLA",
                "duration_seconds": 480,
                "sort_order": 4,
                "created_at": now,
            },
            {
                "module_id": "mod_interview",
                "course_id": SEED_COURSE_ID,
                "title": "Interview prep",
                "description": "Turn applications into conversations.",
                "video_url": "https://www.youtube.com/embed/1qw5ITr3kho",
                "duration_seconds": 540,
                "sort_order": 5,
                "created_at": now,
            },
        ]
        await db.training_modules.insert_many(modules)

        demo_leads = [
            {"name": "Alex Martin", "email": "alex@example.com", "stage": "qualified", "source": "landing"},
            {"name": "Jordan Lee", "email": "jordan@example.com", "stage": "contacted", "source": "webinar"},
            {"name": "Sam Rivera", "email": "sam@example.com", "stage": "new", "source": "instagram"},
        ]
        for item in demo_leads:
            await create_lead(db, SEED_CREATOR_ID, item)

        logger.info("Seeded training course %s with %s modules", SEED_COURSE_ID, len(modules))
    except Exception as exc:
        logger.warning("Training seed skipped: %s", exc)
