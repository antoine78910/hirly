"""Internal OpenAI LLM adapter for structured JSON responses."""

import os

from openai import AsyncOpenAI


class LLMProviderNotConfigured(RuntimeError):
    pass


def _client() -> AsyncOpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise LLMProviderNotConfigured("AI provider is not configured.")
    return AsyncOpenAI(api_key=api_key)


async def complete_json_text(system_message: str, prompt: str) -> str:
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


async def extract_text_from_image_bytes(content: bytes, mime: str = "image/png") -> str:
    """OCR-style plain-text extraction from a resume image via vision."""
    import base64

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
                            "Extract all text from this resume/CV image. "
                            "Return plain text only, preserving headings and bullet structure. "
                            "No commentary."
                        ),
                    },
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
        max_tokens=4096,
    )
    return (response.choices[0].message.content or "").strip()
