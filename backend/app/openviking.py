from __future__ import annotations

import json
import os
import sqlite3
from typing import Any, Dict, List, Optional, Tuple

from .vector_store import vector_store
from .web_search import classify_source_url, select_relevant_evidence


class OpenVikingRAG:
    """OpenViking RAG 检索服务"""
    
    def __init__(self):
        self.vector_store = vector_store
    
    def build_context_from_rag(
        self,
        conn: sqlite3.Connection,
        user_id: str,
        notebook_id: Optional[str],
        node_id: str,
        user_query: str,
        max_results: int = 5,
    ) -> Tuple[List[Dict[str, Any]], str]:
        """
        从 RAG 系统构建上下文
        返回：(检索到的文档列表, 格式化的上下文文本)
        """
        # 1. 从向量数据库检索相关文档
        retrieved_docs = self._retrieve_from_vector_store(
            user_query, user_id, notebook_id, max_results
        )
        
        # 2. 从当前节点和父节点获取上下文
        node_context = self._retrieve_from_node(conn, node_id)
        
        # 3. 合并并排序结果
        merged_docs = self._merge_and_rank(retrieved_docs, node_context, user_query)
        
        # 4. 构建最终上下文
        context_text = self._format_rag_context(merged_docs, user_query)
        
        return merged_docs, context_text
    
    def _retrieve_from_vector_store(
        self,
        query: str,
        user_id: str,
        notebook_id: Optional[str],
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """从向量存储检索相关文档"""
        try:
            results = self.vector_store.search(
                query,
                user_id,
                notebook_id=notebook_id,
                limit=limit,
            )
            return results
        except Exception as e:
            print(f"Vector store search error: {e}")
            return []
    
    def _retrieve_from_node(
        self,
        conn: sqlite3.Connection,
        node_id: str,
    ) -> List[Dict[str, Any]]:
        """从节点获取上下文信息 - 获取整个笔记本的所有节点"""
        from .db import get_parent_chain, list_messages
        
        context_docs = []
        
        try:
            # 获取当前节点及其父节点链
            chain = get_parent_chain(conn, node_id)
            
            if not chain:
                return context_docs
            
            # 获取笔记本 ID
            notebook_id = chain[0]["notebook_id"]
            
            # 获取笔记本中的所有节点（不仅仅是父节点链）
            all_nodes = conn.execute(
                "SELECT id, notebook_id, title FROM nodes WHERE notebook_id = ?",
                (notebook_id,)
            ).fetchall()
            
            # 获取所有相关节点的消息
            for node in all_nodes:
                messages = list_messages(conn, node["id"])
                if messages:
                    # 将消息内容合并为文档
                    content = "\n".join(
                        f"{msg['role']}: {msg['content']}" 
                        for msg in messages[-6:]  # 最近6条消息
                    )
                    context_docs.append({
                        "id": node["id"],
                        "content": content,
                        "title": node["title"],
                        "node_id": node["id"],
                        "notebook_id": node["notebook_id"],
                        "source_type": "node_context",
                        "score": 0.9,  # 高相关性评分
                    })
        except Exception as e:
            print(f"Node context retrieval error: {e}")
        
        return context_docs
    
    def _merge_and_rank(
        self,
        retrieved_docs: List[Dict[str, Any]],
        node_context: List[Dict[str, Any]],
        query: str,
    ) -> List[Dict[str, Any]]:
        """合并并排序检索结果"""
        all_docs = retrieved_docs + node_context
        
        # 去重（基于 id）
        seen_ids = set()
        unique_docs = []
        for doc in all_docs:
            doc_id = doc.get("id")
            if doc_id and doc_id not in seen_ids:
                seen_ids.add(doc_id)
                unique_docs.append(doc)
        
        # 提取查询关键词（简单的中分词）
        query_keywords = set(query.replace("?", "").replace("？", "").split())
        
        def keyword_bonus(doc: Dict[str, Any]) -> float:
            """计算关键词匹配加分"""
            content = doc.get("content", "").lower()
            title = doc.get("title", "").lower()
            bonus = 0.0
            for kw in query_keywords:
                if len(kw) >= 2:  # 只匹配2个字符以上的词
                    if kw.lower() in content or kw.lower() in title:
                        bonus += 0.3  # 关键词匹配加分
            return bonus
        
        # 综合排序：向量分数 + 关键词匹配
        def combined_score(doc: Dict[str, Any]) -> float:
            return doc.get("score", 0) + keyword_bonus(doc)
        
        unique_docs.sort(key=combined_score, reverse=True)
        
        return unique_docs[:8]  # 最多返回8个文档
    
    def _format_rag_context(
        self,
        docs: List[Dict[str, Any]],
        user_query: str,
    ) -> str:
        """格式化 RAG 上下文 - 直接使用检索到的内容"""
        if not docs:
            return ""
        
        evidence_blocks = []
        # 增加返回的文档数量，确保包含用户相关信息的文档
        for index, doc in enumerate(docs[:8], start=1):
            content = doc.get("content", "").strip()
            title = doc.get("title", "")
            source_type = doc.get("source_type", "unknown")
            score = doc.get("score", 0)
            
            # 直接使用检索到的内容，不再做关键词提取
            # 截取内容的前 500 字符作为摘要
            if len(content) > 500:
                display_content = content[:500] + "..."
            else:
                display_content = content
            
            evidence_blocks.append(
                "\n".join([
                    f"[R{index}]",
                    f"标题: {title or '未命名'}",
                    f"来源类型: {self._format_source_type(source_type)}",
                    f"相关性: {score:.2f}",
                    "内容:",
                    display_content,
                ])
            )
        
        separator = "=" * 60
        return (
            "\n\n"
            f"{separator}\n"
            "【知识库检索结果】\n"
            f"{separator}\n"
            "以下信息来自知识库，与用户问题高度相关，请优先使用！\n"
            "使用时请标注来源编号 [R1], [R2] 等。\n"
            f"{separator}\n\n"
            + "\n\n".join(evidence_blocks)
            + f"\n\n{separator}\n"
        )
    
    def _format_source_type(self, source_type: str) -> str:
        """格式化来源类型显示"""
        type_map = {
            "node_context": "节点上下文",
            "web_source": "网页来源",
            "document": "文档",
            "notebook": "笔记本",
        }
        return type_map.get(source_type, source_type)
    
    def index_node_content(
        self,
        conn: sqlite3.Connection,
        node_id: str,
        user_id: str,
        notebook_id: str,
    ):
        """索引节点内容到向量存储"""
        from .db import list_messages, get_node_for_user
        
        try:
            # 获取节点信息
            node = conn.execute(
                "SELECT title, summary FROM nodes WHERE id = ?",
                (node_id,)
            ).fetchone()
            
            if not node:
                return
            
            # 获取节点消息
            messages = list_messages(conn, node_id)
            
            # 构建文档内容
            content_parts = []
            if node["summary"]:
                content_parts.append(f"摘要: {node['summary']}")
            
            for msg in messages:
                role = "用户" if msg["role"] == "user" else "助手"
                content_parts.append(f"{role}: {msg['content']}")
            
            full_content = "\n\n".join(content_parts)
            
            # 创建文档记录
            document = {
                "id": f"node-{node_id}",
                "content": full_content,
                "title": node["title"],
                "node_id": node_id,
                "notebook_id": notebook_id,
                "user_id": user_id,
                "source_type": "node_context",
                "metadata": json.dumps({
                    "title": node["title"],
                    "node_id": node_id,
                    "notebook_id": notebook_id,
                }),
            }
            
            # 添加到向量存储
            self.vector_store.add_documents([document])
            
        except Exception as e:
            print(f"Index node content error: {e}")


openviking_rag = OpenVikingRAG()