import asyncio
from types import SimpleNamespace

import server
from db import supabase_adapter


class _Collection:
    def __init__(self, found=None):
        self.found = found
        self.find_calls = 0
        self.update_calls = 0
        self.insert_calls = 0

    async def find_one(self, *_args, **_kwargs):
        self.find_calls += 1
        return self.found

    async def update_one(self, *_args, **_kwargs):
        self.update_calls += 1

    async def insert_one(self, *_args, **_kwargs):
        self.insert_calls += 1


def test_upsert_existing_auth_user_avoids_redundant_post_update_read(monkeypatch):
    users = _Collection(
        {
            "user_id": "user_1",
            "email": "person@example.com",
            "name": "Old",
            "untouched": True,
        }
    )
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))
    monkeypatch.setattr(server, "_find_user_by_email", users.find_one)

    result = asyncio.run(
        server._upsert_auth_user(
            "PERSON@example.com",
            "New",
            None,
            {"last_login_at": "2026-07-20T00:00:00+00:00"},
        )
    )

    assert users.find_calls == 1
    assert users.update_calls == 1
    assert result["user_id"] == "user_1"
    assert result["name"] == "New"
    assert result["untouched"] is True


def test_upsert_new_auth_user_returns_inserted_document_without_read(monkeypatch):
    users = _Collection()
    monkeypatch.setattr(server, "db", SimpleNamespace(users=users))
    monkeypatch.setattr(server, "_find_user_by_email", users.find_one)

    result = asyncio.run(server._upsert_auth_user("NEW@example.com", "New", None))

    assert users.find_calls == 1
    assert users.insert_calls == 1
    assert result["email"] == "new@example.com"
    assert result["user_id"].startswith("user_")


def test_upsert_existing_auth_user_uses_one_returned_patch_when_enabled(monkeypatch):
    users = _Collection(
        {
            "user_id": "user_1",
            "email": "person@example.com",
            "name": "Old",
        }
    )
    patches = []

    async def _patch(user_id, patch):
        patches.append((user_id, patch))
        return {
            "user_id": user_id,
            "email": "person@example.com",
            **patch,
        }

    monkeypatch.setenv("AUTH_RETURNED_USER_WRITE_ENABLED", "true")
    monkeypatch.setattr(
        server,
        "db",
        SimpleNamespace(users=users, patch_auth_user=_patch),
    )
    monkeypatch.setattr(server, "_find_user_by_email", users.find_one)

    result = asyncio.run(server._upsert_auth_user("person@example.com", "New", None))

    assert users.find_calls == 1
    assert users.update_calls == 0
    assert patches == [("user_1", {"name": "New", "picture": None})]
    assert result["name"] == "New"


def test_joined_auth_lookup_uses_one_database_operation_and_reissues_cookie(monkeypatch):
    calls = []

    class _Db:
        async def resolve_auth_session(self, token):
            calls.append(token)
            return {
                "status": "ok",
                "user": {
                    "user_id": "user_1",
                    "email": "person@example.com",
                    "name": "Person",
                },
                "flags": {
                    "is_training_creator": True,
                    "has_training_access": True,
                    "is_admin": False,
                },
            }

    cookies = []
    monkeypatch.setenv("AUTH_JOINED_SESSION_LOOKUP_ENABLED", "true")
    monkeypatch.setattr(server, "db", _Db())
    monkeypatch.setattr(server, "_set_app_session_cookie", lambda _response, token: cookies.append(token))
    request = SimpleNamespace(url=SimpleNamespace(path="/api/auth/me"))

    user = asyncio.run(
        server.get_current_user(
            request,
            SimpleNamespace(),
            session_token="cookie-token",
            authorization=None,
        )
    )

    assert calls == ["cookie-token"]
    assert cookies == ["cookie-token"]
    assert user.user_id == "user_1"
    assert user._auth_flags["is_training_creator"] is True


def test_user_stripe_identity_is_promoted_for_indexed_lookup():
    row = supabase_adapter._supabase_row(
        "users",
        {
            "user_id": "user_1",
            "email": "person@example.com",
            "billing": {
                "stripe_customer_id": "cus_123",
                "stripe_subscription_id": "sub_123",
            },
        },
    )

    assert row["stripe_customer_id"] == "cus_123"
    assert row["stripe_subscription_id"] == "sub_123"
    assert "stripe_customer_id" in supabase_adapter.TABLE_FILTER_COLUMNS["users"]


def test_auth_http_retries_enabled_get_once(monkeypatch):
    calls = []

    class _Client:
        is_closed = False

        async def request(self, method, url, **kwargs):
            calls.append((method, url, kwargs))
            if len(calls) == 1:
                raise server.httpx.ReadTimeout("transient")
            return SimpleNamespace(status_code=200)

    monkeypatch.setenv("AUTH_IDEMPOTENT_READ_RETRY_ENABLED", "true")
    monkeypatch.setattr(server, "_get_supabase_auth_http_client", lambda: _Client())

    async def _no_sleep(_delay):
        return None

    monkeypatch.setattr(server.asyncio, "sleep", _no_sleep)

    response = asyncio.run(
        server._request_supabase_auth(
            "GET",
            "https://example.supabase.co/auth/v1/user",
            headers={"apikey": "redacted"},
        )
    )

    assert response.status_code == 200
    assert len(calls) == 2


def test_supabase_auth_client_is_reused(monkeypatch):
    created = []

    class _Client:
        is_closed = False

        def __init__(self, **kwargs):
            created.append(kwargs)

    monkeypatch.setattr(server.httpx, "AsyncClient", _Client)
    monkeypatch.setattr(server, "_supabase_auth_http_client", None)

    first = server._get_supabase_auth_http_client()
    second = server._get_supabase_auth_http_client()

    assert first is second
    assert len(created) == 1


def test_auth_http_never_retries_post(monkeypatch):
    calls = []

    class _Client:
        is_closed = False

        async def request(self, method, url, **kwargs):
            calls.append((method, url, kwargs))
            raise server.httpx.ReadTimeout("do not replay mutation")

    monkeypatch.setenv("AUTH_IDEMPOTENT_READ_RETRY_ENABLED", "true")
    monkeypatch.setattr(server, "_get_supabase_auth_http_client", lambda: _Client())

    try:
        asyncio.run(
            server._request_supabase_auth(
                "POST",
                "https://example.supabase.co/auth/v1/admin/users",
                headers={"apikey": "redacted"},
                json_body={"email": "person@example.com"},
            )
        )
    except server.httpx.ReadTimeout:
        pass
    else:
        raise AssertionError("non-idempotent auth mutation must not be replayed")

    assert len(calls) == 1


def test_auth_me_reuses_joined_flags_and_only_reads_profile(monkeypatch):
    class _Profiles:
        calls = 0

        async def find_one(self, *_args, **_kwargs):
            self.calls += 1
            return {"user_id": "user_1", "cv_text": "cv", "target_role": "Engineer"}

    profiles = _Profiles()
    monkeypatch.setattr(server, "db", SimpleNamespace(profiles=profiles))
    monkeypatch.setattr(
        server,
        "is_training_creator",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("joined flag must be reused")),
    )
    monkeypatch.setattr(
        server,
        "_resolve_training_access",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("joined flag must be reused")),
    )
    user = server.User(user_id="user_1", email="person@example.com", name="Person")
    user._auth_flags = {
        "is_training_creator": True,
        "has_training_access": True,
        "is_admin": False,
    }

    payload = asyncio.run(server.auth_me(user))

    assert profiles.calls == 1
    assert payload["is_training_creator"] is True
    assert payload["has_training_access"] is True


def test_joined_auth_invalid_bearer_falls_back_to_cookie_in_two_operations(monkeypatch):
    calls = []

    class _Db:
        async def resolve_auth_session(self, token):
            calls.append(token)
            if token == "bad-bearer":
                return None
            return {
                "status": "ok",
                "user": {
                    "user_id": "user_1",
                    "email": "person@example.com",
                    "name": "Person",
                },
                "flags": {},
            }

    monkeypatch.setenv("AUTH_JOINED_SESSION_LOOKUP_ENABLED", "true")
    monkeypatch.setattr(server, "db", _Db())
    monkeypatch.setattr(server, "_set_app_session_cookie", lambda *_args: None)
    request = SimpleNamespace(url=SimpleNamespace(path="/api/auth/me"))

    user = asyncio.run(
        server.get_current_user(
            request,
            SimpleNamespace(),
            session_token="good-cookie",
            authorization="Bearer bad-bearer",
        )
    )

    assert calls == ["bad-bearer", "good-cookie"]
    assert user.user_id == "user_1"


def test_joined_auth_rpc_retries_one_enabled_idempotent_read(monkeypatch):
    calls = []

    class _Response:
        status_code = 200
        content = b'{"status":"ok","user":{"user_id":"user_1"}}'
        text = content.decode()

        def json(self):
            return {"status": "ok", "user": {"user_id": "user_1"}}

    class _Client:
        async def post(self, *_args, **_kwargs):
            calls.append(_kwargs)
            if len(calls) == 1:
                raise server.httpx.ReadTimeout("transient")
            return _Response()

    async def _no_sleep(_delay):
        return None

    monkeypatch.setenv("AUTH_IDEMPOTENT_READ_RETRY_ENABLED", "true")
    monkeypatch.setattr(supabase_adapter, "_get_shared_http_client", lambda **_kwargs: _Client())
    monkeypatch.setattr(supabase_adapter.asyncio, "sleep", _no_sleep)
    adapter = supabase_adapter.SupabaseDatabaseAdapter("https://example.supabase.co", "secret")

    result = asyncio.run(adapter.resolve_auth_session("token"))

    assert result["status"] == "ok"
    assert len(calls) == 2
    assert calls[0]["timeout"].read == 0.5


def test_auth_migration_declares_indexes_sync_and_rpc_security():
    migration = (
        server.Path(server.__file__).parent
        / "db"
        / "migrations"
        / "20260720001100_auth_session_lookup.sql"
    ).read_text()

    assert "idx_users_stripe_customer_id" in migration
    assert "trg_sync_user_promoted_auth_fields" in migration
    assert "SECURITY DEFINER" in migration
    assert "SET search_path = pg_catalog, public" in migration
    assert "SET statement_timeout = '1s'" in migration
    assert "REVOKE ALL ON FUNCTION public.resolve_auth_session(text) FROM PUBLIC" in migration
    assert "public.patch_auth_user(p_user_id text, p_patch jsonb)" in migration
    assert "SET statement_timeout = '2s'" in migration
    assert "AUTH_JOINED_SESSION_LOOKUP_ENABLED" in migration


def test_training_access_reuses_joined_creator_flag(monkeypatch):
    monkeypatch.setattr("training_access.training_open_access_enabled", lambda: False)

    assert server._training_access_from_user_and_creator(
        {"user_id": "user_1", "email": "person@example.com"},
        True,
    ) is True
