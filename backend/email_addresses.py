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
