"""Hirly transactional email addresses on tryhirly.com.

app@tryhirly.com is the primary support inbox (receive only). Do not use it as a
From address — outbound mail uses role-specific senders below.
"""

from __future__ import annotations

import os

# Inbound support / feedback destination
SUPPORT_INBOX = (os.environ.get("SUPPORT_INBOX") or "app@tryhirly.com").strip()

# Outbound senders (override via env for staging or white-label)
NOREPLY_FROM = (
    os.environ.get("NOREPLY_FROM") or "Hirly <noreply@tryhirly.com>"
).strip()
NOTIFICATIONS_FROM = (
    os.environ.get("NOTIFICATIONS_FROM") or "Hirly <notifications@tryhirly.com>"
).strip()
FEEDBACK_FROM = (
    os.environ.get("FEEDBACK_FROM") or "Hirly <feedback@tryhirly.com>"
).strip()
APPLICATION_FROM = (
    os.environ.get("APPLICATION_FROM") or "Hirly Applications <apply@tryhirly.com>"
).strip()

# Legacy env names kept for Railway / existing deploys
FEEDBACK_TO_EMAIL = (os.environ.get("FEEDBACK_TO_EMAIL") or SUPPORT_INBOX).strip()
FEEDBACK_FROM_EMAIL = (os.environ.get("FEEDBACK_FROM_EMAIL") or FEEDBACK_FROM).strip()
APPLICATION_EMAIL_FROM = (os.environ.get("APPLICATION_EMAIL_FROM") or APPLICATION_FROM).strip()

# Hirly-managed reply inbox (Resend inbound) -- applications submitted while
# this is enabled use a per-application address on INBOUND_DOMAIN instead of
# the candidate's real email, so employer replies land on our own
# infrastructure and get mirrored into the in-app inbox, then forwarded on.
INBOUND_DOMAIN = (os.environ.get("INBOUND_EMAIL_DOMAIN") or "inbox.tryhirly.com").strip()
INBOUND_MANAGED_EMAIL_ENABLED = (os.environ.get("INBOUND_MANAGED_EMAIL_ENABLED") or "false").strip().lower() in (
    "1", "true", "yes", "on",
)
INBOX_FORWARD_FROM = (
    os.environ.get("INBOX_FORWARD_FROM") or "Hirly Inbox <inbox-noreply@tryhirly.com>"
).strip()

# Hirly's brand purple, matching the app UI's sprout-mint token (frontend/src/index.css)
HIRLY_BRAND_COLOR = (os.environ.get("HIRLY_BRAND_COLOR") or "#7C3AED").strip()
HIRLY_LOGO_URL = (os.environ.get("HIRLY_LOGO_URL") or "https://app.tryhirly.com/logo.png").strip()


def managed_reply_address(application_id: str) -> str:
    return f"{application_id}@{INBOUND_DOMAIN}"
