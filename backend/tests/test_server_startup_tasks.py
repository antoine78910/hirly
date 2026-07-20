import asyncio
import logging
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
        "opentelemetry-exporter-otlp-proto-http": (
            "opentelemetry-exporter-otlp-proto-http",
            "1.44.0",
        ),
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


def test_posthog_client_uses_7x_positional_project_key(monkeypatch):
    constructor_call = {}
    sentinel = object()

    def fake_posthog(*args, **kwargs):
        constructor_call["args"] = args
        constructor_call["kwargs"] = kwargs
        return sentinel

    monkeypatch.setattr(server, "Posthog", fake_posthog)

    client = server._build_posthog_client(
        "phc_test",
        "https://eu.i.posthog.com",
    )

    assert client is sentinel
    assert constructor_call == {
        "args": ("phc_test",),
        "kwargs": {
            "host": "https://eu.i.posthog.com",
            "enable_exception_autocapture": True,
        },
    }


def test_posthog_logs_endpoint_uses_validated_ingestion_host(monkeypatch):
    monkeypatch.setenv("POSTHOG_HOST", "https://eu.i.posthog.com")
    monkeypatch.delenv("POSTHOG_ALLOWED_HOSTS", raising=False)
    assert server._posthog_logs_endpoint() == "https://eu.i.posthog.com/i/v1/logs"

    monkeypatch.setenv("POSTHOG_HOST", "https://analytics.tryhirly.com")
    monkeypatch.setenv("POSTHOG_ALLOWED_HOSTS", "analytics.tryhirly.com")
    assert server._posthog_logs_endpoint() == "https://analytics.tryhirly.com/i/v1/logs"

    monkeypatch.setenv("POSTHOG_HOST", "https://collector.invalid")
    monkeypatch.delenv("POSTHOG_ALLOWED_HOSTS", raising=False)
    assert server._posthog_logs_endpoint() is None


def test_posthog_logs_configures_root_otel_handler(monkeypatch):
    calls = {}

    class FakeProvider:
        def __init__(self, *, resource):
            calls["resource"] = resource

        def add_log_record_processor(self, processor):
            calls["processor"] = processor

    class FakeExporter:
        def __init__(self, **kwargs):
            calls["exporter_kwargs"] = kwargs

    class FakeProcessor:
        def __init__(self, exporter):
            calls["exporter"] = exporter

    class FakeHandler(logging.Handler):
        def __init__(self, *, logger_provider):
            super().__init__()
            calls["handler_provider"] = logger_provider

    monkeypatch.setattr(server, "_POSTHOG_LOGS_AVAILABLE", True)
    monkeypatch.setattr(server, "_OtelLoggerProvider", FakeProvider)
    monkeypatch.setattr(server, "_OtelLogExporter", FakeExporter)
    monkeypatch.setattr(server, "_OtelBatchLogRecordProcessor", FakeProcessor)
    monkeypatch.setattr(server, "_OtelLoggingHandler", FakeHandler)
    monkeypatch.setattr(server, "_OtelLogResource", lambda **kwargs: kwargs)
    monkeypatch.setattr(server, "_otel_set_logger_provider", lambda provider: calls.setdefault("provider", provider))
    monkeypatch.setattr(server, "_posthog_log_provider", None)
    monkeypatch.setattr(server, "_posthog_log_handler", None)

    root_logger = logging.getLogger()
    original_handlers = list(root_logger.handlers)
    try:
        assert server._configure_posthog_logs(
            "phc_test",
            "https://eu.i.posthog.com/i/v1/logs",
        )
        assert calls["exporter_kwargs"] == {
            "endpoint": "https://eu.i.posthog.com/i/v1/logs",
            "headers": {"Authorization": "Bearer phc_test"},
        }
        assert calls["provider"] is calls["handler_provider"]
        assert server._posthog_log_handler in root_logger.handlers
    finally:
        for handler in root_logger.handlers:
            if handler not in original_handlers:
                root_logger.removeHandler(handler)


def test_posthog_exception_capture_is_non_blocking(monkeypatch):
    captured = []

    class FakePosthog:
        def capture_exception(self, exception):
            captured.append(exception)
            return "error-id"

    error = RuntimeError("boom")
    monkeypatch.setattr(server, "_posthog_client", FakePosthog())
    assert server._capture_posthog_exception(error) == "error-id"
    assert captured == [error]

    class BrokenPosthog:
        def capture_exception(self, _exception):
            raise RuntimeError("vendor unavailable")

    monkeypatch.setattr(server, "_posthog_client", BrokenPosthog())
    assert server._capture_posthog_exception(error) is None


def test_fastapi_unhandled_exception_handler_captures_and_returns_generic_500(monkeypatch):
    captured = []
    error = RuntimeError("sensitive internal detail")
    monkeypatch.setattr(server, "_capture_posthog_exception", captured.append)

    response = asyncio.run(server._posthog_unhandled_exception_handler(None, error))

    assert captured == [error]
    assert response.status_code == 500
    assert response.body == b'{"detail":"Internal server error"}'


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
    monkeypatch.setattr(server, "jsearch_harvest_autostart_enabled", lambda: False)
    states = {
        source: enabled
        for _schedule, source, _cadence, enabled
        in server._python_ingestion_schedule_states(False)
    }
    assert states["france_travail"] is False
    assert states["jsearch"] is False

    monkeypatch.setattr(server, "jsearch_harvest_autostart_enabled", lambda: True)
    states = {
        source: enabled
        for _schedule, source, _cadence, enabled
        in server._python_ingestion_schedule_states(False)
    }
    assert states["jsearch"] is True


def test_paused_startup_tolerates_missing_optional_ingestion_ledger(monkeypatch, caplog):
    calls = []

    async def missing_ledger(**kwargs):
        calls.append(kwargs)
        raise RuntimeError(
            "Supabase ingestion ledger RPC python_ingestion_schedule_sync "
            "returned HTTP 404: PGRST202"
        )

    monkeypatch.setattr(server.db, "sync_python_ingestion_schedule", missing_ledger)

    asyncio.run(server._sync_python_ingestion_schedules(True))

    assert len(calls) == 1
    assert calls[0]["enabled"] is False
    assert "python_ingestion_ledger_unavailable schedules_paused=true" in caplog.text


def test_enabled_startup_requires_ingestion_ledger(monkeypatch):
    async def missing_ledger(**_kwargs):
        raise RuntimeError(
            "Supabase ingestion ledger RPC python_ingestion_schedule_sync "
            "returned HTTP 404: PGRST202"
        )

    monkeypatch.setattr(server.db, "sync_python_ingestion_schedule", missing_ledger)
    monkeypatch.setattr(server, "ft_harvest_enabled", lambda: True)

    try:
        asyncio.run(server._sync_python_ingestion_schedules(False))
    except RuntimeError as exc:
        assert "PGRST202" in str(exc)
    else:
        raise AssertionError("enabled ingestion must require the ledger RPC")


def test_paused_startup_does_not_hide_unrelated_schedule_errors(monkeypatch):
    async def broken_schedule(**_kwargs):
        raise RuntimeError("database authentication failed")

    monkeypatch.setattr(server.db, "sync_python_ingestion_schedule", broken_schedule)

    try:
        asyncio.run(server._sync_python_ingestion_schedules(True))
    except RuntimeError as exc:
        assert str(exc) == "database authentication failed"
    else:
        raise AssertionError("unrelated schedule errors must remain fatal")
