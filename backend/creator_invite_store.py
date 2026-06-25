"""File-backed creator invitation codes (6-digit) for influencer onboarding."""

from __future__ import annotations

import random
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from influencer_store import get_influencer, load_influencers, save_influencers

STORE_PATH = __import__("pathlib").Path(__file__).resolve().parent / "data" / "creator_invites.json"
DEFAULT_COURSE_ID = "course_job_search_mastery"
INVITE_TTL_DAYS = 90
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


def _ensure_store() -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        STORE_PATH.write_text("[]", encoding="utf-8")


def _should_seed_dev_test_invites() -> bool:
    import os

    flag = (os.environ.get("SEED_DEV_INVITES") or "true").strip().lower()
    return flag not in ("0", "false", "no", "off")


def ensure_dev_test_invites() -> None:
    """Ensure fixed dev invite codes exist (123456 training, 654321 demo)."""
    if not _should_seed_dev_test_invites():
        return

    rows = load_invites()
    by_code = {str(row.get("code")): index for index, row in enumerate(rows) if row.get("code")}
    changed = False
    now = _now_iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)).isoformat()

    for spec in DEV_TEST_INVITE_SPECS:
        code = spec["code"]
        index = by_code.get(code)
        if index is not None:
            row = rows[index]
            needs_reset = bool(row.get("redeemed_at") or row.get("revoked") or _is_expired(row))
            if needs_reset:
                rows[index] = {
                    **row,
                    "invite_type": spec["invite_type"],
                    "label": spec.get("label") or row.get("label") or "",
                    "expires_at": expires,
                    "redeemed_at": None,
                    "redeemed_by_user_id": None,
                    "revoked": False,
                    "updated_at": now,
                }
                changed = True
            continue

        rows.append(
            {
                "invite_id": str(uuid.uuid4()),
                "code": code,
                "influencer_id": None,
                "invite_type": spec["invite_type"],
                "course_id": DEFAULT_COURSE_ID,
                "email_hint": "",
                "label": spec.get("label") or "",
                "created_at": now,
                "expires_at": expires,
                "redeemed_at": None,
                "redeemed_by_user_id": None,
                "revoked": False,
            }
        )
        changed = True

    if changed:
        save_invites(rows)


def load_invites() -> List[Dict[str, Any]]:
    _ensure_store()
    try:
        import json

        raw = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, list) else []
    except (json.JSONDecodeError, OSError):
        return []


def save_invites(rows: List[Dict[str, Any]]) -> None:
    _ensure_store()
    import json

    STORE_PATH.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def _generate_code(existing: set[str]) -> str:
    for _ in range(200):
        code = f"{random.randint(0, 999999):06d}"
        if code not in existing:
            return code
    raise RuntimeError("Could not generate a unique invite code")


def get_invite_by_code(code: str) -> Optional[Dict[str, Any]]:
    normalized = (code or "").strip()
    if not normalized:
        return None
    for row in load_invites():
        if str(row.get("code")) == normalized:
            return row
    return None


def list_invites_for_influencer(influencer_id: str) -> List[Dict[str, Any]]:
    rows = [row for row in load_invites() if row.get("influencer_id") == influencer_id]
    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows


def _is_expired(row: Dict[str, Any]) -> bool:
    expires_at = row.get("expires_at")
    if not expires_at:
        return False
    try:
        return datetime.fromisoformat(expires_at.replace("Z", "+00:00")) < datetime.now(timezone.utc)
    except ValueError:
        return False


def validate_invite(code: str) -> Dict[str, Any]:
    row = get_invite_by_code(code)
    if not row:
        return {"valid": False, "reason": "not_found"}
    if row.get("revoked"):
        return {"valid": False, "reason": "revoked"}
    if _is_expired(row):
        return {"valid": False, "reason": "expired"}
    if row.get("redeemed_at") and row.get("redeemed_by_user_id"):
        return {"valid": False, "reason": "already_redeemed", "invitation": row}
    influencer = get_influencer(row.get("influencer_id") or "")
    return {
        "valid": True,
        "invitation": row,
        "influencer_name": (influencer or {}).get("name"),
        "course_id": row.get("course_id") or DEFAULT_COURSE_ID,
        "invite_type": resolve_invite_type(row),
    }


def list_training_invites(limit: int = 50) -> List[Dict[str, Any]]:
    rows = [
        row for row in load_invites()
        if not row.get("influencer_id") and resolve_invite_type(row) == INVITE_TYPE_TRAINING
    ]
    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows[:limit]


def list_demo_invites(limit: int = 50) -> List[Dict[str, Any]]:
    rows = [
        row for row in load_invites()
        if resolve_invite_type(row) == INVITE_TYPE_DEMO
    ]
    rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
    return rows[:limit]


def _append_invitation(row: Dict[str, Any]) -> Dict[str, Any]:
    rows = load_invites()
    rows.append(row)
    save_invites(rows)
    return row


def create_standalone_invitation(
    course_id: Optional[str] = None,
    email_hint: str = "",
    label: str = "",
    invite_type: str = INVITE_TYPE_TRAINING,
) -> Dict[str, Any]:
    existing_codes = {str(row.get("code")) for row in load_invites() if row.get("code")}
    code = _generate_code(existing_codes)
    now = _now_iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)).isoformat()
    row = {
        "invite_id": str(uuid.uuid4()),
        "code": code,
        "influencer_id": None,
        "invite_type": invite_type if invite_type in {INVITE_TYPE_TRAINING, INVITE_TYPE_DEMO} else INVITE_TYPE_TRAINING,
        "course_id": course_id or DEFAULT_COURSE_ID,
        "email_hint": (email_hint or "").strip(),
        "label": (label or "").strip(),
        "created_at": now,
        "expires_at": expires,
        "redeemed_at": None,
        "redeemed_by_user_id": None,
        "revoked": False,
    }
    return _append_invitation(row)


def create_demo_invitation(
    influencer_id: Optional[str] = None,
    email_hint: str = "",
    label: str = "",
) -> Dict[str, Any]:
    if influencer_id and not get_influencer(influencer_id):
        raise ValueError("Influencer not found")

    existing_codes = {str(row.get("code")) for row in load_invites() if row.get("code")}
    code = _generate_code(existing_codes)
    now = _now_iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)).isoformat()
    row = {
        "invite_id": str(uuid.uuid4()),
        "code": code,
        "influencer_id": influencer_id,
        "invite_type": INVITE_TYPE_DEMO,
        "course_id": DEFAULT_COURSE_ID,
        "email_hint": (email_hint or "").strip(),
        "label": (label or "").strip(),
        "created_at": now,
        "expires_at": expires,
        "redeemed_at": None,
        "redeemed_by_user_id": None,
        "revoked": False,
    }
    invitation = _append_invitation(row)

    if influencer_id:
        for index, inf in enumerate(load_influencers()):
            if inf.get("influencer_id") != influencer_id:
                continue
            inf_rows = load_influencers()
            inf_rows[index] = {**inf, "latest_demo_invite_code": code, "updated_at": now}
            save_influencers(inf_rows)
            break

    return invitation


def create_invitation(influencer_id: str, course_id: Optional[str] = None) -> Dict[str, Any]:
    influencer = get_influencer(influencer_id)
    if not influencer:
        raise ValueError("Influencer not found")

    existing_codes = {str(row.get("code")) for row in load_invites() if row.get("code")}
    code = _generate_code(existing_codes)
    now = _now_iso()
    expires = (datetime.now(timezone.utc) + timedelta(days=INVITE_TTL_DAYS)).isoformat()
    row = {
        "invite_id": str(uuid.uuid4()),
        "code": code,
        "influencer_id": influencer_id,
        "invite_type": INVITE_TYPE_TRAINING,
        "course_id": course_id or DEFAULT_COURSE_ID,
        "email_hint": influencer.get("email") or "",
        "created_at": now,
        "expires_at": expires,
        "redeemed_at": None,
        "redeemed_by_user_id": None,
        "revoked": False,
    }
    invitation = _append_invitation(row)

    for index, inf in enumerate(load_influencers()):
        if inf.get("influencer_id") != influencer_id:
            continue
        inf_rows = load_influencers()
        inf_rows[index] = {**inf, "latest_invite_code": code, "updated_at": now}
        save_influencers(inf_rows)
        break

    return invitation


def mark_invite_redeemed(code: str, user_id: str) -> Optional[Dict[str, Any]]:
    rows = load_invites()
    updated = None
    now = _now_iso()
    for index, row in enumerate(rows):
        if str(row.get("code")) != str(code).strip():
            continue
        next_row = {
            **row,
            "redeemed_at": now,
            "redeemed_by_user_id": user_id,
        }
        rows[index] = next_row
        updated = next_row
        break
    if updated is None:
        return None
    save_invites(rows)
    return updated
