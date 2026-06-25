"""Training access control — invite-only learner access."""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

from fastapi import HTTPException


async def user_has_training_access(
    db,
    user,
    *,
    is_admin_email: Callable[[Optional[str]], bool],
    is_training_creator,
    tutorial_user_id: Optional[str] = None,
) -> bool:
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    if user_doc.get("training_access"):
        return True
    if tutorial_user_id and user.user_id == tutorial_user_id:
        return True
    if is_admin_email(user.email):
        return True
    if await is_training_creator(db, user.user_id):
        return True
    return False


async def require_training_access(
    db,
    user,
    *,
    is_admin_email: Callable[[Optional[str]], bool],
    is_training_creator,
    tutorial_user_id: Optional[str] = None,
):
    if not await user_has_training_access(
        db,
        user,
        is_admin_email=is_admin_email,
        is_training_creator=is_training_creator,
        tutorial_user_id=tutorial_user_id,
    ):
        raise HTTPException(
            status_code=403,
            detail="Training access requires an invitation. Ask your Hirly contact for a link.",
        )
    return user


async def training_access_payload(
    db,
    user,
    *,
    is_admin_email: Callable[[Optional[str]], bool],
    is_training_creator,
    tutorial_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    has_access = await user_has_training_access(
        db,
        user,
        is_admin_email=is_admin_email,
        is_training_creator=is_training_creator,
        tutorial_user_id=tutorial_user_id,
    )
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    return {
        "has_access": has_access,
        "training_access": bool(user_doc.get("training_access")),
    }
