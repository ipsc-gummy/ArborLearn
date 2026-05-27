# ArborLearn / TreeLearn

> 中文 | [English](#english)

ArborLearn 是一个 AI 问答驱动的树状学习平台。它把普通聊天里的零散问答整理成 notebook、树状节点和可回填的学习记录，让用户可以沿着主线学习，也可以从任意片段展开局部追问。

TreeLearn 是 ArborLearn 的核心学习界面：每个 notebook 是一棵学习树，每个节点是一段聚焦对话，子节点用于承接选中文本、局部概念或延伸问题。

## 核心体验

```text
注册/登录
-> 创建或进入 notebook
-> 构建树状学习节点
-> 在节点内向 AI 提问
-> 基于树路径继承上下文
-> 对复杂问题启动长任务
-> 将子对话结论回填到父对话
-> 通过历史、搜索和 RAG 继续复习
```

## 界面预览

ArborLearn 的第一屏不是单纯聊天窗口，而是围绕学习主题组织的工作台：

### Notebook 工作台

![Notebook dashboard](frontend/public/showcase/notebooks-light.png)

### 树状知识结构

![Knowledge tree](frontend/public/showcase/diagram-light.png)

### 节点问答界面

![Node conversation](frontend/public/showcase/conversation-light.png)

## 主要功能

- 树状 notebook 与节点式学习空间。
- 用户注册登录与数据隔离。
- 基于当前节点、父节点、根节点和近期对话构建 AI 上下文。
- 支持流式回答、重新生成和中止保存。
- 长任务执行链：自动规划步骤、保存证据、记录阶段输出并生成最终答案。
- 子对话回填：把局部追问的结论安全写回父对话。
- Web search 与 RAG 基础能力。
- Docker、Nginx、systemd 部署材料。

## 项目结构

```text
ArborLearn/
├── backend/              # FastAPI backend, SQLite data access, AI orchestration
│   ├── app/
│   │   ├── main.py       # API routes
│   │   ├── db.py         # SQLite schema and queries
│   │   ├── context_builder.py
│   │   ├── long_task_runner.py
│   │   └── backfill.py
│   └── requirements.txt
├── frontend/             # React / Vite TreeLearn workspace
│   └── src/
│       ├── components/
│       ├── store/
│       └── lib/
├── docs/                 # Architecture, API, testing, report and deployment docs
├── deploy/               # Nginx and systemd deployment files
└── scripts/              # Smoke checks and local utilities
```

## 快速启动

### 后端

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
# 编辑 .env，至少填写 MODEL_API_KEY
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

默认模型配置兼容 DeepSeek：

```text
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash
```

也可以通过修改 `MODEL_BASE_URL`、`MODEL_NAME`、`MODEL_API_KEY` 接入其他 OpenAI-compatible `/chat/completions` 服务。

### 前端

```bash
cd frontend
npm install
npm run dev
```

如果后端不是 `http://127.0.0.1:8000`，设置：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

## 环境变量

后端最小配置：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `MODEL_API_KEY` | 是 | OpenAI-compatible 模型服务的 API key |
| `MODEL_BASE_URL` | 是 | 默认 `https://api.deepseek.com` |
| `MODEL_NAME` | 是 | 默认 `deepseek-v4-flash` |
| `AUTH_SECRET` | 生产必填 | 登录 token 签名密钥，生产环境必须换成长随机值 |
| `CORS_ORIGINS` | 是 | 允许访问后端的前端 origin 列表 |
| `DATABASE_PATH` | 否 | SQLite 路径，默认 `backend/data/treelearn.sqlite3` |
| `ENABLE_RAG` | 否 | 是否启用 RAG |
| `VECTOR_DB_PATH` | 否 | LanceDB / vector store 路径 |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SEARXNG_BASE_URL` | 否 | Web search provider 配置 |

前端配置：

| 变量 | 说明 |
| --- | --- |
| `VITE_API_BASE_URL` | 后端地址，本地默认 `http://127.0.0.1:8000`，生产环境通常使用同源 `/api` |

## 核心 API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/tree`
- `POST /api/nodes`
- `PATCH /api/nodes/{id}`
- `DELETE /api/nodes/{id}`
- `GET /api/nodes/{id}/messages`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/chat/retry`
- `POST /api/long-tasks`
- `GET /api/long-tasks/{id}`
- `POST /api/backfill/draft`
- `POST /api/backfill/patches`

完整接口说明见 [docs/API.md](docs/API.md)。

## 项目文档

- [项目成熟度路线图](docs/PROJECT_MATURITY_ROADMAP.md)
- [用户流程](docs/USER_FLOW.md)
- [功能矩阵](docs/FEATURE_MATRIX.md)
- [系统架构](docs/ARCHITECTURE.md)
- [API 契约](docs/API.md)
- [测试与回归](docs/TESTING.md)
- [技术报告提纲](docs/REPORT_OUTLINE.md)
- [部署说明](docs/DEPLOYMENT.md)

## Smoke Check

启动后端后运行：

```bash
python3 scripts/smoke_check.py --base-url http://127.0.0.1:8000
```

默认 smoke check 覆盖 health、auth、tree、node、long-task metadata 和 cancel API，不调用真实模型、web search 或 RAG。

可选 live check 会调用外部服务：

```bash
python3 scripts/smoke_check.py \
  --base-url http://127.0.0.1:8000 \
  --include-chat-live \
  --include-web-search
```

## 部署

项目已提供 Docker、Nginx 和 systemd 相关部署材料。ECS / Ubuntu 部署见：

```text
docs/DEPLOYMENT.md
```

生产环境不要直接暴露后端 `8000` 端口，应通过 Nginx 代理 `/api`。

---

## English

ArborLearn is an AI question-answering learning workspace built around a tree-shaped knowledge structure. It turns scattered chat-based learning into notebooks, structured nodes, and reusable learning records.

TreeLearn is the core learning interface: each notebook is a learning tree, each node is a focused conversation, and child nodes let learners branch from selected context without losing the main learning path.

## Core Experience

```text
Sign up / log in
-> create or open a notebook
-> build a tree of learning nodes
-> chat with AI inside a node
-> inherit context from the tree path
-> run long tasks for complex questions
-> backfill child-node conclusions into parent conversations
-> continue review through history, search, and RAG
```

## Screenshots

ArborLearn is organized as a learning workspace, not a plain chatbot.

### Notebook Workspace

![Notebook dashboard](frontend/public/showcase/notebooks-light.png)

### Knowledge Tree

![Knowledge tree](frontend/public/showcase/diagram-light.png)

### Node Conversation

![Node conversation](frontend/public/showcase/conversation-light.png)

## Features

- Tree-shaped notebooks and conversation nodes.
- Email/password authentication with per-user data isolation.
- Node-aware AI chat with context built from root, parent, current node, recent turns, web evidence, and optional RAG.
- Streaming chat, retry, and stop support.
- Long task execution chain with plan, steps, evidence, outputs, final answer, cancellation, and retry hooks.
- Backfill workflow for safely applying child-conversation conclusions to parent messages.
- Web search and RAG foundations.
- Docker, Nginx, and systemd deployment materials.

## Repository Structure

```text
ArborLearn/
├── backend/              # FastAPI backend, SQLite data access, AI orchestration
├── frontend/             # React / Vite TreeLearn workspace
├── docs/                 # Architecture, API, testing, report and deployment docs
├── deploy/               # Nginx and systemd deployment files
└── scripts/              # Smoke checks and local utilities
```

## Quick Start

### Backend

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
# edit .env and set MODEL_API_KEY
.venv/bin/uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The default model endpoint is DeepSeek-compatible:

```text
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash
```

Any OpenAI-compatible `/chat/completions` service can be used by changing `MODEL_BASE_URL`, `MODEL_NAME`, and `MODEL_API_KEY`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

If the backend is not running at `http://127.0.0.1:8000`, set:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

## Environment Variables

Backend:

| Variable | Required | Purpose |
| --- | --- | --- |
| `MODEL_API_KEY` | Yes | API key for the OpenAI-compatible model service |
| `MODEL_BASE_URL` | Yes | Default `https://api.deepseek.com` |
| `MODEL_NAME` | Yes | Default `deepseek-v4-flash` |
| `AUTH_SECRET` | Production | Signing secret for login tokens |
| `CORS_ORIGINS` | Yes | Allowed frontend origins |
| `DATABASE_PATH` | No | SQLite path |
| `ENABLE_RAG` | No | Enables retrieval-augmented context |
| `VECTOR_DB_PATH` | No | Vector database path |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SEARXNG_BASE_URL` | No | Web search provider configuration |

Frontend:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Backend URL. Local default is `http://127.0.0.1:8000`; production usually uses same-origin `/api`. |

## Core API

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/tree`
- `POST /api/nodes`
- `PATCH /api/nodes/{id}`
- `DELETE /api/nodes/{id}`
- `GET /api/nodes/{id}/messages`
- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/chat/retry`
- `POST /api/long-tasks`
- `GET /api/long-tasks/{id}`
- `POST /api/backfill/draft`
- `POST /api/backfill/patches`

See [docs/API.md](docs/API.md) for the full API contract.

## Documentation

- [Project maturity roadmap](docs/PROJECT_MATURITY_ROADMAP.md)
- [User flow](docs/USER_FLOW.md)
- [Feature matrix](docs/FEATURE_MATRIX.md)
- [Architecture](docs/ARCHITECTURE.md)
- [API contract](docs/API.md)
- [Testing and regression](docs/TESTING.md)
- [Technical report outline](docs/REPORT_OUTLINE.md)
- [Deployment guide](docs/DEPLOYMENT.md)

## Smoke Check

Start the backend, then run:

```bash
python3 scripts/smoke_check.py --base-url http://127.0.0.1:8000
```

The default smoke check covers health, auth, tree, node, long-task metadata, and cancel APIs. It does not call the real model API, web search, or RAG.

Optional live checks call external services:

```bash
python3 scripts/smoke_check.py \
  --base-url http://127.0.0.1:8000 \
  --include-chat-live \
  --include-web-search
```

## Deployment

Docker, Nginx, and systemd deployment materials are included. See:

```text
docs/DEPLOYMENT.md
```

In production, do not expose backend port `8000` directly. Proxy `/api` through Nginx instead.
