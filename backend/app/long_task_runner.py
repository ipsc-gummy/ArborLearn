from __future__ import annotations

import asyncio
import json
import os
import re
import time
import urllib.parse
from dataclasses import dataclass, field
from typing import Any

from .billing import ensure_wallet_has_credit, record_successful_model_usage
from .db import (
    add_step_output,
    add_task_evidence,
    add_web_source,
    clear_step_artifacts_from_index,
    connect,
    get_long_task_for_user,
    insert_model_call_log,
    list_long_task_steps,
    list_step_outputs,
    list_task_evidence,
    replace_long_task_steps,
    save_long_task_plan,
    update_long_task_status,
    update_long_task_step_status,
    update_task_current_step,
)
from .long_task_context import build_step_context
from .model_client import DEFAULT_MODEL_NAME, ModelConfigurationError, ModelProviderError, call_model_with_usage
from .web_search import SearchResult, WebPageContent, WebSearchConfigurationError, WebSearchProviderError, fetch_url, search_web


VALID_STEP_TYPES = {"analyze", "retrieve", "read", "compare", "verify", "summarize"}
VALID_RETRIEVAL_MODES = {"none", "standard"}


@dataclass
class RetrievalResult:
    evidence: list[dict] = field(default_factory=list)
    search_result_count: int = 0
    fetched_page_count: int = 0
    source_count: int = 0
    error_message: str | None = None


def task_model_name(task: dict | None) -> str:
    return (task or {}).get("model_name") or os.getenv("MODEL_NAME", DEFAULT_MODEL_NAME)


def task_thinking_mode(task: dict | None) -> str:
    return (task or {}).get("thinking_mode") or "fast"


def estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def extract_json_array(text: str) -> list[dict] | None:
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else None
    except json.JSONDecodeError:
        pass
    match = re.search(r"\[[\s\S]*\]", text)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, list) else None


def extract_json_object(text: str) -> dict | None:
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else None
    except json.JSONDecodeError:
        pass
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def fallback_summary(text: str, limit: int = 420) -> str:
    compact = " ".join(text.strip().split())
    return compact[:limit] or "本步骤已完成，但模型没有返回可摘要的内容。"


def normalize_plan_steps(raw_steps: list[dict], original_question: str) -> list[dict]:
    normalized: list[dict] = []
    for index, item in enumerate(raw_steps[:6]):
        if not isinstance(item, dict):
            continue
        step_type = str(item.get("step_type") or "analyze").strip()
        if step_type not in VALID_STEP_TYPES:
            step_type = "analyze"
        need_retrieval = bool(item.get("need_retrieval")) or step_type in {"retrieve", "verify"}
        retrieval_mode = str(item.get("retrieval_mode") or ("standard" if need_retrieval else "none")).strip()
        if retrieval_mode not in VALID_RETRIEVAL_MODES:
            retrieval_mode = "standard" if need_retrieval else "none"
        if retrieval_mode == "standard":
            need_retrieval = True
        title = str(item.get("title") or f"步骤 {index + 1}").strip()
        goal = str(item.get("goal") or item.get("expected_output") or original_question).strip()
        expected_output = str(item.get("expected_output") or "阶段性结论").strip()
        normalized.append(
            {
                "index": len(normalized),
                "title": title[:120],
                "goal": goal,
                "step_type": step_type,
                "need_retrieval": need_retrieval,
                "retrieval_mode": retrieval_mode,
                "expected_output": expected_output,
            }
        )
    return normalized[:6] if len(normalized) >= 3 else fallback_plan(original_question)


def fallback_plan(original_question: str) -> list[dict]:
    lowered = original_question.lower()
    needs_retrieval = any(keyword in lowered for keyword in ["网络", "最新", "github", "文档", "api", "grok", "search", "web", "tavily"])
    steps = [
        {
            "index": 0,
            "title": "明确问题边界",
            "goal": "提取用户问题中的核心目标、约束和需要回答的关键点。",
            "step_type": "analyze",
            "need_retrieval": False,
            "retrieval_mode": "none",
            "expected_output": "问题边界和分析目标摘要",
        }
    ]
    if needs_retrieval:
        steps.append(
            {
                "index": 1,
                "title": "检索相关资料",
                "goal": "检索与用户问题相关的公开资料，筛选可用于回答的证据片段。",
                "step_type": "retrieve",
                "need_retrieval": True,
                "retrieval_mode": "standard",
                "expected_output": "相关证据和核心机制摘要",
            }
        )
    else:
        steps.append(
            {
                "index": 1,
                "title": "展开核心分析",
                "goal": "基于已有节点上下文和问题边界，形成可复用的阶段性分析。",
                "step_type": "analyze",
                "need_retrieval": False,
                "retrieval_mode": "none",
                "expected_output": "核心分析要点",
            }
        )
    steps.append(
        {
            "index": len(steps),
            "title": "汇总落地方案",
            "goal": "综合前序步骤，给出面向学习或科研任务的结构化结论和建议。",
            "step_type": "summarize",
            "need_retrieval": False,
            "retrieval_mode": "none",
            "expected_output": "最终汇总所需的阶段性结论",
        }
    )
    return steps


def parse_step_output(raw: str) -> dict:
    parsed = extract_json_object(raw)
    if not parsed:
        return {
            "summary": fallback_summary(raw),
            "key_points": [],
            "evidence_refs": [],
            "unresolved_questions": [],
            "confidence": 0.5,
        }
    summary = str(parsed.get("summary") or fallback_summary(raw))
    key_points = parsed.get("key_points")
    unresolved_questions = parsed.get("unresolved_questions")
    evidence_refs = parsed.get("evidence_refs")
    confidence = parsed.get("confidence")
    return {
        "summary": summary[:600],
        "key_points": key_points if isinstance(key_points, list) else [],
        "evidence_refs": evidence_refs if isinstance(evidence_refs, list) else [],
        "unresolved_questions": unresolved_questions if isinstance(unresolved_questions, list) else [],
        "confidence": float(confidence) if isinstance(confidence, (int, float)) else 0.5,
    }


def output_type_for_step(step_type: str) -> str:
    return {
        "analyze": "analysis",
        "retrieve": "retrieval_summary",
        "read": "analysis",
        "compare": "comparison",
        "verify": "verification",
        "summarize": "summary",
    }.get(step_type, "analysis")


def query_terms(text: str) -> set[str]:
    return {item.lower() for item in re.findall(r"[A-Za-z0-9_\-]{2,}|[\u4e00-\u9fff]{2,}", text)}


def domain_quality(url: str) -> float:
    host = urllib.parse.urlparse(url).hostname or ""
    if "docs." in host or host in {"github.com", "arxiv.org"} or host.endswith(".edu"):
        return 1.0
    if "medium.com" in host or "blog" in host:
        return 0.6
    return 0.5


def score_search_result(result: SearchResult, terms: set[str], seen_hosts: set[str]) -> float:
    haystack = f"{result.title} {result.snippet}".lower()
    overlap = sum(1 for term in terms if term in haystack) / max(1, len(terms))
    title_match = sum(1 for term in terms if term in result.title.lower()) / max(1, len(terms))
    host = urllib.parse.urlparse(result.url).hostname or result.url
    duplicate_penalty = 1.0 if host in seen_hosts else 0.0
    provider_score = result.score if result.score is not None else 0.5
    return 0.45 * provider_score + 0.25 * overlap + 0.15 * title_match + 0.10 * domain_quality(result.url) - 0.10 * duplicate_penalty


def rank_results(results: list[SearchResult], query: str) -> list[SearchResult]:
    terms = query_terms(query)
    seen_hosts: set[str] = set()
    scored: list[tuple[float, SearchResult]] = []
    for result in results:
        scored.append((score_search_result(result, terms, seen_hosts), result))
        host = urllib.parse.urlparse(result.url).hostname or result.url
        seen_hosts.add(host)
    return [result for _, result in sorted(scored, key=lambda item: item[0], reverse=True)]


def chunk_text(text: str, max_chars: int = 900, overlap: int = 120) -> list[str]:
    paragraphs = [paragraph.strip() for paragraph in re.split(r"\n{2,}", text) if paragraph.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if len(paragraph) > max_chars:
            if current:
                chunks.append(current.strip())
                current = ""
            for start in range(0, len(paragraph), max_chars - overlap):
                chunks.append(paragraph[start : start + max_chars].strip())
            continue
        if len(current) + len(paragraph) + 2 <= max_chars:
            current = f"{current}\n\n{paragraph}".strip()
        else:
            if current:
                chunks.append(current.strip())
            current = paragraph
    if current:
        chunks.append(current.strip())
    return chunks


def score_chunk(chunk: str, terms: set[str]) -> float:
    lowered = chunk.lower()
    overlap = sum(1 for term in terms if term in lowered) / max(1, len(terms))
    density = min(1.0, len(chunk) / 900)
    return round(0.8 * overlap + 0.2 * density, 4)


class LongTaskRunner:
    async def run(self, user_id: str, task_id: str, start_step_index: int | None = None) -> None:
        with connect() as conn:
            task = get_long_task_for_user(conn, user_id, task_id)
            if not task or task["status"] == "DONE":
                return

        try:
            if start_step_index is None:
                with connect() as conn:
                    update_long_task_status(conn, user_id, task_id, "PLANNING")
                    task = get_long_task_for_user(conn, user_id, task_id)
                steps = await self.generate_plan(user_id, task)
                plan_summary = " -> ".join(step["title"] for step in steps)
                with connect() as conn:
                    replace_long_task_steps(
                        conn,
                        user_id=user_id,
                        task_id=task_id,
                        node_id=task["node_id"],
                        steps=steps,
                    )
                    save_long_task_plan(conn, user_id, task_id, json.dumps(steps, ensure_ascii=False), plan_summary)
                    update_long_task_status(conn, user_id, task_id, "RUNNING")
            else:
                with connect() as conn:
                    clear_step_artifacts_from_index(conn, user_id, task_id, start_step_index)
                    update_long_task_status(conn, user_id, task_id, "RUNNING", current_step_index=start_step_index)

            with connect() as conn:
                task = get_long_task_for_user(conn, user_id, task_id)
                saved_steps = list_long_task_steps(conn, user_id, task_id)

            for step in saved_steps:
                if start_step_index is not None and step["step_index"] < start_step_index:
                    continue
                with connect() as conn:
                    fresh_task = get_long_task_for_user(conn, user_id, task_id)
                    if not fresh_task or fresh_task["status"] == "CANCELLED":
                        return
                    update_task_current_step(conn, user_id, task_id, step["step_index"])
                await self.run_step(user_id, task_id, step["id"])

            with connect() as conn:
                fresh_task = get_long_task_for_user(conn, user_id, task_id)
                if not fresh_task or fresh_task["status"] == "CANCELLED":
                    return
                update_long_task_status(conn, user_id, task_id, "SUMMARIZING")
            final_answer = await self.summarize_final(user_id, task_id)
            with connect() as conn:
                update_long_task_status(conn, user_id, task_id, "DONE", final_answer=final_answer, finished=True)
        except Exception as exc:
            with connect() as conn:
                update_long_task_status(conn, user_id, task_id, "FAILED", error_message=str(exc), finished=True)

    async def generate_plan(self, user_id: str, task: dict) -> list[dict]:
        prompt = (
            "你是一个任务规划器。把用户的复杂学习/科研问题拆成 3-6 个可执行步骤。\n"
            "每一步必须能单独执行、保存输出、被后续步骤复用。\n"
            "输出必须是 JSON 数组，每项包含 index, title, goal, step_type, need_retrieval, retrieval_mode, expected_output。\n"
            "step_type 只能是 analyze, retrieve, compare, verify, summarize；retrieval_mode 只能是 none 或 standard。\n"
            "不要生成空泛步骤，最多 6 步。\n\n"
            f"用户问题：{task['original_question']}"
        )
        messages = [
            {"role": "system", "content": "你只输出 JSON 数组，不输出解释。"},
            {"role": "user", "content": prompt},
        ]
        started = time.time()
        raw = ""
        result = None
        error_message = None
        try:
            with connect() as conn:
                ensure_wallet_has_credit(conn, user_id)
            result = await asyncio.to_thread(call_model_with_usage, messages, task_model_name(task), task_thinking_mode(task))
            raw = result.content
            raw_steps = extract_json_array(raw)
            if raw_steps is None:
                error_message = "Planner returned invalid JSON"
                steps = fallback_plan(task["original_question"])
            else:
                steps = normalize_plan_steps(raw_steps, task["original_question"])
        except (ModelConfigurationError, ModelProviderError, RuntimeError) as exc:
            error_message = str(exc)
            steps = fallback_plan(task["original_question"])
        latency_ms = int((time.time() - started) * 1000)
        with connect() as conn:
            if error_message is None:
                record_successful_model_usage(
                    conn,
                    user_id=user_id,
                    notebook_id=task.get("notebook_id"),
                    node_id=task.get("node_id"),
                    task_id=task["id"],
                    call_type="plan",
                    model_name=task_model_name(task),
                    thinking_mode=task_thinking_mode(task),
                    messages=messages,
                    output_text=raw,
                    usage=result.usage if result else None,
                    latency_ms=latency_ms,
                )
            else:
                insert_model_call_log(
                    conn,
                    user_id=user_id,
                    notebook_id=task.get("notebook_id"),
                    node_id=task.get("node_id"),
                    task_id=task["id"],
                    call_type="plan",
                    model_name=task_model_name(task),
                    thinking_mode=task_thinking_mode(task),
                    input_chars=sum(len(message["content"]) for message in messages),
                    output_chars=len(raw),
                    estimated_input_tokens=estimate_tokens(prompt),
                    estimated_output_tokens=estimate_tokens(raw) if raw else 0,
                    success=False,
                    latency_ms=latency_ms,
                    error_message=error_message,
                )
        return steps

    async def run_step(self, user_id: str, task_id: str, step_id: str) -> None:
        with connect() as conn:
            task = get_long_task_for_user(conn, user_id, task_id)
            step = next((item for item in list_long_task_steps(conn, user_id, task_id) if item["id"] == step_id), None)
            if not task or not step:
                raise RuntimeError("Long task step not found")
            if task["status"] == "CANCELLED":
                return
            update_long_task_step_status(conn, user_id, step_id, "RUNNING")

        retrieval = RetrievalResult()
        if step["need_retrieval"] and step["retrieval_mode"] == "standard":
            retrieval = await self.retrieve_evidence_for_step(user_id, task, step)

        with connect() as conn:
            fresh_task = get_long_task_for_user(conn, user_id, task_id)
            if not fresh_task or fresh_task["status"] == "CANCELLED":
                update_long_task_step_status(conn, user_id, step_id, "SKIPPED", error_message="用户取消任务")
                return

        step_context = await build_step_context(user_id, task_id, step_id)
        started = time.time()
        model_output = ""
        result = None
        try:
            with connect() as conn:
                ensure_wallet_has_credit(conn, user_id)
            result = await asyncio.to_thread(call_model_with_usage, step_context.messages, task_model_name(task), task_thinking_mode(task))
            model_output = result.content
            with connect() as conn:
                fresh_task = get_long_task_for_user(conn, user_id, task_id)
                if not fresh_task or fresh_task["status"] == "CANCELLED":
                    update_long_task_step_status(conn, user_id, step_id, "SKIPPED", error_message="用户取消任务")
                    return
            parsed = parse_step_output(model_output)
            if retrieval.error_message:
                parsed["unresolved_questions"] = [
                    *parsed.get("unresolved_questions", []),
                    f"联网检索已降级：{retrieval.error_message}",
                ]
            unresolved_json = json.dumps(parsed.get("unresolved_questions", []), ensure_ascii=False)
            with connect() as conn:
                add_step_output(
                    conn,
                    user_id=user_id,
                    task_id=task_id,
                    step_id=step_id,
                    node_id=task.get("node_id"),
                    output_type=output_type_for_step(step["step_type"]),
                    content=model_output,
                    summary=parsed["summary"],
                    confidence=parsed.get("confidence"),
                    unresolved_questions=unresolved_json,
                )
                update_long_task_step_status(conn, user_id, step_id, "DONE", output_summary=parsed["summary"])
                record_successful_model_usage(
                    conn,
                    user_id=user_id,
                    notebook_id=task.get("notebook_id"),
                    node_id=task.get("node_id"),
                    task_id=task_id,
                    step_id=step_id,
                    call_type="step_retrieve" if step["need_retrieval"] else "step_analyze",
                    model_name=task_model_name(task),
                    thinking_mode=task_thinking_mode(task),
                    messages=step_context.messages,
                    output_text=model_output,
                    usage=result.usage if result else None,
                    context_chars=step_context.context_chars,
                    web_search_enabled=step["need_retrieval"],
                    search_result_count=retrieval.search_result_count,
                    fetched_page_count=retrieval.fetched_page_count,
                    source_count=retrieval.source_count,
                    evidence_count=len(retrieval.evidence),
                    latency_ms=int((time.time() - started) * 1000),
                    error_message=retrieval.error_message,
                )
        except Exception as exc:
            with connect() as conn:
                update_long_task_step_status(conn, user_id, step_id, "FAILED", error_message=str(exc))
                update_long_task_status(conn, user_id, task_id, "FAILED", error_message=str(exc), finished=True)
                insert_model_call_log(
                    conn,
                    user_id=user_id,
                    notebook_id=task.get("notebook_id"),
                    node_id=task.get("node_id"),
                    task_id=task_id,
                    step_id=step_id,
                    call_type="step_retrieve" if step["need_retrieval"] else "step_analyze",
                    model_name=task_model_name(task),
                    thinking_mode=task_thinking_mode(task),
                    input_chars=step_context.context_chars,
                    output_chars=len(model_output),
                    estimated_input_tokens=step_context.estimated_tokens,
                    estimated_output_tokens=estimate_tokens(model_output) if model_output else 0,
                    context_chars=step_context.context_chars,
                    web_search_enabled=step["need_retrieval"],
                    search_result_count=retrieval.search_result_count,
                    fetched_page_count=retrieval.fetched_page_count,
                    source_count=retrieval.source_count,
                    evidence_count=len(retrieval.evidence),
                    latency_ms=int((time.time() - started) * 1000),
                    success=False,
                    error_message=str(exc),
                )
            raise

    async def retrieve_evidence_for_step(self, user_id: str, task: dict, step: dict) -> RetrievalResult:
        query = f"{step['goal']} {task.get('title') or task['original_question']}".strip()
        try:
            results = await search_web(query, max_results=int(os.getenv("WEB_SEARCH_TOP_K", "8")))
        except (WebSearchConfigurationError, WebSearchProviderError) as exc:
            return RetrievalResult(error_message=str(exc))

        ranked = rank_results(results, query)
        fetched_pages: list[tuple[SearchResult, WebPageContent]] = []
        for result in ranked[: int(os.getenv("WEB_FETCH_TOP_K", "3"))]:
            try:
                page = await fetch_url(result.url)
            except (WebSearchConfigurationError, WebSearchProviderError):
                continue
            fetched_pages.append((result, page))

        if not fetched_pages:
            return RetrievalResult(search_result_count=len(results), error_message="搜索结果没有可读取网页，已降级为无 evidence 执行。")

        terms = query_terms(query)
        candidates: list[tuple[float, SearchResult, WebPageContent, str, str | None]] = []
        saved_source_count = 0
        with connect() as conn:
            for result, page in fetched_pages:
                source_id: str | None = None
                if task.get("notebook_id") and task.get("node_id"):
                    source = add_web_source(
                        conn,
                        user_id,
                        task["notebook_id"],
                        task["node_id"],
                        title=page.title or result.title,
                        url=page.url or result.url,
                        snippet=result.snippet,
                        content=page.content,
                        provider=page.provider,
                    )
                    source_id = source["id"]
                    saved_source_count += 1
                chunks = chunk_text(page.content)
                scored_chunks = sorted(((score_chunk(chunk, terms), chunk) for chunk in chunks), key=lambda item: item[0], reverse=True)
                for score, chunk in scored_chunks[: int(os.getenv("WEB_EVIDENCE_MAX_PER_SOURCE", "2"))]:
                    if chunk:
                        candidates.append((score, result, page, chunk, source_id))

            saved_evidence: list[dict] = []
            for score, result, page, chunk, source_id in sorted(candidates, key=lambda item: item[0], reverse=True)[
                : int(os.getenv("WEB_EVIDENCE_MAX_TOTAL", "8"))
            ]:
                saved_evidence.append(
                    add_task_evidence(
                        conn,
                        user_id=user_id,
                        task_id=task["id"],
                        step_id=step["id"],
                        node_id=task.get("node_id"),
                        source_type="web",
                        source_id=source_id,
                        title=page.title or result.title,
                        url=page.url or result.url,
                        evidence_text=chunk,
                        relevance_score=score,
                    )
                )

        if not saved_evidence:
            return RetrievalResult(
                search_result_count=len(results),
                fetched_page_count=len(fetched_pages),
                source_count=saved_source_count,
                error_message="网页内容没有匹配到可用 evidence，已降级为无 evidence 执行。",
            )
        return RetrievalResult(
            evidence=saved_evidence,
            search_result_count=len(results),
            fetched_page_count=len(fetched_pages),
            source_count=saved_source_count,
        )

    async def summarize_final(self, user_id: str, task_id: str) -> str:
        with connect() as conn:
            task = get_long_task_for_user(conn, user_id, task_id)
            steps = list_long_task_steps(conn, user_id, task_id)
            outputs = list_step_outputs(conn, user_id, task_id, limit=120)
            evidence = list_task_evidence(conn, user_id, task_id, limit=12)
        step_by_id = {step["id"]: step for step in steps}
        output_lines = []
        unresolved: list[str] = []
        for output in outputs:
            step = step_by_id.get(output["step_id"])
            if not step:
                continue
            output_lines.append(f"Step {step['step_index']} - {step['title']}: {output.get('summary') or output['content'][:500]}")
            try:
                unresolved.extend(json.loads(output["unresolved_questions"] or "[]"))
            except json.JSONDecodeError:
                unresolved.append(output["unresolved_questions"])
        evidence_lines = [
            f"[{index}] {item.get('title') or '来源'} {item.get('url') or ''}\n{item['evidence_text'][:700]}"
            for index, item in enumerate(evidence[:8], start=1)
        ]
        prompt = "\n\n".join(
            [
                "你需要基于以下长任务步骤结论生成最终答案。",
                "不要引入未出现在步骤结论或证据中的新事实。证据不足时明确说明。",
                "输出：1. 总结论 2. 分步骤分析 3. 关键证据/来源 4. 不确定点 5. 可执行建议。",
                f"用户原始问题：{task['original_question']}",
                "步骤结论：\n" + ("\n".join(output_lines) or "无"),
                "关键证据：\n" + ("\n\n".join(evidence_lines) or "无"),
                "不确定点：\n" + ("\n".join(str(item) for item in unresolved if item) or "无"),
            ]
        )
        messages = [
            {"role": "system", "content": "你是 ArborLearn 的长任务最终汇总助手。"},
            {"role": "user", "content": prompt},
        ]
        started = time.time()
        raw = ""
        result = None
        try:
            with connect() as conn:
                ensure_wallet_has_credit(conn, user_id)
            result = await asyncio.to_thread(call_model_with_usage, messages, task_model_name(task), task_thinking_mode(task))
            raw = result.content
            with connect() as conn:
                record_successful_model_usage(
                    conn,
                    user_id=user_id,
                    notebook_id=task.get("notebook_id"),
                    node_id=task.get("node_id"),
                    task_id=task_id,
                    call_type="final_summary",
                    model_name=task_model_name(task),
                    thinking_mode=task_thinking_mode(task),
                    messages=messages,
                    output_text=raw,
                    usage=result.usage if result else None,
                    context_chars=len(prompt),
                    evidence_count=len(evidence),
                    latency_ms=int((time.time() - started) * 1000),
                )
            return raw
        except Exception as exc:
            with connect() as conn:
                insert_model_call_log(
                    conn,
                    user_id=user_id,
                    notebook_id=task.get("notebook_id"),
                    node_id=task.get("node_id"),
                    task_id=task_id,
                    call_type="final_summary",
                    model_name=task_model_name(task),
                    thinking_mode=task_thinking_mode(task),
                    input_chars=len(prompt),
                    output_chars=len(raw),
                    estimated_input_tokens=estimate_tokens(prompt),
                    estimated_output_tokens=estimate_tokens(raw) if raw else 0,
                    context_chars=len(prompt),
                    evidence_count=len(evidence),
                    success=False,
                    latency_ms=int((time.time() - started) * 1000),
                    error_message=str(exc),
                )
            raise
