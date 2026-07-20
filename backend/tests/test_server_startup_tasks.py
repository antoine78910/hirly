import asyncio
from importlib.metadata import version
from pathlib import Path

import server


def test_observability_dependencies_are_release_pinned_and_importable():
    requirements = (
        Path(__file__).resolve().parents[1] / "requirements.txt"
    ).read_text(encoding="utf-8")
    expected = {
        "posthog": ("posthog[otel]", "7.27.0"),
        "opentelemetry-sdk": ("opentelemetry-sdk", "1.44.0"),
        "opentelemetry-instrumentation-openai-v2": (
            "opentelemetry-instrumentation-openai-v2",
            "2.4b0",
        ),
    }
    for package, (requirement_name, pinned_version) in expected.items():
        assert f"{requirement_name}=={pinned_version}" in requirements
        assert version(package) == pinned_version
    assert server._OTEL_AVAILABLE is True


def test_startup_observability_rejects_unapproved_host(monkeypatch):
    monkeypatch.setenv("POSTHOG_SERVER_API_KEY", "phc_test")
    monkeypatch.setenv("POSTHOG_HOST", "https://collector.invalid")
    monkeypatch.delenv("POSTHOG_ALLOWED_HOSTS", raising=False)
    assert server._posthog_server_capture_configured() is False


def test_startup_task_is_retained_until_completion():
    async def _run():
        gate = asyncio.Event()

        async def worker():
            await gate.wait()

        task = server._spawn_observed_startup_task(worker(), name="test-retained")
        assert task in server._STARTUP_BACKGROUND_TASKS
        gate.set()
        await task
        await asyncio.sleep(0)
        assert task not in server._STARTUP_BACKGROUND_TASKS

    asyncio.run(_run())


def test_startup_task_terminal_failure_is_logged(caplog):
    async def _run():
        async def worker():
            raise RuntimeError("terminal failure")

        task = server._spawn_observed_startup_task(worker(), name="test-failure")
        await asyncio.gather(task, return_exceptions=True)
        await asyncio.sleep(0)

    asyncio.run(_run())
    assert "startup_background_task_failed task=test-failure" in caplog.text


def test_paused_ingestion_schedules_are_registered_disabled(monkeypatch):
    states = server._python_ingestion_schedule_states(True)
    assert len(states) == 4
    assert all(enabled is False for *_rest, enabled in states)


def test_provider_disabled_schedule_is_not_expected(monkeypatch):
    monkeypatch.setattr(server, "ft_harvest_enabled", lambda: False)
    monkeypatch.setattr(server, "jsearch_harvest_enabled", lambda: True)
    states = {
        source: enabled
        for _schedule, source, _cadence, enabled
        in server._python_ingestion_schedule_states(False)
    }
    assert states["france_travail"] is False
    assert states["jsearch"] is True
