from __future__ import annotations

import json
import os
import sqlite3
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .auth import create_token, normalize_email, password_hash, require_user, verify_password
from .context_builder import build_model_messages
from .db import (
    add_message,
    connect,
    create_starter_notebook,
    descendant_ids,
    get_node_for_user,
    get_notebook_for_user,
    get_notebook_state,
    init_db,
    list_messages,
    now_iso,
    touch_node,
    uid,
)
from .model_client import ModelConfigurationError, ModelProviderError, call_model, stream_model
from .settings import get_cors_origins


app = FastAPI(title="TreeLearn API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    notebookId: str | None = None
    nodeId: str
    message: str = Field(min_length=1)
    userMessageId: str | None = None
    assistantMessageId: str | None = None


class ChatStopRequest(BaseModel):
    nodeId: str
    content: str = Field(min_length=1)
    assistantMessageId: str | None = None


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
    title: str = "新的对话节点"
    summary: str = ""
    selectedText: str | None = None
    contextWeight: Literal["isolated", "mainline"] = "isolated"
    messages: list[MessagePayload] = Field(default_factory=list)


class NodePatch(BaseModel):
    title: str | None = None
    summary: str | None = None
    selectedText: str | None = None
    contextWeight: Literal["isolated", "mainline"] | None = None
    parentId: str | None = None


def serialize_user(user: dict) -> dict:
    return {
        "id": user["id"],
        "email": user["email"],
        "displayName": user["display_name"],
    }


def sse_event(payload: dict, event: str | None = None) -> str:
    prefix = f"event: {event}\n" if event else ""
    return f"{prefix}data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def stopped_assistant_content(content: str) -> str | None:
    content = content.strip()
    if not content:
        return None
    return f"{content}\n\n[stopped]"
    return f"{content}\n\n[已停止]"


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


def clean_generated_title(raw_title: str) -> str:
    title = raw_title.strip().splitlines()[0].strip()
    title = title.strip("`'\"“”‘’ ")
    prefixes = ("Title:", "title:", "标题:", "標題:")
    for prefix in prefixes:
        if title.startswith(prefix):
            title = title[len(prefix) :].strip()
    return title[:32].strip()


def maybe_generate_root_title(conn: sqlite3.Connection, node_id: str, user_question: str, assistant_answer: str) -> str | None:
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
        title = clean_generated_title(call_model(title_messages))
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
    summary = summary.strip("`'\"“”‘’ ")
    prefixes = ("Summary:", "summary:", "摘要:", "总结:", "概述:")
    for prefix in prefixes:
        if summary.startswith(prefix):
            summary = summary[len(prefix) :].strip()
    return summary[:180].strip()


def maybe_generate_branch_summary(conn: sqlite3.Connection, node_id: str) -> str | None:
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

    rows = conn.execute(
        """
        SELECT role, content
        FROM messages
        WHERE node_id = ? AND role IN ('user', 'assistant')
        ORDER BY created_at ASC
        LIMIT 24
        """,
        (node_id,),
    ).fetchall()
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
        summary = clean_generated_summary(call_model(summary_messages))
    except (ModelConfigurationError, ModelProviderError):
        return None
    if not summary:
        return None

    conn.execute("UPDATE nodes SET summary = ?, updated_at = ? WHERE id = ?", (summary, now_iso(), node_id))
    return summary


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {
        "ok": True,
        "model": os.getenv("MODEL_NAME", "deepseek-v4-flash"),
        "modelBaseUrl": os.getenv("MODEL_BASE_URL", "https://api.deepseek.com"),
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

    user = {"id": user_id, "email": email, "display_name": display_name}
    return {"token": create_token(user_id), "user": serialize_user(user)}


@app.post("/api/auth/login")
def login(payload: AuthRequest) -> dict:
    email = normalize_email(payload.email)
    with connect() as conn:
        user = conn.execute(
            """
            SELECT id, email, display_name, password_hash
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


@app.post("/api/nodes", status_code=201)
def create_node(payload: NodeCreate, user: dict = Depends(require_user)) -> dict:
    node_id = payload.id or uid("node")
    ts = now_iso()

    with connect() as conn:
        if payload.parentId:
            parent = get_node_for_user(conn, payload.parentId, user["id"])
            if not parent:
                raise HTTPException(status_code=404, detail="Parent node not found")
            notebook_id = parent["notebook_id"]
            context_mode = payload.contextWeight
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
              id, notebook_id, parent_id, title, summary, selected_text,
              context_mode, position, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              summary = excluded.summary,
              selected_text = excluded.selected_text,
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
def chat(payload: ChatRequest, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        if payload.notebookId and not get_notebook_for_user(conn, payload.notebookId, user["id"]):
            raise HTTPException(status_code=404, detail="Notebook not found")

        user_message = add_message(conn, payload.nodeId, "user", payload.message.strip(), payload.userMessageId)
        model_messages = build_model_messages(conn, payload.nodeId)

        try:
            content = call_model(model_messages)
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ModelProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        assistant_message = add_message(conn, payload.nodeId, "assistant", content)
        node_title = maybe_generate_root_title(conn, payload.nodeId, payload.message.strip(), content)
        node_summary = maybe_generate_branch_summary(conn, payload.nodeId)
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
        }


@app.post("/api/chat/stop")
def stop_chat(payload: ChatStopRequest, user: dict = Depends(require_user)) -> dict:
    with connect() as conn:
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

    message = save_stopped_assistant(payload.nodeId, [payload.content], payload.assistantMessageId)
    return {"message": message}


@app.post("/api/chat/stream")
def chat_stream(payload: ChatRequest, user: dict = Depends(require_user)) -> StreamingResponse:
    with connect() as conn:
        node = get_node_for_user(conn, payload.nodeId, user["id"])
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")
        if payload.notebookId and not get_notebook_for_user(conn, payload.notebookId, user["id"]):
            raise HTTPException(status_code=404, detail="Notebook not found")

        user_message = add_message(conn, payload.nodeId, "user", payload.message.strip(), payload.userMessageId)
        model_messages = build_model_messages(conn, payload.nodeId)

    def generate():
        content_parts: list[str] = []
        model_stream = None
        try:
            model_stream = stream_model(model_messages)
            for delta in model_stream:
                content_parts.append(delta)
                yield sse_event({"content": delta})

            content = "".join(content_parts).strip() or "模型没有返回内容。"
            with connect() as conn:
                assistant_message = add_message(conn, payload.nodeId, "assistant", content)
                node_title = maybe_generate_root_title(conn, payload.nodeId, payload.message.strip(), content)
                node_summary = maybe_generate_branch_summary(conn, payload.nodeId)
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
