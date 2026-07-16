import asyncio
from contextlib import asynccontextmanager

import auto_apply.driver as driver_mod
from auto_apply.driver import ApplyDriver, BrowserApplyDriver, DRIVER_REGISTRY
from auto_apply.models import ApplicationPlan, PlanStep, SubmissionContext, SubmissionEvidence


class _FakeLocator:
    def __init__(self, page, selector, exists=True):
        self._page = page
        self._selector = selector
        self._exists = exists
        self.first = self

    async def count(self):
        return 1 if self._exists else 0

    async def fill(self, value, timeout=0):
        self._page.filled.append((self._selector, value))

    async def press_sequentially(self, value, delay=0):
        self._page.filled.append((self._selector, value))

    async def bounding_box(self):
        return {"x": 10, "y": 10, "width": 120, "height": 32}

    async def set_input_files(self, path, timeout=0):
        self._page.uploaded.append((self._selector, path))

    async def click(self, timeout=0, force=False, delay=0):
        self._page.clicked.append(self._selector)

    async def is_visible(self, timeout=0):
        return False

    async def scroll_into_view_if_needed(self, timeout=0):
        pass

    async def select_option(self, label=None, value=None, timeout=0):
        self._page.selected.append((self._selector, label or value))

    async def check(self, timeout=0):
        self._page.checked.append(self._selector)

    async def inner_text(self, timeout=0):
        return "Thank you for applying"


class _FakeMouse:
    def __init__(self, page):
        self._page = page

    async def move(self, x, y, steps=1):
        pass

    async def wheel(self, x, y):
        pass

    async def click(self, x, y, delay=0):
        self._page.clicked.append(f"mouse:{x:.0f},{y:.0f}")


class _FakeKeyboard:
    def __init__(self, page):
        self._page = page
        self._buffer = ""

    async def press(self, key):
        if key in ("Control+A", "Meta+A"):
            self._buffer = ""
        elif key == "Backspace":
            self._buffer = self._buffer[:-1]

    async def type(self, text, delay=0):
        self._buffer += text
        # Mirror production typing onto the last focused selector when known.
        if self._page.clicked:
            sel = self._page.queried[-1] if self._page.queried else "keyboard"
            # Keep updating a single fill entry for the current field.
            if self._page.filled and self._page.filled[-1][0] == sel:
                self._page.filled[-1] = (sel, self._buffer)
            else:
                self._page.filled.append((sel, self._buffer))


class _FakePage:
    def __init__(self, known_selectors):
        self.url = "https://boards.greenhouse.io/acme/jobs/1"
        self.known = set(known_selectors)
        self.queried = []
        self.filled = []
        self.uploaded = []
        self.clicked = []
        self.selected = []
        self.checked = []
        self.viewport_size = {"width": 1440, "height": 900}
        self.mouse = _FakeMouse(self)
        self.keyboard = _FakeKeyboard(self)

    async def goto(self, url, wait_until=None, timeout=0):
        self.url = url
        class _R:
            status = 200
        return _R()

    async def wait_for_load_state(self, state, timeout=0):
        pass

    async def wait_for_timeout(self, ms):
        pass

    def locator(self, selector):
        self.queried.append(selector)
        return _FakeLocator(self, selector, exists=selector in self.known)

    def get_by_role(self, role, name=None):
        return _FakeLocator(self, f"role:{role}:{name}", exists=False)


class _StubDriver(BrowserApplyDriver):
    """Only implements the subclass hooks -- inherits submit() unchanged."""
    provider = "stub"
    version = "stub-1"

    def can_handle(self, job):
        return True

    async def inspect_application(self, job):
        raise NotImplementedError  # not needed for submit tests

    def application_url(self, job):
        return job["external_url"]


class _EmailLikeDriver(ApplyDriver):
    """A non-browser driver -- proves the interface is mechanism-agnostic."""
    provider = "email"
    version = "email-1"

    def can_handle(self, job):
        return True

    async def inspect_application(self, job):
        return "BLUEPRINT"

    async def submit(self, ctx):
        return SubmissionEvidence(submit_performed=True, network_ok=True, confirmation_text="sent")


def _install_fake_page(monkeypatch, page):
    @asynccontextmanager
    async def fake_launch(*, headless=True):
        yield page
    monkeypatch.setattr(driver_mod, "launch_page", fake_launch)

    async def no_login(p):
        return False

    async def no_captcha(p, click_error=""):
        return {}

    async def no_bot_wall(p, http_status=None):
        return False

    async def no_offer_expired(p):
        return False

    async def noop_cookie(p):
        return None

    async def fast_pause(p, min_ms=0, max_ms=0):
        pass

    async def noop_scroll(p, *args, **kwargs):
        pass

    async def noop_wander(p):
        pass

    async def fake_shot(p):
        return ""

    monkeypatch.setattr(driver_mod, "detect_login_wall", no_login)
    monkeypatch.setattr(driver_mod, "detect_captcha", no_captcha)
    monkeypatch.setattr(driver_mod, "detect_bot_wall", no_bot_wall)
    monkeypatch.setattr(driver_mod, "detect_offer_expired", no_offer_expired)
    monkeypatch.setattr(driver_mod, "captcha_active", lambda d: False)
    monkeypatch.setattr(driver_mod, "dismiss_cookie_banner", noop_cookie)
    monkeypatch.setattr(driver_mod, "human_pause", fast_pause)
    monkeypatch.setattr(driver_mod, "human_scroll", noop_scroll)
    monkeypatch.setattr(driver_mod, "human_mouse_wander", noop_wander)
    monkeypatch.setattr(driver_mod, "screenshot_b64", fake_shot)


def test_submit_executes_each_step_by_binding(monkeypatch):
    page = _FakePage(known_selectors={'[name="job_application[email]"]', '[name="job_application[resume]"]',
                                      'button[type="submit"], input[type="submit"], button:has-text("Submit")'})
    _install_fake_page(monkeypatch, page)

    plan = ApplicationPlan(steps=[
        PlanStep(action="fill", locators=['[name="job_application[email]"]'], value="a@b.co"),
        PlanStep(action="upload", locators=['[name="job_application[resume]"]'], value="__resume_file__", file_role="resume"),
        PlanStep(action="submit", locators=[]),
    ])
    ctx = SubmissionContext(job={"external_url": "https://boards.greenhouse.io/acme/jobs/1"},
                            blueprint=None, plan=plan, documents={"resume_path": "/tmp/cv.pdf"})
    ev = asyncio.run(_StubDriver().submit(ctx))

    assert page.filled[-1] == ('[name="job_application[email]"]', "a@b.co")
    assert page.uploaded == [('[name="job_application[resume]"]', "/tmp/cv.pdf")]
    assert ev.submit_performed is True
    assert ev.confirmation_text == "thank you for applying"


def test_login_wall_aborts_with_blocked_reason(monkeypatch):
    page = _FakePage(known_selectors=set())
    _install_fake_page(monkeypatch, page)

    async def yes_login(p):
        return True
    monkeypatch.setattr(driver_mod, "detect_login_wall", yes_login)

    plan = ApplicationPlan(steps=[PlanStep(action="submit", locators=[])])
    ctx = SubmissionContext(job={"external_url": "https://x/y"}, blueprint=None, plan=plan, documents={})
    ev = asyncio.run(_StubDriver().submit(ctx))
    assert ev.blocked_reason == "login_wall" and ev.submit_performed is False


def test_bot_wall_aborts_with_blocked_reason(monkeypatch):
    page = _FakePage(known_selectors=set())

    async def goto_403(url, wait_until=None, timeout=0):
        page.url = url
        class _R:
            status = 403
        return _R()

    page.goto = goto_403
    _install_fake_page(monkeypatch, page)

    async def yes_bot(p, http_status=None):
        return True
    monkeypatch.setattr(driver_mod, "detect_bot_wall", yes_bot)

    plan = ApplicationPlan(steps=[PlanStep(action="submit", locators=[])])
    ctx = SubmissionContext(job={"external_url": "https://x/y"}, blueprint=None, plan=plan, documents={})
    ev = asyncio.run(_StubDriver().submit(ctx))
    assert ev.blocked_reason == "bot_protection" and ev.submit_performed is False


def test_bot_wall_after_reveal_aborts_before_fills(monkeypatch):
    """SmartRecruiters often shows the bot wall only after Apply/oneclick."""
    page = _FakePage(known_selectors=set())
    _install_fake_page(monkeypatch, page)
    calls = {"n": 0}

    async def bot_after_first(p, http_status=None):
        calls["n"] += 1
        return calls["n"] >= 2

    monkeypatch.setattr(driver_mod, "detect_bot_wall", bot_after_first)

    plan = ApplicationPlan(steps=[
        PlanStep(action="fill", locators=['[name="email"]'], value="a@b.co"),
        PlanStep(action="submit", locators=[]),
    ])
    ctx = SubmissionContext(job={"external_url": "https://x/y"}, blueprint=None, plan=plan, documents={})
    ev = asyncio.run(_StubDriver().submit(ctx))
    assert ev.blocked_reason == "bot_protection"
    assert ev.submit_performed is False
    assert page.filled == []
    assert any(
        step.get("action") == "bot_wall_after_reveal" for step in (ev.raw or {}).get("step_log", [])
    )


def test_offer_expired_aborts_before_fills(monkeypatch):
    page = _FakePage(known_selectors=set())
    _install_fake_page(monkeypatch, page)

    async def yes_expired(p):
        return True

    monkeypatch.setattr(driver_mod, "detect_offer_expired", yes_expired)

    plan = ApplicationPlan(steps=[
        PlanStep(action="fill", locators=['[name="email"]'], value="a@b.co"),
        PlanStep(action="submit", locators=[]),
    ])
    ctx = SubmissionContext(job={"external_url": "https://x/y"}, blueprint=None, plan=plan, documents={})
    ev = asyncio.run(_StubDriver().submit(ctx))
    assert ev.blocked_reason == "offer_expired"
    assert ev.submit_performed is False
    assert page.filled == []


def test_registry_resolves_by_provider_only():
    DRIVER_REGISTRY.register(_StubDriver())
    assert DRIVER_REGISTRY.for_job({"ats_provider": "stub"}).provider == "stub"
    assert DRIVER_REGISTRY.for_job({"ats_provider": "nope"}) is None


def test_every_driver_exposes_a_version_string():
    assert isinstance(_StubDriver().version, str) and _StubDriver().version
    assert isinstance(_EmailLikeDriver().version, str) and _EmailLikeDriver().version


def test_executor_can_interact_only_through_the_interface():
    # A non-browser driver satisfies the same contract; a caller (the executor)
    # only ever touches provider / version / inspect_application / submit -- it
    # never needs isinstance() or to know the mechanism.
    DRIVER_REGISTRY.register(_EmailLikeDriver())
    driver = DRIVER_REGISTRY.for_job({"ats_provider": "email"})
    assert isinstance(driver, ApplyDriver)
    assert driver.version == "email-1"
    ctx = SubmissionContext(job={}, blueprint=None, plan=ApplicationPlan(steps=[]), documents={})
    ev = asyncio.run(driver.submit(ctx))
    assert ev.submit_performed is True and ev.confirmation_text == "sent"


def test_browser_subclass_inherits_submit_without_override(monkeypatch):
    # _StubDriver does NOT override submit(); the inherited BrowserApplyDriver
    # behavior must run end to end.
    page = _FakePage(known_selectors={'button[type="submit"], input[type="submit"], button:has-text("Submit")'})
    _install_fake_page(monkeypatch, page)
    assert "submit" not in _StubDriver.__dict__  # not overridden
    plan = ApplicationPlan(steps=[PlanStep(action="submit", locators=[])])
    ctx = SubmissionContext(job={"external_url": "https://x/y"}, blueprint=None, plan=plan, documents={})
    ev = asyncio.run(_StubDriver().submit(ctx))
    assert ev.submit_performed is True


def test_fallback_locator_only_tried_after_primary_fails(monkeypatch):
    # Case 1: primary matches -> fallback must never be queried.
    page = _FakePage(known_selectors={'#primary', 'button[type="submit"], input[type="submit"], button:has-text("Submit")'})
    _install_fake_page(monkeypatch, page)
    plan = ApplicationPlan(steps=[
        PlanStep(action="fill", locators=['#primary', '#fallback'], value="v"),
        PlanStep(action="submit", locators=[]),
    ])
    ctx = SubmissionContext(job={"external_url": "https://x/y"}, blueprint=None, plan=plan, documents={})
    asyncio.run(_StubDriver().submit(ctx))
    assert '#primary' in page.queried
    assert '#fallback' not in page.queried          # primary was authoritative
    assert page.filled[-1] == ('#primary', "v")

    # Case 2: primary misses (DOM drift) -> fallback is tried, after the primary.
    page2 = _FakePage(known_selectors={'#fallback', 'button[type="submit"], input[type="submit"], button:has-text("Submit")'})
    _install_fake_page(monkeypatch, page2)
    ctx2 = SubmissionContext(job={"external_url": "https://x/y"}, blueprint=None, plan=plan, documents={})
    asyncio.run(_StubDriver().submit(ctx2))
    assert page2.queried.index('#primary') < page2.queried.index('#fallback')
    assert page2.filled[-1] == ('#fallback', "v")
