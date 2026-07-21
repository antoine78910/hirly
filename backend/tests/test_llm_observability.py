import os

import pytest

import llm_client


def test_observation_requires_stable_nonempty_identifiers():
    observation = llm_client.LLMObservation(
        "application_document_generation", "v1", "application_generation"
    )

    assert observation.operation == "application_document_generation"

    with pytest.raises(ValueError, match="operation"):
        llm_client.LLMObservation("", "v1", "application_generation")

    with pytest.raises(ValueError, match="prompt_version"):
        llm_client.LLMObservation("application_document_generation", "v1!", "application_generation")


def test_raw_content_capture_requires_explicit_opt_in(monkeypatch):
    monkeypatch.delenv("POSTHOG_AI_RAW_CONTENT_ENABLED", raising=False)
    monkeypatch.delenv("POSTHOG_AI_RAW_CONTENT_RETENTION_DAYS", raising=False)
    monkeypatch.setenv("OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT", "true")

    assert llm_client.configure_raw_llm_content_capture() is False
    assert os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] == "false"

    monkeypatch.setenv("POSTHOG_AI_RAW_CONTENT_ENABLED", "true")
    assert llm_client.configure_raw_llm_content_capture() is False

    monkeypatch.setenv("POSTHOG_AI_RAW_CONTENT_RETENTION_DAYS", "30")

    assert llm_client.configure_raw_llm_content_capture() is True


def test_product_operation_span_is_emitted_with_governed_metadata(monkeypatch):
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(trace, "get_tracer", provider.get_tracer)

    observation = llm_client.LLMObservation(
        "career_coach_interview_score", "v1", "career_coach"
    )
    with llm_client._observe_llm_operation(observation):
        pass

    span = exporter.get_finished_spans()[0]
    assert span.name == "gen_ai.hirly.career_coach_interview_score"
    assert span.attributes["gen_ai.hirly.operation"] == "career_coach_interview_score"
    assert span.attributes["gen_ai.hirly.prompt_version"] == "v1"
    assert span.attributes["gen_ai.hirly.outcome"] == "success"
    assert span.attributes["gen_ai.hirly.raw_content_retention_days"] == 30


def test_user_context_is_reset_after_the_llm_workflow():
    assert llm_client._llm_user_ctx.get() is None

    with llm_client.llm_user_context("6a629306-4a65-452f-9b79-9e5b51d55030"):
        assert llm_client._llm_user_ctx.get() == "6a629306-4a65-452f-9b79-9e5b51d55030"

    assert llm_client._llm_user_ctx.get() is None


def test_generation_child_inherits_governed_tags_and_trace_identity(monkeypatch):
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(llm_client.build_llm_generation_tag_processor())
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(trace, "get_tracer", provider.get_tracer)

    observation = llm_client.LLMObservation(
        "career_coach_interview_score", "v1", "career_coach"
    )
    with llm_client._observe_llm_operation(observation):
        with provider.get_tracer("test").start_as_current_span("http request"):
            pass
        with provider.get_tracer("test").start_as_current_span(
            "chat gpt-4.1-mini", attributes={"gen_ai.operation.name": "chat"}
        ):
            pass

    parent, http_child, generation = sorted(
        exporter.get_finished_spans(), key=lambda span: span.start_time
    )
    assert generation.context.trace_id == parent.context.trace_id
    assert generation.parent.span_id == parent.context.span_id
    assert generation.attributes["gen_ai.hirly.operation"] == "career_coach_interview_score"
    assert generation.attributes["gen_ai.hirly.prompt_version"] == "v1"
    assert generation.attributes["gen_ai.hirly.feature"] == "career_coach"
    assert "gen_ai.hirly.raw_input" not in generation.attributes
    assert "gen_ai.hirly.operation" not in http_child.attributes
    assert generation.attributes["gen_ai.operation.name"] == "hirly.career_coach_interview_score.v1"


@pytest.mark.asyncio
async def test_raw_text_is_recorded_on_the_product_span_only_when_enabled(monkeypatch):
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    class FakeCompletions:
        async def create(self, **_kwargs):
            choice = type("Choice", (), {"message": type("Message", (), {"content": "raw output"})()})()
            return type("Response", (), {"choices": [choice]})()

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(trace, "get_tracer", provider.get_tracer)
    monkeypatch.setattr(
        llm_client,
        "_client",
        lambda: type("Client", (), {"chat": type("Chat", (), {"completions": FakeCompletions()})()})(),
    )
    monkeypatch.setenv("POSTHOG_AI_RAW_CONTENT_ENABLED", "true")
    monkeypatch.setenv("POSTHOG_AI_RAW_CONTENT_RETENTION_DAYS", "30")

    output = await llm_client.complete_json_text(
        "system prompt",
        "user prompt",
        observation=llm_client.LLMObservation("test_operation", "v1", "test_feature"),
    )

    span = exporter.get_finished_spans()[0]
    assert output == "raw output"
    assert span.attributes["gen_ai.hirly.raw_input"] == "SYSTEM:\nsystem prompt\n\nUSER:\nuser prompt"
    assert span.attributes["gen_ai.hirly.raw_output"] == "raw output"
    assert "OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT" not in span.attributes


@pytest.mark.asyncio
async def test_raw_text_is_not_emitted_without_the_retention_gate(monkeypatch):
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor
    from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

    class FakeCompletions:
        async def create(self, **_kwargs):
            choice = type("Choice", (), {"message": type("Message", (), {"content": "raw output"})()})()
            return type("Response", (), {"choices": [choice]})()

    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    monkeypatch.setattr(trace, "get_tracer", provider.get_tracer)
    monkeypatch.setattr(
        llm_client,
        "_client",
        lambda: type("Client", (), {"chat": type("Chat", (), {"completions": FakeCompletions()})()})(),
    )
    monkeypatch.setenv("POSTHOG_AI_RAW_CONTENT_ENABLED", "true")
    monkeypatch.delenv("POSTHOG_AI_RAW_CONTENT_RETENTION_DAYS", raising=False)

    await llm_client.complete_json_text(
        "system prompt",
        "user prompt",
        observation=llm_client.LLMObservation("test_operation", "v1", "test_feature"),
    )

    attributes = exporter.get_finished_spans()[0].attributes
    assert "gen_ai.hirly.raw_input" not in attributes
    assert "gen_ai.hirly.raw_output" not in attributes
