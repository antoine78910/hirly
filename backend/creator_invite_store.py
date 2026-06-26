"""Creator invitation codes (6-digit) for training and demo onboarding."""

from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from influencer_store import get_influencer, load_influencers, save_influencers

logger = logging.getLogger(__name__)

STORE_PATH = Path(__file__).resolve().parent / "data" / "creator_invites.json"
DEFAULT_COURSE_ID = "course_job_search_mastery"
INVITE_TYPE_TRAINING = "training"
INVITE_TYPE_DEMO = "demo"
INVITE_TYPE_CREATOR = "creator"  # legacy: grants both training + demo

# Fixed local test codes (see frontend inviteDevMocks.js)
DEV_TEST_INVITE_SPECS = (
    {"code": "123456", "invite_type": INVITE_TYPE_TRAINING, "label": "Dev training invite"},
    {"code": "654321", "invite_type": INVITE_TYPE_DEMO, "label": "Dev demo invite"},
)


def resolve_invite_type(row: Optional[Dict[str, Any]]) -> str:
    if not row:
        return INVITE_TYPE_TRAINING
    explicit = str(row.get("invite_type") or "").strip().lower()
    if explicit in {INVITE_TYPE_TRAINING, INVITE_TYPE_DEMO, INVITE_TYPE_CREATOR}:
        return explicit
    if row.get("influencer_id"):
        return INVITE_TYPE_CREATOR
    return INVITE_TYPE_TRAINING


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ensure_file_store() -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        STORE_PATH.write_text("[]", encoding="utf-8")


def _load_invites_file() -> List[Dict[str, Any]]:
    _ensure_file_store()
    try:
        import json

        raw = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def _save_invites_file(rows: List[Dict[str, Any]]) -> None:
    _ensure_file_store()
    import json

    STORE_PATH.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def _has_invite_db(db) -> bool:
    return db is not None and hasattr(db, "creator_invites")


async def _load_invites_db(db) -> List[Dict[str, Any]]:
    if not _has_invite_db(db):
        return []
    try:
        cursor = db.creator_invites.find({})
        if hasattr(cursor, "sort"):
            cursor = cursor.sort("created_at", -1)
        rows = await cursor.to_list(5000)
        return rows or []
    except Exception as exc:
        logger.warning("creator_invites db read failed: %s", exc)
        return []


async def load_invites(db=None) -> List[Dict[str, Any]]:
    rows = await _load_invites_db(db)
    if rows:
        return rows
    return _load_invites_file()


async def _upsert_invite(db, row: Dict[str, Any]) -> Dict[str, Any]:
    doc = dict(row)
    if not doc.get("invite_id"):
        doc["invite_id"] = str(uuid.uuid4())
    doc["updated_at"] = _now_iso()
    if _has_invite_db(db):
        try:
            await db.creator_invites.update_one(
                {"invite_id": doc["invite_id"]},
                {"$set": doc},
                upsert=True,
            )
            return doc
        except Exception as exc:
            logger.warning("creator_invites db upsert failed: %s", exc)
    rows = _load_invites_file()
    replaced = False
    for index, existing in enumerate(rows):
        if str(existing.get("invite_id")) == str(doc["invite_id"]) or str(existing.get("code")) == str(doc.get("code")):
            rows[index] = doc
            replaced = True
            break
    if not replaced:
        rows.append(doc)
    _save_invites_file(rows)
    return doc


async def migrate_file_invites_to_db(db) -> None:
    """One-time bootstrap: copy file-backed invites into Supabase."""
    if not _has_invite_db(db):
        return
    file_rows = _load_invites_file()
    if not file_rows:
        return
    for row in file_rows:
        code = str(row.get("code") or "").strip()
        if not code:
            continue
        existing = await db.creator_invites.find_one({"code": code}, {"_id": 0})
        if existing:
            continue
        try:
            await _upsert_invite(db, row)
        except Exception as exc:
            logger.warning("invite migration failed code=%s: %s", code, exc)


def _should_seed_dev_test_invites() -> bool:
    import os

    flag = (os.environ.get("SEED_DEV_INVITES") or "true").strip().lower()
    return flag not in ("0", "false", "no", "off")


async def ensure_dev_test_invites(db=None) -> None:
    """Ensure fixed dev invite codes exist (123456 training, 654321 demo)."""
    if not _should_seed_dev_test_invites():
        return

    rows = await load_invites(db)
    by_code = {str(row.get("code")): row for row in rows if row.get("code")}
    now = _now_iso()

    for spec in DEV_TEST_INVITE_SPECS:
        code = spec["code"]
        row = by_code.get(code)
        if row:
            if row.get("revoked"):
                row = {
                    **row,
                    "invite_type": spec["invite_type"],
                    "label": spec.get("label") or row.get("label") or "",
                    "revoked": False,
                    "updated_at": now,
                }
                await _upsert_invite(db, row)
            continue

        await _upsert_invite(db, {
            "invite_id": f"dev-{spec['invite_type']}-invite",
            "code": code,
            "influencer_id": None,
            "invite_type": spec["invite_type"],
            "course_id": DEFAULT_COURSE_ID,
            "email_hint": "",
            "label": spec.get("label") or "",
            "created_at": now,
            "redeemed_at": None,
            "redeemed_by_user_id": None,
            "revoked": False,
        })


def _generate_code(existing: set[str]) -> str:
    for _ in range(200):
        code = f"{random.randint(0, 999999):06d}"
        if code not in existing:
            return code
    raise RuntimeError("Could not generate a unique invite code")


async def get_invite_by_code(db, code: str) -> Optional[Dict[str, Any]]:
    normalized = (code or "").strip()
    if not normalized:
        return None
    if _has_invite_db(db):
        try:
            row = await db.creator_invites.find_one({"code": normalized}, {"_id": 0})
            if row:
                return row
        except Exception as exc:
            logger.warning("creator_invites db lookup failed code=%s: %s", normalized, exc)
    for row in _load_invites_file():
        if str(row.get("code")) == normalized:
            return row
    return None


async def list_invites_for_influencer(db, influencer_id: str) -> List[Dict[str, Any]]:
    rows = [
        row for row in await load_invites(db)
        if row.get("influencer_id") == influencer_id
    ]
    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows


def validate_invite_row(row: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Invites do not expire; redeemed links stay valid for the same account to sign in again."""
    if not row:
        return {"valid": False, "reason": "not_found"}
    if row.get("revoked"):
        return {"valid": False, "reason": "revoked"}
    already = bool(row.get("redeemed_at") and row.get("redeemed_by_user_id"))
    influencer = get_influencer(row.get("influencer_id") or "")
    return {
        "valid": True,
        "already_redeemed": already,
        "reason": "already_redeemed" if already else None,
        "invitation": row,
        "influencer_name": (influencer or {}).get("name"),
        "course_id": row.get("course_id") or DEFAULT_COURSE_ID,
        "invite_type": resolve_invite_type(row),
    }


async def validate_invite(db, code: str) -> Dict[str, Any]:
    row = await get_invite_by_code(db, code)
    return validate_invite_row(row)


async def list_training_invites(db, limit: int = 50) -> List[Dict[str, Any]]:
    rows = [
        row for row in await load_invites(db)
        if not row.get("influencer_id") and resolve_invite_type(row) == INVITE_TYPE_TRAINING
    ]
    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows[:limit]


async def list_demo_invites(db, limit: int = 50) -> List[Dict[str, Any]]:
    rows = [
        row for row in await load_invites(db)
        if resolve_invite_type(row) == INVITE_TYPE_DEMO
    ]
    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows[:limit]


async def create_standalone_invitation(
    db,
    course_id: Optional[str] = None,
    email_hint: str = "",
    label: str = "",
    invite_type: str = INVITE_TYPE_TRAINING,
) -> Dict[str, Any]:
    existing_codes = {str(row.get("code")) for row in await load_invites(db) if row.get("code")}
    code = _generate_code(existing_codes)
    now = _now_iso()
    row = {
        "invite_id": str(uuid.uuid4()),
        "code": code,
        "influencer_id": None,
        "invite_type": invite_type if invite_type in {INVITE_TYPE_TRAINING, INVITE_TYPE_DEMO} else INVITE_TYPE_TRAINING,
        "course_id": course_id or DEFAULT_COURSE_ID,
        "email_hint": (email_hint or "").strip(),
        "label": (label or "").strip(),
        "created_at": now,
        "redeemed_at": None,
        "redeemed_by_user_id": None,
        "revoked": False,
    }
    return await _upsert_invite(db, row)


async def create_demo_invitation(
    db,
    influencer_id: Optional[str] = None,
    email_hint: str = "",
    label: str = "",
) -> Dict[str, Any]:
    if influencer_id and not get_influencer(influencer_id):
        raise ValueError("Influencer not found")

    existing_codes = {str(row.get("code")) for row in await load_invites(db) if row.get("code")}
    code = _generate_code(existing_codes)
    now = _now_iso()
    row = {
        "invite_id": str(uuid.uuid4()),
        "code": code,
        "influencer_id": influencer_id,
        "invite_type": INVITE_TYPE_DEMO,
        "course_id": DEFAULT_COURSE_ID,
        "email_hint": (email_hint or "").strip(),
        "label": (label or "").strip(),
        "created_at": now,
        "redeemed_at": None,
        "redeemed_by_user_id": None,
        "revoked": False,
    }
    invitation = await _upsert_invite(db, row)

    if influencer_id:
        for index, inf in enumerate(load_influencers()):
            if inf.get("influencer_id") != influencer_id:
                continue
            inf_rows = load_influencers()
            inf_rows[index] = {**inf, "latest_demo_invite_code": code, "updated_at": now}
            save_influencers(inf_rows)
            break

    return invitation


async def create_invitation(db, influencer_id: str, course_id: Optional[str] = None) -> Dict[str, Any]:
    influencer = get_influencer(influencer_id)
    if not influencer:
        raise ValueError("Influencer not found")

    existing_codes = {str(row.get("code")) for row in await load_invites(db) if row.get("code")}
    code = _generate_code(existing_codes)
    now = _now_iso()
    row = {
        "invite_id": str(uuid.uuid4()),
        "code": code,
        "influencer_id": influencer_id,
        "invite_type": INVITE_TYPE_TRAINING,
        "course_id": course_id or DEFAULT_COURSE_ID,
        "email_hint": influencer.get("email") or "",
        "created_at": now,
        "redeemed_at": None,
        "redeemed_by_user_id": None,
        "revoked": False,
    }
    invitation = await _upsert_invite(db, row)

    for index, inf in enumerate(load_influencers()):
        if inf.get("influencer_id") != influencer_id:
            continue
        inf_rows = load_influencers()
        inf_rows[index] = {**inf, "latest_invite_code": code, "updated_at": now}
        save_influencers(inf_rows)
        break

    return invitation


async def mark_invite_clicked(db, code: str) -> Optional[Dict[str, Any]]:
    """Record that an invite landing page was opened."""
    normalized = str(code or "").strip()
    if not normalized:
        return None
    row = await get_invite_by_code(db, normalized)
    if not row:
        return None
    now = _now_iso()
    click_count = int(row.get("click_count") or 0) + 1
    next_row = {
        **row,
        "click_count": click_count,
        "first_clicked_at": row.get("first_clicked_at") or now,
        "last_clicked_at": now,
    }
    return await _upsert_invite(db, next_row)


async def mark_invite_redeemed(
    db,
    code: str,
    user_id: str,
    user_email: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    row = await get_invite_by_code(db, str(code).strip())
    if not row:
        return None
    now = _now_iso()
    email_norm = (user_email or "").strip().lower()
    next_row = {
        **row,
        "redeemed_at": now,
        "redeemed_by_user_id": user_id,
        "redeemed_by_email": email_norm or row.get("redeemed_by_email"),
    }
    return await _upsert_invite(db, next_row)


def enrich_invite_rows(
    rows: List[Dict[str, Any]],
    users_by_id: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Attach linked account email/name for admin views."""
    lookup = users_by_id or {}
    enriched: List[Dict[str, Any]] = []
    for row in rows:
        copy = dict(row)
        user_id = copy.get("redeemed_by_user_id")
        if user_id and user_id in lookup:
            user = lookup[user_id]
            copy.setdefault("redeemed_by_email", user.get("email"))
            copy["redeemed_by_name"] = user.get("name")
        enriched.append(copy)
    return enriched
