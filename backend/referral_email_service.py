"""Transactional emails for the invite-3-friends referral program."""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx

from email_addresses import NOTIFICATIONS_FROM

logger = logging.getLogger(__name__)

RESEND_API_KEY = (os.environ.get("RESEND_API_KEY") or "").strip()


async def _send_notification(to: str, subject: str, html: str, text: str) -> bool:
    if not RESEND_API_KEY or not to:
        return False
    payload = {
        "from": NOTIFICATIONS_FROM,
        "to": [to],
        "subject": subject,
        "html": html,
        "text": text,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json=payload,
        )
    if response.status_code >= 400:
        logger.error("referral email failed: %s %s", response.status_code, response.text[:300])
        return False
    return True


async def send_friend_referral_used_email(
    *,
    to: str,
    name: str,
    uses_count: int,
    goal: int,
) -> bool:
    subject = f"Someone used your Hirly referral code ({uses_count}/{goal})"
    text = (
        f"Hi {name},\n\n"
        f"Good news — someone just signed up with your referral code.\n"
        f"Progress: {uses_count} of {goal} friends.\n\n"
        f"Keep sharing your code to unlock free access and {40} application credits.\n\n"
        f"— Hirly"
    )
    html = f"""
    <p>Hi {name},</p>
    <p>Good news — someone just signed up with your referral code.</p>
    <p><strong>Progress: {uses_count} of {goal} friends</strong></p>
    <p>Keep sharing your code to unlock free access and 40 application credits.</p>
    <p>— Hirly</p>
    """
    return await _send_notification(to, subject, html, text)


async def send_friend_referral_reward_email(
    *,
    to: str,
    name: str,
    claim_url: str,
    credits: int,
) -> bool:
    subject = "You unlocked a free month on Hirly 🎉"
    text = (
        f"Hi {name},\n\n"
        f"Congratulations — 3 friends used your referral code!\n\n"
        f"Your reward:\n"
        f"- Free access for 1 month\n"
        f"- {credits} application credits\n\n"
        f"Open Hirly to start swiping:\n{claim_url}\n\n"
        f"— Hirly"
    )
    html = f"""
    <p>Hi {name},</p>
    <p><strong>Congratulations — 3 friends used your referral code!</strong></p>
    <ul>
      <li>Free access for 1 month</li>
      <li>{credits} application credits</li>
    </ul>
    <p><a href="{claim_url}">Open Hirly and start applying</a></p>
    <p>— Hirly</p>
    """
    return await _send_notification(to, subject, html, text)
