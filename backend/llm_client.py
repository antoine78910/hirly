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
