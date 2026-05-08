# TreeLearn MVP

TreeLearn is a tree-shaped learning workspace. This MVP connects the existing React UI to a real backend path:

```text
Frontend chat
-> POST /api/chat
-> SQLite tree/messages
-> Context Builder
-> OpenAI-compatible model API
-> assistant message saved back to SQLite
```

Accounts are email/password based in the current MVP. Each user owns their own notebooks, nodes, and messages; unauthenticated requests cannot read or mutate tree data.

## Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
# edit .env and set MODEL_API_KEY
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

If a hidden `.env` file is inconvenient to edit, use `backend/local.env` instead. It is intentionally ignored by git and overrides `.env`.

The default model endpoint is DeepSeek-compatible:

```text
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash
```

Any OpenAI-compatible `/chat/completions` service can be used by changing `MODEL_BASE_URL`, `MODEL_NAME`, and `MODEL_API_KEY`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_BASE_URL` if the backend is not running at `http://127.0.0.1:8000`.

## Core API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/chat`
- `GET /api/tree`
- `GET /api/notebooks/{id}/tree`
- `POST /api/nodes`
- `PATCH /api/nodes/{id}`
- `DELETE /api/nodes/{id}`
- `GET /api/nodes/{id}/messages`

## ECS Deployment

Use GitHub as the source repository, then deploy on ECS with Nginx + systemd. See:

```text
deploy/README.md
```

## Current Context Strategy

When a user chats in a node, the backend builds model context from:

- root node title and summary
- current node title, summary, and context mode
- parent node title, summary, selected text, and recent turns
- current node recent turns

This is intentionally simple, so the first product proof is visible: the same model receives different context depending on the active tree node.
