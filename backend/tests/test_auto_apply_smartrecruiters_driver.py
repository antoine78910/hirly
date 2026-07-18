import asyncio
import json
import pathlib

from application_blueprint import FieldType
from auto_apply.drivers.smartrecruiters import (
    SmartRecruitersApplyDriver,
    _blueprint,
    _fields_from_configuration,
    _parse_oneclick_data,
    _standard_fields,
)


def _fixture(name: str):
    p = pathlib.Path(__file__).resolve().parent / "fixtures" / name
    return json.loads(p.read_text(encoding="utf-8"))


def test_parse_oneclick_data_from_posting_html():
    html = """
    <script>window.ONECLICKDATA = {
      cident: 'Iliad-Free',
      vid: 1,
      pid: 744000131912329,
      puuid: '2270e9ac-137e-43ff-b8fb-d30117137c5d',
    };</script>
    """
    parsed = _parse_oneclick_data(html)
    assert parsed["company"] == "Iliad-Free"
    assert parsed["publication_uuid"] == "2270e9ac-137e-43ff-b8fb-d30117137c5d"


def test_standard_fields_include_contact_resume_and_consent():
    fields = {f.key: f for f in _standard_fields()}
    assert fields["first_name"].type == FieldType.FIRST_NAME
    assert fields["first_name"].binding == "#first-name-input >> input"
    assert fields["last_name"].binding == "#last-name-input >> input"
    assert fields["email_confirm"].binding == "#confirm-email-input >> input"
    assert fields["resume"].binding == 'input[type="file"] >> nth=-1'
    assert fields["consent"].binding == 'spl-checkbox[data-test="consent-box"]'
    assert fields["consent"].type == FieldType.CONSENT


def test_role_locators_use_exact_name_so_nom_does_not_match_prenom():
    from auto_apply.drivers.smartrecruiters import _exact_role_locator

    nom = _exact_role_locator("textbox", "Nom")
    prenom = _exact_role_locator("textbox", "Prénom")
    assert nom == r'role=textbox[name=/^Nom$/i]'
    assert prenom == r'role=textbox[name=/^Prénom$/i]'
    assert "Nom" not in prenom or prenom.startswith("role=")


def test_configuration_maps_screening_questions():
    payload = {
        "questions": [{
            "id": "q1",
            "label": "Motivation",
            "fields": [{
                "id": "textarea#123",
                "label": "Why do you want this job?",
                "type": "TEXTAREA",
                "required": True,
                "values": [],
            }],
        }],
    }
    field = _fields_from_configuration(payload)[0]
    assert field.key == "screening:textarea#123"
    assert field.type == FieldType.TEXTAREA
    assert field.required is True


def test_blueprint_has_signature():
    bp = _blueprint(_standard_fields())
    assert bp.provider == "smartrecruiters"
    assert bp.signature


def test_resolve_publication_from_api_detail(monkeypatch):
    driver = SmartRecruitersApplyDriver()

    async def fake_detail(company, posting_id):
        assert company == "Iliad-Free"
        assert posting_id == "744000131912329"
        return {"uuid": "2270e9ac-137e-43ff-b8fb-d30117137c5d"}

    monkeypatch.setattr(driver._adapter, "fetch_posting_detail", fake_detail)
    job = {
        "board_token": "Iliad-Free",
        "provider_job_id": "744000131912329",
        "external_url": "https://jobs.smartrecruiters.com/Iliad-Free/744000131912329",
    }
    out = asyncio.run(driver.resolve_publication(job))
    assert out["publication_uuid"] == "2270e9ac-137e-43ff-b8fb-d30117137c5d"


def test_oneclick_url_and_can_handle():
    driver = SmartRecruitersApplyDriver()
    assert driver.can_handle({"ats_provider": "smartrecruiters"}) is True
    url = driver.oneclick_url("Iliad-Free", "2270e9ac-137e-43ff-b8fb-d30117137c5d")
    assert "oneclick-ui/company/Iliad-Free/publication/2270e9ac" in url


def test_navigation_url_uses_posting_page():
    driver = SmartRecruitersApplyDriver()
    job = {
        "board_token": "Accor",
        "provider_job_id": "744000131912329",
        "external_url": "https://jobs.smartrecruiters.com/Accor/744000131912329",
        "publication_uuid": "f5c139fe-a63d-4402-bb16-a98b8d99ab24",
    }
    assert "oneclick-ui" not in driver.navigation_url(job)
    assert "Accor" in driver.navigation_url(job)
    assert "oneclick-ui" in driver.application_url(job)


def test_driver_is_registered():
    from auto_apply.driver import DRIVER_REGISTRY
    import auto_apply.drivers  # noqa: F401

    assert DRIVER_REGISTRY.for_job({"ats_provider": "smartrecruiters"}) is not None


class _RevealLocator:
    def __init__(self, text="", count=0):
        self._text = text
        self._count = count
        self.first = self
        self.clicked = False

    async def count(self):
        return self._count

    async def inner_text(self, timeout=0):
        return self._text


class _RevealPage:
    def __init__(self):
        self.url = "https://jobs.smartrecruiters.com/Accor/744000137165134-receptionniste-night-h-f-cdi"
        self.goto_urls = []
        self._cta = _RevealLocator("Je suis intéressé(e)", count=1)
        self.body_text = "Job posting"
        self.goto_status = 200

    def locator(self, selector):
        if selector == 'button:has-text("Je suis intéressé")':
            return self._cta
        if selector == "body":
            loc = _RevealLocator(self.body_text, count=1)
            return loc
        return _RevealLocator(count=0)

    async def goto(self, url, wait_until=None, timeout=None):
        self.goto_urls.append(url)
        self.url = url
        status = self.goto_status

        class _R:
            pass

        resp = _R()
        resp.status = status
        return resp

    async def wait_for_load_state(self, *args, **kwargs):
        return None


def test_reveal_form_clicks_french_interested_button(monkeypatch):
    from auto_apply.models import SubmissionEvidence

    driver = SmartRecruitersApplyDriver()
    page = _RevealPage()
    evidence = SubmissionEvidence(raw={
        "application_url": (
            "https://jobs.smartrecruiters.com/oneclick-ui/company/Accor/"
            "publication/9792f2d8-6c92-4148-ab59-fed4b4fb9ecf?dcr_ci=Accor"
        ),
        "step_log": [],
    })
    clicks = []

    async def fake_detect(_page):
        return False

    async def fake_pause(*args, **kwargs):
        return None

    async def fake_click(loc, page=None):
        clicks.append(loc)
        loc.clicked = True
        page.url = evidence.raw["application_url"]

    async def fake_wait(_page, timeout_ms=45000):
        return True

    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.detect_offer_expired", fake_detect)
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.human_pause", fake_pause)
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.human_click", fake_click)
    monkeypatch.setattr(driver, "_wait_for_oneclick_form", fake_wait)

    asyncio.run(driver.reveal_form(page, evidence))
    assert clicks, "expected Apply CTA click"
    assert evidence.raw["step_log"][0]["value_preview"] == "apply_cta_clicked"
    assert evidence.raw["step_log"][0]["locator"] == 'button:has-text("Je suis intéressé")'


def test_reveal_form_skips_direct_nav_when_cta_already_on_oneclick(monkeypatch):
    """After Apply CTA lands on oneclick, do not goto a different URL; reload shell instead."""
    from auto_apply.models import SubmissionEvidence

    driver = SmartRecruitersApplyDriver()
    page = _RevealPage()
    oneclick = (
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Accor/"
        "publication/7c13523d-2378-46fc-81aa-112ffd689b7a?dcr_ci=Accor"
    )
    evidence = SubmissionEvidence(raw={"application_url": oneclick, "step_log": []})
    page.reload_calls = 0

    async def fake_detect(_page):
        return False

    async def fake_pause(*args, **kwargs):
        return None

    async def fake_click(loc, page=None):
        page.url = oneclick

    async def fake_wait(_page, timeout_ms=45000):
        return False  # blank shell / captcha — form never appears

    async def fake_reload(wait_until=None, timeout=None):
        page.reload_calls += 1

    page.reload = fake_reload

    async def no_fallback(*args, **kwargs):
        return False

    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.detect_offer_expired", fake_detect)
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.human_pause", fake_pause)
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.human_click", fake_click)
    monkeypatch.setattr(driver, "_wait_for_oneclick_form", fake_wait)
    monkeypatch.setattr(
        "auto_apply.fallback_supervisor.run_fallback_supervisor", no_fallback,
    )

    asyncio.run(driver.reveal_form(page, evidence))
    assert page.goto_urls == [], "must not hard-navigate to a second oneclick URL"
    assert page.reload_calls == 1, "blank shell should soft-reload once"
    previews = [s.get("value_preview") for s in evidence.raw["step_log"]]
    assert "apply_cta_clicked" in previews
    assert "oneclick_blank_shell_reload" in previews
    assert "oneclick_direct_nav" not in previews
    assert evidence.blocked_reason == "oneclick_form_not_loaded"


def test_ensure_oneclick_form_ready_succeeds_after_reload(monkeypatch):
    from auto_apply.models import SubmissionEvidence

    driver = SmartRecruitersApplyDriver()
    page = _RevealPage()
    page.url = (
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Accor/"
        "publication/abc/dcr_ci=Accor"
    )
    evidence = SubmissionEvidence(raw={"step_log": []})
    waits = {"n": 0}

    async def fake_wait(_page, timeout_ms=45000):
        waits["n"] += 1
        return waits["n"] >= 2

    async def fake_reload(wait_until=None, timeout=None):
        return None

    async def fake_pause(*args, **kwargs):
        return None

    page.reload = fake_reload
    monkeypatch.setattr(driver, "_wait_for_oneclick_form", fake_wait)
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.human_pause", fake_pause)

    ok = asyncio.run(driver._ensure_oneclick_form_ready(page, evidence, timeout_ms=1000))
    assert ok is True
    assert evidence.blocked_reason is None
    assert any(
        s.get("value_preview") == "oneclick_blank_shell_reload"
        for s in evidence.raw["step_log"]
    )


def test_reveal_form_falls_back_to_oneclick_url(monkeypatch):
    from auto_apply.models import SubmissionEvidence

    driver = SmartRecruitersApplyDriver()
    page = _RevealPage()
    page._cta = _RevealLocator(count=0)
    oneclick = (
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Accor/"
        "publication/9792f2d8-6c92-4148-ab59-fed4b4fb9ecf?dcr_ci=Accor"
    )
    evidence = SubmissionEvidence(raw={"application_url": oneclick, "step_log": []})

    async def fake_detect(_page):
        return False

    async def fake_pause(*args, **kwargs):
        return None

    async def fake_wait(_page, timeout_ms=45000):
        return True

    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.detect_offer_expired", fake_detect)
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.human_pause", fake_pause)
    monkeypatch.setattr(driver, "_wait_for_oneclick_form", fake_wait)
    monkeypatch.setenv("BROWSER_NAVIGATION_TIMEOUT_MS", "5000")

    asyncio.run(driver.reveal_form(page, evidence))
    assert page.goto_urls == [oneclick]
    assert evidence.raw["step_log"][0]["value_preview"] == "oneclick_direct_nav"
    assert evidence.raw["step_log"][0]["status"] == "ok"


def test_reveal_form_goto_timeout_blocks_instead_of_filling(monkeypatch):
    """Regression: Page.goto timeout must not fall through to 9× not_found fills."""
    from auto_apply.models import SubmissionEvidence

    driver = SmartRecruitersApplyDriver()
    page = _RevealPage()
    page._cta = _RevealLocator(count=0)
    oneclick = (
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Accor/"
        "publication/e74c0c79-6b5c-4eab-b989-a51a3625acc1?dcr_ci=Accor"
    )
    evidence = SubmissionEvidence(raw={"application_url": oneclick, "step_log": []})

    async def boom(url, wait_until=None, timeout=None):
        page.goto_urls.append(url)
        raise TimeoutError("Page.goto: Timeout 30000ms exceeded")

    async def fake_detect(_page):
        return False

    async def fake_pause(*args, **kwargs):
        return None

    page.goto = boom
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.detect_offer_expired", fake_detect)
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.human_pause", fake_pause)
    monkeypatch.setenv("BROWSER_NAVIGATION_TIMEOUT_MS", "1000")

    asyncio.run(driver.reveal_form(page, evidence))
    assert evidence.blocked_reason == "oneclick_nav_timeout"
    assert any(s.get("value_preview") == "oneclick_direct_nav" for s in evidence.raw["step_log"])


def test_reveal_form_marks_oneclick_proxy_fail(monkeypatch):
    from auto_apply.models import SubmissionEvidence

    driver = SmartRecruitersApplyDriver()
    page = _RevealPage()
    page._cta = _RevealLocator(count=0)
    page.body_text = "Failed to connect to target host"
    oneclick = (
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Accor/"
        "publication/9792f2d8-6c92-4148-ab59-fed4b4fb9ecf?dcr_ci=Accor"
    )
    evidence = SubmissionEvidence(raw={"application_url": oneclick, "step_log": []})
    waited = []

    async def fake_detect(_page):
        return False

    async def fake_pause(*args, **kwargs):
        return None

    async def fake_wait(_page, timeout_ms=45000):
        waited.append(True)
        return True

    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.detect_offer_expired", fake_detect)
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.human_pause", fake_pause)
    monkeypatch.setattr(driver, "_wait_for_oneclick_form", fake_wait)

    asyncio.run(driver.reveal_form(page, evidence))
    assert page.goto_urls == [oneclick]
    assert evidence.raw["step_log"][0]["status"] == "error"
    assert "Proxy could not reach" in evidence.raw["step_log"][0]["error"]
    assert waited == [], "must not wait for form on proxy error page"


def test_inspect_application_merges_configuration(monkeypatch):
    driver = SmartRecruitersApplyDriver()

    async def fake_resolve(job):
        return {"company": "Iliad-Free", "publication_uuid": "2270e9ac-137e-43ff-b8fb-d30117137c5d"}

    class _Resp:
        status_code = 200
        headers = {"content-type": "application/json"}

        @staticmethod
        def json():
            return {
                "questions": [{
                    "id": "q1",
                    "label": "Motivation",
                    "fields": [{
                        "id": "textarea#123",
                        "label": "Why do you want this job?",
                        "type": "TEXTAREA",
                        "required": True,
                        "values": [],
                    }],
                }],
            }

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, *args, **kwargs):
            return _Resp()

    monkeypatch.setattr(driver, "resolve_publication", fake_resolve)
    monkeypatch.setattr("auto_apply.drivers.smartrecruiters.httpx.AsyncClient", lambda **kwargs: _Client())

    bp = asyncio.run(driver.inspect_application({"ats_provider": "smartrecruiters"}))
    keys = {field.key for field in bp.fields}
    assert "first_name" in keys
    assert "screening:textarea#123" in keys
    assert bp.provider == "smartrecruiters"
