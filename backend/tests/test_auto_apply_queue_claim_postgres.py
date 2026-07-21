import asyncio
import json
import os
from pathlib import Path
from urllib.parse import urlparse

import pytest


ROOT = Path(__file__).parents[1]
FIXTURE_PREFIX = "claim_test_"
ADVISORY_LOCK_KEY = 2_026_072_100_270


def _dedicated_database_url() -> str:
    url = os.environ.get("AUTO_APPLY_CLAIM_TEST_DATABASE_URL", "")
    if not url:
        pytest.skip("AUTO_APPLY_CLAIM_TEST_DATABASE_URL is not configured")
    if os.environ.get("AUTO_APPLY_CLAIM_TEST_DATABASE_DISPOSABLE", "").lower() != "true":
        pytest.fail("AUTO_APPLY_CLAIM_TEST_DATABASE_DISPOSABLE=true is required")
    if url in {os.environ.get("DATABASE_URL"), os.environ.get("SUPABASE_DB_URL")}:
        pytest.fail("dedicated claim test database must not equal a runtime database URL")
    database = urlparse(url).path.lstrip("/").lower()
    if not database.endswith(("_test", "_ci", "_disposable")):
        pytest.fail("claim test database name must end in _test, _ci, or _disposable")
    return url


def _payload(value):
    if value is None or isinstance(value, dict):
        return value
    return json.loads(value)


async def _insert_application(conn, application_id, user_id, job_id, data, created_at):
    await conn.execute(
        """
        INSERT INTO public.applications (
          application_id, user_id, job_id, created_at, updated_at, data
        ) VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz, $5::jsonb)
        """,
        application_id,
        user_id,
        job_id,
        created_at,
        json.dumps(data),
    )


async def _claim(url, ready, start):
    import asyncpg

    conn = await asyncpg.connect(url)
    try:
        ready.set()
        await start.wait()
        return _payload(await conn.fetchval("SELECT public.claim_auto_apply_queue()"))
    finally:
        await conn.close()


async def _concurrent_claims(url):
    ready_a = asyncio.Event()
    ready_b = asyncio.Event()
    start = asyncio.Event()
    task_a = asyncio.create_task(_claim(url, ready_a, start))
    task_b = asyncio.create_task(_claim(url, ready_b, start))
    await asyncio.gather(ready_a.wait(), ready_b.wait())
    start.set()
    return await asyncio.gather(task_a, task_b)


async def _run_database_proof(url):
    asyncpg = pytest.importorskip("asyncpg")
    lock_conn = await asyncpg.connect(url)
    locked = False
    applications_ready = False
    try:
        locked = await lock_conn.fetchval("SELECT pg_try_advisory_lock($1)", ADVISORY_LOCK_KEY)
        if not locked:
            pytest.fail("exclusive auto-apply claim test advisory lock is already held")

        for role in ("anon", "authenticated", "service_role"):
            await lock_conn.execute(
                f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; "
                f"EXCEPTION WHEN duplicate_object THEN NULL; END $$;"
            )

        await lock_conn.execute((ROOT / "db" / "supabase_phase2_schema.sql").read_text())
        applications_ready = True
        columns = {
            row["column_name"]
            for row in await lock_conn.fetch(
                """
                SELECT column_name FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'applications'
                """
            )
        }
        assert {
            "application_id", "user_id", "job_id", "data", "created_at", "updated_at",
        } <= columns

        migrate_conn = await asyncpg.connect(url)
        try:
            await migrate_conn.execute(
                (ROOT / "db" / "migrations" /
                 "20260721002600_auto_apply_queue_claim_index.sql").read_text()
            )
            await migrate_conn.execute(
                (ROOT / "db" / "migrations" /
                 "20260721002700_auto_apply_queue_claim_rpc.sql").read_text()
            )
        finally:
            await migrate_conn.close()

        unrelated = await lock_conn.fetchval(
            "SELECT count(*) FROM public.applications "
            "WHERE data ->> 'auto_apply_queue_status' = 'queued'"
        )
        if unrelated:
            pytest.fail("disposable database contains unrelated queued applications")

        await _insert_application(
            lock_conn, "claim_test_one", "claim_test_user_one", "claim_test_job_one",
            {
                "application_id": "claim_test_one",
                "user_id": "claim_test_user_one",
                "job_id": "claim_test_job_one",
                "auto_apply_queue_status": "queued",
                "auto_apply_queued_at": "2026-07-21T00:00:00+00:00",
            },
            "2026-07-21T00:00:00+00:00",
        )
        one_results = await _concurrent_claims(url)
        assert sum(result is not None for result in one_results) == 1
        assert {result["application_id"] for result in one_results if result} == {"claim_test_one"}

        for suffix, queued_at in (("fifo_a", "2026-07-21T01:00:00+00:00"),
                                  ("fifo_b", "2026-07-21T02:00:00+00:00")):
            await _insert_application(
                lock_conn, f"claim_test_{suffix}", f"claim_test_user_{suffix}",
                f"claim_test_job_{suffix}",
                {
                    "application_id": f"claim_test_{suffix}",
                    "user_id": f"claim_test_user_{suffix}",
                    "job_id": f"claim_test_job_{suffix}",
                    "auto_apply_queue_status": "queued",
                    "auto_apply_queued_at": queued_at,
                },
                queued_at,
            )
        two_results = await _concurrent_claims(url)
        assert {result["application_id"] for result in two_results if result} == {
            "claim_test_fifo_a", "claim_test_fifo_b",
        }

        await _insert_application(
            lock_conn, "claim_test_missing_json_id", "claim_test_physical_user",
            "claim_test_physical_job",
            {"auto_apply_queue_status": "queued", "auto_apply_queued_at": "2026-07-21T03:00:00Z"},
            "2026-07-21T03:00:00+00:00",
        )
        missing = _payload(await lock_conn.fetchval("SELECT public.claim_auto_apply_queue()"))
        assert missing["application_id"] == "claim_test_missing_json_id"
        assert missing["user_id"] == "claim_test_physical_user"
        assert missing["job_id"] == "claim_test_physical_job"
        assert missing["auto_apply_queue_status"] == "running"

        await _insert_application(
            lock_conn, "claim_test_physical_id", "claim_test_physical_user_2",
            "claim_test_physical_job_2",
            {
                "application_id": "contradictory_id",
                "user_id": "contradictory_user",
                "job_id": "contradictory_job",
                "auto_apply_queue_status": "queued",
                "auto_apply_queued_at": "2026-07-21T04:00:00Z",
            },
            "2026-07-21T04:00:00+00:00",
        )
        physical = _payload(await lock_conn.fetchval("SELECT public.claim_auto_apply_queue()"))
        assert physical["application_id"] == "claim_test_physical_id"
        assert physical["user_id"] == "claim_test_physical_user_2"
        assert physical["job_id"] == "claim_test_physical_job_2"
        assert physical["auto_apply_queue_status"] == "running"
        assert await lock_conn.fetchval("SELECT public.claim_auto_apply_queue()") is None

        states = await lock_conn.fetch(
            "SELECT application_id, data ->> 'auto_apply_queue_status' AS status "
            "FROM public.applications WHERE application_id LIKE 'claim_test_%'"
        )
        assert states and all(row["status"] == "running" for row in states)

        acl = await lock_conn.fetch(
            """
            SELECT acl.grantee, role.rolname, acl.grantor,
                   acl.privilege_type, acl.is_grantable, function.proowner
            FROM pg_proc p
            CROSS JOIN LATERAL aclexplode(
              COALESCE(p.proacl, acldefault('f', p.proowner))
            ) acl
            LEFT JOIN pg_roles role ON role.oid = acl.grantee
            WHERE p.oid = 'public.claim_auto_apply_queue()'::regprocedure
            """
        )
        service_oid = await lock_conn.fetchval("SELECT oid FROM pg_roles WHERE rolname='service_role'")
        assert all(row["grantee"] != 0 for row in acl if row["privilege_type"] == "EXECUTE")
        assert all(
            row["grantee"] in {row["proowner"], service_oid}
            for row in acl if row["privilege_type"] == "EXECUTE"
        )
        assert await lock_conn.fetchval(
            "SELECT has_function_privilege('service_role', "
            "'public.claim_auto_apply_queue()', 'EXECUTE')"
        )
        for role in ("anon", "authenticated"):
            assert not await lock_conn.fetchval(
                "SELECT has_function_privilege($1, "
                "'public.claim_auto_apply_queue()', 'EXECUTE')", role
            )
            role_conn = await asyncpg.connect(url)
            try:
                await role_conn.execute(f"SET ROLE {role}")
                with pytest.raises(asyncpg.InsufficientPrivilegeError):
                    await role_conn.fetchval("SELECT public.claim_auto_apply_queue()")
            finally:
                await role_conn.close()

        service_conn = await asyncpg.connect(url)
        try:
            await service_conn.execute("SET ROLE service_role")
            assert await service_conn.fetchval("SELECT public.claim_auto_apply_queue()") is None
        finally:
            await service_conn.close()

        ready, valid = await lock_conn.fetchrow(
            """
            SELECT index.indisready, index.indisvalid
            FROM pg_index index
            JOIN pg_class class ON class.oid = index.indexrelid
            JOIN pg_namespace namespace ON namespace.oid = class.relnamespace
            WHERE namespace.nspname='public'
              AND class.relname='applications_auto_apply_queue_claim_idx'
            """
        )
        assert ready and valid
    finally:
        if locked and applications_ready:
            await lock_conn.execute(
                "DELETE FROM public.applications WHERE application_id LIKE 'claim_test_%'"
            )
        if locked:
            await lock_conn.execute("SELECT pg_advisory_unlock($1)", ADVISORY_LOCK_KEY)
        await lock_conn.close()


def test_atomic_auto_apply_claim_on_disposable_postgres():
    asyncio.run(_run_database_proof(_dedicated_database_url()))
