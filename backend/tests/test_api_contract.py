from __future__ import annotations

import sys
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "treelearn-test.sqlite3"))
    monkeypatch.setenv("AUTH_SECRET", "test-secret")
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.setenv("ENABLE_RAG", "false")

    from app.main import app

    with TestClient(app) as test_client:
        yield test_client


def register(client: TestClient, label: str) -> dict[str, str]:
    email = f"{label}-{uuid.uuid4().hex[:8]}@example.com"
    response = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "ArborLearnTest2026!",
            "displayName": label,
        },
    )
    assert response.status_code == 201
    token = response.json()["token"]
    return {
        "Authorization": f"Bearer {token}",
        "email": email,
    }


def create_root(client: TestClient, headers: dict[str, str], root_id: str | None = None) -> dict:
    root_id = root_id or f"test-root-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/nodes",
        headers=headers,
        json={
            "id": root_id,
            "notebookId": root_id,
            "parentId": None,
            "title": "Pytest Notebook",
            "summary": "Created by backend pytest.",
            "selectedText": None,
            "contextWeight": "mainline",
            "messages": [],
        },
    )
    assert response.status_code == 201
    return response.json()


def create_child(client: TestClient, headers: dict[str, str], parent_id: str) -> dict:
    child_id = f"test-child-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/nodes",
        headers=headers,
        json={
            "id": child_id,
            "parentId": parent_id,
            "title": "Pytest Child",
            "summary": "Child node.",
            "selectedText": "selected text",
            "contextWeight": "isolated",
            "messages": [],
        },
    )
    assert response.status_code == 201
    return response.json()


def test_auth_owner_isolation(client: TestClient) -> None:
    owner = register(client, "owner")
    other = register(client, "other")
    root = create_root(client, owner)

    messages = client.get(f"/api/nodes/{root['id']}/messages", headers=other)
    assert messages.status_code == 404

    patch = client.patch(
        f"/api/nodes/{root['id']}",
        headers=other,
        json={"title": "Should Not Update"},
    )
    assert patch.status_code == 404

    task = client.post(
        "/api/long-tasks",
        headers=other,
        json={
            "nodeId": root["id"],
            "question": "Should not be accepted.",
            "autoRun": False,
        },
    )
    assert task.status_code == 404


def test_node_crud_contract(client: TestClient) -> None:
    user = register(client, "node-crud")
    root = create_root(client, user)
    child = create_child(client, user, root["id"])
    assert child["notebookId"] == root["notebookId"]

    patch = client.patch(
        f"/api/nodes/{child['id']}",
        headers=user,
        json={"title": "Updated Child", "summary": "Updated summary", "contextWeight": "mainline"},
    )
    assert patch.status_code == 200
    assert patch.json()["ok"] is True

    messages = client.get(f"/api/nodes/{child['id']}/messages", headers=user)
    assert messages.status_code == 200
    assert isinstance(messages.json()["messages"], list)

    deleted = client.delete(f"/api/nodes/{child['id']}", headers=user)
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    missing = client.get(f"/api/nodes/{child['id']}/messages", headers=user)
    assert missing.status_code == 404


def test_long_task_metadata_lifecycle(client: TestClient) -> None:
    owner = register(client, "task-owner")
    other = register(client, "task-other")
    root = create_root(client, owner)
    child = create_child(client, owner, root["id"])

    created = client.post(
        "/api/long-tasks",
        headers=owner,
        json={
            "nodeId": child["id"],
            "notebookId": child["notebookId"],
            "question": "Break this test task into steps.",
            "title": "Pytest Long Task",
            "autoRun": False,
            "model": "deepseek-v4-flash",
            "thinkingMode": "fast",
        },
    )
    assert created.status_code == 201
    task = created.json()
    assert task["status"] == "CREATED"
    assert task["node_id"] == child["id"]

    task_id = task["id"]
    visible = client.get(f"/api/nodes/{child['id']}/long-tasks", headers=owner)
    assert visible.status_code == 200
    assert any(item["id"] == task_id for item in visible.json()["tasks"])

    detail = client.get(f"/api/long-tasks/{task_id}", headers=owner)
    assert detail.status_code == 200
    assert detail.json()["id"] == task_id
    assert isinstance(detail.json()["steps"], list)

    hidden = client.get(f"/api/long-tasks/{task_id}", headers=other)
    assert hidden.status_code == 404

    cancelled = client.post(f"/api/long-tasks/{task_id}/cancel", headers=owner)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "CANCELLED"
