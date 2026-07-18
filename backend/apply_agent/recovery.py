"""Stuck-state recovery for browser apply: screenshot, dismiss popups, refill hints.

When the form looks blocked (modal, validation errors, empty required fields),
take a screenshot and try cheap deterministic fixes first. Optionally ask a
vision model what to click (Close / Fermer) when heuristics are not enough.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

from .browser import screenshot_b64
from .blockers import dismiss_cookie_banner
from .human_browser import human_click, human_pause, try_pass_datadome_slider
from .blockers import captcha_active, detect_captcha

logger = logging.getLogger(__name__)

_CLOSE_BUTTON_TEXTS = (
    "Close",
    "Fermer",
    "Dismiss",
    "Got it",
    "OK",
    "Ok",
    "Continue",
    "Continuer",
    "Continuer sans accepter",
    "Not now",
    "No thanks",
    "Non merci",
    "Skip",
    "Passer",
    "Tout refuser",
    "Reject all",
    "Accept",
    "Accepter",
)

_CLOSE_SELECTORS = (
    '[aria-label="Close"]',
    '[aria-label="Fermer"]',
    '[aria-label="close"]',
    'button[aria-label*="Close" i]',
    'button[aria-label*="Fermer" i]',
    '[data-testid*="close" i]',
    '[class*="modal"] button[class*="close" i]',
    '.modal button.close',
    'dialog button:has-text("Close")',
    'dialog button:has-text("Fermer")',
    '[role="dialog"] button:has-text("Close")',
    '[role="dialog"] button:has-text("Fermer")',
    '#onetrust-reject-all-handler',
    '#onetrust-accept-btn-handler',
    '#close-pc-btn-handler',
    '.ot-close-icon',
)


async def inspect_stuck_state(page: Any) -> Dict[str, Any]:
    """DOM snapshot of why the page may be stuck (no LLM)."""
    try:
        state = await page.evaluate(
            """() => {
              const visible = (el) => {
                if (!el) return false;
                const r = el.getBoundingClientRect();
                const s = window.getComputedStyle(el);
                return r.width > 2 && r.height > 2 && s.visibility !== 'hidden'
                  && s.display !== 'none' && s.opacity !== '0';
              };
              const dialogs = [...document.querySelectorAll(
                '[role="dialog"], dialog, .modal, [class*="Modal"], [class*="popup"], [class*="Popup"]'
              )].filter(visible).map(el => (el.innerText || '').trim().slice(0, 240));
              const errors = [...document.querySelectorAll(
                '[aria-invalid="true"], .error, .is-error, [class*="error"], [class*="invalid"], [role="alert"]'
              )].filter(visible).map(el => (el.innerText || el.getAttribute('aria-label') || '').trim())
                .filter(Boolean).slice(0, 20);
              const requiredEmpty = [];
              for (const el of document.querySelectorAll('input, textarea, select, [role="textbox"]')) {
                if (!visible(el)) continue;
                const required = el.required || el.getAttribute('aria-required') === 'true'
                  || (el.closest('spl-input') || {}).hasAttribute?.('required');
                const host = el.closest('spl-input');
                const hostRequired = host && host.hasAttribute('required');
                if (!(required || hostRequired)) continue;
                const val = (el.value || '').trim();
                if (!val) {
                  const label = (host && host.getAttribute('label'))
                    || el.getAttribute('aria-label')
                    || el.getAttribute('placeholder')
                    || el.id
                    || 'field';
                  requiredEmpty.push(String(label).slice(0, 80));
                }
              }
              const buttons = [...document.querySelectorAll('button, [role="button"], a')]
                .filter(visible)
                .map(el => (el.innerText || el.getAttribute('aria-label') || '').trim())
                .filter(t => t && t.length < 40)
                .slice(0, 30);
              return {
                url: location.href,
                dialogs,
                errors: [...new Set(errors)].slice(0, 12),
                required_empty: [...new Set(requiredEmpty)].slice(0, 12),
                buttons: [...new Set(buttons)].slice(0, 20),
                body_snip: (document.body && document.body.innerText || '').slice(0, 500),
              };
            }"""
        )
    except Exception as exc:
        state = {"url": getattr(page, "url", ""), "error": str(exc)[:200]}
    return state


async def dismiss_blocking_overlays(page: Any) -> List[str]:
    """Click common close / dismiss controls. Returns actions taken."""
    actions: List[str] = []
    try:
        await dismiss_cookie_banner(page)
        actions.append("cookie_banner")
    except Exception:
        pass

    if captcha_active(await detect_captcha(page)):
        if await try_pass_datadome_slider(page, attempts=2):
            actions.append("datadome_slider")

    for sel in _CLOSE_SELECTORS:
        try:
            loc = page.locator(sel)
            if await loc.count() and await loc.first.is_visible(timeout=400):
                await loc.first.click(force=True, timeout=1500)
                actions.append(f"click:{sel}")
                await human_pause(page, 250, 500)
        except Exception:
            continue

    for text in _CLOSE_BUTTON_TEXTS:
        try:
            btn = page.get_by_role("button", name=re.compile(f"^{re.escape(text)}$", re.I))
            if await btn.count() and await btn.first.is_visible(timeout=400):
                await human_click(btn.first, page)
                actions.append(f"button:{text}")
                await human_pause(page, 250, 500)
                continue
        except Exception:
            pass
        try:
            loc = page.locator(f'button:has-text("{text}"), [role="button"]:has-text("{text}")')
            if await loc.count() and await loc.first.is_visible(timeout=400):
                await loc.first.click(force=True, timeout=1500)
                actions.append(f"text:{text}")
                await human_pause(page, 250, 500)
        except Exception:
            continue

    # Escape often closes modals.
    try:
        await page.keyboard.press("Escape")
        actions.append("escape")
        await human_pause(page, 150, 300)
    except Exception:
        pass

    # Hide stubborn OneTrust layers that intercept clicks.
    try:
        await page.evaluate(
            """() => {
              for (const sel of ['#onetrust-consent-sdk','.onetrust-pc-dark-filter','#onetrust-pc-sdk']) {
                document.querySelectorAll(sel).forEach(el => el.remove());
              }
            }"""
        )
    except Exception:
        pass
    return actions


async def _vision_recovery_actions(screenshot: str, stuck: Dict[str, Any]) -> List[Dict[str, str]]:
    """Ask vision model what to click. Returns [] if unavailable."""
    if not screenshot or not os.environ.get("OPENAI_API_KEY"):
        return []
    if os.environ.get("APPLY_VISION_RECOVERY", "1").strip().lower() in ("0", "false", "no"):
        return []
    try:
        from openai import AsyncOpenAI
    except ImportError:
        return []
    try:
        client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
        model = os.environ.get(
            "OPENAI_VISION_MODEL",
            os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
        )
        prompt = {
            "stuck": {
                "dialogs": stuck.get("dialogs"),
                "errors": stuck.get("errors"),
                "required_empty": stuck.get("required_empty"),
                "buttons": stuck.get("buttons"),
                "url": stuck.get("url"),
            },
            "instruction": (
                "You are helping a job-application bot that is stuck. "
                "Look at the screenshot. Return JSON only: "
                '{"actions":[{"type":"click_text","text":"..."},'
                '{"type":"note","text":"..."}]} '
                "Prefer clicking Close/Fermer/Dismiss/OK on popups/modals. "
                "If a required field is empty, note its label in a note action "
                "(do not invent field values). Max 3 actions."
            ),
        }
        data_url = f"data:image/jpeg;base64,{screenshot}"
        response = await client.chat.completions.create(
            model=model,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": json.dumps(prompt)},
                        {"type": "image_url", "image_url": {"url": data_url, "detail": "low"}},
                    ],
                }
            ],
            max_completion_tokens=400,
        )
        raw = response.choices[0].message.content or "{}"
        parsed = json.loads(raw)
        actions = parsed.get("actions") if isinstance(parsed, dict) else None
        if not isinstance(actions, list):
            return []
        out: List[Dict[str, str]] = []
        for item in actions[:3]:
            if not isinstance(item, dict):
                continue
            typ = str(item.get("type") or "").strip()
            text = str(item.get("text") or "").strip()[:80]
            if typ and text:
                out.append({"type": typ, "text": text})
        return out
    except Exception as exc:
        logger.info("vision_recovery_unavailable error=%s", str(exc)[:200])
        return []


async def _click_by_visible_text(page: Any, text: str) -> bool:
    text = (text or "").strip()
    if not text or len(text) > 60:
        return False
    # Never click submit-like labels from vision recovery.
    blocked = ("envoyer", "submit", "apply", "postuler", "send application")
    if text.lower() in blocked or any(b in text.lower() for b in ("submit application", "envoyer ma")):
        return False
    try:
        btn = page.get_by_role("button", name=re.compile(re.escape(text), re.I))
        if await btn.count() and await btn.first.is_visible(timeout=800):
            await human_click(btn.first, page)
            return True
    except Exception:
        pass
    try:
        loc = page.locator(
            f'button:has-text("{text}"), [role="button"]:has-text("{text}"), '
            f'a:has-text("{text}"), [aria-label="{text}"]'
        )
        if await loc.count() and await loc.first.is_visible(timeout=800):
            await loc.first.click(force=True, timeout=2000)
            return True
    except Exception:
        pass
    return False


async def recover_stuck_page(
    page: Any,
    *,
    reason: str = "stuck",
    use_vision: bool = True,
) -> Dict[str, Any]:
    """Screenshot + dismiss overlays + optional vision clicks.

    Returns a report with screenshot_b64, actions, stuck state, notes.
    """
    report: Dict[str, Any] = {
        "reason": reason,
        "actions": [],
        "notes": [],
        "screenshot_b64": "",
        "stuck": {},
    }
    shot = await screenshot_b64(page)
    report["screenshot_b64"] = shot
    stuck = await inspect_stuck_state(page)
    report["stuck"] = stuck
    logger.info(
        "apply_recovery_start reason=%s dialogs=%s errors=%s empty=%s",
        reason,
        len(stuck.get("dialogs") or []),
        len(stuck.get("errors") or []),
        len(stuck.get("required_empty") or []),
    )

    dismissed = await dismiss_blocking_overlays(page)
    report["actions"].extend(dismissed)

    if use_vision and (
        stuck.get("dialogs")
        or stuck.get("errors")
        or reason in {"submit_validation", "click_intercepted", "pre_submit"}
    ):
        vision_actions = await _vision_recovery_actions(shot, stuck)
        for item in vision_actions:
            if item["type"] == "click_text":
                if await _click_by_visible_text(page, item["text"]):
                    report["actions"].append(f"vision_click:{item['text']}")
                    await human_pause(page, 300, 600)
            elif item["type"] == "note":
                report["notes"].append(item["text"])

    # Re-inspect after recovery attempts.
    report["stuck_after"] = await inspect_stuck_state(page)
    report["screenshot_b64"] = await screenshot_b64(page) or shot
    logger.info(
        "apply_recovery_done reason=%s actions=%s notes=%s empty_after=%s",
        reason,
        report["actions"][:8],
        report["notes"][:4],
        (report.get("stuck_after") or {}).get("required_empty"),
    )
    return report
