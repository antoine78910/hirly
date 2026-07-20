import asyncio

import server


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
