# ArborLearn Testing And Regression

> 本文档定义 ArborLearn 的本地检查、回归范围和后续 smoke 脚本目标。当前项目还没有完整自动化测试体系，因此第一阶段重点是建立稳定、可重复的核心链路检查。

## 1. 测试分层

建议把检查分成三层。

### 1.1 Static Checks

不启动服务，检查代码是否能构建。

Frontend:

```bash
cd frontend
npm run build
```

Backend:

```bash
cd backend
python -m py_compile app/*.py
```

### 1.2 Smoke Checks

启动后端后，用脚本验证核心 API 是否仍然可用。

第一版 smoke check 不依赖真实模型 API、web search 或 RAG，重点验证：

- 后端健康检查。
- 注册 / 登录 / 当前用户。
- 读取初始树。
- 创建根节点。
- 创建子节点。
- 更新节点。
- 读取节点消息。
- 创建长任务。
- 查询节点长任务列表。
- 查询长任务详情。

运行方式：

```bash
python3 scripts/smoke_check.py --base-url http://127.0.0.1:8000
```

也可以指定固定测试账号：

```bash
python3 scripts/smoke_check.py \
  --base-url http://127.0.0.1:8000 \
  --email arborlearn-smoke@example.com \
  --password ArborLearnSmoke2026!
```

可选 live checks 会调用外部服务，默认不启用：

```bash
python3 scripts/smoke_check.py \
  --base-url http://127.0.0.1:8000 \
  --include-chat-live \
  --include-web-search
```

`--include-chat-live` 需要 `MODEL_API_KEY` 可用。`--include-web-search` 需要配置 web search provider。

### 1.3 Backend Unit / Contract Tests

后端最小 pytest 用于固化不依赖真实模型的 API 边界：

```bash
cd backend
.venv/bin/python -m pip install -r requirements-dev.txt
DATABASE_PATH=/private/tmp/arborlearn-pytest.sqlite3 \
AUTH_SECRET=test-secret \
MODEL_API_KEY=test-key \
.venv/bin/python -m pytest
```

当前重点：

- auth owner isolation。
- node CRUD。
- long task create / list / detail / cancel 状态链。
- 默认 Transformer 演示树。
- 独立临时演示会话。

### 1.4 Live Checks

需要真实模型 API key 或外部服务，适合发布前人工验证。

- chat stream。
- retry / stop。
- web search。
- RAG。
- long task 完整执行。
- backfill draft 生成。

## 2. 什么时候跑

| 修改范围 | 建议检查 |
| --- | --- |
| README / docs | 人工阅读即可，必要时跑 frontend build |
| frontend component | `npm run build` + 浏览器人工检查 |
| `frontend/src/lib/api.ts` | frontend build + smoke check |
| `backend/app/auth.py` | smoke check |
| `backend/app/db.py` | pytest + smoke check + 手动确认迁移兼容 |
| `backend/app/main.py` | pytest + smoke check |
| `context_builder.py` | smoke check + live chat check |
| `long_task_runner.py` | pytest + smoke check + live long task check |
| `backfill.py` | pytest + smoke check + live backfill check |
| deployment files | local health check + deployment checklist |

## 3. 本地启动

Backend:

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
.venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

如果前端不使用默认后端地址：

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000 npm run dev
```

## 4. API Smoke Check 范围

脚本位置：

```text
scripts/smoke_check.py
```

脚本默认使用独立测试邮箱，避免污染真实账号。

```text
arborlearn-smoke-<timestamp>@example.com
```

检查流程：

```text
GET  /api/health
POST /api/auth/register
GET  /api/auth/me
GET  /api/tree
POST /api/nodes
POST /api/nodes
PATCH /api/nodes/{id}
GET  /api/nodes/{id}/messages
POST /api/long-tasks
GET  /api/nodes/{id}/long-tasks
GET  /api/long-tasks/{task_id}
POST /api/long-tasks/{task_id}/cancel
```

可选 live check 流程：

```text
POST /api/chat
POST /api/nodes/{node_id}/web-search
```

成功输出应清楚标记每一步：

```text
PASS health
PASS register
PASS auth me
PASS fetch tree
PASS create root node
PASS create child node
PASS patch child node
PASS fetch messages
PASS create long task
PASS list node long tasks
PASS fetch long task
PASS cancel long task
```

如果启用 live flags，还应看到：

```text
PASS live chat
PASS live web search
```

失败时脚本应输出：

- 请求方法和 URL。
- HTTP 状态码。
- response body。
- 当前步骤名。

## 5. Live Manual Checklist

发布前建议人工检查以下路径。

### 5.1 认证与树

1. 注册新账号。
2. 看到入门 notebook。
3. 创建新的学习主题。
4. 创建子节点。
5. 刷新页面后节点仍存在。

### 5.2 Chat

1. 在节点输入问题。
2. 流式输出正常。
3. assistant message 保存成功。
4. retry 能替换旧回答。
5. stop 能保存部分回答。

### 5.3 Long Task

1. 在节点打开长任务面板。
2. 输入复杂问题。
3. 任务进入规划或执行状态。
4. 能看到步骤列表。
5. 步骤详情能展示输出或错误。
6. cancel 能把任务置为 `CANCELLED`。

### 5.4 Backfill

1. 在父对话选择文本创建子对话。
2. 子对话中形成明确结论。
3. 打开回填面板。
4. 生成草稿。
5. 应用回填。
6. 父消息展示 effective content。
7. 对重叠回填有冲突提示。

### 5.5 Web Search / RAG

1. 开启 web search 后提问。
2. 回答中出现来源。
3. 搜索失败时能降级并显示 warning。
4. 开启 RAG 时上下文构建不报错。

### 5.6 Demo Notebook

注册账号和“体验示例”临时会话都应默认包含完整 Transformer 演示树，不需要额外脚本。

检查点：

1. `POST /api/auth/register` 后，`GET /api/tree` 同时包含 `ArborLearn 入门笔记本` 和 `Transformer 是如何工作的`。
2. `POST /api/auth/demo` 返回 `isTemporary: true` 的用户。
3. 两次 `POST /api/auth/demo` 得到不同用户 id。
4. 一个演示会话中新建的 notebook，另一个演示会话不可见。
5. Transformer 根节点包含自注意力、Q/K/V、多头注意力、Encoder/Decoder 等分支。

## 6. 回归边界

### 6.1 不依赖外部服务的检查

- health。
- auth。
- tree。
- node CRUD。
- long task 创建、查询、取消。

这些检查应该作为每次后端改动后的最小门槛。

### 6.2 依赖模型 API 的检查

- chat。
- chat stream。
- retry。
- long task 完整执行。
- backfill draft。

这些检查需要 `MODEL_API_KEY`，应标记为 live checks，避免本地无 key 时阻塞基础回归。

### 6.3 依赖搜索或向量库的检查

- web search。
- web fetch。
- node web search。
- RAG context。

这些检查依赖 provider key、网络和模型缓存，适合发布前或部署环境验证。

## 7. 后续自动化方向

第一阶段：

- 新增 `scripts/smoke_check.py`。
- 默认只跑不依赖外部服务的 API。
- 输出清晰 pass/fail。

第二阶段：

- 增加 `--include-chat-live`。
- 增加 `--include-web-search`。
- 增加最小 pytest。

第三阶段：

- 针对 backfill anchor / hash / conflict 补测试。
- 针对 chat stream / retry / stop 补 live checks。
- 针对 backfill anchor/hash/conflict 补测试。
- 针对 long task 状态机补测试。

## 8. 注意事项

- 当前仓库已有未提交的 `backend/app/db.py` 改动，涉及数据库层修改前要先确认差异。
- `scripts/` 目录当前是未跟踪目录，新增脚本时要避免覆盖已有文件。
- smoke 脚本不应该删除真实用户数据。
- 需要模型 API 的检查必须显式开启，不能作为默认步骤。
