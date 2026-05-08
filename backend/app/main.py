from __future__ import annotations

from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .context_builder import build_model_messages
from .db import (
    add_message,
    connect,
    descendant_ids,
    get_notebook_state,
    init_db,
    list_messages,
    now_iso,
    touch_node,
    uid,
)
from .model_client import ModelConfigurationError, ModelProviderError, call_model
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


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/tree")
def all_tree() -> dict:
    with connect() as conn:
        return get_notebook_state(conn)


@app.get("/api/notebooks/{notebook_id}/tree")
def notebook_tree(notebook_id: str) -> dict:
    with connect() as conn:
        state = get_notebook_state(conn, notebook_id)
        if not state["rootIds"]:
            raise HTTPException(status_code=404, detail="Notebook not found")
        return state


@app.get("/api/nodes/{node_id}/messages")
def node_messages(node_id: str) -> dict:
    with connect() as conn:
        exists = conn.execute("SELECT id FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail="Node not found")
        return {"messages": list_messages(conn, node_id)}


@app.post("/api/nodes", status_code=201)
def create_node(payload: NodeCreate) -> dict:
    node_id = payload.id or uid("node")
    ts = now_iso()

    with connect() as conn:
        if payload.parentId:
            parent = conn.execute(
                "SELECT id, notebook_id FROM nodes WHERE id = ?",
                (payload.parentId,),
            ).fetchone()
            if not parent:
                raise HTTPException(status_code=404, detail="Parent node not found")
            notebook_id = parent["notebook_id"]
            context_mode = payload.contextWeight
        else:
            notebook_id = payload.notebookId or node_id
            context_mode = "mainline"
            conn.execute(
                """
                INSERT INTO notebooks(id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at
                """,
                (notebook_id, payload.title, ts, ts),
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
def patch_node(node_id: str, payload: NodePatch) -> dict:
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return {"ok": True}

    with connect() as conn:
        node = conn.execute("SELECT id, notebook_id, parent_id FROM nodes WHERE id = ?", (node_id,)).fetchone()
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
            parent = conn.execute("SELECT notebook_id FROM nodes WHERE id = ?", (target_parent_id,)).fetchone()
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
def delete_node(node_id: str) -> dict:
    with connect() as conn:
        node = conn.execute("SELECT notebook_id, parent_id FROM nodes WHERE id = ?", (node_id,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        if node["parent_id"] is None:
            conn.execute("DELETE FROM notebooks WHERE id = ?", (node["notebook_id"],))
        else:
            conn.execute("DELETE FROM nodes WHERE id = ?", (node_id,))
            conn.execute("UPDATE notebooks SET updated_at = ? WHERE id = ?", (now_iso(), node["notebook_id"]))
        return {"ok": True}


@app.post("/api/chat")
def chat(payload: ChatRequest) -> dict:
    with connect() as conn:
        node = conn.execute("SELECT id FROM nodes WHERE id = ?", (payload.nodeId,)).fetchone()
        if not node:
            raise HTTPException(status_code=404, detail="Node not found")

        user_message = add_message(conn, payload.nodeId, "user", payload.message.strip(), payload.userMessageId)
        model_messages = build_model_messages(conn, payload.nodeId)

        try:
            content = call_model(model_messages)
        except ModelConfigurationError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except ModelProviderError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        assistant_message = add_message(conn, payload.nodeId, "assistant", content)
        return {
            "messageId": assistant_message["id"],
            "role": "assistant",
            "content": assistant_message["content"],
            "createdAt": assistant_message["createdAt"],
            "userMessage": user_message,
            "message": assistant_message,
        }
