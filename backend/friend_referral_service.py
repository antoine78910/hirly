"""Invite-3-friends referral program for onboarding checkout.

Codes are real, random 6-digit numbers stored in friend_referral_codes
(created lazily on first enroll, not precomputed for every user) plus
denormalized onto users.friend_referral.code so status reads stay
synchronous. Every 3 completed referrals grants another reward batch
(uncapped, not just the first) -- see redeem_friend_referral_code.
"""

from __future__ import annotations

import logging
import random
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

FRIEND_REFERRAL_GOAL = 3
FRIEND_REFERRAL_REWARD_CREDITS = 40
FRIEND_REFERRAL_REWARD_DAYS = 30
# One-time discount for the new signup who redeems someone else's code
# (separate from the referrer's every-3 reward above).
FRIEND_REFERRAL_SIGNUP_DISCOUNT_PERCENT = 25
FRIEND_REFERRAL_SIGNUP_DISCOUNT_COUPON_ID = "friend_referral_signup_25off"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_code(code: str) -> str:
    return str(code or "").strip().upper()


def _friend_referral_doc(user_doc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return dict((user_doc or {}).get("friend_referral") or {})


def _is_premium(user_doc: Optional[Dict[str, Any]]) -> bool:
    billing = (user_doc or {}).get("billing") or {}
    return (billing.get("subscription_status") or "none") in {"active", "trialing"}


def friend_referral_status_payload(user_doc: Optional[Dict[str, Any]], *, is_premium: Optional[bool] = None) -> Dict[str, Any]:
    referral = _friend_referral_doc(user_doc)
    enrolled = bool(referral.get("enrolled_at"))
    uses = int(referral.get("uses_count") or 0)
    reward_batches_granted = int(referral.get("reward_batches_granted") or 0)
    premium = _is_premium(user_doc) if is_premium is None else is_premium
    return {
        "enrolled": enrolled,
        "code": referral.get("code"),
        "uses_count": uses,
        "goal": FRIEND_REFERRAL_GOAL,
        "progress_in_cycle": uses % FRIEND_REFERRAL_GOAL,
        "reward_batches_granted": reward_batches_granted,
        "credits_earned_total": reward_batches_granted * FRIEND_REFERRAL_REWARD_CREDITS,
        # Only true while the referrer hasn't unlocked access yet -- once
        # premium (via this program or a real subscription), the swipe-page
        # "invite 3 friends to unlock" banner should stop nagging them, even
        # though they can keep earning credits from the Referral page.
        "pending_access": enrolled and not premium and uses < FRIEND_REFERRAL_GOAL,
    }


async def _lookup_referrer_id(db, code: str) -> Optional[str]:
    normalized = _normalize_code(code)
    if not normalized:
        return None
    row = await db.friend_referral_codes.find_one({"code": normalized}, {"_id": 0, "user_id": 1})
    if row and row.get("user_id"):
        return row["user_id"]
    return None


async def _existing_friend_referral_codes(db) -> set:
    codes: set = set()
    try:
        rows = await db.friend_referral_codes.find({}, {"_id": 0, "code": 1}).to_list(100000)
        codes.update(str(row.get("code")) for row in rows if row.get("code"))
    except Exception as exc:
        logger.warning("friend_referral_codes scan failed: %s", exc)
    return codes


def _generate_code(existing: set) -> str:
    for _ in range(200):
        code = f"{random.randint(0, 999999):06d}"
        if code not in existing:
            return code
    raise RuntimeError("Could not generate a unique friend referral code")


async def get_or_create_friend_referral_code(db, user_id: str) -> str:
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0, "friend_referral": 1})
    existing_code = _friend_referral_doc(user_doc).get("code")
    if existing_code:
        return existing_code
    code = _generate_code(await _existing_friend_referral_codes(db))
    now = _now_iso()
    await db.friend_referral_codes.update_one(
        {"code": code},
        {"$set": {"code": code, "user_id": user_id, "created_at": now, "updated_at": now}},
        upsert=True,
    )
    await db.users.update_one(
        {"user_id": user_id},
        {"$set": {"friend_referral.code": code, "friend_referral.updated_at": now}},
    )
    return code


async def enroll_friend_referral(db, user_id: str) -> Dict[str, Any]:
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user_doc:
        raise ValueError("User not found")

    now = _now_iso()
    referral = _friend_referral_doc(user_doc)
    await get_or_create_friend_referral_code(db, user_id)
    if not referral.get("enrolled_at"):
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "friend_referral.enrolled_at": now,
                "friend_referral.uses_count": int(referral.get("uses_count") or 0),
                "friend_referral.updated_at": now,
            }},
        )
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return friend_referral_status_payload(user_doc)


async def has_redeemed_friend_referral_code(db, user_id: str) -> bool:
    """Whether this user signed up using someone else's referral code --
    used to grant the one-time signup discount at checkout."""
    row = await db.friend_referral_redemptions.find_one(
        {"redeemer_user_id": user_id},
        {"_id": 0},
    )
    return row is not None


async def validate_friend_referral_code(
    db,
    *,
    code: str,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Check whether a friend-referral code can be used (no side effects)."""
    normalized = _normalize_code(code)
    if not normalized or len(normalized) != 6 or not normalized.isdigit():
        return {"valid": False, "reason": "invalid_format"}

    referrer_id = await _lookup_referrer_id(db, normalized)
    if not referrer_id:
        return {"valid": False, "reason": "not_found"}

    if user_id and referrer_id == user_id:
        return {"valid": False, "reason": "self_referral"}

    if user_id:
        existing = await db.friend_referral_redemptions.find_one(
            {"redeemer_user_id": user_id},
            {"_id": 0},
        )
        if existing:
            return {"valid": False, "reason": "already_redeemed"}

    return {"valid": True, "reason": None}


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
    if not normalized or len(normalized) != 6 or not normalized.isdigit():
        raise ValueError("Enter a valid 6-digit referral code")

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

    # Repeating reward: every time `uses` crosses a new multiple of the goal,
    # grant another batch -- not just the first time (uncapped).
    old_batches = int(referral.get("reward_batches_granted") or 0)
    new_batches_total = uses // FRIEND_REFERRAL_GOAL
    new_batches = max(0, new_batches_total - old_batches)
    reward_unlocked = new_batches > 0
    if reward_unlocked:
        credits_to_grant = new_batches * FRIEND_REFERRAL_REWARD_CREDITS
        claim_token = uuid.uuid4().hex
        reward_at = _now_iso()
        await db.users.update_one(
            {"user_id": referrer_id},
            {"$set": {
                "friend_referral.reward_batches_granted": new_batches_total,
                "friend_referral.reward_claim_token": claim_token,
                "friend_referral.updated_at": reward_at,
            }},
        )
        await grant_reward(referrer_id, credits_to_grant)
        if referrer_email:
            try:
                claim_url = f"{app_url.rstrip('/')}/swipe?friendReferral=unlocked&token={claim_token}"
                await send_reward_email(
                    to=referrer_email,
                    name=referrer_name,
                    claim_url=claim_url,
                    credits=credits_to_grant,
                )
            except Exception as exc:
                logger.warning("friend_referral reward email failed referrer=%s err=%s", referrer_id, exc)

    return {
        "ok": True,
        "referrer_user_id": referrer_id,
        "uses_count": uses,
        "goal": FRIEND_REFERRAL_GOAL,
        "reward_unlocked": reward_unlocked,
    }


async def claim_friend_referral_reward(db, user_id: str, token: Optional[str]) -> Dict[str, Any]:
    user_doc = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not user_doc:
        raise ValueError("User not found")
    referral = _friend_referral_doc(user_doc)
    if not referral.get("reward_batches_granted"):
        raise ValueError("No referral reward to claim yet")
    # Tokens rotate on every new batch -- a stale link from an earlier reward
    # email shouldn't error out, it's purely informational (nothing is
    # granted here; the reward was already applied at redemption time).
    return friend_referral_status_payload(user_doc)
