from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .db import connect


TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14
PASSWORD_ITERATIONS = 260_000
security = HTTPBearer(auto_error=False)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _b64decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def password_hash(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return f"pbkdf2_sha256${PASSWORD_ITERATIONS}${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iterations, salt, expected = stored_hash.split("$", 3)
    except ValueError:
        return False
    if algorithm != "pbkdf2_sha256":
        return False

    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        _b64decode(salt),
        int(iterations),
    )
    return hmac.compare_digest(_b64encode(digest), expected)


def _auth_secret() -> bytes:
    secret = os.getenv("AUTH_SECRET") or os.getenv("MODEL_API_KEY") or "treelearn-development-secret"
    return secret.encode("utf-8")


def create_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    payload_bytes = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    encoded_payload = _b64encode(payload_bytes)
    signature = hmac.new(_auth_secret(), encoded_payload.encode("ascii"), hashlib.sha256).digest()
    return f"{encoded_payload}.{_b64encode(signature)}"


def read_token(token: str) -> dict[str, Any]:
    try:
        encoded_payload, encoded_signature = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid auth token") from exc

    expected_signature = hmac.new(_auth_secret(), encoded_payload.encode("ascii"), hashlib.sha256).digest()
    if not hmac.compare_digest(_b64encode(expected_signature), encoded_signature):
        raise HTTPException(status_code=401, detail="Invalid auth token")

    payload = json.loads(_b64decode(encoded_payload).decode("utf-8"))
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(status_code=401, detail="Auth token expired")
    return payload


def require_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    payload = read_token(credentials.credentials)
    user_id = payload.get("sub")
    if not isinstance(user_id, str):
        raise HTTPException(status_code=401, detail="Invalid auth token")

    with connect() as conn:
        row = conn.execute(
            """
            SELECT id, email, display_name, created_at
            FROM users
            WHERE id = ?
            """,
            (user_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(row)
