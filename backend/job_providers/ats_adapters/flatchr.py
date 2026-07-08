"""Direct Flatchr public career-page ingestion.

Flatchr's real jobs API (api.flatchr.io) needs an OAuth token per company --
not usable for arbitrary companies without their consent, confirmed via
their own developer docs. The public careers.flatchr.io/company/{slug} page
lists every open job, but is a Next.js app that renders the list
client-side with no separate data-fetch call to intercept (confirmed live:
no XHR/fetch response, no vacancy data in __NEXT_DATA__ -- it's already in
the DOM once idle). So this adapter scrapes the rendered page directly with
Playwright instead of an HTTP client, unlike every other adapter here.

Each job card has no real <a href> (confirmed live: clicking the title
doesn't navigate; only its "Postuler" button does), so the per-job URL can
only be discovered by actually clicking through and reading the resulting
URL -- there's no shortcut that avoids one navigation per job.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from .base import AtsJobAdapter

_DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
_CARD_TEXT_SCRIPT = r"""
() => {
  function textNodesOf(card) {
    const texts = [];
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.textContent.trim();
        if (t) texts.push(t);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === "BUTTON") return;
        Array.from(node.childNodes).forEach(walk);
      }
    }
    walk(card);
    return texts;
  }
  const buttons = Array.from(document.querySelectorAll("button")).filter(
    (b) => (b.textContent || "").trim() === "Postuler"
  );
  return buttons.map((btn) => {
    const card = btn.parentElement ? btn.parentElement.parentElement : null;
    return card ? textNodesOf(card) : [];
  });
}
"""


class FlatchrAtsAdapter(AtsJobAdapter):
    provider = "flatchr"
    host = "careers.flatchr.io"
    max_jobs_per_company = 40
    max_load_more_clicks = 6

    def can_handle_url(self, url: str) -> bool:
        return self.extract_source_key_from_url(url) is not None

    def extract_source_key_from_url(self, url: str) -> Optional[str]:
        parsed = urlparse((url or "").strip())
        host = (parsed.netloc or "").lower().removeprefix("www.")
        if host != self.host:
            return None
        parts = [part for part in (parsed.path or "").split("/") if part]
        if "company" not in parts:
            return None
        idx = parts.index("company")
        if idx + 1 >= len(parts):
            return None
        return parts[idx + 1].strip().lower() or None

    async def fetch_jobs(self, source_key: str, *, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        from playwright.async_api import async_playwright

        listing_url = f"https://{self.host}/fr/company/{source_key}"
        rows: List[Dict[str, Any]] = []
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto(listing_url, wait_until="networkidle", timeout=30000)
                # Confirmed live: a short settle wait here makes the click
                # below silently do nothing (no navigation, no error) --
                # the page needs longer to finish hydrating its click
                # handlers than `networkidle` alone implies.
                await page.wait_for_timeout(4000)

                # "Voir Plus" (load more) pagination is deliberately not
                # handled: confirmed live that clicking it destabilizes the
                # per-job click-through below (works reliably without it,
                # unreliably with it -- not yet root-caused). Only the first
                # batch of jobs is harvested per run until that's resolved;
                # still real coverage, and a future maintenance pass can
                # pick up where this run left off since jobs already in the
                # DB aren't re-fetched.

                cards = await page.evaluate(_CARD_TEXT_SCRIPT)
                # get_by_text, not get_by_role -- confirmed live that
                # get_by_role("button", name="Postuler") resolves to a
                # different, non-navigating element on this page.
                buttons = page.get_by_text("Postuler", exact=True)
                button_count = await buttons.count()
                max_jobs = min(button_count, limit or self.max_jobs_per_company, self.max_jobs_per_company)
                for index in range(max_jobs):
                    parsed_card = self._parse_card(cards[index] if index < len(cards) else [])
                    if not parsed_card:
                        continue
                    try:
                        target = buttons.nth(index)
                        await target.scroll_into_view_if_needed(timeout=3000)
                        await page.wait_for_timeout(300)
                        await target.click(timeout=3000)
                        # A fixed wait, not wait_for_load_state("networkidle")
                        # -- confirmed live that networkidle resolves before
                        # this client-side route change actually completes
                        # (some background network chatter on this page
                        # keeps it "not idle" in a way that satisfies the
                        # check prematurely), reading page.url too early and
                        # getting the still-the-listing-page URL back.
                        await page.wait_for_timeout(2500)
                        parsed_card["apply_url"] = page.url
                        await page.go_back(timeout=8000)
                        await page.wait_for_timeout(2500)
                    except Exception:
                        continue
                    if parsed_card.get("apply_url"):
                        rows.append(parsed_card)
            finally:
                await browser.close()
        return rows

    def _parse_card(self, texts: List[str]) -> Optional[Dict[str, Any]]:
        if len(texts) < 2:
            return None
        title = texts[0]
        contract_type = texts[1]
        date_index = next((i for i, t in enumerate(texts) if _DATE_RE.match(t)), None)
        if date_index is None:
            location = " ".join(texts[2:]).strip(", ")
            posted_at = None
            category = None
        else:
            location = " ".join(texts[2:date_index]).strip(", ")
            posted_at = texts[date_index]
            category = " ".join(texts[date_index + 1:]) if date_index + 1 < len(texts) else None
        if not title:
            return None
        return {
            "title": title,
            "contract_type": contract_type,
            "location": location or "France",
            "posted_at": posted_at,
            "category": category,
        }

    def normalize_job(self, raw_job: Dict[str, Any], *, source_key: str) -> Optional[Dict[str, Any]]:
        apply_url = raw_job.get("apply_url")
        title = raw_job.get("title")
        if not apply_url or not title:
            return None
        vacancy_slug = self._vacancy_slug(apply_url) or title
        external_id = f"{source_key}:{vacancy_slug}"
        imported_at = self.imported_at()
        location = self.clean_text(raw_job.get("location")) or "France"
        posted_at = self._parse_date(raw_job.get("posted_at")) or imported_at
        return {
            "job_id": self.internal_job_id(external_id),
            "provider": self.provider,
            "external_id": external_id,
            "provider_job_id": vacancy_slug,
            "title": self.clean_text(title),
            "company": source_key.replace("-", " ").title(),
            "location": location,
            "country_code": "FR",
            "remote": self.remote_value("", location),
            "salary_min": None,
            "salary_max": None,
            "currency": "EUR",
            "description": "",
            "clean_description": "",
            "requirements": [],
            "tech_stack": [],
            "posted_at": posted_at,
            "imported_at": imported_at,
            "last_seen_at": imported_at,
            "external_url": apply_url,
            "selected_apply_url": apply_url,
            "apply_url_provider": self.provider,
            "apply_url_source": "Flatchr",
            "source": "Flatchr",
            "ats_provider": self.provider,
            "auto_apply_supported": True,
            "manual_fulfillment_ready": True,
            "apply_fulfillment_status": "manual_ready",
            "apply_fulfillment_reason": "Direct public Flatchr apply URL.",
            "job_board_account_required": False,
            "board_token": source_key,
            "provider_query": source_key,
            "provider_search_key": f"{self.provider}:{source_key}",
            "employment_type": raw_job.get("contract_type"),
            "department": raw_job.get("category"),
            "raw_provider_payload": raw_job if os.environ.get("JOB_IMPORT_STORE_RAW", "false").lower() == "true" else None,
        }

    def _vacancy_slug(self, apply_url: str) -> Optional[str]:
        parts = [part for part in urlparse(apply_url).path.split("/") if part]
        if "vacancy" in parts:
            idx = parts.index("vacancy")
            if idx + 1 < len(parts):
                return parts[idx + 1]
        return None

    def _parse_date(self, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        try:
            return datetime.strptime(value, "%d/%m/%Y").replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            return None
