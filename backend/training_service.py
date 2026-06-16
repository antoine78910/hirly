"""Training courses, enrollments, and creator CRM."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from training_module_content import WARM_UP_PLAYBOOK_EN, WARM_UP_PLAYBOOK_FR

logger = logging.getLogger(__name__)

SEED_CREATOR_ID = "creator_swiipr_official"
SEED_COURSE_ID = "course_job_search_mastery"
SEED_MODULES_VERSION = 4

CRM_STAGES = ["new", "contacted", "qualified", "enrolled", "won", "lost"]

COURSE_I18N = {
    "en": {
        "title": "Talking Heads",
        "subtitle": "Video scripts & lessons to level up your job search",
        "description": "Go through each module, watch the videos, and complete the quizzes at the end of every chapter.",
        "level": "Beginner",
    },
    "fr": {
        "title": "Talking Heads",
        "subtitle": "Scripts vidéo et leçons pour booster ta recherche d'emploi",
        "description": "Parcours chaque module, regarde les vidéos et fais les quiz à la fin de chaque chapitre.",
        "level": "Débutant",
    },
}

CREATOR_I18N = {
    "en": {
        "display_name": "Hirly Academy",
        "bio": "Official job search training from the Hirly team.",
    },
    "fr": {
        "display_name": "Académie Hirly",
        "bio": "Formation officielle à la recherche d'emploi par l'équipe Hirly.",
    },
}

MODULE_I18N = {
    "mod_getting_started": {
        "en": {
            "title": "Getting Started",
            "description": "Set up your workspace and understand how the program works.",
            "category": "fundamentals",
        },
        "fr": {
            "title": "Pour bien commencer",
            "description": "Configure ton espace et comprends comment fonctionne le programme.",
            "category": "fundamentals",
        },
    },
    "mod_warm_up": {
        "en": {
            "title": "Warm Up Playbook",
            "description": "TikTok & IG warmup SOP before you post career content.",
            "category": "fundamentals",
            "content": WARM_UP_PLAYBOOK_EN,
        },
        "fr": {
            "title": "Guide d'échauffement",
            "description": "SOP warmup TikTok & IG avant de publier du contenu carrière.",
            "category": "fundamentals",
            "content": WARM_UP_PLAYBOOK_FR,
        },
    },
    "mod_creating_content": {
        "en": {
            "title": "Creating Content",
            "description": "How to plan, script, and record your talking-head videos.",
            "category": "application",
        },
        "fr": {
            "title": "Créer du contenu",
            "description": "Comment planifier, scripter et enregistrer tes vidéos face caméra.",
            "category": "application",
        },
    },
    "mod_content_bank": {
        "en": {
            "title": "Content Bank Examples",
            "description": "Reference scripts and formats you can reuse and adapt.",
            "category": "application",
        },
        "fr": {
            "title": "Exemples banque de contenu",
            "description": "Scripts et formats de référence à réutiliser et adapter.",
            "category": "application",
        },
    },
    "mod_content_policy": {
        "en": {
            "title": "Content Policy & Payment",
            "description": "Guidelines, compliance, and how payments work.",
            "category": "application",
        },
        "fr": {
            "title": "Politique de contenu & paiement",
            "description": "Règles, conformité et fonctionnement des paiements.",
            "category": "application",
        },
    },
    "mod_account_management": {
        "en": {
            "title": "Account Management",
            "description": "Manage your profile, settings, and creator account.",
            "category": "interview",
        },
        "fr": {
            "title": "Gestion du compte",
            "description": "Gère ton profil, tes paramètres et ton compte créateur.",
            "category": "interview",
        },
    },
    "mod_submit_drafts": {
        "en": {
            "title": "Submit Drafts & Next Steps",
            "description": "How to submit work, get feedback, and what happens next.",
            "category": "interview",
        },
        "fr": {
            "title": "Soumettre les brouillons & la suite",
            "description": "Comment soumettre ton travail, obtenir des retours et la suite du parcours.",
            "category": "interview",
        },
    },
    "mod_resources": {
        "en": {
            "title": "Resources",
            "description": "Templates, checklists, and links to keep handy.",
            "category": "resources",
        },
        "fr": {
            "title": "Ressources",
            "description": "Modèles, checklists et liens utiles à garder sous la main.",
            "category": "resources",
        },
    },
    "mod_bonus": {
        "en": {
            "title": "Bonus: War is Over",
            "description": "Extra tips and mindset for finishing strong.",
            "category": "bonus",
        },
        "fr": {
            "title": "Bonus : La guerre est finie",
            "description": "Conseils bonus et état d'esprit pour finir en beauté.",
            "category": "bonus",
        },
    },
}

for _module_id, _packs in MODULE_I18N.items():
    for _lang in ("en", "fr"):
        _packs[_lang].setdefault("video_url", "")


MODULE_SEED = [
    {"module_id": "mod_getting_started", "sort_order": 1, "duration_seconds": 480},
    {"module_id": "mod_warm_up", "sort_order": 2, "duration_seconds": 420},
    {"module_id": "mod_creating_content", "sort_order": 3, "duration_seconds": 600},
    {"module_id": "mod_content_bank", "sort_order": 4, "duration_seconds": 540},
    {"module_id": "mod_content_policy", "sort_order": 5, "duration_seconds": 480},
    {"module_id": "mod_account_management", "sort_order": 6, "duration_seconds": 420},
    {"module_id": "mod_submit_drafts", "sort_order": 7, "duration_seconds": 480},
    {"module_id": "mod_resources", "sort_order": 8, "duration_seconds": 300},
    {"module_id": "mod_bonus", "sort_order": 9, "duration_seconds": 360},
]


def _normalize_lang(lang: Optional[str]) -> str:
    return "fr" if (lang or "").lower().startswith("fr") else "en"


def _localize_fields(doc: Dict[str, Any], lang: str, fields: List[str]) -> Dict[str, Any]:
    out = dict(doc)
    pack = (doc.get("i18n") or {}).get(lang) or {}
    for field in fields:
        if field in pack:
            out[field] = pack[field]
    return out


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


def _public_course(course: Dict[str, Any], module_count: int = 0, lang: str = "en") -> Dict[str, Any]:
    localized = _localize_fields(course, lang, ["title", "subtitle", "description", "level"])
    return {
        "course_id": course["course_id"],
        "title": localized.get("title"),
        "subtitle": localized.get("subtitle"),
        "description": localized.get("description"),
        "thumbnail_url": course.get("thumbnail_url"),
        "level": localized.get("level", "Beginner"),
        "module_count": module_count,
        "duration_minutes": course.get("duration_minutes"),
        "creator_id": course.get("creator_id"),
    }


async def list_published_courses(db, lang: str = "en") -> List[Dict[str, Any]]:
    courses = await db.training_courses.find({"published": True}).sort("created_at", -1).to_list(200)
    out = []
    for course in courses:
        modules = await db.training_modules.find({"course_id": course["course_id"]}).to_list(200)
        out.append(_public_course(course, len(modules), lang))
    return out


async def get_course_detail(db, course_id: str, user_id: Optional[str] = None, lang: str = "en") -> Optional[Dict[str, Any]]:
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
        localized = _localize_fields(mod, lang, ["title", "description", "category", "content", "video_url"])
        module_rows.append({
            "module_id": mod["module_id"],
            "title": localized.get("title"),
            "description": localized.get("description"),
            "category": localized.get("category") or mod.get("category"),
            "content": localized.get("content") or [],
            "video_url": localized.get("video_url", ""),
            "duration_seconds": mod.get("duration_seconds"),
            "sort_order": mod.get("sort_order", 0),
            "completed": mod["module_id"] in completed,
        })

    progress = (enrollment or {}).get("progress_percent")
    if progress is None and module_rows:
        progress = _pct(list(completed), len(module_rows))

    creator = await db.training_creators.find_one({"creator_id": course.get("creator_id")}, {"_id": 0})
    creator_local = _localize_fields(creator or {}, lang, ["display_name", "bio"]) if creator else None

    return {
        "course": _public_course(course, len(module_rows), lang),
        "modules": module_rows,
        "lang": lang,
        "enrollment": {
            "enrolled": enrollment is not None,
            "progress_percent": progress or 0,
            "completed_module_ids": list(completed),
        },
        "creator": {
            "display_name": (creator_local or {}).get("display_name"),
            "bio": (creator_local or {}).get("bio"),
        } if creator_local else None,
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


async def list_user_enrollments(db, user_id: str, lang: str = "en") -> List[Dict[str, Any]]:
    enrollments = await db.training_enrollments.find({"user_id": user_id}).sort("updated_at", -1).to_list(100)
    out = []
    for enr in enrollments:
        course = await db.training_courses.find_one({"course_id": enr["course_id"]}, {"_id": 0})
        if not course:
            continue
        modules = await db.training_modules.find({"course_id": enr["course_id"]}).to_list(200)
        out.append({
            **_public_course(course, len(modules), lang),
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


async def sync_training_locale_content(db) -> None:
    """Patch i18n fields onto seed content when DB was created before translations."""
    try:
        course = await db.training_courses.find_one({"course_id": SEED_COURSE_ID}, {"_id": 0})
        if course:
            await db.training_courses.update_one(
                {"course_id": SEED_COURSE_ID},
                {"$set": {
                    "i18n": COURSE_I18N,
                    **COURSE_I18N["en"],
                }},
            )
        creator = await db.training_creators.find_one({"creator_id": SEED_CREATOR_ID}, {"_id": 0})
        if creator:
            await db.training_creators.update_one(
                {"creator_id": SEED_CREATOR_ID},
                {"$set": {
                    "i18n": CREATOR_I18N,
                    **CREATOR_I18N["en"],
                }},
            )
    except Exception as exc:
        logger.warning("Training locale sync skipped: %s", exc)


def _module_doc(mod_def: Dict[str, Any], now: str, existing: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    module_id = mod_def["module_id"]
    i18n = MODULE_I18N[module_id]
    return {
        "module_id": module_id,
        "course_id": SEED_COURSE_ID,
        "i18n": i18n,
        **i18n["en"],
        "video_url": i18n["en"].get("video_url", ""),
        "duration_seconds": mod_def.get("duration_seconds", 0),
        "sort_order": mod_def["sort_order"],
        "created_at": (existing or {}).get("created_at") or now,
        "updated_at": now,
    }


async def sync_training_modules_catalog(db) -> None:
    """Ensure seed course has the latest module catalog (Talking Heads chapters)."""
    try:
        course = await db.training_courses.find_one({"course_id": SEED_COURSE_ID}, {"_id": 0})
        if not course:
            return

        if int(course.get("modules_seed_version") or 0) >= SEED_MODULES_VERSION:
            return

        now = _now()
        expected_ids = {item["module_id"] for item in MODULE_SEED}

        for mod_def in MODULE_SEED:
            module_id = mod_def["module_id"]
            existing = await db.training_modules.find_one({"module_id": module_id}, {"_id": 0})
            doc = _module_doc(mod_def, now, existing)
            await db.training_modules.update_one(
                {"module_id": module_id},
                {"$set": doc},
                upsert=True,
            )

        obsolete = await db.training_modules.find({"course_id": SEED_COURSE_ID}).to_list(200)
        for mod in obsolete:
            if mod["module_id"] not in expected_ids:
                await db.training_modules.delete_one({"module_id": mod["module_id"]})

        total_seconds = sum(item.get("duration_seconds", 0) for item in MODULE_SEED)
        await db.training_courses.update_one(
            {"course_id": SEED_COURSE_ID},
            {"$set": {
                "i18n": COURSE_I18N,
                **COURSE_I18N["en"],
                "duration_minutes": max(1, round(total_seconds / 60)),
                "modules_seed_version": SEED_MODULES_VERSION,
                "updated_at": now,
            }},
        )
        logger.info("Synced training modules catalog v%s (%s modules)", SEED_MODULES_VERSION, len(MODULE_SEED))
    except Exception as exc:
        logger.warning("Training modules sync skipped: %s", exc)


async def seed_training_content(db) -> None:
    """Seed default Swiipr course + creator if missing."""
    try:
        existing = await db.training_courses.find_one({"course_id": SEED_COURSE_ID}, {"_id": 0})
        if existing:
            await sync_training_locale_content(db)
            await sync_training_modules_catalog(db)
            return

        now = _now()
        creator = {
            "creator_id": SEED_CREATOR_ID,
            "user_id": "system_creator",
            "email": "academy@hirly.app",
            "i18n": CREATOR_I18N,
            **CREATOR_I18N["en"],
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
            "i18n": COURSE_I18N,
            **COURSE_I18N["en"],
            "thumbnail_url": "/onboarding/intro-3.png",
            "duration_minutes": max(1, round(sum(m.get("duration_seconds", 0) for m in MODULE_SEED) / 60)),
            "modules_seed_version": SEED_MODULES_VERSION,
            "status": "published",
            "published": True,
            "created_at": now,
            "updated_at": now,
        }
        await db.training_courses.insert_one(course)

        modules = [_module_doc(mod_def, now) for mod_def in MODULE_SEED]
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
