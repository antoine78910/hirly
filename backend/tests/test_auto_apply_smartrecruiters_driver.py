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
    assert fields["email_confirm"].binding == 'role=textbox[name="Confirmez votre e-mail"]'
    assert fields["resume"].binding == 'input[type="file"] >> nth=-1'
    assert fields["consent"].type == FieldType.CONSENT


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


def test_driver_is_registered():
    from auto_apply.driver import DRIVER_REGISTRY
    import auto_apply.drivers  # noqa: F401

    assert DRIVER_REGISTRY.for_job({"ats_provider": "smartrecruiters"}) is not None
