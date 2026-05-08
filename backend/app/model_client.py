from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


class ModelConfigurationError(RuntimeError):
    pass


class ModelProviderError(RuntimeError):
    pass


def _chat_completions_url() -> str:
    explicit_url = os.getenv("MODEL_CHAT_COMPLETIONS_URL")
    if explicit_url:
        return explicit_url
    base_url = os.getenv("MODEL_BASE_URL", "https://api.deepseek.com").rstrip("/")
    return f"{base_url}/chat/completions"


def call_model(messages: list[dict[str, str]]) -> str:
    api_key = os.getenv("MODEL_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ModelConfigurationError(
            "MODEL_API_KEY is not configured. Copy backend/.env.example to backend/.env and set a real OpenAI-compatible API key."
        )

    payload = {
        "model": os.getenv("MODEL_NAME", "deepseek-v4-flash"),
        "messages": messages,
        "temperature": float(os.getenv("MODEL_TEMPERATURE", "0.3")),
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        _chat_completions_url(),
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=float(os.getenv("MODEL_TIMEOUT", "60"))) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ModelProviderError(f"Model provider returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ModelProviderError(f"Model provider request failed: {exc.reason}") from exc

    try:
        parsed = json.loads(body)
        return parsed["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
        raise ModelProviderError(f"Unexpected model provider response: {body[:500]}") from exc
