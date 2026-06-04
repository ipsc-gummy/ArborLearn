from __future__ import annotations

import json
import sys
import types
import uuid
from datetime import timedelta
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
    monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "false")
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    monkeypatch.setenv("LANCEDB_CONFIG_DIR", str(tmp_path / "lancedb-config"))
    (tmp_path / "appdata").mkdir(parents=True, exist_ok=True)
    (tmp_path / "lancedb-config").mkdir(parents=True, exist_ok=True)

    from app.main import app
    monkeypatch.setenv("DEFAULT_WALLET_INITIAL_CENTS", "1000")
    monkeypatch.setenv("DEFAULT_WALLET_INITIAL_TOKENS", "1000000")

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


def test_register_requires_email_code_when_enabled(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    from app import main

    monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "true")
    monkeypatch.setenv("EMAIL_CODE_SECRET", "test-email-code-secret")
    sent_codes: list[tuple[str, str]] = []
    monkeypatch.setattr(main, "send_verification_code_email", lambda email, code: sent_codes.append((email, code)))

    email = f"verified-{uuid.uuid4().hex[:8]}@example.com"
    send_response = client.post(
        "/api/auth/send-email-code",
        json={"email": email, "purpose": "register"},
    )

    assert send_response.status_code == 200
    assert send_response.json()["message"] == "验证码已发送，请查收邮箱"
    assert len(sent_codes) == 1
    assert sent_codes[0][0] == email
    assert sent_codes[0][1].isdigit()
    assert len(sent_codes[0][1]) == 6

    wrong_code = "000000" if sent_codes[0][1] != "000000" else "111111"
    bad_register = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "ArborLearnTest2026!",
            "displayName": "Verified User",
            "verificationCode": wrong_code,
        },
    )
    assert bad_register.status_code == 400
    assert bad_register.json()["detail"] == "验证码错误或已过期"

    good_register = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "ArborLearnTest2026!",
            "displayName": "Verified User",
            "verificationCode": sent_codes[0][1],
        },
    )
    assert good_register.status_code == 201
    assert good_register.json()["user"]["email"] == email
    assert good_register.json()["user"]["emailVerified"] is True


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


def test_wallet_initializes_on_first_read(client: TestClient) -> None:
    headers = register(client, "wallet-init")

    response = client.get("/api/wallet", headers=headers)

    assert response.status_code == 200
    wallet = response.json()["wallet"]
    assert wallet["balanceCents"] == 1000
    assert wallet["balanceTokens"] == 1_000_000
    assert wallet["canCallApi"] is True


def test_wallet_default_quota_increase_tops_up_existing_wallet(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    headers = register(client, "wallet-quota")

    first = client.get("/api/wallet", headers=headers)
    assert first.status_code == 200
    assert first.json()["wallet"]["balanceCents"] == 1000
    assert first.json()["wallet"]["balanceTokens"] == 1_000_000

    monkeypatch.setenv("DEFAULT_WALLET_INITIAL_CENTS", "1500")
    monkeypatch.setenv("DEFAULT_WALLET_INITIAL_TOKENS", "1500000")
    increased = client.get("/api/wallet", headers=headers)
    assert increased.status_code == 200
    assert increased.json()["wallet"]["balanceCents"] == 1500
    assert increased.json()["wallet"]["balanceTokens"] == 1_500_000

    monkeypatch.setenv("DEFAULT_WALLET_INITIAL_CENTS", "300")
    monkeypatch.setenv("DEFAULT_WALLET_INITIAL_TOKENS", "300000")
    decreased = client.get("/api/wallet", headers=headers)
    assert decreased.status_code == 200
    assert decreased.json()["wallet"]["balanceCents"] == 1500
    assert decreased.json()["wallet"]["balanceTokens"] == 1_500_000


def test_wallet_cost_keeps_sub_cent_precision(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.billing import calculate_paid_cost_cents, calculate_paid_cost_micro_cents

    monkeypatch.setenv(
        "MODEL_PRICING_JSON",
        json.dumps(
            {
                "tiny-model": {
                    "input_cents_per_million_tokens": 1,
                    "output_cents_per_million_tokens": 1,
                }
            }
        ),
    )

    cost_micro_cents, pricing_source = calculate_paid_cost_micro_cents(
        model_name="tiny-model",
        prompt_tokens=1,
        prompt_cache_hit_tokens=None,
        prompt_cache_miss_tokens=None,
        completion_tokens=0,
        total_tokens=1,
        paid_tokens=1,
    )
    cost_cents, _ = calculate_paid_cost_cents(
        model_name="tiny-model",
        prompt_tokens=1,
        prompt_cache_hit_tokens=None,
        prompt_cache_miss_tokens=None,
        completion_tokens=0,
        total_tokens=1,
        paid_tokens=1,
    )

    assert pricing_source == "env"
    assert cost_micro_cents == 1
    assert cost_cents == 0


def test_chat_usage_uses_free_tokens_then_wallet_balance(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app import main
    from app.model_client import ModelCallResult, ModelUsage

    monkeypatch.setenv(
        "MODEL_PRICING_JSON",
        json.dumps(
            {
                "deepseek-v4-pro": {
                    "input_cents_per_million_tokens": 1_000_000,
                    "output_cents_per_million_tokens": 1_000_000,
                }
            }
        ),
    )
    monkeypatch.setenv("DEFAULT_WALLET_INITIAL_TOKENS", "1000")
    monkeypatch.setattr(
        main,
        "call_model_with_usage",
        lambda messages, model_name=None, thinking_mode=None: ModelCallResult(
            content="assistant answer",
            usage=ModelUsage(
                prompt_tokens=600,
                prompt_cache_hit_tokens=100,
                prompt_cache_miss_tokens=500,
                completion_tokens=600,
                total_tokens=1200,
            ),
        ),
    )
    monkeypatch.setattr(main, "maybe_generate_root_title", lambda *args, **kwargs: None)
    monkeypatch.setattr(main, "maybe_generate_node_summary", lambda *args, **kwargs: None)

    headers = register(client, "wallet-chat")
    root = create_root(client, headers)

    first = client.post(
        "/api/chat",
        headers=headers,
        json={"nodeId": root["id"], "message": "hello", "modelName": "deepseek-v4-pro"},
    )
    assert first.status_code == 200

    wallet = client.get("/api/wallet", headers=headers).json()["wallet"]
    assert wallet["balanceCents"] == 800
    assert wallet["balanceMicroCents"] == 800_000_000
    assert wallet["balanceTokens"] == 0
    assert wallet["canCallApi"] is True

    second = client.post(
        "/api/chat",
        headers=headers,
        json={"nodeId": root["id"], "message": "again", "modelName": "deepseek-v4-pro"},
    )
    assert second.status_code == 200

    wallet = client.get("/api/wallet", headers=headers).json()["wallet"]
    assert wallet["balanceCents"] == -400
    assert wallet["balanceMicroCents"] == -400_000_000
    assert wallet["balanceTokens"] == 0
    assert wallet["canCallApi"] is False

    summary = client.get("/api/usage/summary", headers=headers)
    assert summary.status_code == 200
    assert summary.json()["total"]["total_tokens"] == 2400
    assert summary.json()["total"]["cost_cents"] == 1400
    assert summary.json()["total"]["cost_micro_cents"] == 1_400_000_000

    events = client.get("/api/usage/events", headers=headers)
    assert events.status_code == 200
    assert events.json()["events"][0]["usage_source"] == "provider"
    assert events.json()["events"][0]["cost_micro_cents"] == 1_200_000_000
    assert events.json()["events"][0]["prompt_cache_hit_tokens"] == 100
    assert events.json()["events"][0]["prompt_cache_miss_tokens"] == 500


def tiny_png_bytes() -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        b"\x00\x00\x00\x0cIDATx\x9cc````\x00\x00\x00\x05\x00\x01\r\n-\xb4"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )


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


def test_email_verification_required_for_registration_and_demo_upgrade(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "email-verification.sqlite3"))
    monkeypatch.setenv("AUTH_SECRET", "test-secret")
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.setenv("ENABLE_RAG", "false")
    monkeypatch.setenv("EMAIL_VERIFICATION_REQUIRED", "true")
    monkeypatch.setenv("EMAIL_CODE_SECRET", "test-email-code-secret")
    monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))
    monkeypatch.setenv("LANCEDB_CONFIG_DIR", str(tmp_path / "lancedb-config"))
    (tmp_path / "appdata").mkdir(parents=True, exist_ok=True)
    (tmp_path / "lancedb-config").mkdir(parents=True, exist_ok=True)

    from app import main

    sent_codes: dict[str, str] = {}
    monkeypatch.setattr(main, "send_verification_code_email", lambda email, code: sent_codes.setdefault(email, code))

    with TestClient(main.app) as test_client:
        demo = test_client.post("/api/auth/demo", json={})
        assert demo.status_code == 201
        demo_headers = {"Authorization": f"Bearer {demo.json()['token']}"}

        upgrade_email = "demo-upgrade@example.com"
        blocked_upgrade = test_client.post(
            "/api/auth/upgrade-demo",
            headers=demo_headers,
            json={"email": upgrade_email, "password": "ArborLearnTest2026!", "displayName": "Demo Upgrade"},
        )
        assert blocked_upgrade.status_code == 400

        send_upgrade_code = test_client.post("/api/auth/send-email-code", json={"email": upgrade_email, "purpose": "register"})
        assert send_upgrade_code.status_code == 200
        assert send_upgrade_code.json()["message"] == "验证码已发送，请查收邮箱"
        upgraded = test_client.post(
            "/api/auth/upgrade-demo",
            headers=demo_headers,
            json={
                "email": upgrade_email,
                "password": "ArborLearnTest2026!",
                "displayName": "Demo Upgrade",
                "verificationCode": sent_codes[upgrade_email],
            },
        )
        assert upgraded.status_code == 200
        assert upgraded.json()["user"]["emailVerified"] is True
        assert upgraded.json()["user"]["isTemporary"] is False

        register_email = "verified-register@example.com"
        blocked_register = test_client.post(
            "/api/auth/register",
            json={"email": register_email, "password": "ArborLearnTest2026!", "displayName": "Verified Register"},
        )
        assert blocked_register.status_code == 400

        send_register_code = test_client.post("/api/auth/send-email-code", json={"email": register_email, "purpose": "register"})
        assert send_register_code.status_code == 200
        assert send_register_code.json()["message"] == "验证码已发送，请查收邮箱"
        registered = test_client.post(
            "/api/auth/register",
            json={
                "email": register_email,
                "password": "ArborLearnTest2026!",
                "displayName": "Verified Register",
                "verificationCode": sent_codes[register_email],
            },
        )
        assert registered.status_code == 201
        assert registered.json()["user"]["emailVerified"] is True

        with main.connect() as conn:
            conn.execute("UPDATE users SET email_verified = 0, email_verified_at = NULL WHERE email = ?", (register_email,))
        login = test_client.post("/api/auth/login", json={"email": register_email, "password": "ArborLearnTest2026!"})
        assert login.status_code == 403
        assert login.json()["detail"] == "EMAIL_VERIFICATION_REQUIRED"


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

    image_upload = client.post(
        f"/api/nodes/{child['id']}/files",
        headers=owner,
        files={"file": ("sample.png", tiny_png_bytes(), "image/png")},
    )
    assert image_upload.status_code == 201
    assert image_upload.json()["file"]["filename"] == "sample.png"


def test_image_vision_retries_transient_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    from app import file_uploads

    attempts: list[str] = []

    def fake_vision_call(image_bytes: bytes, mime_type: str) -> str:
        attempts.append(mime_type)
        if len(attempts) < 3:
            raise file_uploads.VisionRequestError("The read operation timed out", retryable=True)
        return "图片摘要：第三次识别成功。"

    monkeypatch.setattr(file_uploads, "is_ocr_enabled", lambda: False)
    monkeypatch.setattr(file_uploads, "get_vision_provider", lambda: "qwen_vl")
    monkeypatch.setattr(file_uploads, "get_vision_max_attempts", lambda: 4)
    monkeypatch.setattr(file_uploads, "_vision_retry_delay_seconds", lambda attempt: 0)
    monkeypatch.setattr(file_uploads, "_call_vision_model", fake_vision_call)

    extracted, status, error = file_uploads.decode_image_file(tiny_png_bytes(), "sample.png", "image/png")

    payload = json.loads(extracted)
    assert status == "ready"
    assert error is None
    assert attempts == ["image/png", "image/png", "image/png"]
    assert payload["images_summary"] == "图片摘要：第三次识别成功。"
    assert any("retrying" in warning for warning in payload["metadata"]["warnings"])


def test_image_vision_failure_is_not_hidden_by_ocr(monkeypatch: pytest.MonkeyPatch) -> None:
    from app import file_uploads

    fake_pytesseract = types.SimpleNamespace(
        pytesseract=types.SimpleNamespace(tesseract_cmd=""),
        image_to_string=lambda *args, **kwargs: "OCR 提取到的公式文本",
    )

    monkeypatch.setitem(sys.modules, "pytesseract", fake_pytesseract)
    monkeypatch.setattr(file_uploads, "is_ocr_enabled", lambda: True)
    monkeypatch.setattr(file_uploads, "get_vision_provider", lambda: "qwen_vl")
    monkeypatch.setattr(file_uploads, "get_vision_max_attempts", lambda: 2)
    monkeypatch.setattr(file_uploads, "_vision_retry_delay_seconds", lambda attempt: 0)
    monkeypatch.setattr(
        file_uploads,
        "_call_vision_model",
        lambda image_bytes, mime_type: (_ for _ in ()).throw(
            file_uploads.VisionRequestError("SSL: UNEXPECTED_EOF_WHILE_READING", retryable=True)
        ),
    )

    extracted, status, error = file_uploads.decode_image_file(tiny_png_bytes(), "sample.png", "image/png")

    payload = json.loads(extracted)
    assert status == "failed"
    assert error == "SSL: UNEXPECTED_EOF_WHILE_READING"
    assert payload["text"] == "OCR 提取到的公式文本"
    assert payload["images_summary"] == ""
    assert any("SSL: UNEXPECTED_EOF_WHILE_READING" in warning for warning in payload["metadata"]["warnings"])


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
