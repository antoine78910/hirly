"""Internal OpenAI adapter with governed PostHog AI-observability spans."""

import contextvars
import io
import os
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Dict, Optional

from openai import AsyncOpenAI

# Set this before any LLM call in a request context so PostHog AI observability
# can associate $ai_generation events with the correct user.
_llm_user_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "llm_user_ctx", default=None
)

_GENERATION_TAG_ATTRIBUTES = (
    "gen_ai.hirly.operation",
    "gen_ai.hirly.prompt_version",
    "gen_ai.hirly.feature",
    "gen_ai.hirly.actor_scope",
    "gen_ai.hirly.raw_content_retention_days",
)


@dataclass(frozen=True)
class LLMObservation:
    """Stable, non-PII metadata attached to one product-level LLM operation."""

    operation: str
    prompt_version: str
    feature: str
    actor_scope: str = "user"

    def __post_init__(self) -> None:
        for field_name, value in (
            ("operation", self.operation),
            ("prompt_version", self.prompt_version),
            ("feature", self.feature),
            ("actor_scope", self.actor_scope),
        ):
            if not value or not value.replace("_", "").replace("-", "").replace(".", "").replace(" ", "").isalnum():
                raise ValueError(f"LLM observation {field_name} must be a non-empty identifier")


def set_llm_user_context(distinct_id: str) -> None:
    """Tag the current async context with a user ID for PostHog AI tracing."""
    _llm_user_ctx.set(distinct_id)


@contextmanager
def llm_user_context(distinct_id: str):
    """Bind identity to one LLM workflow without leaking it to later work."""
    token = _llm_user_ctx.set(distinct_id)
    try:
        yield
    finally:
        _llm_user_ctx.reset(token)


def _tag_otel_span_with_user() -> None:
    distinct_id = _llm_user_ctx.get()
    if not distinct_id:
        return
    try:
        from opentelemetry import trace as otel_trace  # noqa: PLC0415
        span = otel_trace.get_current_span()
        if span.is_recording():
            span.set_attribute("posthog.distinct_id", distinct_id)
    except Exception:
        pass


@contextmanager
def observe_llm_operation(observation: LLMObservation):
    """Create an AI parent span that groups an auto-instrumented generation.

    The OpenAI instrumentor still owns the authoritative `$ai_generation`
    event (and therefore model, tokens, latency and cost).  This span carries
    product meaning, prompt version and outcome without creating a parallel
    analytics event producer.
    """
    try:
        from opentelemetry import trace as otel_trace  # noqa: PLC0415
        from opentelemetry.trace.status import Status, StatusCode  # noqa: PLC0415

        tracer = otel_trace.get_tracer("hirly.ai_observability")
        attributes = {
            "gen_ai.hirly.operation": observation.operation,
            "gen_ai.hirly.prompt_version": observation.prompt_version,
            "gen_ai.hirly.feature": observation.feature,
            "gen_ai.hirly.actor_scope": observation.actor_scope,
            "gen_ai.hirly.raw_content_retention_days": 30,
        }
        with tracer.start_as_current_span(
            f"gen_ai.hirly.{observation.operation}", attributes=attributes
        ) as span:
            _tag_otel_span_with_user()
            try:
                yield span
            except Exception as exc:
                span.set_attribute("gen_ai.hirly.outcome", "error")
                span.set_attribute("gen_ai.hirly.error_type", type(exc).__name__)
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                raise
            else:
                span.set_attribute("gen_ai.hirly.outcome", "success")
    except ImportError:
        # AI functionality must remain available when optional OTel packages
        # are unavailable (for local/test environments).
        yield None


# Kept as a private compatibility alias while direct callers migrate to the
# explicit public operation boundary above.
_observe_llm_operation = observe_llm_operation


def configure_raw_llm_content_capture() -> bool:
    """Return whether raw *text* should be written to governed parent spans.

    We intentionally do not enable the OpenAI instrumentor's global content
    switch: the vision call includes a base64 data URL, which would upload the
    entire CV image.  This adapter records only textual prompts/completions on
    its product-level span and never records binary image/audio payloads.
    """
    # Fail closed against an inherited deployment setting. The global OpenAI
    # instrumentor would otherwise serialize the vision request's data URL.
    os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "false"
    return (
        os.environ.get("POSTHOG_AI_RAW_CONTENT_ENABLED", "false").strip().lower() == "true"
        and os.environ.get("POSTHOG_AI_RAW_CONTENT_RETENTION_DAYS", "").strip() == "30"
    )


def _record_raw_text(span: Any, attribute: str, value: str) -> None:
    if span is not None and configure_raw_llm_content_capture():
        span.set_attribute(attribute, value)


def build_llm_generation_tag_processor() -> Any:
    """Build an OTel processor that copies governed tags onto child generations.

    Span attributes do not inherit in OpenTelemetry.  Without this processor,
    PostHog can show the product-operation parent span but cannot group the
    child `$ai_generation` cost/latency facts by prompt version or feature.
    Raw input/output deliberately remain parent-only.
    """
    from opentelemetry import trace as otel_trace  # noqa: PLC0415
    from opentelemetry.sdk.trace import SpanProcessor  # noqa: PLC0415

    class HirlyLlmGenerationTagProcessor(SpanProcessor):
        def on_start(self, span: Any, parent_context: Any = None) -> None:
            # The OpenAI v2 instrumentor creates generation spans with this
            # semantic-convention attribute before processors run. Do not tag
            # arbitrary HTTP/DB/internal descendants as AI observations.
            if not (getattr(span, "attributes", None) or {}).get("gen_ai.operation.name"):
                return
            parent = otel_trace.get_current_span(parent_context)
            attributes = getattr(parent, "attributes", None) or {}
            for attribute in _GENERATION_TAG_ATTRIBUTES:
                value = attributes.get(attribute)
                if value is not None:
                    span.set_attribute(attribute, value)

        def on_end(self, span: Any) -> None:
            return None

        def shutdown(self) -> None:
            return None

        def force_flush(self, timeout_millis: int = 30000) -> bool:
            return True

    return HirlyLlmGenerationTagProcessor()


class LLMProviderNotConfigured(RuntimeError):
    pass


def _client() -> AsyncOpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise LLMProviderNotConfigured("AI provider is not configured.")
    return AsyncOpenAI(api_key=api_key)


async def complete_json_text(
    system_message: str,
    prompt: str,
    *,
    observation: Optional[LLMObservation] = None,
) -> str:
    observation = observation or LLMObservation(
        operation="unclassified_json_completion",
        prompt_version="v1",
        feature="unclassified",
        actor_scope="unknown",
    )
    with _observe_llm_operation(observation) as span:
        _record_raw_text(span, "gen_ai.hirly.raw_input", f"SYSTEM:\n{system_message}\n\nUSER:\n{prompt}")
        client = _client()
        response = await client.chat.completions.create(
            model=os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": prompt},
            ],
        )
        output = response.choices[0].message.content or ""
        _record_raw_text(span, "gen_ai.hirly.raw_output", output)
        return output


def _chat_output_token_kwargs(limit: int) -> Dict[str, int]:
    """Newer OpenAI models reject ``max_tokens``; use ``max_completion_tokens``."""
    return {"max_completion_tokens": int(limit)}


async def extract_text_from_image_bytes(
    content: bytes,
    mime: str = "image/png",
    *,
    observation: Optional[LLMObservation] = None,
) -> str:
    """OCR-style plain-text extraction from a resume image via vision."""
    import base64

    observation = observation or LLMObservation(
        operation="cv_image_text_extraction",
        prompt_version="v1",
        feature="cv_upload",
    )
    b64 = base64.b64encode(content).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    instruction = (
        "Extract all text from this resume/CV image or PDF page scan. "
        "The image may be slightly blurry — still transcribe every readable word. "
        "Return plain text only, preserving headings and bullet structure. "
        "No commentary."
    )
    with _observe_llm_operation(observation) as span:
        _record_raw_text(span, "gen_ai.hirly.raw_input", instruction)
        client = _client()
        response = await client.chat.completions.create(
            model=os.environ.get("OPENAI_VISION_MODEL", os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")),
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": instruction,
                        },
                        {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                    ],
                }
            ],
            **_chat_output_token_kwargs(4096),
        )
        output = (response.choices[0].message.content or "").strip()
        _record_raw_text(span, "gen_ai.hirly.raw_output", output)
        return output


async def transcribe_audio_bytes(
    content: bytes,
    filename: str = "audio.mp3",
    *,
    observation: Optional[LLMObservation] = None,
) -> Dict[str, Any]:
    """Speech-to-text transcription with segment-level timestamps (for step alignment)."""
    observation = observation or LLMObservation(
        operation="recording_transcription",
        prompt_version="v1",
        feature="recording_tools",
    )
    with _observe_llm_operation(observation) as span:
        client = _client()
        buffer = io.BytesIO(content)
        buffer.name = filename or "audio.mp3"
        response = await client.audio.transcriptions.create(
            model=os.environ.get("OPENAI_TRANSCRIBE_MODEL", "whisper-1"),
            file=buffer,
            response_format="verbose_json",
        )
        dump = response.model_dump() if hasattr(response, "model_dump") else dict(response)
        result = {
            "text": dump.get("text") or "",
            "segments": [
                {
                    "start": seg.get("start"),
                    "end": seg.get("end"),
                    "text": (seg.get("text") or "").strip(),
                }
                for seg in (dump.get("segments") or [])
            ],
        }
        _record_raw_text(span, "gen_ai.hirly.raw_output", result["text"])
        return result
