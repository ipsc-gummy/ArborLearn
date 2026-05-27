from __future__ import annotations

import os
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]


def load_env_file(filename: str = ".env", override: bool = False) -> None:
    env_path = BACKEND_DIR / filename
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if value == "" and os.environ.get(key):
            continue
        if override or os.environ.get(key) in (None, ""):
            os.environ[key] = value


load_env_file()
load_env_file("local.env", override=True)


def get_database_path() -> Path:
    configured = os.getenv("DATABASE_PATH", "data/treelearn.sqlite3")
    path = Path(configured)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def get_cors_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5175,http://127.0.0.1:5175",
    )
    origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    dev_origins = [
        f"http://localhost:{port}"
        for port in range(5173, 5180)
    ] + [
        f"http://127.0.0.1:{port}"
        for port in range(5173, 5180)
    ]
    for origin in dev_origins:
        if origin not in origins:
            origins.append(origin)
    return origins


def get_vector_db_path() -> Path:
    """获取向量数据库路径"""
    configured = os.getenv("VECTOR_DB_PATH", "data/lancedb")
    path = Path(configured)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_vector_embedding_model() -> str:
    """获取向量嵌入模型名称"""
    return os.getenv("VECTOR_EMBEDDING_MODEL", "all-MiniLM-L6-v2")


def is_rag_enabled() -> bool:
    """检查是否启用 RAG 功能"""
    return os.getenv("ENABLE_RAG", "false").lower() == "true"
