from __future__ import annotations

import json
import os
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

import sqlite3

from .db import apply_wallet_usage, get_or_create_wallet, insert_model_call_log
from .model_client import ModelCallResult, ModelUsage


DEFAULT_INITIAL_CENTS = 1000
DEFAULT_INITIAL_TOKENS = 1_000_000


class WalletInsufficientCreditError(RuntimeError):
    def __init__(self, balance_cents: int, balance_tokens: int) -> None:
        self.balance_cents = balance_cents
        self.balance_tokens = balance_tokens
        super().__init__(f"Wallet balance is insufficient: {balance_cents} cents, {balance_tokens} tokens")


@dataclass(frozen=True)
class UsageAccounting:
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    usage_source: str
    cost_cents: int
    pricing_source: str


def initial_wallet_cents() -> int:
    return _env_int("DEFAULT_WALLET_INITIAL_CENTS", DEFAULT_INITIAL_CENTS)


def initial_wallet_tokens() -> int:
    return _env_int("DEFAULT_WALLET_INITIAL_TOKENS", DEFAULT_INITIAL_TOKENS)


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def wallet_public_view(wallet: dict) -> dict:
    return {
        "userId": wallet["user_id"],
        "balanceCents": wallet["balance_cents"],
        "balanceTokens": wallet["balance_tokens"],
        "initialCents": initial_wallet_cents(),
        "initialTokens": initial_wallet_tokens(),
        "canCallApi": wallet["balance_cents"] > 0,
        "createdAt": wallet["created_at"],
        "updatedAt": wallet["updated_at"],
    }


def ensure_wallet(conn: sqlite3.Connection, user_id: str) -> dict:
    return get_or_create_wallet(
        conn,
        user_id,
        initial_cents=initial_wallet_cents(),
        initial_tokens=initial_wallet_tokens(),
    )


def ensure_wallet_has_credit(conn: sqlite3.Connection, user_id: str) -> dict:
    wallet = ensure_wallet(conn, user_id)
    if wallet["balance_cents"] <= 0:
        raise WalletInsufficientCreditError(wallet["balance_cents"], wallet["balance_tokens"])
    return wallet


def estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, len(text) // 4)


def estimate_message_tokens(messages: list[dict]) -> int:
    total = 0
    for message in messages:
        total += estimate_tokens(str(message.get("content", "")))
    return total


def usage_from_result(
    result: ModelCallResult,
    *,
    messages: list[dict],
    output_text: str | None = None,
) -> tuple[int, int, int, str]:
    output = result.content if output_text is None else output_text
    return usage_from_provider_or_estimate(result.usage, messages=messages, output_text=output)


def usage_from_provider_or_estimate(
    usage: ModelUsage | None,
    *,
    messages: list[dict],
    output_text: str,
) -> tuple[int, int, int, str]:
    if usage and usage.total_tokens is not None:
        prompt_tokens = usage.prompt_tokens if usage.prompt_tokens is not None else estimate_message_tokens(messages)
        completion_tokens = (
            usage.completion_tokens if usage.completion_tokens is not None else max(0, usage.total_tokens - prompt_tokens)
        )
        return prompt_tokens, completion_tokens, usage.total_tokens, "provider"

    prompt_tokens = estimate_message_tokens(messages)
    completion_tokens = estimate_tokens(output_text)
    return prompt_tokens, completion_tokens, prompt_tokens + completion_tokens, "estimated"


def pricing_for_model(model_name: str | None) -> tuple[dict | None, str]:
    raw = os.getenv("MODEL_PRICING_JSON", "").strip()
    if not raw:
        return None, "missing"
    try:
        pricing = json.loads(raw)
    except json.JSONDecodeError:
        return None, "invalid"
    if not isinstance(pricing, dict):
        return None, "invalid"
    model_pricing = pricing.get(model_name or "") or pricing.get("default")
    if not isinstance(model_pricing, dict):
        return None, "missing"
    return model_pricing, "env"


def calculate_cost_cents(model_name: str | None, prompt_tokens: int, completion_tokens: int) -> tuple[int, str]:
    pricing, source = pricing_for_model(model_name)
    if not pricing:
        return 0, source

    input_cents_per_million = _decimal_value(pricing.get("input_cents_per_million_tokens"))
    output_cents_per_million = _decimal_value(pricing.get("output_cents_per_million_tokens"))
    if input_cents_per_million is None or output_cents_per_million is None:
        return 0, "invalid"

    cost = (
        Decimal(prompt_tokens) * input_cents_per_million
        + Decimal(completion_tokens) * output_cents_per_million
    ) / Decimal(1_000_000)
    return int(cost.quantize(Decimal("1"), rounding=ROUND_HALF_UP)), source


def _decimal_value(value: object) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def build_accounting(
    *,
    model_name: str | None,
    usage: ModelUsage | None,
    messages: list[dict],
    output_text: str,
) -> UsageAccounting:
    prompt_tokens, completion_tokens, total_tokens, usage_source = usage_from_provider_or_estimate(
        usage,
        messages=messages,
        output_text=output_text,
    )
    cost_cents, pricing_source = calculate_cost_cents(model_name, prompt_tokens, completion_tokens)
    return UsageAccounting(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        usage_source=usage_source,
        cost_cents=cost_cents,
        pricing_source=pricing_source,
    )


def record_successful_model_usage(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    call_type: str,
    model_name: str | None,
    thinking_mode: str | None = None,
    messages: list[dict],
    output_text: str,
    usage: ModelUsage | None = None,
    notebook_id: str | None = None,
    node_id: str | None = None,
    task_id: str | None = None,
    step_id: str | None = None,
    context_chars: int | None = None,
    web_search_enabled: bool = False,
    search_result_count: int = 0,
    fetched_page_count: int = 0,
    source_count: int = 0,
    evidence_count: int = 0,
    latency_ms: int | None = None,
    error_message: str | None = None,
) -> dict:
    accounting = build_accounting(model_name=model_name, usage=usage, messages=messages, output_text=output_text)
    input_chars = sum(len(str(message.get("content", ""))) for message in messages)
    log = insert_model_call_log(
        conn,
        user_id=user_id,
        notebook_id=notebook_id,
        node_id=node_id,
        task_id=task_id,
        step_id=step_id,
        call_type=call_type,
        model_name=model_name,
        thinking_mode=thinking_mode,
        input_chars=input_chars,
        output_chars=len(output_text),
        estimated_input_tokens=estimate_message_tokens(messages),
        estimated_output_tokens=estimate_tokens(output_text),
        prompt_tokens=accounting.prompt_tokens,
        completion_tokens=accounting.completion_tokens,
        total_tokens=accounting.total_tokens,
        usage_source=accounting.usage_source,
        cost_cents=accounting.cost_cents,
        pricing_source=accounting.pricing_source,
        context_chars=context_chars,
        web_search_enabled=web_search_enabled,
        search_result_count=search_result_count,
        fetched_page_count=fetched_page_count,
        source_count=source_count,
        evidence_count=evidence_count,
        latency_ms=latency_ms,
        success=True,
        error_message=error_message,
    )
    apply_wallet_usage(
        conn,
        user_id=user_id,
        delta_cents=-accounting.cost_cents,
        delta_tokens=-accounting.total_tokens,
        source="model_call",
        model_call_log_id=log["id"],
        reason=call_type,
        initial_cents=initial_wallet_cents(),
        initial_tokens=initial_wallet_tokens(),
    )
    return log
