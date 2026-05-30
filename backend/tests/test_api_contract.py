from __future__ import annotations

import sys
import uuid
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from docx import Document

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "arborlearn-test.sqlite3"))
    monkeypatch.setenv("AUTH_SECRET", "test-secret")
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.setenv("ENABLE_RAG", "false")
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    monkeypatch.setenv("LANCEDB_CONFIG_DIR", str(tmp_path / "lancedb-config"))
    (tmp_path / "appdata").mkdir(parents=True, exist_ok=True)
    (tmp_path / "lancedb-config").mkdir(parents=True, exist_ok=True)

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


def test_registration_creates_starter_and_transformer_demo(client: TestClient) -> None:
    user = register(client, "starter")
    tree = client.get("/api/tree", headers=user)
    assert tree.status_code == 200

    payload = tree.json()
    root_ids = payload["rootIds"]
    titles = [payload["nodes"][root_id]["title"] for root_id in root_ids]
    assert any(title.startswith("ArborLearn") for title in titles)
    assert any(title.startswith("Transformer") for title in titles)


def test_demo_sessions_are_temporary_and_isolated(client: TestClient) -> None:
    first = client.post("/api/auth/demo", json={})
    second = client.post("/api/auth/demo", json={})
    assert first.status_code == 201
    assert second.status_code == 201

    first_payload = first.json()
    second_payload = second.json()
    assert first_payload["user"]["isTemporary"] is True
    assert second_payload["user"]["isTemporary"] is True
    assert first_payload["user"]["id"] != second_payload["user"]["id"]

    first_headers = {"Authorization": f"Bearer {first_payload['token']}"}
    second_headers = {"Authorization": f"Bearer {second_payload['token']}"}
    root = create_root(client, first_headers, root_id=f"demo-root-{uuid.uuid4().hex[:8]}")

    hidden = client.get(f"/api/nodes/{root['id']}/messages", headers=second_headers)
    assert hidden.status_code == 404

    first_tree = client.get("/api/tree", headers=first_headers)
    second_tree = client.get("/api/tree", headers=second_headers)
    assert first_tree.status_code == 200
    assert second_tree.status_code == 200
    first_titles = [first_tree.json()["nodes"][root_id]["title"] for root_id in first_tree.json()["rootIds"]]
    second_titles = [second_tree.json()["nodes"][root_id]["title"] for root_id in second_tree.json()["rootIds"]]
    assert any(title.startswith("Transformer") for title in first_titles)
    assert any(title.startswith("Transformer") for title in second_titles)
    assert "Pytest Notebook" in first_titles
    assert "Pytest Notebook" not in second_titles


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


def test_tree_root_ids_return_root_node_ids(client: TestClient) -> None:
    user = register(client, "root-map")
    notebook_id = f"nb-{uuid.uuid4().hex[:8]}"
    root_node_id = f"node-{uuid.uuid4().hex[:8]}"
    response = client.post(
        "/api/nodes",
        headers=user,
        json={
            "id": root_node_id,
            "notebookId": notebook_id,
            "parentId": None,
            "title": "Notebook with distinct IDs",
            "summary": "",
            "selectedText": None,
            "contextWeight": "mainline",
            "messages": [],
        },
    )
    assert response.status_code == 201

    tree = client.get("/api/tree", headers=user)
    assert tree.status_code == 200
    payload = tree.json()
    assert root_node_id in payload["rootIds"]
    assert notebook_id not in payload["nodes"]
    assert payload["nodes"][root_node_id]["parentId"] is None


def test_node_file_upload_lifecycle_and_context(client: TestClient) -> None:
    owner = register(client, "file-owner")
    other = register(client, "file-other")
    root = create_root(client, owner)
    child = create_child(client, owner, root["id"])

    upload = client.post(
        f"/api/nodes/{child['id']}/files",
        headers=owner,
        files={"file": ("notes.md", b"# Notes\nArborLearn upload context works.", "text/markdown")},
    )
    assert upload.status_code == 201
    uploaded_file = upload.json()["file"]
    assert uploaded_file["filename"] == "notes.md"
    assert uploaded_file["extractionStatus"] == "ready"
    assert uploaded_file["extractedChars"] > 0

    listed = client.get(f"/api/nodes/{child['id']}/files", headers=owner)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["files"]] == [uploaded_file["id"]]

    hidden = client.get(f"/api/files/{uploaded_file['id']}", headers=other)
    assert hidden.status_code == 404

    context = client.get(
        f"/api/context/debug?node_id={child['id']}&query=summarize",
        headers=owner,
    )
    assert context.status_code == 200
    assert "ArborLearn upload context works." in context.json()["final_context_preview"]

    deleted = client.delete(f"/api/files/{uploaded_file['id']}", headers=owner)
    assert deleted.status_code == 200
    assert deleted.json()["ok"] is True

    listed_after_delete = client.get(f"/api/nodes/{child['id']}/files", headers=owner)
    assert listed_after_delete.status_code == 200
    assert listed_after_delete.json()["files"] == []


def test_node_file_upload_rejects_unsupported_type(client: TestClient) -> None:
    owner = register(client, "file-reject")
    root = create_root(client, owner)
    child = create_child(client, owner, root["id"])

    upload = client.post(
        f"/api/nodes/{child['id']}/files",
        headers=owner,
        files={"file": ("notes.exe", b"MZ-not-supported", "application/octet-stream")},
    )
    assert upload.status_code == 400


def test_node_file_upload_accepts_pdf_docx_and_image(client: TestClient) -> None:
    owner = register(client, "file-rich")
    root = create_root(client, owner)
    child = create_child(client, owner, root["id"])

    pdf_buffer = BytesIO()
    pdf_writer = PdfWriter()
    pdf_writer.add_blank_page(width=200, height=200)
    pdf_writer.write(pdf_buffer)
    pdf_upload = client.post(
        f"/api/nodes/{child['id']}/files",
        headers=owner,
        files={"file": ("sample.pdf", pdf_buffer.getvalue(), "application/pdf")},
    )
    assert pdf_upload.status_code == 201
    assert pdf_upload.json()["file"]["filename"] == "sample.pdf"

    doc = Document()
    doc.add_paragraph("ArborLearn DOCX upload works.")
    docx_buffer = BytesIO()
    doc.save(docx_buffer)
    docx_upload = client.post(
        f"/api/nodes/{child['id']}/files",
        headers=owner,
        files={
            "file": (
                "sample.docx",
                docx_buffer.getvalue(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert docx_upload.status_code == 201
    assert docx_upload.json()["file"]["filename"] == "sample.docx"

    png_bytes = (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc````\x00\x00\x00\x05\x00\x01\r\n-\xb4"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    image_upload = client.post(
        f"/api/nodes/{child['id']}/files",
        headers=owner,
        files={"file": ("sample.png", png_bytes, "image/png")},
    )
    assert image_upload.status_code == 201
    assert image_upload.json()["file"]["filename"] == "sample.png"


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
            "model": "deepseek-v4-pro",
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
