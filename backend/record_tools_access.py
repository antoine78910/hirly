"""Access control for internal record-tools (demo + training learners)."""

from __future__ import annotations

from typing import Any, Callable, Optional

from fastapi import HTTPException

from training_access import user_has_training_access


async def user_has_record_tools_access(
    db,
    user,
    *,
    is_admin_email: Callable[[Optional[str]], bool],
    is_training_creator,
    tutorial_user_id: Optional[str] = None,
) -> bool:
    user_doc = await db.users.find_one({"user_id": user.user_id}, {"_id": 0, "demo_account": 1}) or {}
    if user_doc.get("demo_account"):
        return True
    return await user_has_training_access(
        db,
        user,
        is_admin_email=is_admin_email,
        is_training_creator=is_training_creator,
        tutorial_user_id=tutorial_user_id,
    )


async def require_record_tools_user(
    db,
    user,
    *,
    is_admin_email: Callable[[Optional[str]], bool],
    is_training_creator,
    tutorial_user_id: Optional[str] = None,
):
    if not await user_has_record_tools_access(
        db,
        user,
        is_admin_email=is_admin_email,
        is_training_creator=is_training_creator,
        tutorial_user_id=tutorial_user_id,
    ):
        raise HTTPException(
            status_code=403,
            detail="Record tools require a demo or training account.",
        )
    return user
