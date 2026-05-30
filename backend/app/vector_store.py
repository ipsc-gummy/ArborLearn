from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Windows 兼容：禁用符号链接（Windows 不支持 symlink）
os.environ.setdefault("HF_HUB_ENABLE_SYMLINKS", "0")
os.environ.setdefault(
    "LANCEDB_CONFIG_DIR",
    str((Path(__file__).resolve().parents[1] / "data" / "lancedb-config")),
)

import lancedb
from lancedb.embeddings import EmbeddingFunctionRegistry
from lancedb.table import Table

from .settings import BACKEND_DIR


class VectorStore:
    """LanceDB 向量存储服务类"""
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance
    
    def initialize(self):
        """初始化向量存储"""
        if self._initialized:
            return
        
        db_path = BACKEND_DIR / "data" / "lancedb"
        db_path.mkdir(parents=True, exist_ok=True)
        
        self.db = lancedb.connect(str(db_path))
        self.embedding_model = self._get_embedding_model()
        self._initialized = True
    
    def _get_embedding_model(self):
        """获取嵌入模型"""
        model_name = os.getenv("VECTOR_EMBEDDING_MODEL", "all-MiniLM-L6-v2")
        try:
            registry = EmbeddingFunctionRegistry.get_instance()
            return registry.get(model_name).create()
        except Exception:
            from sentence_transformers import SentenceTransformer
            
            class CustomEmbeddingFunction:
                def __init__(self, model_name):
                    self.model = SentenceTransformer(model_name)
                
                def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
                    return self.model.encode(texts).tolist()
                
                def ndims(self) -> int:
                    return self.model.get_sentence_embedding_dimension()
            
            return CustomEmbeddingFunction(model_name)
    
    def get_or_create_table(self, table_name: str) -> Table:
        """获取或创建向量表"""
        if not self._initialized:
            self.initialize()
        
        if table_name in self.db.table_names():
            return self.db.open_table(table_name)
        
        import pyarrow as pa
        
        schema = pa.schema([
            ("id", pa.string()),
            ("content", pa.string()),
            ("title", pa.string()),
            ("node_id", pa.string()),
            ("notebook_id", pa.string()),
            ("user_id", pa.string()),
            ("source_type", pa.string()),
            ("metadata", pa.string()),
            ("vector", pa.list_(pa.float32(), 384)),
        ])
        return self.db.create_table(table_name, schema=schema)
    
    def add_documents(
        self,
        documents: List[Dict[str, Any]],
        table_name: str = "context_vectors",
    ):
        """向向量表添加文档"""
        table = self.get_or_create_table(table_name)
        
        records = []
        texts = []
        for doc in documents:
            text = doc.get("content", "")
            if text:
                texts.append(text)
                records.append(doc)
        
        if texts:
            vectors = self.embedding_model.generate_embeddings(texts)
            for record, vector in zip(records, vectors):
                record["vector"] = vector
            
            table.add(records)
    
    def search(
        self,
        query: str,
        user_id: str,
        notebook_id: Optional[str] = None,
        node_id: Optional[str] = None,
        limit: int = 5,
        table_name: str = "context_vectors",
    ) -> List[Dict[str, Any]]:
        """搜索相关文档"""
        if not self._initialized:
            self.initialize()
        
        if table_name not in self.db.table_names():
            return []
        
        table = self.db.open_table(table_name)
        
        query_vector = self.embedding_model.generate_embeddings([query])[0]
        
        builder = table.search(query_vector).limit(limit)
        
        if user_id:
            builder = builder.where(f"user_id = '{user_id}'")
        if notebook_id:
            builder = builder.where(f"notebook_id = '{notebook_id}'")
        
        results = builder.to_list()
        
        return [
            {
                "id": r.get("id"),
                "content": r.get("content", ""),
                "title": r.get("title", ""),
                "node_id": r.get("node_id"),
                "notebook_id": r.get("notebook_id"),
                "source_type": r.get("source_type"),
                "score": r.get("_distance", 0),
            }
            for r in results
        ]
    
    def delete_by_node(self, node_id: str, table_name: str = "context_vectors"):
        """删除指定节点的向量"""
        if table_name not in self.db.table_names():
            return
        
        table = self.db.open_table(table_name)
        table.delete(f"node_id = '{node_id}'")
    
    def delete_by_notebook(self, notebook_id: str, table_name: str = "context_vectors"):
        """删除指定笔记本的向量"""
        if table_name not in self.db.table_names():
            return
        
        table = self.db.open_table(table_name)
        table.delete(f"notebook_id = '{notebook_id}'")


vector_store = VectorStore()
