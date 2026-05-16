from __future__ import annotations

import os
import sqlite3

from .db import get_parent_chain


SYSTEM_PROMPT = """你是 TreeLearn 的学习助手。
你的任务不是闲聊，而是根据树状学习上下文回答当前节点的问题。
优先使用提供的根节点、父节点和当前节点上下文；当上下文不足时，明确说明你在补充通用知识。
回答要围绕当前局部问题，避免把兄弟分支或无关历史当成主线事实。"""


def _model_identity_context() -> str:
    model_name = os.getenv("MODEL_NAME", "deepseek-v4-flash")
    base_url = os.getenv("MODEL_BASE_URL", "https://api.deepseek.com")
    return (
        "运行配置:\n"
        f"- 当前后端接入的模型名: {model_name}\n"
        f"- 当前模型 API base URL: {base_url}\n"
        "- 当用户询问你使用哪个模型时，按上述后端配置回答；不要猜测或编造更底层的模型身份。"
    )


def _recent_turns(conn: sqlite3.Connection, node_id: str, limit: int, before_created_at: str | None = None) -> list[sqlite3.Row]:
    created_filter = "AND created_at <= ?" if before_created_at else ""
    params: tuple[str, str, int] | tuple[str, int]
    params = (node_id, before_created_at, limit) if before_created_at else (node_id, limit)
    return list(
        reversed(
            conn.execute(
                f"""
                SELECT role, content
                FROM messages
                WHERE node_id = ? AND role IN ('user', 'assistant')
                {created_filter}
                ORDER BY created_at DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        )
    )


def _format_turns(rows: list[sqlite3.Row]) -> str:
    if not rows:
        return "无"
    labels = {"user": "用户", "assistant": "助手"}
    return "\n".join(f"- {labels.get(row['role'], row['role'])}: {row['content']}" for row in rows)


def build_model_messages(conn: sqlite3.Connection, node_id: str, before_created_at: str | None = None) -> list[dict[str, str]]:
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
        f"根节点摘要: {root['summary'] or '无'}",
        f"当前节点标题: {current['title']}",
        f"当前节点摘要: {current['summary'] or '无'}",
        f"当前节点上下文模式: {current['context_mode']}",
    ]

    if parent:
        context_lines.extend(
            [
                f"父节点标题: {parent['title']}",
                f"父节点摘要: {parent['summary'] or '无'}",
                f"父节点触发片段 selectedText: {current['selected_text'] or parent['selected_text'] or '无'}",
                "父节点最近 2 轮对话:",
                _format_turns(_recent_turns(conn, parent["id"], 4)),
            ]
        )

    current_history = _recent_turns(conn, node_id, 12, before_created_at)
    messages = [
        {
            "role": "system",
            "content": f"{SYSTEM_PROMPT}\n\n{_model_identity_context()}\n\n树状上下文:\n" + "\n".join(context_lines),
        }
    ]
    messages.extend({"role": row["role"], "content": row["content"]} for row in current_history)
    return messages
