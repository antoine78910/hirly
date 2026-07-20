"""Internal OpenAI LLM adapter for structured JSON responses."""

import contextvars
import io
import os
from typing import Any, Dict, Optional

from openai import AsyncOpenAI

# Set this before any LLM call in a request context so PostHog AI observability
# can associate $ai_generation events with the correct user.
_llm_user_ctx: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "llm_user_ctx", default=None
)


def set_llm_user_context(distinct_id: str) -> None:
    """Tag the current async context with a user ID for PostHog AI tracing."""
    _llm_user_ctx.set(distinct_id)


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


class LLMProviderNotConfigured(RuntimeError):
    pass


def _client() -> AsyncOpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise LLMProviderNotConfigured("AI provider is not configured.")
    return AsyncOpenAI(api_key=api_key)


async def complete_json_text(system_message: str, prompt: str) -> str:
    _tag_otel_span_with_user()
    client = _client()
    response = await client.chat.completions.create(
        model=os.environ.get("OPENAI_MODEL", "gpt-4.1-mini"),
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_message},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content or ""


def _chat_output_token_kwargs(limit: int) -> Dict[str, int]:
    """Newer OpenAI models reject ``max_tokens``; use ``max_completion_tokens``."""
    return {"max_completion_tokens": int(limit)}


async def extract_text_from_image_bytes(content: bytes, mime: str = "image/png") -> str:
    """OCR-style plain-text extraction from a resume image via vision."""
    import base64

    _tag_otel_span_with_user()
    client = _client()
    b64 = base64.b64encode(content).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"
    response = await client.chat.completions.create(
        model=os.environ.get("OPENAI_VISION_MODEL", os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")),
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            "Extract all text from this resume/CV image or PDF page scan. "
                            "The image may be slightly blurry — still transcribe every readable word. "
                            "Return plain text only, preserving headings and bullet structure. "
                            "No commentary."
                        ),
                    },
                    {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                ],
            }
        ],
        **_chat_output_token_kwargs(4096),
    )
    return (response.choices[0].message.content or "").strip()


async def transcribe_audio_bytes(content: bytes, filename: str = "audio.mp3") -> Dict[str, Any]:
    """Speech-to-text transcription with segment-level timestamps (for step alignment)."""
    client = _client()
    buffer = io.BytesIO(content)
    buffer.name = filename or "audio.mp3"
    response = await client.audio.transcriptions.create(
        model=os.environ.get("OPENAI_TRANSCRIBE_MODEL", "whisper-1"),
        file=buffer,
        response_format="verbose_json",
    )
    dump = response.model_dump() if hasattr(response, "model_dump") else dict(response)
    return {
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
