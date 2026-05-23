from __future__ import annotations

import os
import sqlite3

from .db import get_parent_chain
from .effective_context import list_effective_messages
from .web_search import classify_source_url, select_relevant_evidence


SYSTEM_PROMPT = """你是 TreeLearn 的学习助手。
你的任务不是闲聊，而是根据树状学习上下文回答当前节点的问题。
优先使用提供的根节点、父节点和当前节点上下文；当上下文不足时，明确说明你在补充通用知识。
回答要围绕当前局部问题，避免把兄弟分支或无关历史当成主线事实。"""


def _model_identity_context(model_name: str | None = None) -> str:
    model_name = model_name or os.getenv("MODEL_NAME", "deepseek-v4-flash")
    base_url = os.getenv("MODEL_BASE_URL", "https://api.deepseek.com")
    return (
        "运行配置:\n"
        f"- 当前后端接入的模型名: {model_name}\n"
        f"- 当前模型 API base URL: {base_url}\n"
        "- 当用户询问你使用哪个模型时，按上述后端配置回答；不要猜测或编造更底层的模型身份。"
    )


def _recent_turns(conn: sqlite3.Connection, node_id: str, limit: int, before_created_at: str | None = None) -> list[dict]:
    return list_effective_messages(
        conn,
        node_id,
        limit=limit,
        before_created_at=before_created_at,
        ascending=False,
    )


def _format_turns(rows: list[dict]) -> str:
    if not rows:
        return "无"
    labels = {"user": "用户", "assistant": "助手"}
    return "\n".join(f"- {labels.get(row['role'], row['role'])}: {row['content']}" for row in rows)


def _summary_text(row: sqlite3.Row) -> str:
    summary = row["summary"] or "无"
    if row["summary_stale"]:
        return f"{summary}\n[提示] 该摘要可能基于回填前内容生成，不能当作完全可靠上下文。"
    return summary


def _format_web_evidence(web_sources: list[dict] | None, user_query: str | None = None) -> str:
    if not web_sources:
        return ""
    evidence_blocks = []
    for index, source in enumerate(web_sources[:3], start=1):
        content = (source.get("content") or "").strip()
        snippet = (source.get("snippet") or "").strip()
        source_type = source.get("source_type")
        trust_level = source.get("trust_level")
        if not source_type or not trust_level:
            source_type, trust_level, _ = classify_source_url(str(source.get("url") or ""))
        relevant_evidence = select_relevant_evidence(
            content or snippet,
            user_query or f"{source.get('title') or ''} {snippet}",
            max_paragraphs=2,
            max_chars=2400,
        )
        evidence_blocks.append(
            "\n".join(
                [
                    f"[S{index}]",
                    f"Title: {source.get('title') or 'Untitled'}",
                    f"URL: {source.get('url') or ''}",
                    f"Source Type: {source_type}",
                    f"Trust Level: {trust_level}",
                    f"Snippet: {snippet or 'None'}",
                    "Relevant Evidence:",
                    relevant_evidence or "无可用正文",
                ]
            )
        )
    return (
        "\n\n[Web Evidence - Use First]\n\n"
        "The following sources were retrieved for the current user question.\n"
        "Use these sources when relevant.\n"
        "If the evidence is insufficient, explicitly say the evidence is insufficient.\n"
        "When using a source, cite it as [S1], [S2], etc.\n\n"
        + "\n\n".join(evidence_blocks)
    )


def build_model_messages(
    conn: sqlite3.Connection,
    node_id: str,
    before_created_at: str | None = None,
    model_name: str | None = None,
    web_sources: list[dict] | None = None,
    user_query: str | None = None,
) -> list[dict[str, str]]:
    chain = get_parent_chain(conn, node_id)
    if not chain:
        raise ValueError(f"Node not found: {node_id}")

    root = chain[0]
    current = chain[-1]
    parent = chain[-2] if len(chain) > 1 else None

    path = " / ".join(row["title"] for row in chain)
    context_lines = [
        f"当前路径: {path}",
        f"根节点标题: {root['title']}",
        f"根节点摘要: {_summary_text(root)}",
        f"当前节点标题: {current['title']}",
        f"当前节点摘要: {_summary_text(current)}",
        f"当前节点上下文模式: {current['context_mode']}",
    ]

    if parent:
        context_lines.extend(
            [
                f"父节点标题: {parent['title']}",
                f"父节点摘要: {_summary_text(parent)}",
                f"父节点触发片段 selectedText: {current['selected_text'] or parent['selected_text'] or '无'}",
                "父节点最近 2 轮对话:",
                _format_turns(_recent_turns(conn, parent["id"], 4)),
            ]
        )

    current_history = _recent_turns(conn, node_id, 12, before_created_at)
    web_evidence = _format_web_evidence(web_sources, user_query)
    web_instruction = ""
    if web_evidence:
        web_instruction = (
            "\n\n联网检索回答规则:\n"
            "- 优先基于 Web Evidence 回答；证据不足时明确说明不足，不要编造来源。\n"
            "- 使用来源信息时在句子或段落中标注 [S1]、[S2] 这类编号。\n"
            "- 不要引入 Web Evidence 或节点上下文都不支持的新事实。\n"
            "- 回答末尾必须列出“参考来源”，包含标题和 URL。"
        )

    messages = [
        {
            "role": "system",
            "content": (
                f"{SYSTEM_PROMPT}\n\n{_model_identity_context(model_name)}\n\n树状上下文:\n"
                + "\n".join(context_lines)
                + web_evidence
                + web_instruction
            ),
        }
    ]
    messages.extend({"role": row["role"], "content": row["content"]} for row in current_history)
    return messages
