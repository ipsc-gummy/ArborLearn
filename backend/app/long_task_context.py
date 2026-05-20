from __future__ import annotations

import json
from dataclasses import dataclass

from .db import (
    connect,
    get_long_task_for_user,
    get_long_task_step_for_user,
    get_parent_chain,
    list_long_task_steps,
    list_messages,
    list_step_outputs,
    list_task_evidence,
)


@dataclass
class StepContext:
    messages: list[dict[str, str]]
    context_text: str
    used_evidence_ids: list[str]
    used_step_output_ids: list[str]
    sections: list[dict]
    context_chars: int
    estimated_tokens: int
    truncated: bool


SYSTEM_INSTRUCTION = """你正在执行 ArborLearn 长任务中的一个可见步骤。
只完成当前步骤，不要提前完成后续步骤。
不要输出隐藏推理链，不要声称看到了模型内部思考。
输出结构化阶段结论；证据不足时明确说明不足。"""


OUTPUT_FORMAT = """请输出 JSON：
{
  "summary": "本步骤的阶段性结论",
  "key_points": ["要点 1", "要点 2"],
  "evidence_refs": ["ev_xxx"],
  "unresolved_questions": [],
  "confidence": 0.0
}"""


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def _truncate(text: str, max_chars: int) -> tuple[str, bool]:
    if len(text) <= max_chars:
        return text, False
    if max_chars <= 20:
        return text[:max_chars], True
    return f"{text[: max_chars - 14].rstrip()}\n...[truncated]", True


def _section(name: str, text: str, max_chars: int) -> tuple[dict, str, bool]:
    truncated_text, truncated = _truncate(text.strip(), max_chars)
    return {"name": name, "chars": len(truncated_text), "truncated": truncated}, truncated_text, truncated


def _tree_context(conn, node_id: str | None) -> str:
    if not node_id:
        return "未绑定知识节点。"
    chain = get_parent_chain(conn, node_id)
    if not chain:
        return "未找到知识节点上下文。"

    root = chain[0]
    current = chain[-1]
    parent = chain[-2] if len(chain) > 1 else None
    recent_messages = list_messages(conn, node_id)[-6:]
    message_text = "\n".join(f"- {message['role']}: {message['content'][:600]}" for message in recent_messages) or "无"
    return "\n".join(
        [
            f"当前路径: {' / '.join(row['title'] for row in chain)}",
            f"根节点标题: {root['title']}",
            f"根节点摘要: {(root['summary'] or '无')[:500]}",
            f"父节点标题: {parent['title'] if parent else '无'}",
            f"父节点摘要: {((parent['summary'] if parent else '') or '无')[:800]}",
            f"当前节点标题: {current['title']}",
            f"当前节点摘要: {(current['summary'] or '无')[:1500]}",
            f"当前节点 selectedText: {(current['selected_text'] or '无')[:1000]}",
            "当前节点最近消息:",
            message_text,
        ]
    )


def _previous_outputs_text(outputs: list[dict], current_step_index: int, steps_by_id: dict[str, dict]) -> tuple[str, list[str]]:
    parts: list[str] = []
    used_ids: list[str] = []
    for output in outputs:
        step = steps_by_id.get(output["step_id"])
        if not step or step["step_index"] >= current_step_index:
            continue
        summary = output.get("summary") or output.get("content") or ""
        used_ids.append(output["id"])
        parts.append(
            "\n".join(
                [
                    f"Step {step['step_index']} - {step['title']}",
                    f"Summary: {summary[:900]}",
                ]
            )
        )
    return "\n\n".join(parts) or "无", used_ids


def _evidence_text(evidence: list[dict]) -> tuple[str, list[str]]:
    parts: list[str] = []
    used_ids: list[str] = []
    per_source_count: dict[str, int] = {}
    for item in evidence:
        source_key = item.get("source_id") or item["id"]
        if per_source_count.get(source_key, 0) >= 2:
            continue
        per_source_count[source_key] = per_source_count.get(source_key, 0) + 1
        used_ids.append(item["id"])
        text, _ = _truncate(item["evidence_text"], 1200)
        parts.append(
            "\n".join(
                [
                    f"Source [{len(used_ids)}]",
                    f"ID: {item['id']}",
                    f"Type: {item['source_type']}",
                    f"Title: {item.get('title') or 'Untitled'}",
                    f"URL: {item.get('url') or 'None'}",
                    f"Relevance: {item.get('relevance_score')}",
                    "Evidence:",
                    text,
                ]
            )
        )
        if len(used_ids) >= 8:
            break
    return "\n\n".join(parts) or "无", used_ids


async def build_step_context(user_id: str, task_id: str, step_id: str, max_chars: int = 16000) -> StepContext:
    with connect() as conn:
        task = get_long_task_for_user(conn, user_id, task_id)
        if not task:
            raise ValueError("Long task not found")
        step = get_long_task_step_for_user(conn, user_id, task_id, step_id)
        if not step:
            raise ValueError("Long task step not found")
        steps = {item["id"]: item for item in list_long_task_steps(conn, user_id, task_id)}
        outputs = list_step_outputs(conn, user_id, task_id, limit=100)
        evidence = list_task_evidence(conn, user_id, task_id, step_id, limit=30)

        previous_outputs, used_step_output_ids = _previous_outputs_text(outputs, step["step_index"], steps)
        evidence_block, used_evidence_ids = _evidence_text(evidence)

        raw_sections = [
            ("System", SYSTEM_INSTRUCTION, 1000),
            ("Original Task", f"用户原始问题：{task['original_question']}", 1000),
            (
                "Current Step",
                "\n".join(
                    [
                        f"步骤标题：{step['title']}",
                        f"步骤目标：{step['goal']}",
                        f"步骤类型：{step['step_type']}",
                        f"是否需要检索：{step['need_retrieval']}",
                        f"检索模式：{step['retrieval_mode']}",
                        f"期望输出：{step.get('input_summary') or '阶段性结论'}",
                    ]
                ),
                1000,
            ),
            ("Tree Context", _tree_context(conn, task.get("node_id")), 3000),
            ("Previous Step Outputs", previous_outputs, 3000),
            ("Evidence", evidence_block, 8000),
            ("Output Format", OUTPUT_FORMAT, 1000),
        ]

    sections: list[dict] = []
    context_parts: list[str] = []
    truncated = False
    remaining = max_chars
    for name, text, preferred_chars in raw_sections:
        budget = min(preferred_chars, max(300, remaining))
        if name in {"System", "Original Task", "Current Step", "Output Format"}:
            budget = min(max(len(text), 300), remaining)
        section_meta, section_text, section_truncated = _section(name, text, max(1, budget))
        sections.append(section_meta)
        context_parts.append(f"[{name}]\n{section_text}")
        truncated = truncated or section_truncated
        remaining -= len(section_text)
        if remaining <= 0:
            truncated = True
            break

    context_text = "\n\n".join(context_parts)
    messages = [
        {"role": "system", "content": SYSTEM_INSTRUCTION},
        {"role": "user", "content": context_text},
    ]
    return StepContext(
        messages=messages,
        context_text=context_text,
        used_evidence_ids=used_evidence_ids,
        used_step_output_ids=used_step_output_ids,
        sections=sections,
        context_chars=len(context_text),
        estimated_tokens=estimate_tokens(context_text),
        truncated=truncated,
    )


def parse_unresolved_questions(value: str | None) -> list:
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return [value]
    return parsed if isinstance(parsed, list) else [parsed]
