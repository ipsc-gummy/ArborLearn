from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from .auth import create_token, normalize_email, password_hash, require_user, verify_password
from .backfill import (
    MAX_REPLACEMENT_CHARS,
    UNLIMITED_REPLACEMENT_EDIT_TYPES,
    active_patch_overlap,
    archive_patch,
    archive_patches_for_message,
    create_and_apply_patch,
    list_message_patches,
    message_for_user,
    normalize_source_metadata_for_storage,
    parse_source_metadata,
    resolve_anchor_range,
    source_node_for_user,
)
from .billing import (
    WalletInsufficientCreditError,
    ensure_wallet,
    ensure_wallet_can_charge_model,
    record_successful_model_usage,
    wallet_public_view,
    wallet_quota_for_user,
)
from .context_builder import build_model_messages, index_node_to_vector_store
from .db import (
    add_message,
    add_uploaded_file,
    add_web_source,
    connect,
    create_starter_notebook,
    create_long_task,
    delete_uploaded_file,
    descendant_ids,
    get_long_task_for_user,
    get_long_task_step_for_user,
    get_node_for_user,
    get_notebook_for_user,
    get_uploaded_file_for_user,
    get_notebook_state,
    get_usage_summary,
    get_usage_timeseries,
    get_usage_tree,
    init_db,
    insert_model_call_log,
    list_usage_events,
    list_long_task_steps,
    list_long_tasks_for_node,
    list_messages,
    list_step_outputs,
    list_task_evidence,
    list_uploaded_files,
    now_iso,
    touch_node,
    update_uploaded_file_extraction,
    update_long_task_status,
    uid,
)
from .effective_context import content_hash, list_effective_messages
from .file_uploads import extract_stored_file, prepare_uploaded_file
from .long_task_context import build_step_context
from .long_task_runner import LongTaskRunner
from .long_task_schemas import LongTaskCreateRequest
from .model_client import (
    DEFAULT_MODEL_NAME,
    DEEPSEEK_MODEL_NAMES,
    ModelConfigurationError,
    ModelProviderError,
    call_model,
    call_model_with_usage,
    stream_model,
    stream_model_events,
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
APP_SETTING_DEFINITIONS: dict[str, dict[str, int | str]] = {
    "demo_nudge_question_trigger": {
        "label": "温和提示触发提问数",
        "default": 5,
        "min": 1,
        "max": 100,
    },
    "demo_nudge_notebook_trigger": {
        "label": "温和提示触发新增笔记本数",
        "default": 1,
        "min": 1,
        "max": 20,
    },
    "demo_nudge_auto_hide_ms": {
        "label": "温和提示停留时间（毫秒）",
        "default": 13000,
        "min": 3000,
        "max": 60000,
    },
    "demo_lock_question_trigger": {
        "label": "强制绑定触发提问数",
        "default": 10,
        "min": 1,
        "max": 200,
    },
    "demo_lock_notebook_trigger": {
        "label": "强制绑定触发新增笔记本数",
        "default": 3,
        "min": 1,
        "max": 50,
    },
    "demo_session_ttl_hours": {
        "label": "演示账号保留时长（小时）",
        "default": DEMO_SESSION_TTL_HOURS,
        "min": 1,
        "max": 168,
    },
}


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


class DemoUpgradeRequest(AuthRequest):
    pass


class PasswordChangeRequest(BaseModel):
    currentPassword: str = Field(min_length=1)
    newPassword: str = Field(min_length=8)


class AdminSettingsUpdate(BaseModel):
    settings: dict[str, int]


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
    title: str = "新的对话节点"
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
    pinned: bool | None = None


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


def wallet_http_error(exc: WalletInsufficientCreditError) -> HTTPException:
    return HTTPException(
        status_code=402,
        detail={
            "code": "WALLET_INSUFFICIENT_CREDIT",
            "message": "钱包余额不足，请补充额度后再调用模型。",
            "balanceCents": exc.balance_cents,
            "balanceMicroCents": exc.balance_micro_cents,
            "balanceTokens": exc.balance_tokens,
        },
    )


def serialize_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "displayName": user["display_name"],
        "isTemporary": bool(user.get("is_temporary", 0)),
        "isAdmin": bool(user.get("is_admin", 0)),
    }


def _setting_default(key: str) -> int:
    return int(APP_SETTING_DEFINITIONS[key]["default"])


def serialize_app_settings(settings: dict[str, int]) -> dict:
    return {
        key: {
            "value": settings[key],
            "label": definition["label"],
            "default": int(definition["default"]),
            "min": int(definition["min"]),
            "max": int(definition["max"]),
        }
        for key, definition in APP_SETTING_DEFINITIONS.items()
    }


def get_app_settings() -> dict[str, int]:
    with connect() as conn:
        rows = conn.execute("SELECT key, value FROM app_settings").fetchall()
    raw_values = {row["key"]: row["value"] for row in rows}
    settings: dict[str, int] = {}
    for key, definition in APP_SETTING_DEFINITIONS.items():
        default = int(definition["default"])
        minimum = int(definition["min"])
        maximum = int(definition["max"])
        try:
            value = int(raw_values.get(key, default))
        except (TypeError, ValueError):
            value = default
        settings[key] = max(minimum, min(maximum, value))
    return settings


def set_app_settings(values: dict[str, int]) -> dict[str, int]:
    settings = get_app_settings()
    ts = now_iso()
    with connect() as conn:
        for key, value in values.items():
            if key not in APP_SETTING_DEFINITIONS:
                raise HTTPException(status_code=400, detail=f"Unknown setting: {key}")
            definition = APP_SETTING_DEFINITIONS[key]
            minimum = int(definition["min"])
            maximum = int(definition["max"])
            normalized = max(minimum, min(maximum, int(value)))
            conn.execute(
                """
                INSERT INTO app_settings(key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (key, str(normalized), ts),
            )
            settings[key] = normalized
    return settings


def require_admin(user: dict = Depends(require_user)) -> dict:
    if not user.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin account required")
    return user


def sse_event(payload: dict, event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def stopped_assistant_content(content: str) -> str | None:
    content = content.strip()
    if not content:
        return None
    return f"{content}\n\n[stopped]"
    return f"{content}\n\n[已停止]"


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


def uploaded_file_public_view(uploaded_file: dict, include_text: bool = False) -> dict:
    payload = {
        "id": uploaded_file["id"],
        "nodeId": uploaded_file["nodeId"],
        "notebookId": uploaded_file["notebookId"],
        "filename": uploaded_file["filename"],
        "originalFilename": uploaded_file["originalFilename"],
        "mimeType": uploaded_file["mimeType"],
        "fileSize": uploaded_file["fileSize"],
        "extractionStatus": uploaded_file["extractionStatus"],
        "extractedChars": uploaded_file["extractedChars"],
        "errorMessage": uploaded_file["errorMessage"],
        "createdAt": uploaded_file["createdAt"],
        "updatedAt": uploaded_file["updatedAt"],
    }
    if include_text:
        payload["extractedText"] = uploaded_file.get("extractedText", "")
    return payload


def run_file_extraction_task(
    file_id: str,
    user_id: str,
    storage_path: str,
    filename: str,
    mime_type: str | None,
    notebook_id: str | None = None,
    node_id: str | None = None,
) -> None:
    try:
        extracted_text, extraction_status, error_message = extract_stored_file(
            storage_path=storage_path,
            filename=filename,
            mime_type=mime_type,
            billing_context={"user_id": user_id, "notebook_id": notebook_id, "node_id": node_id},
        )
    except Exception as exc:
        extracted_text = ""
        extraction_status = "failed"
        error_message = f"Unable to extract file text: {exc}"

    with connect() as conn:
        update_uploaded_file_extraction(
            conn,
            file_id,
            user_id,
            extracted_text=extracted_text,
            extraction_status=extraction_status,
            error_message=error_message,
        )


def append_source_references(content: str, sources: list[dict]) -> str:
    if not sources:
        return content
    if all(source.get("url") and str(source["url"]) in content for source in sources):
        return content
    references = "\n".join(
        f"[S{index}] {source.get('title') or '来源'} - {source.get('url')}"
        for index, source in enumerate(sources, start=1)
        if source.get("url")
    )
    return f"{content.rstrip()}\n\n参考来源:\n{references}"


def append_web_search_warning(content: str, warning: str | None) -> str:
    if not warning:
        return content
    return f"{content.rstrip()}\n\n> 联网检索未完成：{warning}\n> 已降级为不使用网页证据的回答。"


UNVERIFIED_REFERENCES_RE = re.compile(
    r"\n{0,2}(?:#{1,6}\s*)?(?:参考来源|来源|References)\s*[:：]\s*[\s\S]*$",
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


async def wait_for_node_for_user(node_id: str, user_id: str) -> sqlite3.Row | None:
    for attempt in range(8):
        with connect() as conn:
            node = get_node_for_user(conn, node_id, user_id)
            if node:
                return node
        if attempt < 7:
            await asyncio.sleep(0.15)
    return None


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
    title = title.strip("`'\"“”‘’ ")
    prefixes = ("Title:", "title:", "标题:", "標題:")
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
    user_id: str | None = None,
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
    if not node or node["parent_id"] is not None or node["title"] != "新的学习主题":
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
        if user_id:
            ensure_wallet_can_charge_model(conn, user_id, model_name)
        started = time.time()
        result = call_model_with_usage(title_messages, model_name, "fast")
        title = clean_generated_title(result.content)
        if user_id:
            record_successful_model_usage(
                conn,
                user_id=user_id,
                notebook_id=node["notebook_id"],
                node_id=node_id,
                call_type="title",
                model_name=model_name,
                thinking_mode="fast",
                messages=title_messages,
                output_text=result.content,
                usage=result.usage,
                latency_ms=int((time.time() - started) * 1000),
            )
    except (WalletInsufficientCreditError, ModelConfigurationError, ModelProviderError):
        return None
    if not title:
        return None

    ts = now_iso()
    conn.execute("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?", (title, ts, node_id))
    conn.execute("UPDATE notebooks SET title = ?, updated_at = ? WHERE id = ?", (title, ts, node["notebook_id"]))
    return title


def clean_generated_summary(raw_summary: str) -> str:
    summary = " ".join(raw_summary.strip().split())
    summary = summary.strip("`'\"“”‘’ ")
    prefixes = ("Summary:", "summary:", "摘要:", "总结:", "概述:")
    for prefix in prefixes:
        if summary.startswith(prefix):
            summary = summary[len(prefix) :].strip()
    return summary[:180].strip()


def maybe_generate_branch_summary(
    conn: sqlite3.Connection, node_id: str, model_name: str | None = None, user_id: str | None = None
) -> str | None:
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
                "你正在为一个树形学习产品生成子对话预览摘要。"
                "请概括整个子对话目前讨论了什么、得出了什么要点。"
                "只输出摘要正文，不要标题，不要列表，不要使用“围绕”“创建的局部追问”等模板化字样。"
                "控制在 45 个中文字以内。"
            ),
        },
        {
            "role": "user",
            "content": f"触发片段：{node['selected_text'] or node['title']}\n\n子对话内容：\n{conversation[-4000:]}",
        },
    ]
    try:
        if user_id:
            ensure_wallet_can_charge_model(conn, user_id, model_name)
        started = time.time()
        result = call_model_with_usage(summary_messages, model_name, "fast")
        summary = clean_generated_summary(result.content)
        if user_id:
            record_successful_model_usage(
                conn,
                user_id=user_id,
                node_id=node_id,
                call_type="branch_summary",
                model_name=model_name,
                thinking_mode="fast",
                messages=summary_messages,
                output_text=result.content,
                usage=result.usage,
                latency_ms=int((time.time() - started) * 1000),
            )
    except (WalletInsufficientCreditError, ModelConfigurationError, ModelProviderError):
        return None
    if not summary:
        return None

    conn.execute("UPDATE nodes SET summary = ?, summary_stale = 0, updated_at = ? WHERE id = ?", (summary, now_iso(), node_id))
    return summary


def maybe_generate_node_summary(
    conn: sqlite3.Connection, node_id: str, model_name: str | None = None, user_id: str | None = None
) -> str | None:
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
        if user_id:
            ensure_wallet_can_charge_model(conn, user_id, model_name)
        started = time.time()
        result = call_model_with_usage(summary_messages, model_name, "fast")
        summary = clean_generated_summary(result.content)
        if user_id:
            record_successful_model_usage(
                conn,
                user_id=user_id,
                node_id=node_id,
                call_type="node_summary",
                model_name=model_name,
                thinking_mode="fast",
                messages=summary_messages,
                output_text=result.content,
                usage=result.usage,
                latency_ms=int((time.time() - started) * 1000),
            )
    except (WalletInsufficientCreditError, ModelConfigurationError, ModelProviderError):
        return None
    if not summary:
        return None

    conn.execute("UPDATE nodes SET summary = ?, summary_stale = 0, updated_at = ? WHERE id = ?", (summary, now_iso(), node_id))
    return summary


@app.on_event("startup")
def startup() -> None:
    init_db()
    ensure_admin_account()
    cleanup_demo_sessions()


def cleanup_demo_sessions() -> None:
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=get_app_settings()["demo_session_ttl_hours"])).isoformat()
    legacy_email = normalize_email(LEGACY_DEMO_ACCOUNT_EMAIL)
    with connect() as conn:
        conn.execute("DELETE FROM users WHERE is_temporary = 1 AND created_at < ?", (cutoff,))
        conn.execute("DELETE FROM users WHERE email = ?", (legacy_email,))


def ensure_admin_account() -> None:
    email = normalize_email(os.getenv("ADMIN_EMAIL", "admin@arborlearn.local"))
    password = os.getenv("ADMIN_PASSWORD", "")
    display_name = (os.getenv("ADMIN_DISPLAY_NAME", "ArborLearn Admin").strip() or "ArborLearn Admin")[:64]
    if not password:
        return
    ts = now_iso()
    with connect() as conn:
        existing = conn.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE users
                SET display_name = ?, password_hash = ?, is_temporary = 0, is_admin = 1, updated_at = ?
                WHERE id = ?
                """,
                (display_name, password_hash(password), ts, existing["id"]),
            )
            return
        conn.execute(
            """
            INSERT INTO users(id, email, display_name, password_hash, is_temporary, is_admin, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, 1, ?, ?)
            """,
            (uid("user"), email, display_name, password_hash(password), ts, ts),
        )


def create_isolated_demo_user() -> dict:
    cleanup_demo_sessions()
    user_id = uid("user")
    demo_suffix = user_id.removeprefix("user-")
    email = f"demo-{demo_suffix}@arborlearn.local"
    display_name = "演示体验"
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
        "is_admin": 0,
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


@app.get("/api/wallet")
def wallet(user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        initial_cents, initial_tokens = wallet_quota_for_user(conn, user["id"])
        return {
            "wallet": wallet_public_view(
                ensure_wallet(conn, user["id"]),
                initial_cents=initial_cents,
                initial_tokens=initial_tokens,
            )
        }


@app.get("/api/usage/summary")
def usage_summary(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    user: dict = Depends(require_user),
) -> dict:
    with connect() as conn:
        return get_usage_summary(conn, user["id"], from_, to)


@app.get("/api/usage/events")
def usage_events(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = Query(None),
    user: dict = Depends(require_user),
) -> dict:
    with connect() as conn:
        return list_usage_events(conn, user["id"], from_ts=from_, to_ts=to, limit=limit, cursor=cursor)


@app.get("/api/usage/timeseries")
def usage_timeseries(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    bucket: Literal["day", "hour"] = "day",
    user: dict = Depends(require_user),
) -> dict:
    with connect() as conn:
        return {"series": get_usage_timeseries(conn, user["id"], from_ts=from_, to_ts=to, bucket=bucket)}


@app.get("/api/usage/tree")
def usage_tree(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    groupBy: str = Query("model,callType"),
    user: dict = Depends(require_user),
) -> dict:
    if groupBy != "model,callType":
        raise HTTPException(status_code=400, detail="Only groupBy=model,callType is supported.")
    with connect() as conn:
        return {"tree": get_usage_tree(conn, user["id"], from_ts=from_, to_ts=to)}


@app.get("/api/app-settings")
def app_settings() -> dict:
    return {"settings": serialize_app_settings(get_app_settings())}


@app.get("/api/admin/settings")
def admin_settings(user: dict = Depends(require_admin)) -> dict:
    return {"settings": serialize_app_settings(get_app_settings())}


@app.patch("/api/admin/settings")
def update_admin_settings(payload: AdminSettingsUpdate, user: dict = Depends(require_admin)) -> dict:
    return {"settings": serialize_app_settings(set_app_settings(payload.settings))}


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

    user = {"id": user_id, "email": email, "display_name": display_name, "is_temporary": 0, "is_admin": 0}
    return {"token": create_token(user_id), "user": serialize_user(user)}


@app.post("/api/auth/upgrade-demo")
def upgrade_demo_account(payload: DemoUpgradeRequest, user: dict = Depends(require_user)) -> dict:
    if not user.get("is_temporary"):
        raise HTTPException(status_code=400, detail="Current account is already permanent")

    email = normalize_email(payload.email)
    if "@" not in email or "." not in email.rsplit("@", 1)[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address")

    display_name = (payload.displayName or email.split("@", 1)[0]).strip()[:64] or "ArborLearn User"
    ts = now_iso()
    with connect() as conn:
        try:
            conn.execute(
                """
                UPDATE users
                SET email = ?, display_name = ?, password_hash = ?, is_temporary = 0, updated_at = ?
                WHERE id = ? AND is_temporary = 1
                """,
                (email, display_name, password_hash(payload.password), ts, user["id"]),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(status_code=409, detail="Email is already registered") from exc

        upgraded_user = conn.execute(
            """
            SELECT id, email, display_name, is_temporary, is_admin
            FROM users
            WHERE id = ?
            """,
            (user["id"],),
        ).fetchone()

    if not upgraded_user:
        raise HTTPException(status_code=404, detail="Demo account not found")
    return {"token": create_token(user["id"]), "user": serialize_user(dict(upgraded_user))}


@app.post("/api/auth/demo", status_code=201)
def demo_session() -> dict:
    user = create_isolated_demo_user()
    return {"token": create_token(user["id"]), "user": serialize_user(user)}


@app.post("/api/auth/demo/notebooks/{notebook_ref}")
def resume_demo_notebook(notebook_ref: str) -> dict:
    with connect() as conn:
        user = conn.execute(
            """
            SELECT users.id, users.email, users.display_name, users.is_temporary, users.is_admin
            FROM notebooks
            JOIN users ON users.id = notebooks.owner_user_id
            WHERE users.is_temporary = 1
              AND (
                notebooks.id = ?
                OR EXISTS (
                  SELECT 1
                  FROM nodes
                  WHERE nodes.notebook_id = notebooks.id
                    AND nodes.parent_id IS NULL
                    AND nodes.id = ?
                )
              )
            LIMIT 1
            """,
            (notebook_ref, notebook_ref),
        ).fetchone()

    if not user:
        raise HTTPException(status_code=404, detail="Demo notebook not found")
    return {"token": create_token(user["id"]), "user": serialize_user(dict(user))}


@app.post("/api/auth/login")
def login(payload: AuthRequest) -> dict:
    email = normalize_email(payload.email)
    legacy_email = normalize_email(LEGACY_DEMO_ACCOUNT_EMAIL)
    if email == legacy_email:
        raise HTTPException(status_code=410, detail="演示入口已改为独立体验会话，请点击“体验示例”进入")

    with connect() as conn:
        user = conn.execute(
            """
            SELECT id, email, display_name, password_hash, is_temporary, is_admin
            FROM users
            WHERE email = ?
            """,
            (email,),
        ).fetchone()
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return {"token": create_token(user["id"]), "user": serialize_user(dict(user))}


@app.post("/api/auth/change-password")
def change_password(payload: PasswordChangeRequest, user: dict = Depends(require_user)) -> dict:
    if user.get("is_temporary"):
        raise HTTPException(status_code=400, detail="Demo accounts must be upgraded before changing password")

    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, password_hash
            FROM users
            WHERE id = ?
            """,
            (user["id"],),
        ).fetchone()
        if not row or not verify_password(payload.currentPassword, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Current password is incorrect")

        conn.execute(
            """
            UPDATE users
            SET password_hash = ?, updated_at = ?
            WHERE id = ?
            """,
            (password_hash(payload.newPassword), now_iso(), user["id"]),
        )
    return {"ok": True}


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


@app.post("/api/nodes/{node_id}/files", status_code=201)
async def upload_node_file(
    node_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: dict = Depends(require_user),
) -> dict:
    file_id = uid("file")
    with connect() as conn:
        node = get_node_for_user(conn, node_id, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

    prepared = await prepare_uploaded_file(
        file,
        user_id=user["id"],
        file_id=file_id,
        notebook_id=node["notebook_id"],
        node_id=node_id,
    )
    with connect() as conn:
        uploaded_file = add_uploaded_file(
            conn,
            file_id=file_id,
            user_id=user["id"],
            notebook_id=node["notebook_id"],
            node_id=node_id,
            **prepared,
        )
    if uploaded_file["extractionStatus"] == "pending":
        background_tasks.add_task(
            run_file_extraction_task,
            file_id,
            user["id"],
            prepared["storage_path"],
            prepared["filename"],
            prepared["mime_type"],
            node["notebook_id"],
            node_id,
        )
    return {"file": uploaded_file_public_view(uploaded_file)}


@app.get("/api/nodes/{node_id}/files")
def node_files(node_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        if not get_node_for_user(conn, node_id, user["id"]):
            raise HTTPException(status_code=404, detail="Node not found")
        files = list_uploaded_files(conn, user["id"], node_id)
        return {"files": [uploaded_file_public_view(file) for file in files]}


@app.get("/api/files/{file_id}")
def uploaded_file_detail(file_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        uploaded_file = get_uploaded_file_for_user(conn, file_id, user["id"])
        if not uploaded_file:
            raise HTTPException(status_code=404, detail="File not found")
        return {"file": uploaded_file_public_view(uploaded_file, include_text=True)}


@app.get("/api/files/{file_id}/content")
def uploaded_file_content(file_id: str, user: dict = Depends(require_user)) -> FileResponse:
    with connect() as conn:
        uploaded_file = get_uploaded_file_for_user(conn, file_id, user["id"])
        if not uploaded_file:
            raise HTTPException(status_code=404, detail="File not found")

    storage_path_value = uploaded_file.get("storagePath")
    storage_path = Path(storage_path_value) if storage_path_value else None
    if not storage_path or not storage_path.exists():
        raise HTTPException(status_code=404, detail="Stored file not found")

    return FileResponse(
        storage_path,
        media_type=uploaded_file.get("mimeType") or None,
        filename=uploaded_file.get("originalFilename") or uploaded_file.get("filename") or "upload",
    )


@app.delete("/api/files/{file_id}")
def remove_uploaded_file(file_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        uploaded_file = delete_uploaded_file(conn, file_id, user["id"])
        if not uploaded_file:
            raise HTTPException(status_code=404, detail="File not found")

    storage_path_value = uploaded_file.get("storagePath")
    storage_path = Path(storage_path_value) if storage_path_value else None
    if storage_path and storage_path.exists():
        shutil.rmtree(storage_path.parent, ignore_errors=True)
    return {"ok": True, "file": uploaded_file_public_view(uploaded_file)}


@app.get("/api/messages/{message_id}/patches")
def message_patches(message_id: str, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        return {"patches": list_message_patches(conn, user["id"], message_id)}


EDIT_TYPE_GENERATION_GUIDE = {
    "correct": "纠错：修正原选区中的事实、术语、表达错误。保持范围尽量短，不扩写。",
    "expand": "补充：把子对话中已经明确沉淀的结论补进原选区，可以适度扩展信息密度。",
    "compress": "压缩：保留核心意思，减少冗余，让原选区更紧凑。",
    "reframe": "重构：在不改变选区外内容的前提下，重新组织原选区表达，使逻辑更清晰。",
}


def clean_backfill_draft(raw: str) -> str:
    text = raw.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text).strip()
    text = text.strip(" \t\r\n")
    if (text.startswith('"') and text.endswith('"')) or (text.startswith("'") and text.endswith("'")):
        text = text[1:-1].strip()
    return text


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
    child_text = "\n".join(
        f"{message['role']}: {message['content']}" for message in child_messages if message.get("content")
    )
    patch_text = "\n".join(
        f"- {patch['editType']} [{patch['targetRangeStart']}, {patch['targetRangeEnd']}]: {patch['originalText']} => {patch['replacementText']}"
        for patch in existing_patches
        if patch.get("status") == "applied"
    ) or "无"
    instruction_text = user_instruction.strip() if user_instruction else "无"
    return [
        {
            "role": "system",
            "content": (
                "你是 ArborLearn 的回填草稿生成器。只生成目标选区的替换内容，不要重写整条父消息。"
                "必须保持父消息原有风格；不能引入子对话没有支持的新事实；不能改变选区外内容。"
                "输出必须是纯文本或 Markdown 片段，不要标题、解释、引号、项目说明。"
                "如果子对话信息不足以形成可靠回填，只输出 __INSUFFICIENT_CONTEXT__。"
            ),
        },
        {
            "role": "user",
            "content": (
                f"回填类型：{EDIT_TYPE_GENERATION_GUIDE[edit_type]}\n\n"
                f"父消息原文：\n{parent_content}\n\n"
                f"目标选区原文：\n{original_text}\n\n"
                f"选区锚点：\n"
                f"- prefix: {source_metadata.get('anchorPrefix') or ''}\n"
                f"- anchor: {source_metadata.get('anchorText') or ''}\n"
                f"- suffix: {source_metadata.get('anchorSuffix') or ''}\n\n"
                f"已有已生效回填：\n{patch_text}\n\n"
                f"用户额外生成提示：\n{instruction_text}\n\n"
                f"子对话内容：\n{child_text}\n\n"
                "请根据子对话内容生成 replacementText。"
            ),
        },
    ]


@app.post("/api/backfill/draft", status_code=201)
def create_backfill_draft(payload: BackfillDraftCreate, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        try:
            ensure_wallet_can_charge_model(conn, user["id"], payload.modelName)
        except WalletInsufficientCreditError as exc:
            raise wallet_http_error(exc) from exc
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        source_node = source_node_for_user(conn, user["id"], payload.sourceChildNodeId)
        if not source_node:
            raise HTTPException(status_code=404, detail="Source child node not found")
        source_metadata = parse_source_metadata(source_node["source_metadata_json"])
        if not source_metadata:
            raise HTTPException(status_code=400, detail="Source child node does not contain backfill metadata")
        if source_metadata.get("targetMessageId") != payload.targetMessageId:
            raise HTTPException(status_code=400, detail="Target message does not match source metadata")

        target_message = message_for_user(conn, payload.targetMessageId, user["id"])
        if not target_message:
            raise HTTPException(status_code=404, detail="Target message not found")
        if source_metadata.get("baseMessageContentHash") != content_hash(target_message["content"]):
            raise HTTPException(status_code=409, detail="Target message version has changed")

        target_start, target_end = resolve_anchor_range(target_message["content"], source_metadata)
        conflict = active_patch_overlap(
            conn,
            payload.targetMessageId,
            target_start,
            target_end,
            exclude_source_child_node_id=payload.sourceChildNodeId,
        )
        if conflict:
            raise HTTPException(status_code=409, detail=backfill_conflict_detail(conflict))

        child_messages = list_effective_messages(conn, payload.sourceChildNodeId, ascending=True)
        meaningful_child_messages = [
            message for message in child_messages if message["role"] in {"user", "assistant"} and message["content"].strip()
        ]
        existing_patches = list_message_patches(conn, user["id"], payload.targetMessageId)
        parent_content = target_message["content"]
        original_text = parent_content[target_start:target_end]
        model_messages = build_backfill_draft_messages(
            edit_type=payload.editType,
            user_instruction=payload.userInstruction,
            parent_content=parent_content,
            original_text=original_text,
            source_metadata=source_metadata,
            child_messages=meaningful_child_messages,
            existing_patches=existing_patches,
        )
        model_messages.insert(
            1,
            {
                "role": "system",
                "content": (
                    "Always return a usable editable draft. If the child conversation has no clear conclusion, "
                    "use the selected text, parent context, edit type, and user instruction to make a conservative replacement. "
                    "Do not return __INSUFFICIENT_CONTEXT__."
                ),
            },
        )

    started = time.time()
    result = None
    try:
        result = call_model_with_usage(model_messages, payload.modelName, payload.thinkingMode or "fast")
        draft_text = clean_backfill_draft(result.content)
    except ModelConfigurationError as exc:
        with connect() as conn:
            insert_model_call_log(
                conn,
                user_id=user["id"],
                notebook_id=source_node["notebook_id"],
                node_id=payload.sourceChildNodeId,
                call_type="backfill_draft",
                model_name=payload.modelName,
                thinking_mode=payload.thinkingMode or "fast",
                input_chars=sum(len(message["content"]) for message in model_messages),
                output_chars=0,
                estimated_input_tokens=max(1, sum(len(message["content"]) for message in model_messages) // 4),
                estimated_output_tokens=0,
                success=False,
                latency_ms=int((time.time() - started) * 1000),
                error_message=str(exc),
            )
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except ModelProviderError as exc:
        with connect() as conn:
            insert_model_call_log(
                conn,
                user_id=user["id"],
                notebook_id=source_node["notebook_id"],
                node_id=payload.sourceChildNodeId,
                call_type="backfill_draft",
                model_name=payload.modelName,
                thinking_mode=payload.thinkingMode or "fast",
                input_chars=sum(len(message["content"]) for message in model_messages),
                output_chars=0,
                estimated_input_tokens=max(1, sum(len(message["content"]) for message in model_messages) // 4),
                estimated_output_tokens=0,
                success=False,
                latency_ms=int((time.time() - started) * 1000),
                error_message=str(exc),
            )
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if draft_text == "__INSUFFICIENT_CONTEXT__" or not draft_text:
        draft_text = original_text
    if payload.editType not in UNLIMITED_REPLACEMENT_EDIT_TYPES and len(draft_text) > MAX_REPLACEMENT_CHARS:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "BACKFILL_DRAFT_TOO_LONG",
                "message": "生成的回填内容过长，可能会破坏原文节奏。请缩短回填内容，或改用“补充/重构”方式重新生成。",
            },
        )

    with connect() as conn:
        record_successful_model_usage(
            conn,
            user_id=user["id"],
            notebook_id=source_node["notebook_id"],
            node_id=payload.sourceChildNodeId,
            call_type="backfill_draft",
            model_name=payload.modelName,
            thinking_mode=payload.thinkingMode or "fast",
            messages=model_messages,
            output_text=result.content if result else draft_text,
            usage=result.usage if result else None,
            latency_ms=int((time.time() - started) * 1000),
        )

    return {
        "draft": {
            "sourceChildNodeId": payload.sourceChildNodeId,
            "targetMessageId": payload.targetMessageId,
            "editType": payload.editType,
            "targetRangeStart": target_start,
            "targetRangeEnd": target_end,
            "originalText": original_text,
            "replacementText": draft_text,
            "rangeSuggestion": None,
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

        if "pinned" in updates:
            if node["parent_id"] is not None:
                raise HTTPException(status_code=400, detail="Only notebook roots can be pinned")
            conn.execute(
                "UPDATE notebooks SET pinned = ?, updated_at = ? WHERE id = ?",
                (1 if updates["pinned"] else 0, now_iso(), node["notebook_id"]),
            )

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
        try:
            ensure_wallet_can_charge_model(conn, user["id"], payload.modelName)
        except WalletInsufficientCreditError as exc:
            raise wallet_http_error(exc) from exc
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            node = await wait_for_node_for_user(payload.nodeId, user["id"])
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

        started = time.time()
        result = None
        try:
            result = call_model_with_usage(model_messages, payload.modelName, payload.thinkingMode)
            content = result.content
        except ModelConfigurationError as exc:
            insert_model_call_log(
                conn,
                user_id=user["id"],
                notebook_id=node["notebook_id"],
                node_id=payload.nodeId,
                call_type="chat",
                model_name=payload.modelName,
                thinking_mode=payload.thinkingMode,
                input_chars=sum(len(message["content"]) for message in model_messages),
                output_chars=0,
                estimated_input_tokens=max(1, sum(len(message["content"]) for message in model_messages) // 4),
                estimated_output_tokens=0,
                context_chars=sum(len(message["content"]) for message in model_messages),
                web_search_enabled=payload.web_search,
                source_count=len(web_sources),
                latency_ms=int((time.time() - started) * 1000),
                success=False,
                error_message=str(exc),
            )
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ModelProviderError as exc:
            insert_model_call_log(
                conn,
                user_id=user["id"],
                notebook_id=node["notebook_id"],
                node_id=payload.nodeId,
                call_type="chat",
                model_name=payload.modelName,
                thinking_mode=payload.thinkingMode,
                input_chars=sum(len(message["content"]) for message in model_messages),
                output_chars=0,
                estimated_input_tokens=max(1, sum(len(message["content"]) for message in model_messages) // 4),
                estimated_output_tokens=0,
                context_chars=sum(len(message["content"]) for message in model_messages),
                web_search_enabled=payload.web_search,
                source_count=len(web_sources),
                latency_ms=int((time.time() - started) * 1000),
                success=False,
                error_message=str(exc),
            )
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        content = finalize_web_search_answer(content, web_sources, web_search_warning)
        record_successful_model_usage(
            conn,
            user_id=user["id"],
            notebook_id=node["notebook_id"],
            node_id=payload.nodeId,
            call_type="chat",
            model_name=payload.modelName,
            thinking_mode=payload.thinkingMode,
            messages=model_messages,
            output_text=content,
            usage=result.usage if result else None,
            context_chars=sum(len(message["content"]) for message in model_messages),
            web_search_enabled=payload.web_search,
            source_count=len(web_sources),
            latency_ms=int((time.time() - started) * 1000),
        )
        assistant_message = add_message(conn, payload.nodeId, "assistant", content)
        node_title = maybe_generate_root_title(conn, payload.nodeId, payload.message.strip(), content, payload.modelName, user["id"])
        node_summary = maybe_generate_node_summary(conn, payload.nodeId, payload.modelName, user["id"])
        
        # 索引对话内容到向量存储（RAG）
        if payload.ragEnabled:
            try:
                index_node_to_vector_store(conn, payload.nodeId)
            except Exception as exc:
                print(f"[RAG Index] Non-blocking index error: {exc}")
        
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
        try:
            ensure_wallet_can_charge_model(conn, user["id"], payload.modelName)
        except WalletInsufficientCreditError as exc:
            raise wallet_http_error(exc) from exc
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
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

        started = time.time()
        result = None
        try:
            result = call_model_with_usage(model_messages, payload.modelName, payload.thinkingMode)
            content = result.content
        except ModelConfigurationError as exc:
            insert_model_call_log(
                conn,
                user_id=user["id"],
                notebook_id=node["notebook_id"],
                node_id=payload.nodeId,
                call_type="retry",
                model_name=payload.modelName,
                thinking_mode=payload.thinkingMode,
                input_chars=sum(len(message["content"]) for message in model_messages),
                output_chars=0,
                estimated_input_tokens=max(1, sum(len(message["content"]) for message in model_messages) // 4),
                estimated_output_tokens=0,
                context_chars=sum(len(message["content"]) for message in model_messages),
                latency_ms=int((time.time() - started) * 1000),
                success=False,
                error_message=str(exc),
            )
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ModelProviderError as exc:
            insert_model_call_log(
                conn,
                user_id=user["id"],
                notebook_id=node["notebook_id"],
                node_id=payload.nodeId,
                call_type="retry",
                model_name=payload.modelName,
                thinking_mode=payload.thinkingMode,
                input_chars=sum(len(message["content"]) for message in model_messages),
                output_chars=0,
                estimated_input_tokens=max(1, sum(len(message["content"]) for message in model_messages) // 4),
                estimated_output_tokens=0,
                context_chars=sum(len(message["content"]) for message in model_messages),
                latency_ms=int((time.time() - started) * 1000),
                success=False,
                error_message=str(exc),
            )
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        record_successful_model_usage(
            conn,
            user_id=user["id"],
            notebook_id=node["notebook_id"],
            node_id=payload.nodeId,
            call_type="retry",
            model_name=payload.modelName,
            thinking_mode=payload.thinkingMode,
            messages=model_messages,
            output_text=content,
            usage=result.usage if result else None,
            context_chars=sum(len(message["content"]) for message in model_messages),
            latency_ms=int((time.time() - started) * 1000),
        )
        assistant_message = update_assistant_message(conn, payload.assistantMessageId, payload.nodeId, content)
        node_title = maybe_generate_root_title(conn, payload.nodeId, previous_user_message["content"], content, payload.modelName, user["id"])
        node_summary = maybe_generate_node_summary(conn, payload.nodeId, payload.modelName, user["id"])
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
        try:
            ensure_wallet_can_charge_model(conn, user["id"], payload.modelName)
        except WalletInsufficientCreditError as exc:
            raise wallet_http_error(exc) from exc
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
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
        provider_usage = None
        model_stream = None
        started = time.time()
        try:
            model_stream = stream_model_events(model_messages, payload.modelName, payload.thinkingMode)
            for event in model_stream:
                if event.usage:
                    provider_usage = event.usage
                if event.content:
                    content_parts.append(event.content)
                    yield sse_event({"content": event.content})

            content = "".join(content_parts).strip() or "模型没有返回内容。"
            with connect() as conn:
                record_successful_model_usage(
                    conn,
                    user_id=user["id"],
                    notebook_id=node["notebook_id"],
                    node_id=payload.nodeId,
                    call_type="retry_stream",
                    model_name=payload.modelName,
                    thinking_mode=payload.thinkingMode,
                    messages=model_messages,
                    output_text=content,
                    usage=provider_usage,
                    context_chars=sum(len(message["content"]) for message in model_messages),
                    latency_ms=int((time.time() - started) * 1000),
                )
                assistant_message = update_assistant_message(conn, payload.assistantMessageId, payload.nodeId, content)
                node_title = maybe_generate_root_title(conn, payload.nodeId, previous_user_content, content, payload.modelName, user["id"])
                node_summary = maybe_generate_node_summary(conn, payload.nodeId, payload.modelName, user["id"])
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
            with connect() as conn:
                insert_model_call_log(
                    conn,
                    user_id=user["id"],
                    notebook_id=node["notebook_id"],
                    node_id=payload.nodeId,
                    call_type="retry_stream",
                    model_name=payload.modelName,
                    thinking_mode=payload.thinkingMode,
                    input_chars=sum(len(message["content"]) for message in model_messages),
                    output_chars=len("".join(content_parts)),
                    estimated_input_tokens=max(1, sum(len(message["content"]) for message in model_messages) // 4),
                    estimated_output_tokens=max(0, len("".join(content_parts)) // 4),
                    context_chars=sum(len(message["content"]) for message in model_messages),
                    latency_ms=int((time.time() - started) * 1000),
                    success=False,
                    error_message=str(exc),
                )
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
        try:
            ensure_wallet_can_charge_model(conn, user["id"], payload.modelName)
        except WalletInsufficientCreditError as exc:
            raise wallet_http_error(exc) from exc
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            node = await wait_for_node_for_user(payload.nodeId, user["id"])
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
        provider_usage = None
        model_stream = None
        started = time.time()
        try:
            model_stream = stream_model_events(model_messages, payload.modelName, payload.thinkingMode)
            for event in model_stream:
                if event.usage:
                    provider_usage = event.usage
                if event.content:
                    content_parts.append(event.content)
                    yield sse_event({"content": event.content})

            content = finalize_web_search_answer(
                "".join(content_parts).strip() or "模型没有返回内容。",
                web_sources,
                web_search_warning,
            )
            with connect() as conn:
                record_successful_model_usage(
                    conn,
                    user_id=user["id"],
                    notebook_id=node["notebook_id"],
                    node_id=payload.nodeId,
                    call_type="chat_stream",
                    model_name=payload.modelName,
                    thinking_mode=payload.thinkingMode,
                    messages=model_messages,
                    output_text=content,
                    usage=provider_usage,
                    context_chars=sum(len(message["content"]) for message in model_messages),
                    web_search_enabled=payload.web_search,
                    source_count=len(web_sources),
                    latency_ms=int((time.time() - started) * 1000),
                )
                assistant_message = add_message(conn, payload.nodeId, "assistant", content)
                node_title = maybe_generate_root_title(conn, payload.nodeId, payload.message.strip(), content, payload.modelName, user["id"])
                node_summary = maybe_generate_node_summary(conn, payload.nodeId, payload.modelName, user["id"])
                # 索引对话内容到向量存储（RAG）
                if payload.ragEnabled:
                    try:
                        index_node_to_vector_store(conn, payload.nodeId)
                    except Exception as exc:
                        print(f"[RAG Index] Non-blocking index error: {exc}")
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
            with connect() as conn:
                insert_model_call_log(
                    conn,
                    user_id=user["id"],
                    notebook_id=node["notebook_id"],
                    node_id=payload.nodeId,
                    call_type="chat_stream",
                    model_name=payload.modelName,
                    thinking_mode=payload.thinkingMode,
                    input_chars=sum(len(message["content"]) for message in model_messages),
                    output_chars=len("".join(content_parts)),
                    estimated_input_tokens=max(1, sum(len(message["content"]) for message in model_messages) // 4),
                    estimated_output_tokens=max(0, len("".join(content_parts)) // 4),
                    context_chars=sum(len(message["content"]) for message in model_messages),
                    web_search_enabled=payload.web_search,
                    source_count=len(web_sources),
                    latency_ms=int((time.time() - started) * 1000),
                    success=False,
                    error_message=str(exc),
                )
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
