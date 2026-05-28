from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .auth import create_token, normalize_email, password_hash, require_user, verify_password
from .backfill import (
    MAX_REPLACEMENT_CHARS,
    UNLIMITED_REPLACEMENT_EDIT_TYPES,
    active_patch_overlap,
    archive_patch,
    archive_patches_for_message,
    create_and_apply_patch,
    decide_target_range,
    list_message_patches,
    message_for_user,
    normalize_source_metadata_for_storage,
    parse_source_metadata,
    resolve_anchor_range,
    source_node_for_user,
    validate_target_range_contains_anchor,
)
from .context_builder import build_model_messages, index_node_to_vector_store
from .db import (
    add_message,
    add_web_source,
    connect,
    create_starter_notebook,
    create_long_task,
    descendant_ids,
    get_long_task_for_user,
    get_long_task_step_for_user,
    get_node_for_user,
    get_notebook_for_user,
    get_notebook_state,
    init_db,
    insert_model_call_log,
    list_long_task_steps,
    list_long_tasks_for_node,
    list_messages,
    list_step_outputs,
    list_task_evidence,
    now_iso,
    touch_node,
    update_long_task_status,
    uid,
)
from .effective_context import content_hash, list_effective_messages
from .long_task_context import build_step_context
from .long_task_runner import LongTaskRunner
from .long_task_schemas import LongTaskCreateRequest
from .model_client import (
    DEFAULT_MODEL_NAME,
    DEEPSEEK_MODEL_NAMES,
    ModelConfigurationError,
    ModelProviderError,
    call_model,
    stream_model,
)
from .settings import get_cors_origins
from .web_search import (
    SearchResult,
    WebPageContent,
    WebSearchConfigurationError,
    WebSearchProviderError,
    classify_source_url,
    fetch_url,
    get_web_search_config_status,
    select_relevant_evidence,
    search_web,
)


app = FastAPI(title="ArborLearn API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

LEGACY_DEMO_ACCOUNT_EMAIL = "demo@arborlearn.local"
DEMO_SESSION_TTL_HOURS = 24


class ChatRequest(BaseModel):
    notebookId: str | None = None
    nodeId: str
    message: str = Field(min_length=1)
    userMessageId: str | None = None
    assistantMessageId: str | None = None
    modelName: Literal["deepseek-v4-flash", "deepseek-v4-pro"] | None = None
    thinkingMode: Literal["fast", "deep", "challenge"] | None = None
    webSearch: bool = False
    webQuery: str | None = None
    ragEnabled: bool = False

    @property
    def web_search(self) -> bool:
        return self.webSearch
    
    @property
    def rag_enabled(self) -> bool:
        return self.ragEnabled

    @property
    def web_query(self) -> str | None:
        return self.webQuery

    @property
    def rag_enabled(self) -> bool:
        return self.ragEnabled


class ChatStopRequest(BaseModel):
    nodeId: str
    content: str = Field(min_length=1)
    assistantMessageId: str | None = None


class ChatRetryRequest(BaseModel):
    nodeId: str
    assistantMessageId: str
    modelName: Literal["deepseek-v4-flash", "deepseek-v4-pro"] | None = None
    thinkingMode: Literal["fast", "deep", "challenge"] | None = None


class AuthRequest(BaseModel):
    email: str
    password: str = Field(min_length=8)
    displayName: str | None = None


class MessagePayload(BaseModel):
    id: str | None = None
    role: Literal["user", "assistant", "system"]
    content: str
    selectedText: str | None = None
    createdAt: str | None = None


class NodeCreate(BaseModel):
    id: str | None = None
    notebookId: str | None = None
    parentId: str | None = None
    title: str = "鏂扮殑瀵硅瘽鑺傜偣"
    summary: str = ""
    selectedText: str | None = None
    contextWeight: Literal["isolated", "mainline"] = "isolated"
    sourceMetadata: dict | None = None
    messages: list[MessagePayload] = Field(default_factory=list)


class NodePatch(BaseModel):
    title: str | None = None
    summary: str | None = None
    selectedText: str | None = None
    contextWeight: Literal["isolated", "mainline"] | None = None
    parentId: str | None = None


class BackfillPatchCreate(BaseModel):
    sourceChildNodeId: str
    targetMessageId: str
    editType: Literal["correct", "expand", "compress", "reframe"]
    targetRangeStart: int
    targetRangeEnd: int
    replacementText: str = Field(min_length=1)


class BackfillDraftCreate(BaseModel):
    sourceChildNodeId: str
    targetMessageId: str
    editType: Literal["correct", "expand", "compress", "reframe"]
    targetRangeStart: int | None = None
    targetRangeEnd: int | None = None
    userInstruction: str | None = Field(default=None, max_length=2000)
    modelName: Literal["deepseek-v4-flash", "deepseek-v4-pro"] | None = None
    thinkingMode: Literal["fast", "deep", "challenge"] | None = None


class BackfillRangeDecisionCreate(BaseModel):
    sourceChildNodeId: str
    targetMessageId: str
    editType: Literal["correct", "expand", "compress", "reframe"]
    userInstruction: str | None = Field(default=None, max_length=2000)


class BackfillReviewCreate(BaseModel):
    sourceChildNodeId: str
    targetMessageId: str
    editType: Literal["correct", "expand", "compress", "reframe"]
    targetRangeStart: int
    targetRangeEnd: int
    replacementText: str = Field(min_length=1)
    userInstruction: str | None = Field(default=None, max_length=2000)
    modelName: Literal["deepseek-v4-flash", "deepseek-v4-pro"] | None = None
    thinkingMode: Literal["fast", "deep", "challenge"] | None = None


class WebSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    max_results: int = Field(5, ge=1, le=8, alias="maxResults")

    model_config = ConfigDict(populate_by_name=True)


class WebFetchRequest(BaseModel):
    url: str = Field(min_length=1)


class NodeWebSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    max_results: int = Field(5, ge=1, le=8, alias="maxResults")
    fetch_top_k: int = Field(3, ge=1, le=3, alias="fetchTopK")

    model_config = ConfigDict(populate_by_name=True)


def serialize_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "displayName": user["display_name"],
        "isTemporary": bool(user.get("is_temporary", 0)),
    }


def sse_event(payload: dict, event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def stopped_assistant_content(content: str) -> str | None:
    content = content.strip()
    if not content:
        return None
    return f"{content}\n\n[stopped]"
    return f"{content}\n\n[宸插仠姝"


def source_public_view(source: dict, include_content: bool = False) -> dict:
    source_type, trust_level, domain_quality_score = classify_source_url(str(source.get("url") or ""))
    public_source = {
        "id": source.get("id"),
        "title": source.get("title"),
        "url": source.get("url"),
        "snippet": source.get("snippet"),
        "provider": source.get("provider"),
        "source_type": source.get("source_type") or source_type,
        "trust_level": source.get("trust_level") or trust_level,
        "domain_quality_score": source.get("domain_quality_score") or domain_quality_score,
        "createdAt": source.get("createdAt"),
    }
    if include_content:
        public_source["content"] = source.get("content")
    return public_source


def source_brief_view(source: dict) -> dict:
    source_type, trust_level, _ = classify_source_url(str(source.get("url") or ""))
    return {
        "title": source.get("title"),
        "url": source.get("url"),
        "source_type": source.get("source_type") or source_type,
        "trust_level": source.get("trust_level") or trust_level,
    }


def long_task_step_public_view(step: dict) -> dict:
    return {
        "id": step["id"],
        "task_id": step["task_id"],
        "node_id": step["node_id"],
        "step_index": step["step_index"],
        "title": step["title"],
        "goal": step["goal"],
        "step_type": step["step_type"],
        "status": step["status"],
        "need_retrieval": step["need_retrieval"],
        "retrieval_mode": step["retrieval_mode"],
        "output_summary": step["output_summary"],
        "error_message": step["error_message"],
        "started_at": step["started_at"],
        "finished_at": step["finished_at"],
    }


def long_task_public_view(task: dict, steps: list[dict] | None = None) -> dict:
    payload = {
        "id": task["id"],
        "title": task["title"],
        "original_question": task["original_question"],
        "status": task["status"],
        "current_step_index": task["current_step_index"],
        "plan_summary": task["plan_summary"],
        "node_id": task["node_id"],
        "notebook_id": task["notebook_id"],
        "model_name": task.get("model_name"),
        "thinking_mode": task.get("thinking_mode"),
        "final_answer": task.get("final_answer"),
        "error_message": task["error_message"],
        "created_at": task["created_at"],
        "updated_at": task["updated_at"],
        "finished_at": task["finished_at"],
    }
    if steps is not None:
        payload["steps"] = [long_task_step_public_view(step) for step in steps]
    return payload


def task_evidence_public_view(evidence: dict) -> dict:
    return {
        "id": evidence["id"],
        "source_type": evidence["source_type"],
        "source_id": evidence["source_id"],
        "title": evidence["title"],
        "url": evidence["url"],
        "evidence_text": evidence["evidence_text"],
        "relevance_score": evidence["relevance_score"],
        "char_count": evidence["char_count"],
        "created_at": evidence["created_at"],
    }


def step_output_public_view(output: dict) -> dict:
    return {
        "id": output["id"],
        "output_type": output["output_type"],
        "content": output["content"],
        "summary": output["summary"],
        "confidence": output["confidence"],
        "unresolved_questions": output["unresolved_questions"],
        "created_at": output["created_at"],
    }


def append_source_references(content: str, sources: list[dict]) -> str:
    if not sources:
        return content
    if all(source.get("url") and str(source["url"]) in content for source in sources):
        return content
    references = "\n".join(
        f"[S{index}] {source.get('title') or '鏉ユ簮'} - {source.get('url')}"
        for index, source in enumerate(sources, start=1)
        if source.get("url")
    )
    return f"{content.rstrip()}\n\n鍙傝€冩潵婧?\n{references}"


def append_web_search_warning(content: str, warning: str | None) -> str:
    if not warning:
        return content
    return f"{content.rstrip()}\n\n> 联网检索未完成：{warning}\n> 已降级为不使用网页证据的回答。"


UNVERIFIED_REFERENCES_RE = re.compile(
    r"\n{0,2}(?:#{1,6}\s*)?(?:鍙傝€冩潵婧恷鏉ユ簮|References)\s*[:锛歖\s*[\s\S]*$",
    re.IGNORECASE,
)


def strip_unverified_reference_section(content: str) -> str:
    return UNVERIFIED_REFERENCES_RE.sub("", content.rstrip()).rstrip()


def finalize_web_search_answer(content: str, sources: list[dict], warning: str | None) -> str:
    if not warning:
        return append_source_references(content, sources)
    if sources:
        return append_web_search_warning(append_source_references(content, sources), warning)
    return append_web_search_warning(strip_unverified_reference_section(content), warning)


def http_error_from_web_error(exc: Exception) -> HTTPException:
    if isinstance(exc, WebSearchConfigurationError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, WebSearchProviderError):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=500, detail=f"Unexpected web search error: {exc}")


async def fetch_top_web_pages(results: list[SearchResult], fetch_top_k: int) -> list[tuple[SearchResult, WebPageContent]]:
    async def fetch_one(result: SearchResult) -> tuple[SearchResult, WebPageContent] | None:
        try:
            page = await fetch_url(result.url)
        except (WebSearchConfigurationError, WebSearchProviderError):
            return None
        return result, page

    fetched = await asyncio.gather(*(fetch_one(result) for result in results[:fetch_top_k]))
    return [item for item in fetched if item is not None]


async def collect_and_save_web_sources(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    node: sqlite3.Row,
    query: str,
    max_results: int = 5,
    fetch_top_k: int = 3,
) -> list[dict]:
    try:
        results = await search_web(query, max_results=max_results)
    except (WebSearchConfigurationError, WebSearchProviderError) as exc:
        raise http_error_from_web_error(exc) from exc

    if not results:
        raise HTTPException(status_code=404, detail="No web search results found")

    fetched_pages = await fetch_top_web_pages(results, fetch_top_k)

    saved_sources: list[dict] = []
    for result, page in fetched_pages:
        source = add_web_source(
            conn,
            user_id,
            node["notebook_id"],
            node["id"],
            title=page.title or result.title,
            url=page.url or result.url,
            snippet=result.snippet,
            content=page.content,
            provider=page.provider,
        )
        source_type, trust_level, domain_quality_score = classify_source_url(str(source.get("url") or ""))
        source.update({"source_type": source_type, "trust_level": trust_level, "domain_quality_score": domain_quality_score})
        saved_sources.append(source)
    if saved_sources:
        return saved_sources

    for result in results[:fetch_top_k]:
        snippet = result.snippet.strip()
        if not snippet:
            continue
        source = add_web_source(
            conn,
            user_id,
            node["notebook_id"],
            node["id"],
            title=result.title,
            url=result.url,
            snippet=snippet,
            content=snippet,
            provider="search-result",
        )
        source.update(
            {
                "source_type": result.source_type,
                "trust_level": result.trust_level,
                "domain_quality_score": result.domain_quality_score,
            }
        )
        saved_sources.append(source)
    if not saved_sources:
        raise HTTPException(status_code=502, detail="No readable web pages or snippets found from the search results")
    return saved_sources


async def try_collect_web_sources(
    conn: sqlite3.Connection,
    *,
    user_id: str,
    node: sqlite3.Row,
    query: str,
    max_results: int = 5,
    fetch_top_k: int = 3,
) -> tuple[list[dict], str | None]:
    try:
        sources = await asyncio.wait_for(
            collect_and_save_web_sources(
                conn,
                user_id=user_id,
                node=node,
                query=query,
                max_results=max_results,
                fetch_top_k=fetch_top_k,
            ),
            timeout=float(os.getenv("WEB_SEARCH_PREP_TIMEOUT", "12")),
        )
        return sources, None
    except asyncio.TimeoutError:
        return [], "搜索或网页抓取超时"
    except HTTPException as exc:
        return [], str(exc.detail)
    except Exception as exc:
        return [], str(exc)


async def collect_web_sources_preview(query: str, max_results: int = 5, fetch_top_k: int = 3) -> tuple[list[dict], str | None]:
    try:
        results = await search_web(query, max_results=max_results)
    except (WebSearchConfigurationError, WebSearchProviderError) as exc:
        return [], str(exc)
    if not results:
        return [], "No web search results found"

    fetched_pages = await fetch_top_web_pages(results, fetch_top_k)
    by_url = {page.url: (result, page) for result, page in fetched_pages}
    sources: list[dict] = []
    for result in results[:fetch_top_k]:
        item = by_url.get(result.url)
        if item:
            _, page = item
            content = page.content
            title = page.title or result.title
            url = page.url or result.url
            provider = page.provider
        else:
            content = result.snippet
            title = result.title
            url = result.url
            provider = "search-result"
        source_type, trust_level, domain_quality_score = classify_source_url(url)
        sources.append(
            {
                "title": title,
                "url": url,
                "snippet": result.snippet,
                "content": content,
                "provider": provider,
                "source_type": source_type,
                "trust_level": trust_level,
                "domain_quality_score": domain_quality_score,
            }
        )
    return sources, None


def save_stopped_assistant(node_id: str, content_parts: list[str], message_id: str | None = None) -> dict | None:
    content = stopped_assistant_content("".join(content_parts))
    if not content:
        return None
    msg_id = message_id or uid("msg")
    ts = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO messages(id, node_id, role, content, created_at)
            VALUES (?, ?, 'assistant', ?, ?)
            """,
            (msg_id, node_id, content, ts),
        )
        touch_node(conn, node_id, ts)
    return {"id": msg_id, "role": "assistant", "content": content, "selectedText": None, "createdAt": ts}


def update_assistant_message(conn: sqlite3.Connection, message_id: str, node_id: str, content: str) -> dict:
    conn.execute(
        """
        UPDATE messages
        SET content = ?
        WHERE id = ? AND node_id = ? AND role = 'assistant'
        """,
        (content, message_id, node_id),
    )
    touch_node(conn, node_id)
    row = conn.execute(
        "SELECT created_at FROM messages WHERE id = ? AND node_id = ?",
        (message_id, node_id),
    ).fetchone()
    return {
        "id": message_id,
        "role": "assistant",
        "content": content,
        "selectedText": None,
        "createdAt": row["created_at"] if row else now_iso(),
    }


def clean_generated_title(raw_title: str) -> str:
    title = raw_title.strip().splitlines()[0].strip()
    title = title.strip("`'\"鈥溾€濃€樷€?")
    prefixes = ("Title:", "title:", "鏍囬:", "妯欓:")
    for prefix in prefixes:
        if title.startswith(prefix):
            title = title[len(prefix) :].strip()
    return title[:32].strip()


def maybe_generate_root_title(
    conn: sqlite3.Connection,
    node_id: str,
    user_question: str,
    assistant_answer: str,
    model_name: str | None = None,
) -> str | None:
    node = conn.execute(
        """
        SELECT nodes.id, nodes.notebook_id, nodes.parent_id, nodes.title
        FROM nodes
        JOIN notebooks ON notebooks.id = nodes.notebook_id
        WHERE nodes.id = ?
        """,
        (node_id,),
    ).fetchone()
    if not node or node["parent_id"] is not None or node["title"] != "鏂扮殑瀛︿範涓婚":
        return None

    user_message_count = conn.execute(
        "SELECT COUNT(*) AS count FROM messages WHERE node_id = ? AND role = 'user'",
        (node_id,),
    ).fetchone()["count"]
    if user_message_count != 1:
        return None

    title_messages = [
        {
            "role": "system",
            "content": (
                "Generate a concise Chinese title for a learning notebook. "
                "Return only the title, no quotes, no explanation, no punctuation at the end. "
                "Keep it under 16 Chinese characters or 8 English words."
            ),
        },
        {
            "role": "user",
            "content": f"User question:\n{user_question}\n\nAssistant answer:\n{assistant_answer[:1200]}",
        },
    ]
    try:
        title = clean_generated_title(call_model(title_messages, model_name, "fast"))
    except (ModelConfigurationError, ModelProviderError):
        return None
    if not title:
        return None

    ts = now_iso()
    conn.execute("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?", (title, ts, node_id))
    conn.execute("UPDATE notebooks SET title = ?, updated_at = ? WHERE id = ?", (title, ts, node["notebook_id"]))
    return title


def clean_generated_summary(raw_summary: str) -> str:
    summary = " ".join(raw_summary.strip().split())
    summary = summary.strip("`'\"鈥溾€濃€樷€?")
    prefixes = ("Summary:", "summary:", "鎽樿:", "鎬荤粨:", "姒傝堪:")
    for prefix in prefixes:
        if summary.startswith(prefix):
            summary = summary[len(prefix) :].strip()
    return summary[:180].strip()


def maybe_generate_branch_summary(conn: sqlite3.Connection, node_id: str, model_name: str | None = None) -> str | None:
    node = conn.execute(
        """
        SELECT id, parent_id, title, selected_text
        FROM nodes
        WHERE id = ?
        """,
        (node_id,),
    ).fetchone()
    if not node or node["parent_id"] is None:
        return None

    rows = list_effective_messages(conn, node_id, limit=24, ascending=True)
    if not rows:
        return None

    conversation = "\n".join(f"{row['role']}: {row['content']}" for row in rows)
    summary_messages = [
        {
            "role": "system",
            "content": (
                "你正在为树状学习产品生成子对话预览摘要。"
                "请概括子对话目前讨论了什么、得出了什么要点。"
                "只输出摘要正文，不要标题，不要列表。"
                "控制在 45 个中文字以内。"
            ),
        },
        {
            "role": "user",
            "content": f"触发片段：{node['selected_text'] or node['title']}\n\n子对话内容：\n{conversation[-4000:]}",
        },
    ]
    try:
        summary = clean_generated_summary(call_model(summary_messages, model_name, "fast"))
    except (ModelConfigurationError, ModelProviderError):
        return None
    if not summary:
        return None

    conn.execute("UPDATE nodes SET summary = ?, summary_stale = 0, updated_at = ? WHERE id = ?", (summary, now_iso(), node_id))
    return summary


def maybe_generate_node_summary(conn: sqlite3.Connection, node_id: str, model_name: str | None = None) -> str | None:
    node = conn.execute(
        """
        SELECT id, parent_id, title, selected_text
        FROM nodes
        WHERE id = ?
        """,
        (node_id,),
    ).fetchone()
    if not node:
        return None

    rows = list_effective_messages(conn, node_id, limit=24, ascending=True)
    if not rows:
        return None

    conversation = "\n".join(f"{row['role']}: {row['content']}" for row in rows)
    node_kind = "root notebook node" if node["parent_id"] is None else "branch node"
    summary_messages = [
        {
            "role": "system",
            "content": (
                "You generate concise Chinese summaries for ArborLearn tree conversation nodes. "
                "Summarize what this node has actually discussed and the key conclusion so far. "
                "Return only the summary text. Do not add a title, bullets, or explanations. "
                "Do not copy the user's question or the assistant's answer verbatim. "
                "Keep it within 45 Chinese characters."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Node type: {node_kind}\n"
                f"Node title: {node['title']}\n"
                f"Selected text: {node['selected_text'] or 'None'}\n\n"
                f"Conversation:\n{conversation[-4000:]}"
            ),
        },
    ]
    try:
        summary = clean_generated_summary(call_model(summary_messages, model_name, "fast"))
    except (ModelConfigurationError, ModelProviderError):
        return None
    if not summary:
        return None

    conn.execute("UPDATE nodes SET summary = ?, summary_stale = 0, updated_at = ? WHERE id = ?", (summary, now_iso(), node_id))
    return summary


@app.on_event("startup")
def startup() -> None:
    init_db()
    cleanup_demo_sessions()


def cleanup_demo_sessions() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=DEMO_SESSION_TTL_HOURS)).isoformat()
    legacy_email = normalize_email(LEGACY_DEMO_ACCOUNT_EMAIL)
    with connect() as conn:
        conn.execute("DELETE FROM users WHERE is_temporary = 1 AND created_at < ?", (cutoff,))
        conn.execute("DELETE FROM users WHERE email = ?", (legacy_email,))


def create_isolated_demo_user() -> dict:
    cleanup_demo_sessions()
    user_id = uid("user")
    demo_suffix = user_id.removeprefix("user-")
    email = f"demo-{demo_suffix}@arborlearn.local"
    display_name = "婕旂ず浣撻獙"
    ts = now_iso()
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO users(id, email, display_name, password_hash, is_temporary, created_at, updated_at)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            """,
            (user_id, email, display_name, password_hash(uid("demo-password")), ts, ts),
        )
        create_starter_notebook(conn, user_id)
    return {
        "id": user_id,
        "email": email,
        "display_name": display_name,
        "is_temporary": 1,
    }


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "model": os.getenv("MODEL_NAME", DEFAULT_MODEL_NAME),
        "modelBaseUrl": os.getenv("MODEL_BASE_URL", "https://api.deepseek.com"),
        "availableModels": sorted(DEEPSEEK_MODEL_NAMES),
        "webSearch": get_web_search_config_status(),
    }


@app.post("/api/web/search")
async def web_search_endpoint(payload: WebSearchRequest, user: dict = Depends(require_user)) -> dict:
    try:
        results = await search_web(payload.query.strip(), payload.max_results)
    except (WebSearchConfigurationError, WebSearchProviderError) as exc:
        raise http_error_from_web_error(exc) from exc
    return {"results": [result.to_dict() for result in results], "provider": os.getenv("WEB_SEARCH_PROVIDER", "auto")}


@app.post("/api/web/fetch")
async def web_fetch_endpoint(payload: WebFetchRequest, user: dict = Depends(require_user)) -> dict:
    try:
        page = await fetch_url(payload.url)
    except (WebSearchConfigurationError, WebSearchProviderError) as exc:
        raise http_error_from_web_error(exc) from exc
    return {"page": page.to_dict()}


@app.get("/api/context/debug")
async def context_debug_endpoint(
    node_id: str = Query(..., alias="node_id"),
    query: str = Query(""),
    web_search: bool = Query(False, alias="web_search"),
    webSearch: bool | None = Query(None),
    modelName: Literal["deepseek-v4-flash", "deepseek-v4-pro"] | None = Query(None),
    thinkingMode: Literal["fast", "deep", "challenge"] | None = Query(None),
    user: dict = Depends(require_user),
) -> dict:
    use_web_search = webSearch if webSearch is not None else web_search
    with connect() as conn:
        node = get_node_for_user(conn, node_id, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        sources: list[dict] = []
        web_search_warning: str | None = None
        if use_web_search and query.strip():
            sources, web_search_warning = await collect_web_sources_preview(query.strip(), max_results=5, fetch_top_k=3)

        messages = build_model_messages(
            conn,
            node_id,
            model_name=modelName,
            web_sources=sources,
            user_query=query.strip() or None,
        )

    system_chars = len(messages[0]["content"]) if messages else 0
    recent_chars = sum(len(message["content"]) for message in messages[1:])
    source_payloads = []
    evidence_chars = 0
    for source in sources:
        evidence_preview = select_relevant_evidence(
            str(source.get("content") or source.get("snippet") or ""),
            query,
            max_paragraphs=2,
            max_chars=900,
        )
        evidence_chars += len(evidence_preview)
        source_payloads.append(
            {
                "title": source.get("title"),
                "url": source.get("url"),
                "source_type": source.get("source_type"),
                "trust_level": source.get("trust_level"),
                "evidence_preview": evidence_preview,
            }
        )

    final_context = "\n\n".join(message["content"] for message in messages)
    return {
        "node_id": node_id,
        "model_config": {
            "model": modelName or os.getenv("MODEL_NAME", DEFAULT_MODEL_NAME),
            "thinkingMode": thinkingMode,
        },
        "sections": [
            {"name": "System", "chars": system_chars},
            {"name": "Node Context", "chars": system_chars},
            {"name": "Recent Messages", "chars": recent_chars},
            {"name": "Web Evidence", "chars": evidence_chars},
        ],
        "sources": source_payloads,
        "estimated_tokens": max(1, len(final_context) // 4),
        "truncated": False,
        "web_search_warning": web_search_warning,
        "final_context_preview": final_context[:4000],
    }


@app.post("/api/long-tasks", status_code=201)
def create_long_task_endpoint(
    payload: LongTaskCreateRequest,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_user),
) -> dict:
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    with connect() as conn:
        notebook_id = payload.notebook_id
        node_id = payload.node_id
        if node_id:
            node = get_node_for_user(conn, node_id, user["id"])
            if not node:
                raise HTTPException(status_code=404, detail="Node not found")
            if notebook_id and notebook_id != node["notebook_id"]:
                raise HTTPException(status_code=400, detail="node_id and notebook_id do not belong to the same notebook")
            notebook_id = node["notebook_id"]
        elif notebook_id and not get_notebook_for_user(conn, notebook_id, user["id"]):
            raise HTTPException(status_code=404, detail="Notebook not found")

        task = create_long_task(
            conn,
            user["id"],
            original_question=question,
            title=(payload.title or question[:32]).strip(),
            notebook_id=notebook_id,
            node_id=node_id,
            model_name=payload.resolved_model_name,
            thinking_mode=payload.resolved_thinking_mode,
        )
        if payload.auto_run:
            update_long_task_status(conn, user["id"], task["id"], "RUNNING")
            background_tasks.add_task(LongTaskRunner().run, user["id"], task["id"])
            task["status"] = "RUNNING"

    return {
        "id": task["id"],
        "status": task["status"],
        "title": task["title"],
        "original_question": task["original_question"],
        "node_id": task["node_id"],
        "model_name": task.get("model_name"),
        "thinking_mode": task.get("thinking_mode"),
    }


@app.post("/api/long-tasks/{task_id}/run")
def run_long_task_endpoint(task_id: str, background_tasks: BackgroundTasks, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        task = get_long_task_for_user(conn, user["id"], task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Long task not found")
        if task["status"] in {"RUNNING", "PLANNING", "SUMMARIZING"}:
            return {"task_id": task_id, "status": task["status"], "message": "Long task is already running"}
        if task["status"] == "DONE":
            return {"task_id": task_id, "status": "DONE", "message": "Long task is already done"}
        update_long_task_status(conn, user["id"], task_id, "RUNNING")
    background_tasks.add_task(LongTaskRunner().run, user["id"], task_id)
    return {"task_id": task_id, "status": "RUNNING", "message": "Long task started"}


@app.get("/api/nodes/{node_id}/long-tasks")
def list_node_long_tasks_endpoint(
    node_id: str,
    limit: int = Query(20, ge=1, le=50),
    user: dict = Depends(require_user),
) -> dict:
    with connect() as conn:
        node = get_node_for_user(conn, node_id, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        tasks = list_long_tasks_for_node(conn, user["id"], node_id, limit)
        task_payloads = [
            long_task_public_view(task, list_long_task_steps(conn, user["id"], task["id"]))
            for task in tasks
        ]
    return {"tasks": task_payloads}


@app.get("/api/long-tasks/{task_id}")
def get_long_task_endpoint(task_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        task = get_long_task_for_user(conn, user["id"], task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Long task not found")
        steps = list_long_task_steps(conn, user["id"], task_id)
    return long_task_public_view(task, steps)


@app.get("/api/long-tasks/{task_id}/steps/{step_id}")
def get_long_task_step_endpoint(task_id: str, step_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        task = get_long_task_for_user(conn, user["id"], task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Long task not found")
        step = get_long_task_step_for_user(conn, user["id"], task_id, step_id)
        if not step:
            raise HTTPException(status_code=404, detail="Long task step not found")
        evidence = list_task_evidence(conn, user["id"], task_id, step_id, limit=20)
        outputs = list_step_outputs(conn, user["id"], task_id, step_id, limit=20)
    return {
        **long_task_step_public_view(step),
        "evidence": [task_evidence_public_view(item) for item in evidence],
        "outputs": [step_output_public_view(item) for item in outputs],
    }


@app.post("/api/long-tasks/{task_id}/cancel")
def cancel_long_task_endpoint(task_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        task = get_long_task_for_user(conn, user["id"], task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Long task not found")
        update_long_task_status(conn, user["id"], task_id, "CANCELLED", finished=True)
    return {"task_id": task_id, "status": "CANCELLED"}


@app.post("/api/long-tasks/{task_id}/steps/{step_id}/retry")
def retry_long_task_step_endpoint(
    task_id: str,
    step_id: str,
    background_tasks: BackgroundTasks,
    user: dict = Depends(require_user),
) -> dict:
    with connect() as conn:
        task = get_long_task_for_user(conn, user["id"], task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Long task not found")
        step = get_long_task_step_for_user(conn, user["id"], task_id, step_id)
        if not step:
            raise HTTPException(status_code=404, detail="Long task step not found")
        if step["status"] != "FAILED":
            raise HTTPException(status_code=400, detail="Only FAILED steps can be retried")
        update_long_task_status(conn, user["id"], task_id, "RUNNING", current_step_index=step["step_index"])
    background_tasks.add_task(LongTaskRunner().run, user["id"], task_id, step["step_index"])
    return {"task_id": task_id, "step_id": step_id, "status": "RUNNING", "message": "Long task step retry started"}


@app.get("/api/long-tasks/{task_id}/steps/{step_id}/context-debug")
async def long_task_context_debug_endpoint(task_id: str, step_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        task = get_long_task_for_user(conn, user["id"], task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Long task not found")
        step = get_long_task_step_for_user(conn, user["id"], task_id, step_id)
        if not step:
            raise HTTPException(status_code=404, detail="Long task step not found")

    context = await build_step_context(user["id"], task_id, step_id)
    with connect() as conn:
        evidence_by_id = {
            item["id"]: item
            for item in list_task_evidence(conn, user["id"], task_id, step_id, limit=50)
        }
        insert_model_call_log(
            conn,
            user_id=user["id"],
            notebook_id=task.get("notebook_id"),
            node_id=task.get("node_id"),
            task_id=task_id,
            step_id=step_id,
            call_type="context_debug",
            model_name=None,
            input_chars=context.context_chars,
            estimated_input_tokens=context.estimated_tokens,
            context_chars=context.context_chars,
            evidence_count=len(context.used_evidence_ids),
            success=True,
        )
    return {
        "task_id": task_id,
        "step_id": step_id,
        "estimated_tokens": context.estimated_tokens,
        "context_chars": context.context_chars,
        "truncated": context.truncated,
        "sections": context.sections,
        "used_evidence": [
            {
                "id": evidence_id,
                "title": evidence_by_id.get(evidence_id, {}).get("title"),
                "source_type": evidence_by_id.get(evidence_id, {}).get("source_type"),
                "relevance_score": evidence_by_id.get(evidence_id, {}).get("relevance_score"),
            }
            for evidence_id in context.used_evidence_ids
        ],
    }


@app.post("/api/auth/register", status_code=201)
def register(payload: AuthRequest) -> dict:
    email = normalize_email(payload.email)
    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")

    display_name = (payload.displayName or email.split("@", 1)[0]).strip()[:64] or "ArborLearn User"
    user_id = uid("user")
    ts = now_iso()
    with connect() as conn:
        try:
            conn.execute(
                """
                INSERT INTO users(id, email, display_name, password_hash, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (user_id, email, display_name, password_hash(payload.password), ts, ts),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Email is already registered") from exc
        create_starter_notebook(conn, user_id)

    user = {"id": user_id, "email": email, "display_name": display_name, "is_temporary": 0}
    return {"token": create_token(user_id), "user": serialize_user(user)}


@app.post("/api/auth/demo", status_code=201)
def demo_session() -> dict:
    user = create_isolated_demo_user()
    return {"token": create_token(user["id"]), "user": serialize_user(user)}


@app.post("/api/auth/login")
def login(payload: AuthRequest) -> dict:
    email = normalize_email(payload.email)
    legacy_email = normalize_email(LEGACY_DEMO_ACCOUNT_EMAIL)
    if email == legacy_email:
        raise HTTPException(status_code=410, detail="演示入口已改为独立体验会话，请点击“体验示例”进入")

    with connect() as conn:
        user = conn.execute(
            """
            SELECT id, email, display_name, password_hash, is_temporary
            FROM users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"token": create_token(user["id"]), "user": serialize_user(dict(user))}


@app.get("/api/auth/me")
def me(user: dict = Depends(require_user)) -> dict:
    return {"user": serialize_user(user)}


@app.get("/api/tree")
def all_tree(user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        return get_notebook_state(conn, user["id"])


@app.get("/api/notebooks/{notebook_id}/tree")
def notebook_tree(notebook_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        state = get_notebook_state(conn, user["id"], notebook_id)
        if not state["rootIds"]:
            raise HTTPException(status_code=404, detail="Notebook not found")
        return state


@app.get("/api/nodes/{node_id}/messages")
def node_messages(node_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        exists = get_node_for_user(conn, node_id, user["id"])
        if not exists:
            raise HTTPException(status_code=404, detail="Node not found")
        return {"messages": list_messages(conn, node_id)}


@app.get("/api/messages/{message_id}/patches")
def message_patches(message_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        return {"patches": list_message_patches(conn, user["id"], message_id)}


EDIT_TYPE_GENERATION_GUIDE = {
    "correct": (
        "修改：优先修正目标范围中的事实错误、术语不准、逻辑跳步或表达别扭之处。"
        "尽量保留原文结构和语气，只改必要部分；不要借机扩写新内容。"
    ),
    "expand": (
        "补充：在不打断原文节奏的前提下，把子对话中已经确认的关键信息自然补进目标范围。"
        "优先补足定义、原因、例子、边界条件或结论，但不要堆砌无关背景。"
    ),
    "compress": (
        "压缩：保留原文核心信息和必要术语，删去重复、绕口、弱信息密度的表达。"
        "压缩后应更短、更清楚，而不是简单删句导致信息断裂。"
    ),
    "reframe": (
        "重构：在保持原意和事实不变的前提下，重新组织目标范围的表达顺序、层次和衔接。"
        "优先让逻辑更顺、段落更稳、Markdown 结构更清晰。"
    ),
}
EDIT_TYPE_TAG_RE = re.compile(r"#(?:修改|纠错|补充|压缩|重构|correct|expand|compress|reframe)", re.IGNORECASE)


def normalize_backfill_instruction(user_instruction: str | None) -> str:
    return (user_instruction or "").strip()


def backfill_instruction_is_thin(user_instruction: str | None) -> bool:
    instruction = normalize_backfill_instruction(user_instruction)
    if not instruction:
        return True
    if EDIT_TYPE_TAG_RE.search(instruction):
        return False
    content = EDIT_TYPE_TAG_RE.sub("", instruction)
    content = re.sub(r"[\s#锛屻€?.!锛?锛燂細:锛?銆?]+", "", content)
    return len(content) < 2


def clean_backfill_draft(raw: str) -> str:
    text = raw.strip("\r\n")
    if text.lstrip().startswith("```"):
        text = re.sub(r"^\s*```[a-zA-Z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip("\r\n")
    text = text.strip("\r\n")
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        text = text[1:-1].strip()
    return text


def trim_reviewed_text_to_range(reviewed_text: str, before_target: str, after_target: str) -> str:
    text = reviewed_text.strip("\r\n")
    if before_target and text.startswith(before_target):
        text = text[len(before_target) :]
    if after_target and text.endswith(after_target):
        text = text[: -len(after_target)]
    text = trim_boundary_overlap(text, before_target, after_target)
    return text.strip("\r\n")


def trim_boundary_overlap(text: str, before_target: str, after_target: str) -> str:
    trimmed = text
    max_prefix_overlap = min(len(before_target), len(trimmed), 120)
    for size in range(max_prefix_overlap, 1, -1):
        if trimmed.startswith(before_target[-size:]):
            trimmed = trimmed[size:]
            break

    max_suffix_overlap = min(len(after_target), len(trimmed), 120)
    for size in range(max_suffix_overlap, 1, -1):
        if trimmed.endswith(after_target[:size]):
            trimmed = trimmed[:-size]
            break

    duplicated_boundary_marks = "锛屻€傦紒锛燂紱锛氥€?.!?;:"
    if trimmed and after_target and trimmed[-1] == after_target[0] and trimmed[-1] in duplicated_boundary_marks:
        trimmed = trimmed[:-1]
    return trimmed


INLINE_BOUNDARY_MARKERS = ("**", "__", "~~", "`", "*", "_")


def read_boundary_markers(text: str) -> tuple[str, str]:
    stripped = text.strip("\r\n")
    leading = ""
    trailing = ""
    changed = True
    while changed:
        changed = False
        for marker in INLINE_BOUNDARY_MARKERS:
            if (
                stripped.startswith(leading + marker)
                and stripped.endswith(marker + trailing)
                and len(stripped) >= len(leading) + len(trailing) + len(marker) * 2
            ):
                leading += marker
                trailing = marker + trailing
                changed = True
                break
    return leading, trailing


def strip_boundary_markers(text: str) -> str:
    stripped = text.strip("\r\n")
    changed = True
    while changed:
        changed = False
        for marker in INLINE_BOUNDARY_MARKERS:
            if stripped.startswith(marker) and stripped.endswith(marker) and len(stripped) >= len(marker) * 2:
                stripped = stripped[len(marker) : -len(marker)].strip("\r\n")
                changed = True
                break
    return stripped


def align_reviewed_markdown_boundaries(reviewed_text: str, original_text: str) -> str:
    original_leading, original_trailing = read_boundary_markers(original_text)
    reviewed_inner = strip_boundary_markers(reviewed_text)
    if not reviewed_inner.strip():
        return reviewed_text
    if not original_leading and not original_trailing:
        return reviewed_inner
    return f"{original_leading}{reviewed_inner}{original_trailing}"


def build_backfill_review_window(content: str, start: int, end: int, replacement_text: str, radius: int = 1600) -> dict:
    window_start = max(0, start - radius)
    window_end = min(len(content), end + radius)
    before_target = content[window_start:start]
    original_target = content[start:end]
    after_target = content[end:window_end]
    return {
        "beforeTarget": before_target,
        "originalTarget": original_target,
        "afterTarget": after_target,
        "originalWindow": f"{before_target}{original_target}{after_target}",
        "patchedWindow": f"{before_target}{replacement_text}{after_target}",
        "patchedFullMessage": f"{content[:start]}{replacement_text}{content[end:]}",
    }


def backfill_conflict_detail(conflict: sqlite3.Row) -> dict:
    return {
        "code": "BACKFILL_RANGE_OVERLAP",
        "message": "这段内容已经存在其他回填，不能直接覆盖。你可以保留原回填、撤回旧回填后再应用，或取消本次操作。",
        "conflictPatch": {
            "id": conflict["id"],
            "sourceChildNodeId": conflict["source_child_node_id"],
            "targetRangeStart": conflict["target_range_start"],
            "targetRangeEnd": conflict["target_range_end"],
            "anchorText": conflict["anchor_text"],
            "originalText": conflict["original_text"],
            "replacementText": conflict["replacement_text"],
            "editType": conflict["edit_type"],
        },
    }


def load_backfill_generation_context(
    conn: sqlite3.Connection,
    user_id: str,
    source_child_node_id: str,
    target_message_id: str,
    edit_type: str,
    user_instruction: str | None,
) -> dict:
    source_node = source_node_for_user(conn, user_id, source_child_node_id)
    if not source_node:
        raise HTTPException(status_code=404, detail="Source child node not found")
    source_metadata = parse_source_metadata(source_node["source_metadata_json"])
    if not source_metadata:
        raise HTTPException(status_code=400, detail="Source child node does not contain backfill metadata")
    if source_metadata.get("targetMessageId") != target_message_id:
        raise HTTPException(status_code=400, detail="Target message does not match source metadata")

    target_message = message_for_user(conn, target_message_id, user_id)
    if not target_message:
        raise HTTPException(status_code=404, detail="Target message not found")
    if source_metadata.get("baseMessageContentHash") != content_hash(target_message["content"]):
        raise HTTPException(status_code=409, detail="Target message version has changed")

    child_messages = list_effective_messages(conn, source_child_node_id, ascending=True)
    meaningful_child_messages = [
        message for message in child_messages if message["role"] in {"user", "assistant"} and message["content"].strip()
    ]
    effective_edit_type = (
        "reframe"
        if not meaningful_child_messages and backfill_instruction_is_thin(user_instruction)
        else edit_type
    )
    anchor_start, anchor_end = resolve_anchor_range(target_message["content"], source_metadata)
    return {
        "source_metadata": source_metadata,
        "target_message": target_message,
        "meaningful_child_messages": meaningful_child_messages,
        "effective_edit_type": effective_edit_type,
        "anchor_start": anchor_start,
        "anchor_end": anchor_end,
    }


def validate_backfill_conflict(
    conn: sqlite3.Connection,
    target_message_id: str,
    start: int,
    end: int,
    source_child_node_id: str,
) -> None:
    conflict = active_patch_overlap(
        conn,
        target_message_id,
        start,
        end,
        exclude_source_child_node_id=source_child_node_id,
    )
    if conflict:
        raise HTTPException(status_code=409, detail=backfill_conflict_detail(conflict))


def build_backfill_draft_messages(
    *,
    edit_type: str,
    user_instruction: str | None,
    parent_content: str,
    original_text: str,
    source_metadata: dict,
    child_messages: list[dict],
    existing_patches: list[dict],
) -> list[dict[str, str]]:
    instruction_text = normalize_backfill_instruction(user_instruction) or "None"
    child_text = "\n".join(
        f"{message['role']}: {message['content']}" for message in child_messages if message.get("content")
    ) or "None"
    return [
        {"role": "system", "content": "Generate only the replacement text for the selected backfill range."},
        {
            "role": "user",
            "content": (
                f"Edit type: {EDIT_TYPE_GENERATION_GUIDE[edit_type]}\n\n"
                f"User instruction:\n{instruction_text}\n\n"
                f"Parent message:\n{parent_content}\n\n"
                f"Original selected range:\n{original_text}\n\n"
                f"Child conversation:\n{child_text}\n\n"
                "Return only replacementText."
            ),
        },
    ]

def build_backfill_cloze_draft_messages(
    *,
    edit_type: str,
    user_instruction: str | None,
    parent_content: str,
    original_text: str,
    source_metadata: dict,
    child_messages: list[dict],
    existing_patches: list[dict],
    target_range_start: int,
    target_range_end: int,
) -> list[dict[str, str]]:
    child_text = "\n".join(
        f"{message['role']}: {message['content']}" for message in child_messages if message.get("content")
    ) or "None"
    patch_text = "\n".join(
        f"- {patch['editType']} [{patch['targetRangeStart']}, {patch['targetRangeEnd']}]: {patch['originalText']} => {patch['replacementText']}"
        for patch in existing_patches
        if patch.get("status") == "applied"
    ) or "None"
    instruction_text = normalize_backfill_instruction(user_instruction) or "None"
    before_target = parent_content[max(0, target_range_start - 1800) : target_range_start]
    after_target = parent_content[target_range_end : min(len(parent_content), target_range_end + 1800)]
    fill_template = f"{before_target}[[FILL_BACKFILL_SLOT]]{after_target}"
    return [
        {
            "role": "system",
            "content": (
                "You generate ArborLearn backfill drafts by solving a constrained fill-in-the-blank task.\n\n"
                "The target range is a blank slot inside the parent message. The original target text is only a reference "
                "for what the slot used to contain, not something you must copy or freely rewrite. Infer the best slot content "
                "from the surrounding parent context, the child conversation, the user's instruction, and the edit type.\n\n"
                "Rules:\n"
                "1. Return only the text that fills [[FILL_BACKFILL_SLOT]]. Do not return the surrounding context.\n"
                "2. The filled result must read naturally when inserted between beforeTarget and afterTarget.\n"
                "3. Prefer preserving the original slot's role, tone, granularity, and Markdown structure.\n"
                "4. Use child conversation facts only when they are relevant and supported. Do not invent unsupported facts.\n"
                "5. The user's instruction is a constraint on how to fill the slot, not permission to rewrite outside it.\n"
                "6. If intent is thin or unclear, default internally to reframe: make the slot clearer and structurally sound while preserving meaning.\n"
                "7. If the slot owns Markdown markers, list/table/code/quote structure, or paragraph breaks, return a complete Markdown-valid slot.\n\n"
                "Output only the final slot content. No title, no explanation, no quote marks, no report."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Edit type guide:\n{EDIT_TYPE_GENERATION_GUIDE[edit_type]}\n\n"
                f"User instruction:\n{instruction_text}\n\n"
                f"Target range coordinates: [{target_range_start}, {target_range_end})\n\n"
                f"Original slot text:\n{original_text}\n\n"
                f"Anchor metadata:\n"
                f"- prefix: {source_metadata.get('anchorPrefix') or ''}\n"
                f"- anchor: {source_metadata.get('anchorText') or ''}\n"
                f"- suffix: {source_metadata.get('anchorSuffix') or ''}\n\n"
                f"Existing applied backfills:\n{patch_text}\n\n"
                f"Child conversation:\n{child_text}\n\n"
                f"beforeTarget:\n{before_target}\n\n"
                f"afterTarget:\n{after_target}\n\n"
                f"Fill template:\n{fill_template}\n\n"
                "Fill [[FILL_BACKFILL_SLOT]] and return only the slot content."
            ),
        },
    ]


def build_backfill_review_messages(
    *,
    edit_type: str,
    user_instruction: str | None,
    parent_content: str,
    original_text: str,
    replacement_text: str,
    source_metadata: dict,
) -> list[dict[str, str]]:
    instruction_text = normalize_backfill_instruction(user_instruction) or "None"
    return [
        {"role": "system", "content": "Review and correct only the replacement text for the selected range."},
        {
            "role": "user",
            "content": (
                f"Edit type: {EDIT_TYPE_GENERATION_GUIDE[edit_type]}\n\n"
                f"User instruction:\n{instruction_text}\n\n"
                f"Parent message:\n{parent_content}\n\n"
                f"Original selected range:\n{original_text}\n\n"
                f"Current replacementText:\n{replacement_text}\n\n"
                "Return only corrected replacementText."
            ),
        },
    ]

def build_backfill_context_review_messages(
    *,
    edit_type: str,
    user_instruction: str | None,
    parent_content: str,
    original_text: str,
    replacement_text: str,
    source_metadata: dict,
    target_range_start: int,
    target_range_end: int,
) -> list[dict[str, str]]:
    instruction_text = normalize_backfill_instruction(user_instruction) or "None"
    review_window = build_backfill_review_window(parent_content, target_range_start, target_range_end, replacement_text)
    return [
        {
            "role": "system",
            "content": (
                "You are ArborLearn's substitution reviewer. Treat the user's editor text as a candidate fill for the selected target range.\n\n"
                "Core task: substitute editorText into the selected target range, inspect the resulting patchedWindow, then return ONLY the corrected text that should occupy that same range.\n\n"
                "Hard rules:\n"
                "1. Do not summarize, explain, or freely rewrite the whole parent message.\n"
                "2. The output must be a replacement for the selected target range only. Never include beforeTarget or afterTarget unless those characters are already inside the selected range.\n"
                "3. If the selected range is only part of a sentence, do NOT complete the rest of the sentence when that rest already exists in afterTarget. The returned text must stop exactly at the selected range boundary.\n"
                "4. Before returning, mentally concatenate: beforeTarget + output + afterTarget. If output ending repeats the beginning of afterTarget, remove the repeated part from output.\n"
                "5. Judge quality by the substituted result, not by editorText in isolation. patchedWindow is the text that must become coherent.\n"
                "6. If patchedWindow is already smooth and Markdown-valid, return editorText unchanged.\n"
                "7. If patchedWindow is awkward, fix only the returned range text so that substituting it back makes patchedWindow smooth.\n"
                "8. If Markdown is broken after substitution, repair the returned text so the substituted result has correct Markdown. Check bold/italic/code/strike markers, lists, quotes, tables, code fences, indentation, and paragraph blank lines.\n"
                "9. Markdown boundary rule: after normal paired Markdown inside the text is accounted for, the remaining leading and trailing inline markers of the returned text must match the original selected range. If the original selected range has no boundary marker, do not add one. Do not mix markers such as ** with __, * with _, or ` with ** at the boundaries.\n"
                "10. Preserve meaning and supported facts. Do not introduce facts not supported by parent context, child conversation, or user instruction.\n\n"
                "Output only the final corrected range text. No title, no quote marks, no explanation, no review report."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Edit type guide:\n{EDIT_TYPE_GENERATION_GUIDE[edit_type]}\n\n"
                f"User instruction:\n{instruction_text}\n\n"
                f"Selected target range coordinates: [{target_range_start}, {target_range_end})\n\n"
                f"Original selected range text:\n{original_text}\n\n"
                f"Editor text to substitute into the selected range:\n{replacement_text}\n\n"
                f"Anchor metadata:\n"
                f"- prefix: {source_metadata.get('anchorPrefix') or ''}\n"
                f"- anchor: {source_metadata.get('anchorText') or ''}\n"
                f"- suffix: {source_metadata.get('anchorSuffix') or ''}\n\n"
                f"beforeTarget in review window:\n{review_window['beforeTarget']}\n\n"
                f"originalTarget in review window:\n{review_window['originalTarget']}\n\n"
                f"afterTarget in review window:\n{review_window['afterTarget']}\n\n"
                f"originalWindow before substitution:\n{review_window['originalWindow']}\n\n"
                f"patchedWindow after substituting editor text:\n{review_window['patchedWindow']}\n\n"
                f"patchedFullMessage:\n{review_window['patchedFullMessage']}\n\n"
                "Return only the corrected text that should replace the selected range."
            ),
        },
    ]


@app.post("/api/backfill/range-decision", status_code=200)
def decide_backfill_range(payload: BackfillRangeDecisionCreate, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        context = load_backfill_generation_context(
            conn,
            user["id"],
            payload.sourceChildNodeId,
            payload.targetMessageId,
            payload.editType,
            payload.userInstruction,
        )
        target_message = context["target_message"]
        anchor_start = context["anchor_start"]
        anchor_end = context["anchor_end"]
        target_start, target_end, range_reason = decide_target_range(
            target_message["content"],
            anchor_start,
            anchor_end,
            context["effective_edit_type"],
            payload.userInstruction,
        )
        validate_backfill_conflict(conn, payload.targetMessageId, target_start, target_end, payload.sourceChildNodeId)
        original_text = target_message["content"][target_start:target_end]
        anchor_text = target_message["content"][anchor_start:anchor_end]
        return {
            "decision": {
                "sourceChildNodeId": payload.sourceChildNodeId,
                "targetMessageId": payload.targetMessageId,
                "editType": context["effective_edit_type"],
                "anchorRangeStart": anchor_start,
                "anchorRangeEnd": anchor_end,
                "anchorText": anchor_text,
                "targetRangeStart": target_start,
                "targetRangeEnd": target_end,
                "originalText": original_text,
                "reason": range_reason,
                "expanded": target_start != anchor_start or target_end != anchor_end,
            }
        }


@app.post("/api/backfill/draft", status_code=201)
def create_backfill_draft(payload: BackfillDraftCreate, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        context = load_backfill_generation_context(
            conn,
            user["id"],
            payload.sourceChildNodeId,
            payload.targetMessageId,
            payload.editType,
            payload.userInstruction,
        )
        source_metadata = context["source_metadata"]
        target_message = context["target_message"]
        effective_edit_type = context["effective_edit_type"]
        anchor_start = context["anchor_start"]
        anchor_end = context["anchor_end"]
        if payload.targetRangeStart is not None and payload.targetRangeEnd is not None:
            target_start = payload.targetRangeStart
            target_end = payload.targetRangeEnd
            original_text = validate_target_range_contains_anchor(
                target_message["content"],
                target_start,
                target_end,
                anchor_start,
                anchor_end,
            )
            range_reason = None
        else:
            target_start, target_end, range_reason = decide_target_range(
                target_message["content"],
                anchor_start,
                anchor_end,
                effective_edit_type,
                payload.userInstruction,
            )
            original_text = target_message["content"][target_start:target_end]
        validate_backfill_conflict(conn, payload.targetMessageId, target_start, target_end, payload.sourceChildNodeId)

        existing_patches = list_message_patches(conn, user["id"], payload.targetMessageId)
        parent_content = target_message["content"]
        model_messages = build_backfill_cloze_draft_messages(
            edit_type=effective_edit_type,
            user_instruction=payload.userInstruction,
            parent_content=parent_content,
            original_text=original_text,
            source_metadata=source_metadata,
            child_messages=context["meaningful_child_messages"],
            existing_patches=existing_patches,
            target_range_start=target_start,
            target_range_end=target_end,
        )

    try:
        draft_text = clean_backfill_draft(call_model(model_messages, payload.modelName, payload.thinkingMode or "fast"))
    except ModelConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ModelProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if draft_text == "__INSUFFICIENT_CONTEXT__" or not draft_text:
        draft_text = original_text
    if effective_edit_type not in UNLIMITED_REPLACEMENT_EDIT_TYPES and len(draft_text) > MAX_REPLACEMENT_CHARS:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "BACKFILL_DRAFT_TOO_LONG",
                "message": "生成的回填内容过长，可能会破坏原文节奏。请缩短回填内容，或改用补充/重构方式重新生成。",
            },
        )

    return {
        "draft": {
            "sourceChildNodeId": payload.sourceChildNodeId,
            "targetMessageId": payload.targetMessageId,
            "editType": effective_edit_type,
            "targetRangeStart": target_start,
            "targetRangeEnd": target_end,
            "originalText": original_text,
            "replacementText": draft_text,
            "rangeSuggestion": {
                "targetRangeStart": target_start,
                "targetRangeEnd": target_end,
                "reason": range_reason,
            }
            if range_reason
            else None,
        }
    }


@app.post("/api/backfill/review", status_code=200)
def review_backfill_replacement(payload: BackfillReviewCreate, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        context = load_backfill_generation_context(
            conn,
            user["id"],
            payload.sourceChildNodeId,
            payload.targetMessageId,
            payload.editType,
            payload.userInstruction,
        )
        target_message = context["target_message"]
        original_text = validate_target_range_contains_anchor(
            target_message["content"],
            payload.targetRangeStart,
            payload.targetRangeEnd,
            context["anchor_start"],
            context["anchor_end"],
        )
        target_start = payload.targetRangeStart
        target_end = payload.targetRangeEnd
        validate_backfill_conflict(
            conn,
            payload.targetMessageId,
            payload.targetRangeStart,
            payload.targetRangeEnd,
            payload.sourceChildNodeId,
        )
        replacement_text = payload.replacementText.strip("\r\n")
        if not replacement_text.strip():
            raise HTTPException(status_code=400, detail="replacementText cannot be empty")
        review_window = build_backfill_review_window(
            target_message["content"],
            target_start,
            target_end,
            replacement_text,
        )
        model_messages = build_backfill_context_review_messages(
            edit_type=context["effective_edit_type"],
            user_instruction=payload.userInstruction,
            parent_content=target_message["content"],
            original_text=original_text,
            replacement_text=replacement_text,
            source_metadata=context["source_metadata"],
            target_range_start=target_start,
            target_range_end=target_end,
        )

    try:
        reviewed_text = clean_backfill_draft(call_model(model_messages, payload.modelName, payload.thinkingMode or "fast"))
    except ModelConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ModelProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not reviewed_text:
        reviewed_text = replacement_text
    reviewed_text = trim_reviewed_text_to_range(
        reviewed_text,
        review_window["beforeTarget"],
        review_window["afterTarget"],
    )
    reviewed_text = align_reviewed_markdown_boundaries(reviewed_text, original_text)
    if not reviewed_text.strip():
        reviewed_text = replacement_text
    return {
        "review": {
            "sourceChildNodeId": payload.sourceChildNodeId,
            "targetMessageId": payload.targetMessageId,
            "editType": context["effective_edit_type"],
            "targetRangeStart": target_start,
            "targetRangeEnd": target_end,
            "originalText": original_text,
            "replacementText": reviewed_text,
            "changed": reviewed_text != replacement_text,
        }
    }


@app.post("/api/backfill/patches", status_code=201)
def create_backfill_patch(payload: BackfillPatchCreate, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        patch = create_and_apply_patch(
            conn,
            user["id"],
            source_child_node_id=payload.sourceChildNodeId,
            target_message_id=payload.targetMessageId,
            edit_type=payload.editType,
            target_range_start=payload.targetRangeStart,
            target_range_end=payload.targetRangeEnd,
            replacement_text=payload.replacementText,
        )
        return {"patch": patch}


@app.post("/api/backfill/patches/{patch_id}/archive")
def archive_backfill_patch(patch_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        patch = archive_patch(conn, user["id"], patch_id)
        return {"patch": patch}


@app.post("/api/nodes/{node_id}/web-search")
async def node_web_search(node_id: str, payload: NodeWebSearchRequest, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        node = get_node_for_user(conn, node_id, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        sources = await collect_and_save_web_sources(
            conn,
            user_id=user["id"],
            node=node,
            query=payload.query.strip(),
            max_results=payload.max_results,
            fetch_top_k=payload.fetch_top_k,
        )
        return {"sources": [source_public_view(source, include_content=True) for source in sources]}


@app.post("/api/nodes", status_code=201)
def create_node(payload: NodeCreate, user: dict = Depends(require_user)) -> dict:
    node_id = payload.id or uid("node")
    ts = now_iso()

    with connect() as conn:
        source_metadata_json: str | None = None
        if payload.parentId:
            parent = get_node_for_user(conn, payload.parentId, user["id"])
            if not parent:
                raise HTTPException(status_code=404, detail="Parent node not found")
            notebook_id = parent["notebook_id"]
            context_mode = payload.contextWeight
            if payload.sourceMetadata is not None:
                source_metadata_json = normalize_source_metadata_for_storage(
                    conn,
                    user["id"],
                    payload.parentId,
                    payload.sourceMetadata,
                )
        else:
            notebook_id = payload.notebookId or node_id
            context_mode = "mainline"
            conn.execute(
                """
                INSERT INTO notebooks(id, owner_user_id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  owner_user_id = excluded.owner_user_id,
                  title = excluded.title,
                  updated_at = excluded.updated_at
                """,
                (notebook_id, user["id"], payload.title, ts, ts),
            )

        sibling_count = conn.execute(
            "SELECT COUNT(*) AS count FROM nodes WHERE notebook_id = ? AND parent_id IS ?",
            (notebook_id, payload.parentId),
        ).fetchone()["count"]

        conn.execute(
            """
            INSERT INTO nodes(
              id, notebook_id, parent_id, title, summary, selected_text, source_metadata_json,
              context_mode, position, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              summary = excluded.summary,
              selected_text = excluded.selected_text,
              source_metadata_json = excluded.source_metadata_json,
              context_mode = excluded.context_mode,
              updated_at = excluded.updated_at
            """,
            (
                node_id,
                notebook_id,
                payload.parentId,
                payload.title,
                payload.summary,
                payload.selectedText,
                source_metadata_json,
                context_mode,
                sibling_count,
                ts,
                ts,
            ),
        )

        for message in payload.messages:
            conn.execute(
                """
                INSERT OR IGNORE INTO messages(id, node_id, role, content, selected_text, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    message.id or uid("msg"),
                    node_id,
                    message.role,
                    message.content,
                    message.selectedText,
                    message.createdAt or ts,
                ),
            )

        touch_node(conn, node_id, ts)
        return {"id": node_id, "notebookId": notebook_id}


@app.patch("/api/nodes/{node_id}")
def patch_node(node_id: str, payload: NodePatch, user: dict = Depends(require_user)) -> dict:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return {"ok": True}

    with connect() as conn:
        node = get_node_for_user(conn, node_id, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        if "parentId" in updates and updates["parentId"] != node["parent_id"]:
            target_parent_id = updates["parentId"]
            if target_parent_id is None:
                raise HTTPException(status_code=400, detail="Use root creation for notebook roots")
            if target_parent_id == node_id:
                raise HTTPException(status_code=400, detail="Node cannot be its own parent")
            if target_parent_id in descendant_ids(conn, node_id):
                raise HTTPException(status_code=400, detail="Node cannot move under its own descendant")
            parent = get_node_for_user(conn, target_parent_id, user["id"])
            if not parent:
                raise HTTPException(status_code=404, detail="Target parent not found")
            conn.execute(
                "UPDATE nodes SET parent_id = ?, notebook_id = ?, updated_at = ? WHERE id = ?",
                (target_parent_id, parent["notebook_id"], now_iso(), node_id),
            )

        field_map = {
            "title": "title",
            "summary": "summary",
            "selectedText": "selected_text",
            "contextWeight": "context_mode",
        }
        for api_name, column in field_map.items():
            if api_name in updates:
                conn.execute(f"UPDATE nodes SET {column} = ?, updated_at = ? WHERE id = ?", (updates[api_name], now_iso(), node_id))

        if "title" in updates and node["parent_id"] is None:
            conn.execute("UPDATE notebooks SET title = ?, updated_at = ? WHERE id = ?", (updates["title"], now_iso(), node["notebook_id"]))

        touch_node(conn, node_id)
        return {"ok": True}


@app.delete("/api/nodes/{node_id}")
def delete_node(node_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        node = get_node_for_user(conn, node_id, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        if node["parent_id"] is None:
            conn.execute("DELETE FROM notebooks WHERE id = ?", (node["notebook_id"],))
        else:
            conn.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
            conn.execute("UPDATE notebooks SET updated_at = ? WHERE id = ?", (now_iso(), node["notebook_id"]))
        return {"ok": True}


@app.post("/api/chat")
async def chat(payload: ChatRequest, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        if payload.notebookId and not get_notebook_for_user(conn, payload.notebookId, user["id"]):
            raise HTTPException(status_code=404, detail="Notebook not found")

        user_message = add_message(conn, payload.nodeId, "user", payload.message.strip(), payload.userMessageId)
        web_sources: list[dict] = []
        web_search_warning: str | None = None
        if payload.web_search:
            web_sources, web_search_warning = await try_collect_web_sources(
                conn,
                user_id=user["id"],
                node=node,
                query=(payload.web_query or payload.message).strip(),
                max_results=5,
                fetch_top_k=3,
            )
        model_messages = build_model_messages(
            conn,
            payload.nodeId,
            model_name=payload.modelName,
            web_sources=web_sources,
            user_query=(payload.web_query or payload.message).strip(),
            enable_rag=payload.rag_enabled,
        )

        try:
            content = call_model(model_messages, payload.modelName, payload.thinkingMode)
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ModelProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        content = finalize_web_search_answer(content, web_sources, web_search_warning)
        assistant_message = add_message(conn, payload.nodeId, "assistant", content)
        node_title = maybe_generate_root_title(conn, payload.nodeId, payload.message.strip(), content, payload.modelName)
        node_summary = maybe_generate_node_summary(conn, payload.nodeId, payload.modelName)
        
        # 绱㈠紩瀵硅瘽鍐呭鍒板悜閲忓瓨鍌紙RAG锛?
        if payload.ragEnabled:
            index_node_to_vector_store(conn, payload.nodeId)
        
        return {
            "messageId": assistant_message["id"],
            "role": "assistant",
            "content": assistant_message["content"],
            "createdAt": assistant_message["createdAt"],
            "userMessage": user_message,
            "message": assistant_message,
            "nodeId": payload.nodeId,
            "nodeTitle": node_title,
            "nodeSummary": node_summary,
            "sources": [source_brief_view(source) for source in web_sources],
            "webSearchWarning": web_search_warning,
        }


@app.post("/api/chat/stop")
def stop_chat(payload: ChatStopRequest, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

    message = save_stopped_assistant(payload.nodeId, [payload.content], payload.assistantMessageId)
    return {"message": message}


@app.post("/api/chat/retry")
def retry_chat(payload: ChatRetryRequest, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        target_message = conn.execute(
            """
            SELECT id, created_at
            FROM messages
            WHERE id = ? AND node_id = ? AND role = 'assistant'
            """,
            (payload.assistantMessageId, payload.nodeId),
        ).fetchone()
        if not target_message:
            raise HTTPException(status_code=404, detail="Assistant message not found")

        previous_user_message = conn.execute(
            """
            SELECT id, content, created_at
            FROM messages
            WHERE node_id = ? AND role = 'user' AND created_at < ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (payload.nodeId, target_message["created_at"]),
        ).fetchone()
        if not previous_user_message:
            raise HTTPException(status_code=400, detail="No user message found to retry")

        model_messages = build_model_messages(conn, payload.nodeId, previous_user_message["created_at"], payload.modelName)
        archived_patch_count = archive_patches_for_message(
            conn,
            user["id"],
            payload.assistantMessageId,
            "target_message_regenerated",
        )

        try:
            content = call_model(model_messages, payload.modelName, payload.thinkingMode)
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ModelProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        assistant_message = update_assistant_message(conn, payload.assistantMessageId, payload.nodeId, content)
        node_title = maybe_generate_root_title(conn, payload.nodeId, previous_user_message["content"], content, payload.modelName)
        node_summary = maybe_generate_node_summary(conn, payload.nodeId, payload.modelName)
        return {
            "messageId": assistant_message["id"],
            "role": "assistant",
            "content": assistant_message["content"],
            "createdAt": assistant_message["createdAt"],
            "message": assistant_message,
            "nodeId": payload.nodeId,
            "nodeTitle": node_title,
            "nodeSummary": node_summary,
            "archivedPatchCount": archived_patch_count,
        }


@app.post("/api/chat/retry/stream")
def retry_chat_stream(payload: ChatRetryRequest, user: dict = Depends(require_user)) -> StreamingResponse:
    with connect() as conn:
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        target_message = conn.execute(
            """
            SELECT id, created_at
            FROM messages
            WHERE id = ? AND node_id = ? AND role = 'assistant'
            """,
            (payload.assistantMessageId, payload.nodeId),
        ).fetchone()
        if not target_message:
            raise HTTPException(status_code=404, detail="Assistant message not found")

        previous_user_message = conn.execute(
            """
            SELECT id, content, created_at
            FROM messages
            WHERE node_id = ? AND role = 'user' AND created_at < ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (payload.nodeId, target_message["created_at"]),
        ).fetchone()
        if not previous_user_message:
            raise HTTPException(status_code=400, detail="No user message found to retry")

        model_messages = build_model_messages(conn, payload.nodeId, previous_user_message["created_at"], payload.modelName)
        archived_patch_count = archive_patches_for_message(
            conn,
            user["id"],
            payload.assistantMessageId,
            "target_message_regenerated",
        )
        previous_user_content = previous_user_message["content"]

    def generate():
        content_parts: list[str] = []
        model_stream = None
        try:
            model_stream = stream_model(model_messages, payload.modelName, payload.thinkingMode)
            for delta in model_stream:
                content_parts.append(delta)
                yield sse_event({"content": delta})

            content = "".join(content_parts).strip() or "模型没有返回内容。"
            with connect() as conn:
                assistant_message = update_assistant_message(conn, payload.assistantMessageId, payload.nodeId, content)
                node_title = maybe_generate_root_title(conn, payload.nodeId, previous_user_content, content, payload.modelName)
                node_summary = maybe_generate_node_summary(conn, payload.nodeId, payload.modelName)
            yield sse_event(
                {
                    "messageId": assistant_message["id"],
                    "role": "assistant",
                    "content": assistant_message["content"],
                    "createdAt": assistant_message["createdAt"],
                    "message": assistant_message,
                    "nodeId": payload.nodeId,
                    "nodeTitle": node_title,
                    "nodeSummary": node_summary,
                    "archivedPatchCount": archived_patch_count,
                },
                "done",
            )
        except GeneratorExit:
            if model_stream is not None:
                model_stream.close()
            raise
        except (ModelConfigurationError, ModelProviderError) as exc:
            yield sse_event({"error": str(exc)}, "error")
        except Exception as exc:
            yield sse_event({"error": f"Unexpected server error: {exc}"}, "error")

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/chat/stream")
async def chat_stream(payload: ChatRequest, user: dict = Depends(require_user)) -> StreamingResponse:
    with connect() as conn:
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        if payload.notebookId and not get_notebook_for_user(conn, payload.notebookId, user["id"]):
            raise HTTPException(status_code=404, detail="Notebook not found")

        user_message = add_message(conn, payload.nodeId, "user", payload.message.strip(), payload.userMessageId)
        web_sources: list[dict] = []
        web_search_warning: str | None = None
        if payload.web_search:
            web_sources, web_search_warning = await try_collect_web_sources(
                conn,
                user_id=user["id"],
                node=node,
                query=(payload.web_query or payload.message).strip(),
                max_results=5,
                fetch_top_k=3,
            )
        model_messages = build_model_messages(
            conn,
            payload.nodeId,
            model_name=payload.modelName,
            web_sources=web_sources,
            user_query=(payload.web_query or payload.message).strip(),
            enable_rag=payload.rag_enabled,
        )

    def generate():
        content_parts: list[str] = []
        model_stream = None
        try:
            model_stream = stream_model(model_messages, payload.modelName, payload.thinkingMode)
            for delta in model_stream:
                content_parts.append(delta)
                yield sse_event({"content": delta})

            content = finalize_web_search_answer(
                "".join(content_parts).strip() or "模型没有返回内容。",
                web_sources,
                web_search_warning,
            )
            with connect() as conn:
                assistant_message = add_message(conn, payload.nodeId, "assistant", content)
                node_title = maybe_generate_root_title(conn, payload.nodeId, payload.message.strip(), content, payload.modelName)
                node_summary = maybe_generate_node_summary(conn, payload.nodeId, payload.modelName)
                # 绱㈠紩瀵硅瘽鍐呭鍒板悜閲忓瓨鍌紙RAG锛?
                if payload.ragEnabled:
                    index_node_to_vector_store(conn, payload.nodeId)
            yield sse_event(
                {
                    "messageId": assistant_message["id"],
                    "role": "assistant",
                    "content": assistant_message["content"],
                    "createdAt": assistant_message["createdAt"],
                    "userMessage": user_message,
                    "message": assistant_message,
                    "nodeId": payload.nodeId,
                    "nodeTitle": node_title,
                    "nodeSummary": node_summary,
                    "sources": [source_brief_view(source) for source in web_sources],
                    "webSearchWarning": web_search_warning,
                },
                "done",
            )
        except GeneratorExit:
            if model_stream is not None:
                model_stream.close()
            try:
                save_stopped_assistant(payload.nodeId, content_parts, payload.assistantMessageId)
            except Exception:
                pass
            raise
        except (ModelConfigurationError, ModelProviderError) as exc:
            yield sse_event({"error": str(exc)}, "error")
        except Exception as exc:
            yield sse_event({"error": f"Unexpected server error: {exc}"}, "error")

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
