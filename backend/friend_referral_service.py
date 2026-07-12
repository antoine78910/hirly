"""Invite-3-friends referral program for onboarding checkout."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

FRIEND_REFERRAL_GOAL = 3
FRIEND_REFERRAL_REWARD_CREDITS = 40
FRIEND_REFERRAL_REWARD_DAYS = 30


def referral_code_from_user_id(user_id: str) -> str:
    """Match frontend referralCodeFromUserId (6-char hex)."""
    seed = str(user_id or "guest")
    hash_val = 0
    for char in seed:
        hash_val = (hash_val * 31 + ord(char)) & 0xFFFFFFFF
    return format(hash_val, "x").upper().zfill(6)[-6:]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_code(code: str) -> str:
    return str(code or "").strip().upper()


def _friend_referral_doc(user_doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return dict((user_doc or {}).get("friend_referral") or {})


def friend_referral_status_payload(user_doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    user_id = (user_doc or {}).get("user_id") or ""
    referral = _friend_referral_doc(user_doc)
    enrolled = bool(referral.get("enrolled_at"))
    uses = int(referral.get("uses_count") or 0)
    reward_granted = bool(referral.get("reward_granted_at"))
    return {
        "enrolled": enrolled,
        "code": referral_code_from_user_id(user_id) if user_id else None,
        "uses_count": uses,
        "goal": FRIEND_REFERRAL_GOAL,
        "reward_granted": reward_granted,
        "reward_credits": FRIEND_REFERRAL_REWARD_CREDITS if reward_granted else 0,
        "pending_access": enrolled and not reward_granted and uses < FRIEND_REFERRAL_GOAL,
    }


async def _lookup_referrer_id(db, code: str) -> Optional[str]:
    normalized = _normalize_code(code)
    if not normalized:
        return None
    row = await db.friend_referral_codes.find_one({"code": normalized}, {"_id": 0, "user_id": 1})
    if row and row.get("user_id"):
        return row["user_id"]
    return None


async def enroll_friend_referral(db, user_id: str) -> Dict[str, Any]:
    code = referral_code_from_user_id(user_id)
    now = _now_iso()
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user_doc:
        raise ValueError("User not found")

    referral = _friend_referral_doc(user_doc)
    if not referral.get("enrolled_at"):
        await db.users.update_one(
            {"user_id": user_id},
            {
                "$set": {
                    "friend_referral.enrolled_at": now,
                    "friend_referral.uses_count": int(referral.get("uses_count") or 0),
                    "friend_referral.updated_at": now,
                }
            },
            upsert=False,
        )
    else:
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"friend_referral.updated_at": now}},
            upsert=False,
        )

    await db.friend_referral_codes.update_one(
        {"code": code},
        {"$set": {"code": code, "user_id": user_id, "enrolled_at": referral.get("enrolled_at") or now, "updated_at": now}},
        upsert=True,
    )
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return friend_referral_status_payload(user_doc)


async def redeem_friend_referral_code(
    db,
    *,
    code: str,
    redeemer_user_id: str,
    redeemer_email: Optional[str] = None,
    send_use_email,
    send_reward_email,
    grant_reward,
    app_url: str,
) -> Dict[str, Any]:
    normalized = _normalize_code(code)
    if not normalized or not (4 <= len(normalized) <= 8) or not normalized.isalnum():
        raise ValueError("Enter a valid referral code (4–8 letters or numbers)")

    referrer_id = await _lookup_referrer_id(db, normalized)
    if not referrer_id:
        raise ValueError("Referral code not found")

    if referrer_id == redeemer_user_id:
        raise ValueError("You cannot use your own referral code")

    existing = await db.friend_referral_redemptions.find_one(
        {"redeemer_user_id": redeemer_user_id},
        {"_id": 0},
    )
    if existing:
        raise ValueError("You have already used a friend referral code")

    already_for_code = await db.friend_referral_redemptions.find_one(
        {"referrer_user_id": referrer_id, "redeemer_user_id": redeemer_user_id},
        {"_id": 0},
    )
    if already_for_code:
        raise ValueError("You have already used this referral code")

    now = _now_iso()
    await db.friend_referral_redemptions.insert_one({
        "redemption_id": f"friend_ref_{uuid.uuid4().hex[:12]}",
        "code": normalized,
        "referrer_user_id": referrer_id,
        "redeemer_user_id": redeemer_user_id,
        "redeemer_email": (redeemer_email or "").strip().lower() or None,
        "created_at": now,
    })

    referrer_doc = await db.users.find_one({"user_id": referrer_id}, {"_id": 0})
    if not referrer_doc:
        raise ValueError("Referral code not found")

    referral = _friend_referral_doc(referrer_doc)
    if not referral.get("enrolled_at"):
        await enroll_friend_referral(db, referrer_id)
        referrer_doc = await db.users.find_one({"user_id": referrer_id}, {"_id": 0})
        referral = _friend_referral_doc(referrer_doc)

    uses = int(referral.get("uses_count") or 0) + 1
    await db.users.update_one(
        {"user_id": referrer_id},
        {"$set": {"friend_referral.uses_count": uses, "friend_referral.updated_at": now}},
    )

    referrer_email = (referrer_doc.get("email") or "").strip()
    referrer_name = (referrer_doc.get("name") or "").strip() or "there"

    if referrer_email:
        try:
            await send_use_email(
                to=referrer_email,
                name=referrer_name,
                uses_count=uses,
                goal=FRIEND_REFERRAL_GOAL,
            )
        except Exception as exc:
            logger.warning("friend_referral use email failed referrer=%s err=%s", referrer_id, exc)

    reward_granted = bool(referral.get("reward_granted_at"))
    if uses >= FRIEND_REFERRAL_GOAL and not reward_granted:
        claim_token = uuid.uuid4().hex
        reward_at = _now_iso()
        await db.users.update_one(
            {"user_id": referrer_id},
            {
                "$set": {
                    "friend_referral.reward_granted_at": reward_at,
                    "friend_referral.reward_claim_token": claim_token,
                    "friend_referral.updated_at": reward_at,
                }
            },
        )
        await grant_reward(referrer_id)
        if referrer_email:
            try:
                claim_url = f"{app_url.rstrip('/')}/swipe?friendReferral=unlocked&token={claim_token}"
                await send_reward_email(
                    to=referrer_email,
                    name=referrer_name,
                    claim_url=claim_url,
                    credits=FRIEND_REFERRAL_REWARD_CREDITS,
                )
            except Exception as exc:
                logger.warning("friend_referral reward email failed referrer=%s err=%s", referrer_id, exc)
        reward_granted = True

    return {
        "ok": True,
        "referrer_user_id": referrer_id,
        "uses_count": uses,
        "goal": FRIEND_REFERRAL_GOAL,
        "reward_unlocked": reward_granted and uses >= FRIEND_REFERRAL_GOAL,
    }


async def claim_friend_referral_reward(db, user_id: str, token: Optional[str]) -> Dict[str, Any]:
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user_doc:
        raise ValueError("User not found")
    referral = _friend_referral_doc(user_doc)
    if not referral.get("reward_granted_at"):
        raise ValueError("No referral reward to claim yet")
    stored = str(referral.get("reward_claim_token") or "")
    if stored and token and stored != str(token).strip():
        raise ValueError("Invalid reward link")
    return friend_referral_status_payload(user_doc)
