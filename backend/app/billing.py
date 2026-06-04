from __future__ import annotations

import json
import os
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

import sqlite3

from .db import MICRO_CENTS_PER_CENT, apply_wallet_usage, get_or_create_wallet, insert_model_call_log, micro_cents_to_display_cents
from .model_client import ModelCallResult, ModelConfigurationError, ModelUsage


DEFAULT_INITIAL_CENTS = 1000
DEFAULT_INITIAL_TOKENS = 1_000_000
ADMIN_INITIAL_CENTS = 1000
ADMIN_INITIAL_TOKENS = 10_000_000
DEFAULT_USD_TO_CNY_RATE = Decimal("7.20")
DEFAULT_MODEL_PRICING_USD = {
    "deepseek-chat": {
        "provider": "deepseek",
        "cache_hit_usd_per_million_tokens": "0.07",
        "cache_miss_usd_per_million_tokens": "0.27",
        "output_usd_per_million_tokens": "1.10",
    },
    "deepseek-reasoner": {
        "provider": "deepseek",
        "cache_hit_usd_per_million_tokens": "0.14",
        "cache_miss_usd_per_million_tokens": "0.55",
        "output_usd_per_million_tokens": "2.19",
    },
    "qwen2.5-vl-7b-instruct": {
        "provider": "qwen",
        "input_usd_per_million_tokens": "0.287",
        "output_usd_per_million_tokens": "0.717",
    },
}
MODEL_PRICE_ALIASES = {
    "deepseek-v4-flash": "deepseek-chat",
    "deepseek-v4-pro": "deepseek-reasoner",
    "Qwen/Qwen2.5-VL-7B-Instruct": "qwen2.5-vl-7b-instruct",
}


class WalletInsufficientCreditError(RuntimeError):
    def __init__(self, balance_cents: int, balance_tokens: int, balance_micro_cents: int | None = None) -> None:
        self.balance_cents = balance_cents
        self.balance_micro_cents = balance_micro_cents if balance_micro_cents is not None else balance_cents * MICRO_CENTS_PER_CENT
        self.balance_tokens = balance_tokens
        super().__init__(f"Wallet balance is insufficient: {balance_cents} cents, {balance_tokens} tokens")


@dataclass(frozen=True)
class UsageAccounting:
    prompt_tokens: int
    prompt_cache_hit_tokens: int | None
    prompt_cache_miss_tokens: int | None
    completion_tokens: int
    total_tokens: int
    usage_source: str
    cost_cents: int
    cost_micro_cents: int
    pricing_source: str


def initial_wallet_cents() -> int:
    return _env_int("DEFAULT_WALLET_INITIAL_CENTS", DEFAULT_INITIAL_CENTS)


def initial_wallet_tokens() -> int:
    return _env_int("DEFAULT_WALLET_INITIAL_TOKENS", DEFAULT_INITIAL_TOKENS)


def admin_wallet_cents() -> int:
    return _env_int("ADMIN_WALLET_INITIAL_CENTS", ADMIN_INITIAL_CENTS)


def admin_wallet_tokens() -> int:
    return _env_int("ADMIN_WALLET_INITIAL_TOKENS", ADMIN_INITIAL_TOKENS)


def wallet_quota_for_user(conn: sqlite3.Connection, user_id: str) -> tuple[int, int]:
    row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user_id,)).fetchone()
    is_admin = bool(row and row["is_admin"])
    if is_admin:
        return admin_wallet_cents(), admin_wallet_tokens()
    return initial_wallet_cents(), initial_wallet_tokens()


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


def wallet_public_view(wallet: dict, *, initial_cents: int | None = None, initial_tokens: int | None = None) -> dict:
    public_initial_cents = initial_wallet_cents() if initial_cents is None else initial_cents
    public_initial_tokens = initial_wallet_tokens() if initial_tokens is None else initial_tokens
    return {
        "userId": wallet["user_id"],
        "balanceCents": wallet["balance_cents"],
        "balanceMicroCents": wallet["balance_micro_cents"],
        "balanceTokens": wallet["balance_tokens"],
        "initialCents": public_initial_cents,
        "initialMicroCents": public_initial_cents * MICRO_CENTS_PER_CENT,
        "initialTokens": public_initial_tokens,
        "canCallApi": wallet["balance_tokens"] > 0 or wallet["balance_micro_cents"] > 0,
        "createdAt": wallet["created_at"],
        "updatedAt": wallet["updated_at"],
    }


def ensure_wallet(conn: sqlite3.Connection, user_id: str) -> dict:
    initial_cents, initial_tokens = wallet_quota_for_user(conn, user_id)
    return get_or_create_wallet(
        conn,
        user_id,
        initial_cents=initial_cents,
        initial_tokens=initial_tokens,
    )


def ensure_wallet_has_credit(conn: sqlite3.Connection, user_id: str) -> dict:
    wallet = ensure_wallet(conn, user_id)
    if wallet["balance_tokens"] <= 0 and wallet["balance_micro_cents"] <= 0:
        raise WalletInsufficientCreditError(wallet["balance_cents"], wallet["balance_tokens"], wallet["balance_micro_cents"])
    return wallet


def ensure_wallet_can_charge_model(conn: sqlite3.Connection, user_id: str, model_name: str | None = None) -> dict:
    wallet = ensure_wallet_has_credit(conn, user_id)
    if wallet["balance_tokens"] <= 0 and wallet["balance_micro_cents"] > 0:
        pricing, source = pricing_for_model(model_name)
        if not pricing or source in {"missing", "invalid"}:
            raise ModelConfigurationError(f"Missing wallet pricing for model '{model_name or 'default'}'.")
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
) -> tuple[int, int | None, int | None, int, int, str]:
    output = result.content if output_text is None else output_text
    return usage_from_provider_or_estimate(result.usage, messages=messages, output_text=output)


def usage_from_provider_or_estimate(
    usage: ModelUsage | None,
    *,
    messages: list[dict],
    output_text: str,
) -> tuple[int, int | None, int | None, int, int, str]:
    if usage and usage.total_tokens is not None:
        prompt_tokens = usage.prompt_tokens if usage.prompt_tokens is not None else estimate_message_tokens(messages)
        completion_tokens = (
            usage.completion_tokens if usage.completion_tokens is not None else max(0, usage.total_tokens - prompt_tokens)
        )
        return (
            prompt_tokens,
            usage.prompt_cache_hit_tokens,
            usage.prompt_cache_miss_tokens,
            completion_tokens,
            usage.total_tokens,
            "provider",
        )

    prompt_tokens = estimate_message_tokens(messages)
    completion_tokens = estimate_tokens(output_text)
    return prompt_tokens, None, None, completion_tokens, prompt_tokens + completion_tokens, "estimated"


def pricing_for_model(model_name: str | None) -> tuple[dict | None, str]:
    resolved_model_name = MODEL_PRICE_ALIASES.get(model_name or "", model_name or "")
    raw = os.getenv("MODEL_PRICING_JSON", "").strip()
    if raw:
        try:
            pricing = json.loads(raw)
        except json.JSONDecodeError:
            return None, "invalid"
        if not isinstance(pricing, dict):
            return None, "invalid"
        model_pricing = pricing.get(model_name or "") or pricing.get(resolved_model_name) or pricing.get("default")
        if isinstance(model_pricing, dict):
            return model_pricing, "env"

    model_pricing = DEFAULT_MODEL_PRICING_USD.get(resolved_model_name)
    if not isinstance(model_pricing, dict):
        return None, "missing"
    return model_pricing, "builtin"


def usd_per_million_to_cents(value: object) -> Decimal | None:
    decimal_value = _decimal_value(value)
    if decimal_value is None:
        return None
    return decimal_value * usd_to_cny_rate() * Decimal(100)


def usd_to_cny_rate() -> Decimal:
    value = _decimal_value(os.getenv("USD_TO_CNY_RATE"))
    return value if value is not None and value > 0 else DEFAULT_USD_TO_CNY_RATE


def price_cents_per_million(pricing: dict, cents_key: str, usd_key: str) -> Decimal | None:
    cents = _decimal_value(pricing.get(cents_key))
    if cents is not None:
        return cents
    return usd_per_million_to_cents(pricing.get(usd_key))


def calculate_cost_micro_cents(
    model_name: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    *,
    prompt_cache_hit_tokens: int | None = None,
    prompt_cache_miss_tokens: int | None = None,
) -> tuple[int, str]:
    pricing, source = pricing_for_model(model_name)
    if not pricing:
        return 0, source

    output_cents_per_million = price_cents_per_million(
        pricing,
        "output_cents_per_million_tokens",
        "output_usd_per_million_tokens",
    )
    provider = str(pricing.get("provider", "")).lower()
    if provider == "deepseek" or "cache_miss_usd_per_million_tokens" in pricing or "cache_miss_cents_per_million_tokens" in pricing:
        cache_hit_cents_per_million = price_cents_per_million(
            pricing,
            "cache_hit_cents_per_million_tokens",
            "cache_hit_usd_per_million_tokens",
        )
        cache_miss_cents_per_million = price_cents_per_million(
            pricing,
            "cache_miss_cents_per_million_tokens",
            "cache_miss_usd_per_million_tokens",
        )
        if cache_hit_cents_per_million is None or cache_miss_cents_per_million is None or output_cents_per_million is None:
            return 0, "invalid"
        if prompt_cache_hit_tokens is None and prompt_cache_miss_tokens is None:
            cache_hit_tokens = 0
            cache_miss_tokens = prompt_tokens
        else:
            cache_hit_tokens = max(0, prompt_cache_hit_tokens or 0)
            cache_miss_tokens = max(0, prompt_cache_miss_tokens or 0)
            missing_prompt_tokens = max(0, prompt_tokens - cache_hit_tokens - cache_miss_tokens)
            cache_miss_tokens += missing_prompt_tokens
        cost = (
            Decimal(cache_hit_tokens) * cache_hit_cents_per_million
            + Decimal(cache_miss_tokens) * cache_miss_cents_per_million
            + Decimal(completion_tokens) * output_cents_per_million
        ) / Decimal(1_000_000)
        micro_cost = cost * Decimal(MICRO_CENTS_PER_CENT)
        return int(micro_cost.quantize(Decimal("1"), rounding=ROUND_HALF_UP)), source

    input_cents_per_million = price_cents_per_million(
        pricing,
        "input_cents_per_million_tokens",
        "input_usd_per_million_tokens",
    )
    if input_cents_per_million is None or output_cents_per_million is None:
        return 0, "invalid"

    cost = (Decimal(prompt_tokens) * input_cents_per_million + Decimal(completion_tokens) * output_cents_per_million) / Decimal(1_000_000)
    micro_cost = cost * Decimal(MICRO_CENTS_PER_CENT)
    return int(micro_cost.quantize(Decimal("1"), rounding=ROUND_HALF_UP)), source


def calculate_cost_cents(
    model_name: str | None,
    prompt_tokens: int,
    completion_tokens: int,
    *,
    prompt_cache_hit_tokens: int | None = None,
    prompt_cache_miss_tokens: int | None = None,
) -> tuple[int, str]:
    cost_micro_cents, pricing_source = calculate_cost_micro_cents(
        model_name,
        prompt_tokens,
        completion_tokens,
        prompt_cache_hit_tokens=prompt_cache_hit_tokens,
        prompt_cache_miss_tokens=prompt_cache_miss_tokens,
    )
    return micro_cents_to_display_cents(cost_micro_cents), pricing_source


def calculate_paid_cost_micro_cents(
    *,
    model_name: str | None,
    prompt_tokens: int,
    prompt_cache_hit_tokens: int | None,
    prompt_cache_miss_tokens: int | None,
    completion_tokens: int,
    total_tokens: int,
    paid_tokens: int,
) -> tuple[int, str]:
    if paid_tokens <= 0:
        return 0, "free_tokens"
    if total_tokens <= 0:
        return 0, "missing"
    full_cost_micro_cents, pricing_source = calculate_cost_micro_cents(
        model_name,
        prompt_tokens,
        completion_tokens,
        prompt_cache_hit_tokens=prompt_cache_hit_tokens,
        prompt_cache_miss_tokens=prompt_cache_miss_tokens,
    )
    if pricing_source in {"missing", "invalid"}:
        raise ModelConfigurationError(f"Missing wallet pricing for model '{model_name or 'default'}'.")
    paid_cost = (Decimal(full_cost_micro_cents) * Decimal(paid_tokens)) / Decimal(total_tokens)
    return int(paid_cost.quantize(Decimal("1"), rounding=ROUND_HALF_UP)), pricing_source


def calculate_paid_cost_cents(
    *,
    model_name: str | None,
    prompt_tokens: int,
    prompt_cache_hit_tokens: int | None,
    prompt_cache_miss_tokens: int | None,
    completion_tokens: int,
    total_tokens: int,
    paid_tokens: int,
) -> tuple[int, str]:
    paid_cost_micro_cents, pricing_source = calculate_paid_cost_micro_cents(
        model_name=model_name,
        prompt_tokens=prompt_tokens,
        prompt_cache_hit_tokens=prompt_cache_hit_tokens,
        prompt_cache_miss_tokens=prompt_cache_miss_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        paid_tokens=paid_tokens,
    )
    return micro_cents_to_display_cents(paid_cost_micro_cents), pricing_source


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
    prompt_tokens, prompt_cache_hit_tokens, prompt_cache_miss_tokens, completion_tokens, total_tokens, usage_source = usage_from_provider_or_estimate(
        usage,
        messages=messages,
        output_text=output_text,
    )
    cost_micro_cents, pricing_source = calculate_cost_micro_cents(
        model_name,
        prompt_tokens,
        completion_tokens,
        prompt_cache_hit_tokens=prompt_cache_hit_tokens,
        prompt_cache_miss_tokens=prompt_cache_miss_tokens,
    )
    cost_cents = micro_cents_to_display_cents(cost_micro_cents)
    return UsageAccounting(
        prompt_tokens=prompt_tokens,
        prompt_cache_hit_tokens=prompt_cache_hit_tokens,
        prompt_cache_miss_tokens=prompt_cache_miss_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        usage_source=usage_source,
        cost_cents=cost_cents,
        cost_micro_cents=cost_micro_cents,
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
    initial_cents, initial_tokens = wallet_quota_for_user(conn, user_id)
    wallet = get_or_create_wallet(
        conn,
        user_id,
        initial_cents=initial_cents,
        initial_tokens=initial_tokens,
    )
    free_tokens_applied = min(max(int(wallet["balance_tokens"]), 0), accounting.total_tokens)
    paid_tokens = max(0, accounting.total_tokens - free_tokens_applied)
    paid_cost_micro_cents, pricing_source = calculate_paid_cost_micro_cents(
        model_name=model_name,
        prompt_tokens=accounting.prompt_tokens,
        prompt_cache_hit_tokens=accounting.prompt_cache_hit_tokens,
        prompt_cache_miss_tokens=accounting.prompt_cache_miss_tokens,
        completion_tokens=accounting.completion_tokens,
        total_tokens=accounting.total_tokens,
        paid_tokens=paid_tokens,
    )
    paid_cost_cents = micro_cents_to_display_cents(paid_cost_micro_cents)
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
        prompt_cache_hit_tokens=accounting.prompt_cache_hit_tokens,
        prompt_cache_miss_tokens=accounting.prompt_cache_miss_tokens,
        completion_tokens=accounting.completion_tokens,
        total_tokens=accounting.total_tokens,
        usage_source=accounting.usage_source,
        cost_cents=paid_cost_cents,
        cost_micro_cents=paid_cost_micro_cents,
        pricing_source=pricing_source,
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
        delta_cents=-paid_cost_cents,
        delta_micro_cents=-paid_cost_micro_cents,
        delta_tokens=-free_tokens_applied,
        source="model_call",
        model_call_log_id=log["id"],
        reason=call_type,
        initial_cents=initial_cents,
        initial_tokens=initial_tokens,
    )
    return log
