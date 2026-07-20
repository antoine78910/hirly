import json
from pathlib import Path

from job_providers.ats_adapters.greenhouse import GreenhouseAtsAdapter


FIXTURE = (
    Path(__file__).resolve().parents[2]
    / "tests"
    / "fixtures"
    / "g019"
    / "greenhouse-parity.json"
)


def test_greenhouse_python_writer_matches_frozen_typescript_parity_contract():
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    normalized = GreenhouseAtsAdapter().normalize_job(
        fixture["raw"], source_key=fixture["tenantKey"]
    )
    expected = fixture["expected"]

    assert normalized is not None
    assert {
        "externalId": normalized["external_id"],
        "providerJobId": normalized["provider_job_id"],
        "title": normalized["title"],
        "company": normalized["company"],
        "location": normalized["location"],
        "description": normalized["description"],
        "sourceUrl": normalized["external_url"],
        "applyUrl": normalized["selected_apply_url"],
        "manualFulfillmentReady": normalized["manual_fulfillment_ready"],
        "autoApplySupported": normalized["auto_apply_supported"],
    } == {
        key: expected[key]
        for key in (
            "externalId",
            "providerJobId",
            "title",
            "company",
            "location",
            "description",
            "sourceUrl",
            "applyUrl",
            "manualFulfillmentReady",
            "autoApplySupported",
        )
    }

    # Country and validation tier are canonical TypeScript concerns. Freezing
    # them beside the Python fields prevents the shadow comparator from
    # silently dropping either release gate during writer migration.
    assert expected["countryCode"] == fixture["countryCode"]
    assert expected["validationTier"] == "A"
