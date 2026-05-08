from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Iterable
from uuid import uuid4

from .settings import get_database_path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def uid(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:12]}"


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(get_database_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              email TEXT NOT NULL UNIQUE,
              display_name TEXT NOT NULL,
              password_hash TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS notebooks (
              id TEXT PRIMARY KEY,
              owner_user_id TEXT,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              pinned INTEGER NOT NULL DEFAULT 0,
              FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS nodes (
              id TEXT PRIMARY KEY,
              notebook_id TEXT NOT NULL,
              parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              summary TEXT NOT NULL DEFAULT '',
              selected_text TEXT,
              context_mode TEXT NOT NULL DEFAULT 'isolated',
              position INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_nodes_notebook_parent
              ON nodes(notebook_id, parent_id, position);

            CREATE TABLE IF NOT EXISTS messages (
              id TEXT PRIMARY KEY,
              node_id TEXT NOT NULL,
              role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
              content TEXT NOT NULL,
              selected_text TEXT,
              created_at TEXT NOT NULL,
              FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_messages_node_created
              ON messages(node_id, created_at);
            """
        )
        ensure_column(conn, "notebooks", "owner_user_id", "TEXT")


def ensure_column(conn: sqlite3.Connection, table_name: str, column_name: str, declaration: str) -> None:
    columns = [row["name"] for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()]
    if column_name not in columns:
        conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {declaration}")


def seed_if_empty(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) AS count FROM notebooks").fetchone()["count"]
    if count:
        return

    ts = now_iso()
    conn.execute(
        "INSERT INTO notebooks(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("root", "TreeLearn 项目学习", ts, ts),
    )
    nodes = [
        (
            "root",
            "root",
            None,
            "TreeLearn 项目学习",
            "围绕树形上下文工程理解项目背景、核心功能、技术栈和后端协作边界。",
            None,
            "mainline",
            0,
        ),
        (
            "method",
            "root",
            "root",
            "树形上下文调度",
            "根据根节点到当前节点路径、当前节点完整内容和选中文本构造 prompt。",
            "树形上下文调度",
            "isolated",
            0,
        ),
        (
            "skill",
            "root",
            "root",
            "Skill 偏好模板",
            "保存讲解结构、深度、示例风格和推导偏好。",
            "Skill 偏好模板",
            "isolated",
            1,
        ),
        (
            "context",
            "root",
            "method",
            "主线保护策略",
            "普通支线默认隔离，避免局部追问污染主线路径摘要。",
            "普通支线默认不污染后续主线上下文",
            "isolated",
            0,
        ),
    ]
    conn.executemany(
        """
        INSERT INTO nodes(
          id, notebook_id, parent_id, title, summary, selected_text,
          context_mode, position, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(*node, ts, ts) for node in nodes],
    )

    messages = [
        (
            "m-root-1",
            "root",
            "assistant",
            "TreeLearn 将论文、PPT、技术文档等学习过程组织成树形知识网络。主线负责宏观学习路径，支线负责局部追问，普通支线默认不污染后续主线上下文。",
        ),
        (
            "m-root-2",
            "root",
            "assistant",
            "前端需要支持左侧树形节点、右侧阅读块与主子对话 3:7 分栏、选中文本创建子对话、分支超链接预览、Skill 偏好模板、导入导出和分享复习。",
        ),
        (
            "m-method-1",
            "method",
            "assistant",
            "树形结构不直接改变模型 attention 权重，但可以为上下文选择、排序、压缩和标注提供依据。后端可沿路径摘要、当前节点全文和选中文本构造最终 prompt。",
        ),
        (
            "m-context-1",
            "context",
            "assistant",
            "默认隔离策略能避免局部概念被模型误当成全局重点。支线内容保持在自己的节点上下文中，便于围绕局部问题继续追问。",
        ),
        (
            "m-skill-1",
            "skill",
            "assistant",
            "Skill 不是知识点总结，而是用户希望 AI 怎样讲。比如先给大纲、解释变量、给反例、遇到公式时补充推导。",
        ),
    ]
    conn.executemany(
        "INSERT INTO messages(id, node_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        [(*message, ts) for message in messages],
    )


def create_starter_notebook(conn: sqlite3.Connection, user_id: str) -> str:
    notebook_id = uid("nb")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO notebooks(id, owner_user_id, title, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (notebook_id, user_id, "TreeLearn 入门笔记本", ts, ts),
    )

    nodes = [
        (
            notebook_id,
            notebook_id,
            None,
            "TreeLearn 入门笔记本",
            "从这里开始创建学习主题、选中文本开支线，并观察树形上下文如何影响 AI 回答。",
            None,
            "mainline",
            0,
        ),
        (
            uid("node"),
            notebook_id,
            notebook_id,
            "树形上下文调度",
            "子对话会带上父节点片段、父节点最近对话和根节点摘要，帮助模型聚焦局部问题。",
            "树形上下文调度",
            "isolated",
            0,
        ),
    ]
    conn.executemany(
        """
        INSERT INTO nodes(
          id, notebook_id, parent_id, title, summary, selected_text,
          context_mode, position, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [(*node, ts, ts) for node in nodes],
    )
    conn.execute(
        """
        INSERT INTO messages(id, node_id, role, content, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            uid("msg"),
            notebook_id,
            "assistant",
            "欢迎使用 ArborLearn。这个账号下的笔记本、树节点和聊天记录会独立保存，不会和其他用户混在一起。",
            ts,
        ),
    )
    return notebook_id


def row_to_message(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "createdAt": row["created_at"],
        "selectedText": row["selected_text"],
    }


def list_messages(conn: sqlite3.Connection, node_id: str) -> list[dict]:
    rows = conn.execute(
        """
        SELECT id, role, content, selected_text, created_at
        FROM messages
        WHERE node_id = ?
        ORDER BY created_at ASC
        """,
        (node_id,),
    ).fetchall()
    return [row_to_message(row) for row in rows]


def add_message(
    conn: sqlite3.Connection,
    node_id: str,
    role: str,
    content: str,
    message_id: str | None = None,
    selected_text: str | None = None,
) -> dict:
    msg_id = message_id or uid("msg")
    ts = now_iso()
    conn.execute(
        """
        INSERT INTO messages(id, node_id, role, content, selected_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (msg_id, node_id, role, content, selected_text, ts),
    )
    touch_node(conn, node_id, ts)
    return {
        "id": msg_id,
        "role": role,
        "content": content,
        "selectedText": selected_text,
        "createdAt": ts,
    }


def touch_node(conn: sqlite3.Connection, node_id: str, ts: str | None = None) -> None:
    timestamp = ts or now_iso()
    node = conn.execute("SELECT notebook_id FROM nodes WHERE id = ?", (node_id,)).fetchone()
    if not node:
        return
    conn.execute("UPDATE nodes SET updated_at = ? WHERE id = ?", (timestamp, node_id))
    conn.execute("UPDATE notebooks SET updated_at = ? WHERE id = ?", (timestamp, node["notebook_id"]))


def row_to_node(conn: sqlite3.Connection, row: sqlite3.Row, children: Iterable[str]) -> dict:
    return {
        "id": row["id"],
        "parentId": row["parent_id"],
        "title": row["title"],
        "kind": "main" if row["parent_id"] is None else "branch",
        "summary": row["summary"],
        "selectedText": row["selected_text"],
        "contextWeight": row["context_mode"],
        "children": list(children),
        "messages": list_messages(conn, row["id"]),
        "expanded": True,
        "updatedAt": row["updated_at"],
    }


def get_notebook_state(conn: sqlite3.Connection, user_id: str, notebook_id: str | None = None) -> dict:
    params: list[str] = [user_id]
    where = "WHERE notebook_id IN (SELECT id FROM notebooks WHERE owner_user_id = ?)"
    if notebook_id:
        where += " AND notebook_id = ?"
        params.append(notebook_id)
    rows = conn.execute(
        f"""
        SELECT id, notebook_id, parent_id, title, summary, selected_text, context_mode, updated_at, position
        FROM nodes
        {where}
        ORDER BY position ASC, created_at ASC
        """,
        tuple(params),
    ).fetchall()

    children_by_parent: dict[str, list[str]] = {}
    for row in rows:
        parent_id = row["parent_id"]
        if parent_id is not None:
            children_by_parent.setdefault(parent_id, []).append(row["id"])

    nodes = {row["id"]: row_to_node(conn, row, children_by_parent.get(row["id"], [])) for row in rows}

    notebook_query = "SELECT id, pinned FROM notebooks WHERE owner_user_id = ?"
    notebook_params: list[str] = [user_id]
    if notebook_id:
        notebook_query += " AND id = ?"
        notebook_params.append(notebook_id)
    notebook_query += " ORDER BY pinned DESC, updated_at DESC"
    notebooks = conn.execute(notebook_query, tuple(notebook_params)).fetchall()

    return {
        "nodes": nodes,
        "rootIds": [row["id"] for row in notebooks],
        "pinnedRootIds": [row["id"] for row in notebooks if row["pinned"]],
    }


def get_node_for_user(conn: sqlite3.Connection, node_id: str, user_id: str) -> sqlite3.Row | None:
    return conn.execute(
        """
        SELECT nodes.id, nodes.notebook_id, nodes.parent_id
        FROM nodes
        JOIN notebooks ON notebooks.id = nodes.notebook_id
        WHERE nodes.id = ? AND notebooks.owner_user_id = ?
        """,
        (node_id, user_id),
    ).fetchone()


def get_notebook_for_user(conn: sqlite3.Connection, notebook_id: str, user_id: str) -> sqlite3.Row | None:
    return conn.execute(
        "SELECT id FROM notebooks WHERE id = ? AND owner_user_id = ?",
        (notebook_id, user_id),
    ).fetchone()


def get_parent_chain(conn: sqlite3.Connection, node_id: str) -> list[sqlite3.Row]:
    chain: list[sqlite3.Row] = []
    current_id: str | None = node_id
    seen: set[str] = set()
    while current_id:
        if current_id in seen:
            raise ValueError("Cycle detected in node parent chain")
        seen.add(current_id)
        row = conn.execute(
            """
            SELECT id, notebook_id, parent_id, title, summary, selected_text, context_mode
            FROM nodes
            WHERE id = ?
            """,
            (current_id,),
        ).fetchone()
        if not row:
            break
        chain.append(row)
        current_id = row["parent_id"]
    return list(reversed(chain))


def descendant_ids(conn: sqlite3.Connection, node_id: str) -> list[str]:
    rows = conn.execute(
        """
        WITH RECURSIVE subtree(id) AS (
          SELECT id FROM nodes WHERE id = ?
          UNION ALL
          SELECT nodes.id FROM nodes JOIN subtree ON nodes.parent_id = subtree.id
        )
        SELECT id FROM subtree
        """,
        (node_id,),
    ).fetchall()
    return [row["id"] for row in rows]
