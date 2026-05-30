from __future__ import annotations

import os
import sqlite3
from typing import List, Optional

from .db import get_parent_chain
from .openviking import openviking_rag
from .effective_context import list_effective_messages
from .web_search import classify_source_url, select_relevant_evidence


SYSTEM_PROMPT = """你是 ArborLearn 的学习助手。
你的任务不是闲聊，而是根据树状学习上下文回答当前节点的问题。
优先使用提供的根节点、父节点和当前节点上下文；当上下文不足时，明确说明你在补充通用知识。
回答要围绕当前局部问题，避免把兄弟分支或无关历史当成主线事实。

上下文层级说明：
- 根节点：学习主题的最高层次概括
- 祖先节点：逐级展开的中间层次
- 父节点：直接上级，包含触发当前分支的上下文
- 当前节点：正在进行的具体对话"""


def _model_identity_context(model_name: str | None = None) -> str:
    model_name = model_name or os.getenv("MODEL_NAME", "deepseek-v4-pro")
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


def _get_node_notebook_id(conn: sqlite3.Connection, node_id: str) -> Optional[str]:
    """获取节点所属的笔记本 ID"""
    row = conn.execute(
        "SELECT notebook_id FROM nodes WHERE id = ?",
        (node_id,)
    ).fetchone()
    return row["notebook_id"] if row else None


def _get_user_id_from_node(conn: sqlite3.Connection, node_id: str) -> Optional[str]:
    """从节点获取用户 ID"""
    row = conn.execute(
        """
        SELECT notebooks.owner_user_id
        FROM nodes
        JOIN notebooks ON nodes.notebook_id = notebooks.id
        WHERE nodes.id = ?
        """,
        (node_id,)
    ).fetchone()
    return row["owner_user_id"] if row else None


def _build_hierarchical_context(
    conn: sqlite3.Connection,
    chain: list[sqlite3.Row],
    before_created_at: str | None = None,
) -> str:
    """
    构建层次化的树形上下文
    根据节点在树中的深度，提供不同级别的概括：
    - 根节点（深度0）：标题 + 摘要（最高层次概括）
    - 祖先节点（深度1到n-2）：标题 + 摘要（逐级详细）
    - 父节点（深度n-1）：标题 + 摘要 + 触发片段 + 最近2轮对话（较详细）
    - 当前节点（深度n）：标题 + 摘要 + 上下文模式 + 最近12轮对话（最详细）
    """
    if not chain:
        return ""
    
    context_parts = []
    depth = len(chain)
    
    # 1. 当前路径（所有节点标题）
    path = " / ".join(row["title"] for row in chain)
    context_parts.append(f"【当前路径】: {path}")
    
    # 2. 根节点（最高层次概括）
    root = chain[0]
    context_parts.append("\n【根节点】")
    context_parts.append(f"  标题: {root['title']}")
    context_parts.append(f"  摘要: {root['summary'] or '无'}")
    
    # 3. 祖先节点（中间层次，逐级展开）
    if depth > 2:
        ancestors = chain[1:-2]  # 排除根节点和父节点
        for i, ancestor in enumerate(ancestors, start=1):
            ancestor_depth = i
            context_parts.append(f"\n【祖先节点{ancestor_depth}】")
            context_parts.append(f"  标题: {ancestor['title']}")
            context_parts.append(f"  摘要: {ancestor['summary'] or '无'}")
    
    # 4. 父节点（较详细）
    if depth > 1:
        parent = chain[-2]
        current = chain[-1]
        context_parts.append("\n【父节点】")
        context_parts.append(f"  标题: {parent['title']}")
        context_parts.append(f"  摘要: {parent['summary'] or '无'}")
        
        # 触发片段（从当前节点或父节点获取）
        trigger_text = current['selected_text'] or parent['selected_text']
        if trigger_text:
            context_parts.append(f"  触发片段: {trigger_text}")
        
        # 根据上下文模式决定是否包含父节点对话
        # sqlite3.Row 不支持 .get()，需要转换为字典
        current_dict = dict(current)
        parent_dict = dict(parent)
        context_mode = current_dict.get('context_mode', parent_dict.get('context_mode', 'mainline'))
        if context_mode != 'isolated':
            context_parts.append("  最近对话:")
            context_parts.append("    " + _format_turns(_recent_turns(conn, parent["id"], 4)).replace("\n", "\n    "))
    
    # 5. 当前节点（最详细）
    current = chain[-1]
    context_parts.append("\n【当前节点】")
    context_parts.append(f"  标题: {current['title']}")
    context_parts.append(f"  摘要: {current['summary'] or '无'}")
    # sqlite3.Row 不支持 .get()，需要转换或直接索引
    current_dict = dict(current)
    context_mode = current_dict.get('context_mode', 'mainline')
    context_parts.append(f"  上下文模式: {context_mode}")
    
    return "\n".join(context_parts)


def build_model_messages(
    conn: sqlite3.Connection,
    node_id: str,
    before_created_at: str | None = None,
    model_name: str | None = None,
    web_sources: list[dict] | None = None,
    user_query: str | None = None,
    enable_rag: bool = False,
) -> list[dict[str, str]]:
    chain = get_parent_chain(conn, node_id)
    if not chain:
        raise ValueError(f"Node not found: {node_id}")

    # 构建层次化树形上下文（核心）
    hierarchical_context = _build_hierarchical_context(conn, chain, before_created_at)
    
    # 获取当前节点的对话历史（用于追加到 messages）
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
    
    # 格式化网页搜索证据
    web_evidence = _format_web_evidence(web_sources, user_query)
    
    # RAG 检索上下文（作为补充，不干扰树形上下文的核心逻辑）
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
                content_preview = doc.get('content', '')[:100].replace('\n', ' ')
                title = doc.get('title', 'N/A')
                source = doc.get('source_type', 'unknown')
                print(f"[RAG] Doc {i+1}: [{source}] {title} - {content_preview}...")
            if rag_context:
                print(f"[RAG] Generated context with {len(rag_context)} characters")
                print(f"[RAG] Context preview: {rag_context[:500]}...")
        else:
            print("[RAG] Skipped: user_id not found")

    # 证据使用说明
    evidence_instruction = ""
    has_external_evidence = bool(web_evidence or rag_context)
    if has_external_evidence:
        evidence_instruction = (
            "\n\n【证据使用规则】\n"
            "- 优先基于提供的树状上下文回答，其次使用知识库和网页证据。\n"
            "- 证据不足时明确说明，不要编造来源。\n"
            "- 使用来源信息时标注 [R1]、[R2]（知识库）或 [S1]、[S2]（网页）。\n"
            "- 不要引入上下文不支持的新事实。\n"
            "- 回答末尾列出参考来源（如有）。"
        )

    # 构建最终的 system prompt
    # 将 RAG 上下文放在前面，让模型优先看到知识库信息
    system_content = (
        f"{SYSTEM_PROMPT}\n\n"
        f"{_model_identity_context(model_name)}\n\n"
        f"{rag_context}"
        f"【树状上下文】\n"
        f"{hierarchical_context}"
        f"{web_evidence}"
        f"{evidence_instruction}"
    )

    # 日志记录上下文信息
    print(f"[Context Builder] System prompt length: {len(system_content)}")
    print(f"[Context Builder] Has RAG context: {bool(rag_context)}")
    if rag_context:
        print(f"[Context Builder] RAG context length: {len(rag_context)}")
        if '小美' in rag_context:
            print(f"[Context Builder] ✓ RAG context contains 小美")

    messages = [
        {
            "role": "system",
            "content": system_content,
        }
    ]
    
    # 追加当前节点的对话历史
    messages.extend({"role": row["role"], "content": row["content"]} for row in current_history)
    
    return messages


def index_node_to_vector_store(
    conn: sqlite3.Connection,
    node_id: str,
):
    """将节点内容索引到向量存储"""
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
