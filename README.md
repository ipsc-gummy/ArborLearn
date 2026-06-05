# ArborLearn

> 中文 | [English](#english)

ArborLearn 是一个 AI 问答驱动的树状学习平台。它把普通聊天里的零散问答整理成 notebook、树状节点和可回填的学习记录，让用户可以沿着主线学习，也可以从任意片段展开局部追问。

ArborLearn 的核心学习界面围绕树状 notebook 展开：每个 notebook 是一棵学习树，每个节点是一段聚焦对话，子节点用于承接选中文本、局部概念或延伸问题。

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
├── frontend/             # React / Vite ArborLearn workspace
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
MODEL_NAME=deepseek-v4-pro
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
| `MODEL_NAME` | 是 | 默认 `deepseek-v4-pro` |
| `AUTH_SECRET` | 生产必填 | 登录 token 签名密钥，生产环境必须换成长随机值 |
| `EMAIL_CODE_SECRET` | 生产必填 | 邮箱验证码 hash 密钥，生产环境必须换成长随机值 |
| `SMTP_HOST` / `SMTP_PORT` | 开启验证码必填 | 阿里云 DirectMail 使用 `smtpdm.aliyun.com` + `465` |
| `SMTP_USER` / `SMTP_PASSWORD` | 开启验证码必填 | 发信地址和 SMTP 密码，密码只写入真实 `.env` |
| `SMTP_FROM` / `SMTP_FROM_NAME` | 开启验证码必填 | 邮件发件人地址和显示名 |
| `CORS_ORIGINS` | 是 | 允许访问后端的前端 origin 列表 |
| `DATABASE_PATH` | 否 | SQLite 路径，默认 `backend/data/arborlearn.sqlite3` |
| `ENABLE_RAG` | 否 | 是否启用 RAG |
| `VECTOR_DB_PATH` | 否 | LanceDB / vector store 路径 |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SEARXNG_BASE_URL` | 否 | Web search provider 配置 |

前端配置：

| 变量 | 说明 |
| --- | --- |
| `VITE_API_BASE_URL` | 后端地址，本地默认 `http://127.0.0.1:8000`，生产环境通常使用同源 `/api` |

邮箱验证码配置：

- 注册前调用 `POST /api/auth/send-email-code` 发送 6 位验证码，`POST /api/auth/register` 需要携带 `verificationCode`。
- 阿里云 ECS 部署使用 DirectMail SMTP SSL：`SMTP_HOST=smtpdm.aliyun.com`、`SMTP_PORT=465`，不要使用 25 端口。
- `SMTP_PASSWORD` 和 `EMAIL_CODE_SECRET` 只写入真实 `backend/.env`，不要提交到 Git。
- 验证码有效期 10 分钟，同一邮箱 60 秒内不能重复发送，24 小时最多发送 10 次，最多失败尝试 5 次。

## 核心 API

- `POST /api/auth/register`
- `POST /api/auth/send-email-code`
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

## 演示 Notebook

新注册账号会自动获得两个默认 notebook：

- `ArborLearn 入门笔记本`：说明基础操作和树形上下文。
- `Transformer 是如何工作的`：完整演示树，包含自注意力、Q/K/V、多头注意力、Encoder/Decoder 等分支。

前端的“体验示例”不会登录共享账号。每次点击都会创建独立的临时演示会话，默认包含 Transformer 示例树；不同访问者不会共享笔记本、节点或聊天记录，浏览器会话结束后也不会自动恢复该体验账号。

## 部署

项目已提供 Docker、Nginx 和 systemd 相关部署材料。ECS / Ubuntu 部署见：

```text
docs/DEPLOYMENT.md
```

生产环境不要直接暴露后端 `8000` 端口，应通过 Nginx 代理 `/api`。

---

## English

ArborLearn is an AI question-answering learning workspace built around a tree-shaped knowledge structure. It turns scattered chat-based learning into notebooks, structured nodes, and reusable learning records.

ArborLearn is the core learning interface: each notebook is a learning tree, each node is a focused conversation, and child nodes let learners branch from selected context without losing the main learning path.

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
├── frontend/             # React / Vite ArborLearn workspace
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
MODEL_NAME=deepseek-v4-pro
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
| `MODEL_NAME` | Yes | Default `deepseek-v4-pro` |
| `DEFAULT_WALLET_INITIAL_CENTS` | No | Initial RMB wallet grant for new users, in cents; free token grants are no longer configured |
| `ADMIN_WALLET_INITIAL_CENTS` | No | Initial RMB wallet grant for admins, in cents; free token grants are no longer configured |
| `AUTH_SECRET` | Production | Signing secret for login tokens |
| `EMAIL_CODE_SECRET` | Production | Secret for hashing email verification codes |
| `SMTP_HOST` / `SMTP_PORT` | Required for email codes | Aliyun DirectMail uses `smtpdm.aliyun.com` + `465` |
| `SMTP_USER` / `SMTP_PASSWORD` | Required for email codes | Sender address and SMTP password; never commit the password |
| `SMTP_FROM` / `SMTP_FROM_NAME` | Required for email codes | Sender address and display name |
| `CORS_ORIGINS` | Yes | Allowed frontend origins |
| `DATABASE_PATH` | No | SQLite path |
| `ENABLE_RAG` | No | Enables retrieval-augmented context |
| `VECTOR_DB_PATH` | No | Vector database path |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `SEARXNG_BASE_URL` | No | Web search provider configuration |

Frontend:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Backend URL. Local default is `http://127.0.0.1:8000`; production usually uses same-origin `/api`. |

Email verification:

- `POST /api/auth/send-email-code` sends a 6-digit registration code; `POST /api/auth/register` must include `verificationCode`.
- On Aliyun ECS, use DirectMail SMTP SSL with `SMTP_HOST=smtpdm.aliyun.com` and `SMTP_PORT=465`; do not use port 25.
- Keep `SMTP_PASSWORD` and `EMAIL_CODE_SECRET` only in the real `backend/.env`, never in Git.

## Core API

- `POST /api/auth/register`
- `POST /api/auth/send-email-code`
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

## Demo Notebook

New registered accounts automatically receive two default notebooks:

- `ArborLearn 入门笔记本`: a lightweight guide to the core workflow and tree context.
- `Transformer 是如何工作的`: a complete demo tree covering self-attention, Q/K/V, multi-head attention, Encoder/Decoder, and examples.

The frontend demo entry does not log into a shared account. Each click creates an isolated temporary demo session with the Transformer notebook, so visitors do not share notebooks, nodes, or chat history. The temporary demo token is stored only for the browser session.

## Deployment

Docker, Nginx, and systemd deployment materials are included. See:

```text
docs/DEPLOYMENT.md
```

In production, do not expose backend port `8000` directly. Proxy `/api` through Nginx instead.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

Unless otherwise noted, ArborLearn source code and project documentation are licensed under the MIT License.

## Attribution and Project Name

The source code of ArborLearn is licensed under the MIT License. You may use, modify, and distribute the source code under the terms of the MIT License.

The ArborLearn project name, logo, official domain, and other brand assets are reserved for the original project. You may refer to ArborLearn to describe the origin of your work, but you may not use the ArborLearn brand to imply official endorsement, official affiliation, or an official distribution without permission.

## Credits

ArborLearn was initiated by [@ipsc-gummy](https://github.com/ipsc-gummy) and is maintained by the ArborLearn team.

Project direction, product concept, tree-structured learning workflow, repository coordination, deployment readiness, and open-source governance were led by [@ipsc-gummy](https://github.com/ipsc-gummy).

The ArborLearn team has contributed across frontend implementation, backend services, model integration, upload and parsing workflows, UI interaction, testing, documentation, deployment, and operations.

For the latest contribution history, see the [GitHub contributors graph](https://github.com/ipsc-gummy/ArborLearn/graphs/contributors).
