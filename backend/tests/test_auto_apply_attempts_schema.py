import pathlib

from db import supabase_adapter as sa


def test_auto_apply_attempts_is_registered():
    assert "auto_apply_attempts" in sa.MIGRATED_TABLES
    assert sa.TABLE_PRIMARY_KEYS["auto_apply_attempts"] == "id"
    cols = sa.TABLE_FILTER_COLUMNS["auto_apply_attempts"]
    for required in ("id", "user_id", "job_id", "provider", "driver", "driver_version",
                     "status", "blueprint_signature", "verdict", "reason",
                     "claimed_at", "submitted_at", "verified_at"):
        assert required in cols, required


def test_supabase_row_maps_columns_and_keeps_extras_in_json():
    doc = {
        "id": "abc123",
        "user_id": "u1",
        "job_id": "j1",
        "provider": "greenhouse",
        "driver": "greenhouse",
        "driver_version": "gh-2026.07.15",
        "status": "needs_user_input",
        "reason": "needs_user_input:visa",
        "missing_fields": ["visa", "salary"],
        "evidence": {"blocked_reason": None},
    }
    row = sa._supabase_row("auto_apply_attempts", doc)
    assert row["id"] == "abc123"
    assert row["status"] == "needs_user_input"
    assert row["driver_version"] == "gh-2026.07.15"
    # Provider-specific / non-column data is preserved inside the JSON document,
    # never promoted to a dedicated column.
    assert row["data"]["missing_fields"] == ["visa", "salary"]
    assert row["data"]["evidence"] == {"blocked_reason": None}


def test_schema_declares_partial_unique_index_with_invariant_comment():
    schema = pathlib.Path(__file__).resolve().parent.parent / "supabase_schema.sql"
    text = schema.read_text(encoding="utf-8")
    assert "CREATE TABLE IF NOT EXISTS auto_apply_attempts" in text
    assert "auto_apply_attempts_active_unique" in text
    assert "WHERE status IN ('in_flight', 'submitted_success')" in text
    # The invariant must be documented in the migration itself.
    assert "never submit the same application twice" in text.lower()
    for col in ("claimed_at", "submitted_at", "verified_at", "driver_version"):
        assert col in text, col
