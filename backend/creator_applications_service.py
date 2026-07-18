"""Public creator-program applications (TikTok/Instagram creator recruiting)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def create_creator_application(
    db,
    *,
    email: str,
    first_name: str,
    last_name: str,
    tiktok_handle: Optional[str] = None,
    instagram_handle: Optional[str] = None,
    has_company: Optional[str] = None,
    whatsapp_country: Optional[str] = None,
    whatsapp_number: Optional[str] = None,
    country: Optional[str] = None,
    referred_by: Optional[str] = None,
    message: Optional[str] = None,
) -> Dict[str, Any]:
    doc = {
        "creator_application_id": f"creatorapp_{uuid.uuid4().hex[:12]}",
        "email": email,
        "first_name": first_name,
        "last_name": last_name,
        "tiktok_handle": tiktok_handle,
        "instagram_handle": instagram_handle,
        "has_company": has_company,
        "whatsapp_country": whatsapp_country,
        "whatsapp_number": whatsapp_number,
        "country": country,
        "referred_by": referred_by,
        "message": message,
        "status": "pending",
        "created_at": _now_iso(),
    }
    await db.creator_applications.update_one(
        {"creator_application_id": doc["creator_application_id"]}, {"$set": doc}, upsert=True,
    )
    return doc
