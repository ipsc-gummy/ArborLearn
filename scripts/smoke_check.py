#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any


DEFAULT_API_BASE_URL = "http://127.0.0.1:8000"
DEFAULT_PASSWORD = "ArborLearnSmoke2026!"
REQUEST_TIMEOUT_SECONDS = 30


@dataclass
class ApiError(RuntimeError):
    method: str
    path: str
    status: int | None
    body: str

    def __str__(self) -> str:
        status = self.status if self.status is not None else "network"
        return f"{self.method} {self.path} failed with {status}: {self.body}"


class ApiClient:
    def __init__(self, base_url: str, timeout: int) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.token: str | None = None

    def request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> Any:
        data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers = {"Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        request = urllib.request.Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise ApiError(method, path, exc.code, body) from exc
        except urllib.error.URLError as exc:
            raise ApiError(method, path, None, str(exc.reason)) from exc

        return json.loads(body) if body else None


def log_pass(label: str) -> None:
    print(f"PASS {label}", flush=True)


def log_info(message: str) -> None:
    print(f"INFO {message}", flush=True)


def make_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def run_smoke(base_url: str, email: str, password: str, timeout: int) -> None:
    client = ApiClient(base_url, timeout)

    health = client.request("GET", "/api/health")
    require(bool(health.get("ok")), "health response did not contain ok=true")
    log_pass("health")

    auth = client.request(
        "POST",
        "/api/auth/register",
        {
            "email": email,
            "password": password,
            "displayName": "ArborLearn Smoke",
        },
    )
    token = auth.get("token")
    require(isinstance(token, str) and token, "register response did not contain token")
    client.token = token
    log_pass("register")

    me = client.request("GET", "/api/auth/me")
    require(me.get("user", {}).get("email") == email, "auth me returned a different user")
    log_pass("auth me")

    tree = client.request("GET", "/api/tree")
    require(isinstance(tree.get("nodes"), dict), "tree response did not contain nodes")
    require(isinstance(tree.get("rootIds"), list), "tree response did not contain rootIds")
    log_pass("fetch tree")

    root_id = make_id("smoke-root")
    root = client.request(
        "POST",
        "/api/nodes",
        {
            "id": root_id,
            "notebookId": root_id,
            "parentId": None,
            "title": "Smoke Test Notebook",
            "summary": "Created by scripts/smoke_check.py",
            "selectedText": None,
            "contextWeight": "mainline",
            "messages": [],
        },
    )
    require(root.get("id") == root_id, "create root node returned unexpected id")
    notebook_id = root.get("notebookId")
    require(notebook_id == root_id, "create root node returned unexpected notebookId")
    log_pass("create root node")

    child_id = make_id("smoke-child")
    child = client.request(
        "POST",
        "/api/nodes",
        {
            "id": child_id,
            "parentId": root_id,
            "title": "Smoke Child Node",
            "summary": "Initial child summary",
            "selectedText": "Smoke selection",
            "contextWeight": "isolated",
            "messages": [],
        },
    )
    require(child.get("id") == child_id, "create child node returned unexpected id")
    require(child.get("notebookId") == notebook_id, "child node did not inherit notebook")
    log_pass("create child node")

    patch = client.request(
        "PATCH",
        f"/api/nodes/{child_id}",
        {
            "title": "Smoke Child Node Updated",
            "summary": "Updated child summary",
            "contextWeight": "mainline",
        },
    )
    require(patch.get("ok") is True, "patch node did not return ok=true")
    log_pass("patch child node")

    messages = client.request("GET", f"/api/nodes/{child_id}/messages")
    require(isinstance(messages.get("messages"), list), "node messages response did not contain messages")
    log_pass("fetch messages")

    task = client.request(
        "POST",
        "/api/long-tasks",
        {
            "node_id": child_id,
            "notebook_id": notebook_id,
            "question": "请把这个 smoke check 问题拆成三步。",
            "title": "Smoke Long Task",
            "auto_run": False,
            "model": "deepseek-v4-flash",
            "thinkingMode": "fast",
        },
    )
    task_id = task.get("id")
    require(isinstance(task_id, str) and task_id, "create long task response did not contain id")
    require(task.get("status") == "CREATED", "new long task was not CREATED")
    log_pass("create long task")

    tasks = client.request("GET", f"/api/nodes/{child_id}/long-tasks")
    require(any(item.get("id") == task_id for item in tasks.get("tasks", [])), "node long task list did not include created task")
    log_pass("list node long tasks")

    detail = client.request("GET", f"/api/long-tasks/{task_id}")
    require(detail.get("id") == task_id, "fetch long task returned unexpected id")
    require(isinstance(detail.get("steps"), list), "long task detail did not contain steps")
    log_pass("fetch long task")

    cancelled = client.request("POST", f"/api/long-tasks/{task_id}/cancel")
    require(cancelled.get("status") == "CANCELLED", "cancel long task did not return CANCELLED")
    log_pass("cancel long task")

    log_info(f"smoke account: {email}")
    log_info("ArborLearn smoke checks completed.")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run ArborLearn API smoke checks against a running backend.")
    parser.add_argument("--base-url", default=DEFAULT_API_BASE_URL, help=f"Backend base URL, default {DEFAULT_API_BASE_URL}")
    parser.add_argument("--email", default=None, help="Smoke account email. Defaults to a unique example.com address.")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help="Smoke account password.")
    parser.add_argument("--timeout", type=int, default=REQUEST_TIMEOUT_SECONDS, help="Request timeout in seconds.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    timestamp = int(time.time())
    email = args.email or f"arborlearn-smoke-{timestamp}-{uuid.uuid4().hex[:6]}@example.com"
    try:
        run_smoke(args.base_url, email, args.password, args.timeout)
    except Exception as exc:
        print(f"FAIL {exc}", file=sys.stderr, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
