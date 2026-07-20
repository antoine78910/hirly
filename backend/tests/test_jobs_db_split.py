"""Tests for optional JOBS_SUPABASE_* inventory split."""

import base64
import json

import db as db_pkg
import pytest
from db.supabase_adapter import JOB_FEED_LIGHT_SELECT, _restore_document


def test_attach_jobs_inventory_rewires_collections():
    class _Fake:
        def __init__(self, url):
            self.supabase_url = url
            self.jobs = object()
            self.ats_company_sources = object()
            self.company_boards = object()
            self.friendly_company_career_pages = object()
            self.geo_places = object()
            self.users = object()

    primary = _Fake("https://primary.supabase.co")
    jobs_db = _Fake("https://jobs.supabase.co")
    primary_users = primary.users
    db_pkg.attach_jobs_inventory(primary, jobs_db)
    assert primary.jobs is jobs_db.jobs
    assert primary.ats_company_sources is jobs_db.ats_company_sources
    assert primary.geo_places is jobs_db.geo_places
    assert primary.users is primary_users
    assert primary.jobs_inventory_url == "https://jobs.supabase.co"


def test_create_database_adapter_splits_when_env_set(monkeypatch):
    created = []

    class _FakeAdapter:
        def __init__(self, supabase_url=None, secret_key=None, db_url=None):
            self.supabase_url = supabase_url
            self.secret_key = secret_key
            self.db_url = db_url
            self.jobs = object()
            self.ats_company_sources = object()
            self.company_boards = object()
            self.friendly_company_career_pages = object()
            self.geo_places = object()
            self.users = object()
            created.append(supabase_url)

    monkeypatch.setenv("SUPABASE_URL", "https://primary.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "primary-key")
    monkeypatch.setenv("JOBS_SUPABASE_URL", "https://jobs.supabase.co")
    monkeypatch.setenv("JOBS_SUPABASE_SECRET_KEY", "jobs-key")
    monkeypatch.setattr(db_pkg, "SupabaseDatabaseAdapter", _FakeAdapter)

    adapter = db_pkg.create_database_adapter()
    assert created == ["https://primary.supabase.co", "https://jobs.supabase.co"]
    assert adapter.jobs_inventory_url == "https://jobs.supabase.co"


def test_create_database_adapter_keeps_single_db_without_jobs_env(monkeypatch):
    created = []

    class _FakeAdapter:
        def __init__(self, supabase_url=None, secret_key=None, db_url=None):
            self.supabase_url = supabase_url
            created.append(supabase_url)
            self.jobs = object()

    monkeypatch.setenv("SUPABASE_URL", "https://primary.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "primary-key")
    monkeypatch.delenv("JOBS_SUPABASE_URL", raising=False)
    monkeypatch.delenv("JOBS_SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.setattr(db_pkg, "SupabaseDatabaseAdapter", _FakeAdapter)

    db_pkg.create_database_adapter()
    assert created == ["https://primary.supabase.co"]


def _jwt_for_role(role: str) -> str:
    payload = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
    return f"header.{payload}.signature"


@pytest.mark.parametrize(
    "public_key",
    [
        "sb_publishable_example",
        _jwt_for_role("anon"),
        _jwt_for_role("authenticated"),
    ],
)
def test_primary_database_rejects_public_supabase_credentials(monkeypatch, public_key):
    monkeypatch.setenv("SUPABASE_URL", "https://primary.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", public_key)
    with pytest.raises(RuntimeError, match="secret/service-role"):
        db_pkg.create_database_adapter()


def test_split_inventory_rejects_public_supabase_credentials(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://primary.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "primary-secret")
    monkeypatch.setenv("JOBS_SUPABASE_URL", "https://jobs.supabase.co")
    monkeypatch.setenv("JOBS_SUPABASE_SECRET_KEY", "sb_publishable_example")
    with pytest.raises(RuntimeError, match="JOBS_SUPABASE_SECRET_KEY"):
        db_pkg.create_database_adapter()


def test_unrecognized_legacy_secret_format_is_left_to_remote_auth(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://primary.supabase.co")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "header.not-base64.signature")
    monkeypatch.delenv("JOBS_SUPABASE_URL", raising=False)
    monkeypatch.delenv("JOBS_SUPABASE_SECRET_KEY", raising=False)
    monkeypatch.setattr(db_pkg, "SupabaseDatabaseAdapter", lambda **kwargs: object())
    db_pkg.create_database_adapter()


def test_job_feed_light_select_excludes_jsonb_data():
    assert "data" not in JOB_FEED_LIGHT_SELECT.split(",")
    assert "job_id" in JOB_FEED_LIGHT_SELECT
    assert "selected_apply_url" in JOB_FEED_LIGHT_SELECT


def test_restore_document_maps_light_feed_apply_urls():
    doc = _restore_document(
        {
            "job_id": "job_1",
            "title": "Sales",
            "selected_apply_url": "https://boards.greenhouse.io/acme/jobs/1",
        }
    )
    assert doc["external_url"] == "https://boards.greenhouse.io/acme/jobs/1"
    assert doc["apply_url"] == "https://boards.greenhouse.io/acme/jobs/1"
    assert "data" not in doc
