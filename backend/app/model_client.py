from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

DEEPSEEK_MODEL_NAMES = {"deepseek-v4-flash", "deepseek-v4-pro"}
DEEPSEEK_THINKING_MODES = {"fast", "deep", "challenge"}
DEFAULT_MODEL_NAME = "deepseek-v4-flash"
DEFAULT_THINKING_MODE = "deep"
THINKING_MODE_CONFIG = {
    "fast": {"type": "disabled"},
    "deep": {"type": "enabled", "reasoning_effort": "high"},
    "challenge": {"type": "enabled", "reasoning_effort": "max"},
}


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


def resolve_model_name(model_name: str | None = None) -> str:
    if model_name is None:
        return os.getenv("MODEL_NAME", DEFAULT_MODEL_NAME)
    if model_name not in DEEPSEEK_MODEL_NAMES:
        raise ModelConfigurationError(
            f"Unsupported model '{model_name}'. Choose one of: {', '.join(sorted(DEEPSEEK_MODEL_NAMES))}."
        )
    return model_name


def resolve_thinking_mode(thinking_mode: str | None = None) -> str:
    if thinking_mode is None:
        return os.getenv("MODEL_THINKING_MODE", DEFAULT_THINKING_MODE)
    if thinking_mode not in DEEPSEEK_THINKING_MODES:
        raise ModelConfigurationError(
            f"Unsupported thinking mode '{thinking_mode}'. Choose one of: {', '.join(sorted(DEEPSEEK_THINKING_MODES))}."
        )
    return thinking_mode


def build_model_payload(
    messages: list[dict[str, str]],
    model_name: str | None = None,
    thinking_mode: str | None = None,
    stream: bool = False,
) -> dict:
    resolved_thinking_mode = resolve_thinking_mode(thinking_mode)
    thinking_config = THINKING_MODE_CONFIG[resolved_thinking_mode]
    payload = {
        "model": resolve_model_name(model_name),
        "messages": messages,
        "thinking": {"type": thinking_config["type"]},
    }
    if stream:
        payload["stream"] = True
    if thinking_config["type"] == "enabled":
        payload["reasoning_effort"] = thinking_config["reasoning_effort"]
    else:
        payload["temperature"] = float(os.getenv("MODEL_TEMPERATURE", "0.3"))
    return payload


def call_model(messages: list[dict[str, str]], model_name: str | None = None, thinking_mode: str | None = None) -> str:
    api_key = os.getenv("MODEL_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ModelConfigurationError(
            "MODEL_API_KEY is not configured. Copy backend/.env.example to backend/.env and set a real OpenAI-compatible API key."
        )

    payload = build_model_payload(messages, model_name, thinking_mode)
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


def stream_model(messages: list[dict[str, str]], model_name: str | None = None, thinking_mode: str | None = None):
    api_key = os.getenv("MODEL_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise ModelConfigurationError(
            "MODEL_API_KEY is not configured. Copy backend/.env.example to backend/.env and set a real OpenAI-compatible API key."
        )

    payload = build_model_payload(messages, model_name, thinking_mode, stream=True)
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
        response = urllib.request.urlopen(request, timeout=float(os.getenv("MODEL_TIMEOUT", "60")))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise ModelProviderError(f"Model provider returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise ModelProviderError(f"Model provider request failed: {exc.reason}") from exc

    with response:
        for raw_line in response:
            line = raw_line.decode("utf-8", errors="replace").strip()
            if not line or not line.startswith("data:"):
                continue
            data_line = line[5:].strip()
            if data_line == "[DONE]":
                break
            try:
                parsed = json.loads(data_line)
            except json.JSONDecodeError as exc:
                raise ModelProviderError(f"Unexpected model stream frame: {data_line[:500]}") from exc
            delta = parsed.get("choices", [{}])[0].get("delta", {}).get("content")
            if delta:
                yield delta
