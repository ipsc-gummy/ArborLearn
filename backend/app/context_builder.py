from __future__ import annotations

import os
import sqlite3
from typing import Optional

from .db import get_parent_chain, list_uploaded_files
from .effective_context import list_effective_messages
from .openviking import openviking_rag
from .web_search import classify_source_url, select_relevant_evidence


SYSTEM_PROMPT = """你是 ArborLearn 的学习助手。
你的任务是基于树状学习上下文回答当前节点问题。
优先使用当前节点和父子节点上下文；证据不足时明确说明，不要编造。"""


def _model_identity_context(model_name: str | None = None) -> str:
    model_name = model_name or os.getenv("MODEL_NAME", "deepseek-v4-pro")
    base_url = os.getenv("MODEL_BASE_URL", "https://api.deepseek.com")
    return (
        "运行配置:\n"
        f"- 当前后端接入模型: {model_name}\n"
        f"- API Base URL: {base_url}\n"
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
        return f"{summary}\n[提示] 该摘要可能过时，仅作辅助。"
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
        "\n\n[Web Evidence]\n"
        "Use only when relevant and cite as [S#].\n\n"
        + "\n\n".join(evidence_blocks)
    )


def _format_uploaded_file_context(uploaded_files: list[dict]) -> str:
    ready_files = [
        uploaded_file
        for uploaded_file in uploaded_files
        if uploaded_file.get("extractionStatus") == "ready" and (uploaded_file.get("extractedText") or "").strip()
    ]
    if not ready_files:
        return ""

    blocks = []
    remaining_chars = 14_000
    for index, uploaded_file in enumerate(ready_files[:5], start=1):
        text = (uploaded_file.get("extractedText") or "").strip()
        if not text or remaining_chars <= 0:
            break
        excerpt = text[: min(4_000, remaining_chars)]
        remaining_chars -= len(excerpt)
        blocks.append(
            "\n".join(
                [
                    f"[F{index}] {uploaded_file.get('filename') or 'uploaded file'}",
                    f"Size: {uploaded_file.get('fileSize') or 0} bytes",
                    "Content Excerpt:",
                    excerpt,
                ]
            )
        )

    if not blocks:
        return ""
    return (
        "\n\n[Uploaded Files - Current Node]\n"
        "Primary local evidence. Cite as [F#].\n\n"
        + "\n\n".join(blocks)
    )


def _format_uploaded_file_status(uploaded_files: list[dict]) -> str:
    if not uploaded_files:
        return ""
    lines = []
    for index, uploaded_file in enumerate(uploaded_files[:5], start=1):
        status = uploaded_file.get("extractionStatus") or "unknown"
        error_message = uploaded_file.get("errorMessage")
        name = uploaded_file.get("filename") or "uploaded file"
        if error_message:
            lines.append(f"[F{index}] {name}: {status} ({error_message})")
        else:
            lines.append(f"[F{index}] {name}: {status}")
    return "\n".join(lines)


def _get_node_notebook_id(conn: sqlite3.Connection, node_id: str) -> Optional[str]:
    row = conn.execute("SELECT notebook_id FROM nodes WHERE id = ?", (node_id,)).fetchone()
    return row["notebook_id"] if row else None


def _get_user_id_from_node(conn: sqlite3.Connection, node_id: str) -> Optional[str]:
    row = conn.execute(
        """
        SELECT notebooks.owner_user_id
        FROM nodes
        JOIN notebooks ON nodes.notebook_id = notebooks.id
        WHERE nodes.id = ?
        """,
        (node_id,),
    ).fetchone()
    return row["owner_user_id"] if row else None


def _build_hierarchical_context(
    conn: sqlite3.Connection,
    chain: list[sqlite3.Row],
    before_created_at: str | None = None,
    include_current_summary: bool = True,
) -> str:
    if not chain:
        return ""

    root = chain[0]
    current = chain[-1]
    parent = chain[-2] if len(chain) > 1 else None
    path = " / ".join(row["title"] for row in chain)

    parts = [
        f"当前路径: {path}",
        f"根节点标题: {root['title']}",
        f"根节点摘要: {_summary_text(root)}",
        f"当前节点标题: {current['title']}",
        f"当前节点摘要: {_summary_text(current)}",
        f"当前节点上下文模式: {current['context_mode']}",
    ]
    if not include_current_summary:
        parts.pop(4)

    if parent:
        parts.extend(
            [
                f"父节点标题: {parent['title']}",
                f"父节点摘要: {_summary_text(parent)}",
                f"触发片段 selectedText: {current['selected_text'] or parent['selected_text'] or '无'}",
                "父节点最近 2 轮对话:",
                _format_turns(_recent_turns(conn, parent["id"], 4, before_created_at)),
            ]
        )
    return "\n".join(parts)


def build_model_messages(
    conn: sqlite3.Connection,
    node_id: str,
    before_created_at: str | None = None,
    model_name: str | None = None,
    web_sources: list[dict] | None = None,
    user_query: str | None = None,
    enable_rag: bool = False,
    include_current_summary: bool = True,
) -> list[dict[str, str]]:
    chain = get_parent_chain(conn, node_id)
    if not chain:
        raise ValueError(f"Node not found: {node_id}")

    hierarchical_context = _build_hierarchical_context(
        conn,
        chain,
        before_created_at,
        include_current_summary=include_current_summary,
    )
    current_history = _recent_turns(conn, node_id, 12, before_created_at)

    web_evidence = _format_web_evidence(web_sources, user_query)
    user_id_for_files = _get_user_id_from_node(conn, node_id)
    uploaded_file_context = ""
    uploaded_file_status = ""
    if user_id_for_files:
        uploaded_files = list_uploaded_files(conn, user_id_for_files, node_id, limit=10, include_text=True)
        uploaded_file_context = _format_uploaded_file_context(uploaded_files)
        uploaded_file_status = _format_uploaded_file_status(uploaded_files)

    image_query = bool(
        user_query and any(keyword in user_query.lower() for keyword in ("图片", "照片", "截图", "image", "photo", "图里", "图中"))
    )

    rag_context = ""
    rag_docs = []
    if enable_rag and user_query:
        user_id = _get_user_id_from_node(conn, node_id)
        notebook_id = _get_node_notebook_id(conn, node_id)
        if user_id:
            print(f"[RAG] Starting RAG retrieval for query: {user_query[:50]}...")
            rag_docs, rag_context = openviking_rag.build_context_from_rag(
                conn,
                user_id=user_id,
                notebook_id=notebook_id,
                node_id=node_id,
                user_query=user_query,
                max_results=5,
            )
            print(f"[RAG] Retrieved {len(rag_docs)} documents")
            for i, doc in enumerate(rag_docs):
                content_preview = doc.get("content", "")[:100].replace("\n", " ")
                title = doc.get("title", "N/A")
                source = doc.get("source_type", "unknown")
                print(f"[RAG] Doc {i+1}: [{source}] {title} - {content_preview}...")
            if rag_context:
                print(f"[RAG] Generated context with {len(rag_context)} characters")
                print(f"[RAG] Context preview: {rag_context[:500]}...")
        else:
            print("[RAG] Skipped: user_id not found")

    evidence_instruction = (
        "\n\n[Evidence Rules]\n"
        "- Prefer current-node uploaded files and tree context.\n"
        "- Use RAG/web evidence as secondary support.\n"
        "- If evidence is insufficient, state it clearly.\n"
        "- Do not fabricate facts not present in provided evidence.\n"
    )
    image_rules = ""
    if image_query:
        image_rules = (
            "\n\n[Image Query Rules]\n"
            "- Image-specific details must be grounded in [F#] current-node files.\n"
            "- RAG [R#] cannot override [F#] image evidence.\n"
            "- If OCR failed/empty/unclear, say 'uncertain' instead of guessing.\n"
            "- Numeric fields must be copied from [F#] only.\n"
        )

    tree_context_block = f"\n\n[Tree Context]\n{hierarchical_context}"
    file_status_block = f"\n\n[Uploaded File Status]\n{uploaded_file_status}" if uploaded_file_status else ""
    file_context_block = uploaded_file_context
    rag_block = rag_context
    web_block = web_evidence

    if image_query:
        ordered_blocks = f"{file_status_block}{file_context_block}{tree_context_block}{rag_block}{web_block}"
    else:
        ordered_blocks = f"{tree_context_block}{file_status_block}{file_context_block}{rag_block}{web_block}"

    system_content = (
        f"{SYSTEM_PROMPT}\n\n"
        f"{_model_identity_context(model_name)}"
        f"{ordered_blocks}"
        f"{evidence_instruction}"
        f"{image_rules}"
    )

    print(f"[Context Builder] System prompt length: {len(system_content)}")
    print(f"[Context Builder] Has RAG context: {bool(rag_context)}")
    if rag_context:
        print(f"[Context Builder] RAG context length: {len(rag_context)}")

    messages = [{"role": "system", "content": system_content}]
    messages.extend({"role": row["role"], "content": row["content"]} for row in current_history)
    return messages


def index_node_to_vector_store(
    conn: sqlite3.Connection,
    node_id: str,
):
    user_id = _get_user_id_from_node(conn, node_id)
    notebook_id = _get_node_notebook_id(conn, node_id)
    if user_id and notebook_id:
        print(f"[RAG Index] Indexing node {node_id} to vector store")
        openviking_rag.index_node_content(
            conn,
            node_id=node_id,
            user_id=user_id,
            notebook_id=notebook_id,
        )
        print(f"[RAG Index] Node {node_id} indexed successfully")
    else:
        print(f"[RAG Index] Skipped: user_id={user_id}, notebook_id={notebook_id}")
