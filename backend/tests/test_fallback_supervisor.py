import asyncio

import pytest

from auto_apply.fallback_supervisor import (
    ALLOWED_ACTIONS,
    FallbackDecision,
    decide_fallback,
    execute_fallback_action,
    fallback_agent_enabled,
    heuristic_decide,
    max_fallback_calls,
    run_fallback_supervisor,
)
from auto_apply.models import SubmissionEvidence


def test_heuristic_blank_shell_reloads():
    d = heuristic_decide(
        "oneclick_form_not_loaded",
        url="https://jobs.smartrecruiters.com/oneclick-ui/company/Accor/publication/x",
        body_snip="SERVEUR Paris",
    )
    assert d.action == "reload_oneclick"


def test_heuristic_nav_timeout_retries_session():
    d = heuristic_decide("oneclick_nav_timeout", url="https://jobs.smartrecruiters.com/Accor/1")
    assert d.action == "abort_retry_session"


def test_heuristic_expired_copy_skips():
    d = heuristic_decide(
        "oneclick_form_not_loaded",
        url="https://jobs.smartrecruiters.com/oneclick-ui/x",
        body_snip="Cette offre n'est plus disponible",
    )
    assert d.action == "skip_offer"


def test_allowed_actions_are_closed_set():
    assert "submit" not in ALLOWED_ACTIONS
    assert "fill" not in ALLOWED_ACTIONS
    assert "reload_oneclick" in ALLOWED_ACTIONS


def test_env_kill_switch(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_FALLBACK_AGENT", "0")
    assert fallback_agent_enabled() is False
    monkeypatch.setenv("AUTO_APPLY_FALLBACK_AGENT", "1")
    assert fallback_agent_enabled() is True


def test_max_calls_clamped(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_FALLBACK_MAX_CALLS", "99")
    assert max_fallback_calls() == 4
    monkeypatch.setenv("AUTO_APPLY_FALLBACK_MAX_CALLS", "1")
    assert max_fallback_calls() == 1


class _FakePage:
    url = "https://jobs.smartrecruiters.com/oneclick-ui/company/Accor/publication/x"
    reload_calls = 0

    def locator(self, selector):
        return self

    async def count(self):
        return 0

    async def inner_text(self, timeout=0):
        return "ibis STYLES SERVEUR Paris"

    async def reload(self, wait_until=None, timeout=None):
        self.reload_calls += 1

    async def wait_for_timeout(self, ms):
        return None


def test_execute_reload_uses_driver_hook():
    page = _FakePage()
    evidence = SubmissionEvidence(raw={})
    calls = []

    class _Drv:
        async def _reload_oneclick_shell(self, p, ev=None):
            calls.append(True)

    executed = asyncio.run(
        execute_fallback_action(
            page,
            FallbackDecision("reload_oneclick", issue="blank"),
            driver=_Drv(),
            evidence=evidence,
        )
    )
    assert executed == "reload_oneclick"
    assert calls == [True]


def test_run_fallback_recovers_when_form_ready(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_FALLBACK_AGENT", "1")
    monkeypatch.setenv("AUTO_APPLY_FALLBACK_MAX_CALLS", "2")
    page = _FakePage()
    evidence = SubmissionEvidence(raw={})

    async def fake_decide(**kwargs):
        return FallbackDecision("reload_oneclick", issue="blank", source="heuristic")

    async def fake_shot(p):
        return ""

    monkeypatch.setattr("auto_apply.fallback_supervisor.decide_fallback", fake_decide)
    monkeypatch.setattr("apply_agent.browser.screenshot_b64", fake_shot)

    async def ready(_p):
        return True

    ok = asyncio.run(
        run_fallback_supervisor(
            page,
            evidence,
            reason="oneclick_form_not_loaded",
            form_ready_check=ready,
        )
    )
    assert ok is True
    assert evidence.raw["fallback_calls"] == 1
    assert evidence.raw["fallback_decisions"][0]["action"] == "reload_oneclick"


def test_run_fallback_respects_budget(monkeypatch):
    monkeypatch.setenv("AUTO_APPLY_FALLBACK_AGENT", "1")
    monkeypatch.setenv("AUTO_APPLY_FALLBACK_MAX_CALLS", "1")
    page = _FakePage()
    evidence = SubmissionEvidence(raw={"fallback_calls": 1})

    ok = asyncio.run(
        run_fallback_supervisor(page, evidence, reason="oneclick_form_not_loaded")
    )
    assert ok is False


def test_decide_fallback_uses_heuristic_without_screenshot(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    async def boom(**kwargs):
        raise AssertionError("vision should not run")

    monkeypatch.setattr("auto_apply.fallback_supervisor.vision_decide", boom)
    d = asyncio.run(
        decide_fallback(
            reason="oneclick_nav_timeout",
            url="https://x",
            screenshot_b64="",
        )
    )
    assert d.action == "abort_retry_session"
    assert d.source == "heuristic"


def test_skip_offer_sets_blocked_reason():
    page = _FakePage()
    evidence = SubmissionEvidence(raw={})
    asyncio.run(
        execute_fallback_action(
            page,
            FallbackDecision("skip_offer", issue="expired"),
            evidence=evidence,
        )
    )
    assert evidence.blocked_reason == "offer_expired"
