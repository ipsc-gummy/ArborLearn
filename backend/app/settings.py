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
    configured = os.getenv("DATABASE_PATH", "data/arborlearn.sqlite3")
    path = Path(configured)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def get_cors_origins() -> list[str]:
    default_dev_origins = [f"http://localhost:{port}" for port in range(5173, 5180)] + [
        f"http://127.0.0.1:{port}" for port in range(5173, 5180)
    ]
    raw = os.getenv(
        "CORS_ORIGINS",
        "",
    )
    configured_origins = [origin.strip() for origin in raw.split(",") if origin.strip()]
    return list(dict.fromkeys(configured_origins + default_dev_origins))


def get_vector_db_path() -> Path:
    """获取向量数据库路径"""
    configured = os.getenv("VECTOR_DB_PATH", "data/lancedb")
    path = Path(configured)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_upload_dir() -> Path:
    configured = os.getenv("UPLOAD_DIR", "data/uploads")
    path = Path(configured)
    if not path.is_absolute():
        path = BACKEND_DIR / path
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_max_upload_bytes() -> int:
    raw_value = os.getenv("MAX_UPLOAD_MB", "20")
    try:
        megabytes = max(1, int(raw_value))
    except ValueError:
        megabytes = 20
    return megabytes * 1024 * 1024


def get_vector_embedding_model() -> str:
    """获取向量嵌入模型名称"""
    return os.getenv("VECTOR_EMBEDDING_MODEL", "all-MiniLM-L6-v2")


def is_rag_enabled() -> bool:
    """检查是否启用 RAG 功能"""
    return os.getenv("ENABLE_RAG", "false").lower() == "true"


def is_ocr_enabled() -> bool:
    return os.getenv("ENABLE_OCR", "true").lower() == "true"


def get_ocr_languages() -> str:
    return os.getenv("OCR_LANGUAGES", "chi_sim+eng")


def get_ocr_timeout_seconds() -> int:
    raw = os.getenv("OCR_TIMEOUT_SECONDS", "12")
    try:
        return max(2, int(raw))
    except ValueError:
        return 12


def get_tesseract_cmd() -> str | None:
    value = os.getenv("TESSERACT_CMD", "").strip()
    return value or None


def get_vision_provider() -> str:
    return os.getenv("VISION_PROVIDER", "none").strip().lower()


def get_vision_base_url() -> str:
    return os.getenv("VISION_BASE_URL", "http://127.0.0.1:8001/v1").strip().rstrip("/")


def get_vision_model() -> str:
    return os.getenv("VISION_MODEL", "Qwen/Qwen2.5-VL-7B-Instruct").strip()


def get_vision_api_key() -> str:
    return os.getenv("VISION_API_KEY", "").strip()


def get_vision_timeout_seconds() -> int:
    raw = os.getenv("VISION_TIMEOUT_SECONDS", "120")
    try:
        return max(10, int(raw))
    except ValueError:
        return 120


def get_vision_max_attempts() -> int:
    raw = os.getenv("VISION_MAX_ATTEMPTS", "4")
    try:
        return min(6, max(1, int(raw)))
    except ValueError:
        return 4


def get_vision_retry_initial_delay_seconds() -> float:
    raw = os.getenv("VISION_RETRY_INITIAL_DELAY_SECONDS", "2")
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 2.0


def get_vision_retry_max_delay_seconds() -> float:
    raw = os.getenv("VISION_RETRY_MAX_DELAY_SECONDS", "12")
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 12.0


def get_vision_max_image_edge() -> int:
    raw = os.getenv("VISION_MAX_IMAGE_EDGE", "2400")
    try:
        value = int(raw)
    except ValueError:
        return 2400
    if value <= 0:
        return 0
    return max(512, value)
