# ArborLearn API Contract

> 本文档描述当前 FastAPI 后端的主要接口契约。除 `/api/health` 外，业务接口默认需要 `Authorization: Bearer <token>`。

## 1. 通用约定

### Base URL

本地默认：

```text
http://127.0.0.1:8000
```

前端通过 `VITE_API_BASE_URL` 指定后端地址。

### Auth Header

```http
Authorization: Bearer <token>
```

token 由 `/api/auth/register` 或 `/api/auth/login` 返回。

### Error Shape

FastAPI 默认错误结构：

```json
{
  "detail": "error message"
}
```

部分业务错误会返回结构化 `detail`：

```json
{
  "detail": {
    "code": "BACKFILL_RANGE_OVERLAP",
    "message": "...",
    "conflictPatch": {}
  }
}
```

常见状态码：

| 状态码 | 含义 |
| --- | --- |
| `400` | 请求参数或业务状态不合法 |
| `401` | 未认证或 token 无效 |
| `404` | 当前用户下找不到资源 |
| `409` | 资源冲突，例如邮箱已注册、回填目标版本变化 |
| `502` | 上游模型或搜索 provider 错误 |
| `503` | 模型或搜索配置缺失 |

## 2. Health

### `GET /api/health`

用于检查后端服务、模型配置和 web search 配置状态。

Response:

```json
{
  "ok": true,
  "model": "deepseek-v4-flash",
  "modelBaseUrl": "https://api.deepseek.com",
  "availableModels": ["deepseek-v4-flash", "deepseek-v4-pro"],
  "webSearch": {}
}
```

## 3. Auth

### `POST /api/auth/register`

注册用户并创建入门 notebook。

Request:

```json
{
  "email": "user@example.com",
  "password": "password with at least 8 chars",
  "displayName": "Optional Name"
}
```

Response `201`:

```json
{
  "token": "base64urlPayload.signature",
  "user": {
    "id": "user-...",
    "email": "user@example.com",
    "displayName": "Optional Name"
  }
}
```

Errors:

- `400` invalid email
- `409` email already registered

### `POST /api/auth/login`

Request:

```json
{
  "email": "user@example.com",
  "password": "password with at least 8 chars"
}
```

Response:

```json
{
  "token": "base64urlPayload.signature",
  "user": {
    "id": "user-...",
    "email": "user@example.com",
    "displayName": "User"
  }
}
```

Errors:

- `401` invalid email or password

### `GET /api/auth/me`

Response:

```json
{
  "user": {
    "id": "user-...",
    "email": "user@example.com",
    "displayName": "User"
  }
}
```

## 4. Tree And Nodes

### `GET /api/tree`

返回当前用户全部 notebook 的树状态。

Response:

```json
{
  "nodes": {},
  "rootIds": ["nb-..."],
  "pinnedRootIds": []
}
```

### `GET /api/notebooks/{notebook_id}/tree`

返回指定 notebook 的树状态。

Errors:

- `404` notebook not found

### `POST /api/nodes`

创建根节点或子节点。

创建根节点时会创建或更新 notebook；创建子节点时 `parentId` 必须属于当前用户。

Request:

```json
{
  "id": "node-optional",
  "notebookId": "nb-optional",
  "parentId": null,
  "title": "新的学习主题",
  "summary": "",
  "selectedText": null,
  "contextWeight": "isolated",
  "sourceMetadata": null,
  "messages": []
}
```

Response `201`:

```json
{
  "id": "node-...",
  "notebookId": "nb-..."
}
```

Notes:

- 根节点的 `contextWeight` 会被后端设为 `mainline`。
- 子节点的 notebook 会继承 parent node 的 notebook。
- 带 `sourceMetadata` 的子节点会进入 backfill 校验流程。

### `PATCH /api/nodes/{node_id}`

更新节点标题、摘要、选中文本、上下文模式或父节点。

Request:

```json
{
  "title": "新标题",
  "summary": "摘要",
  "selectedText": "选中文本",
  "contextWeight": "mainline",
  "parentId": "node-..."
}
```

Response:

```json
{
  "ok": true
}
```

Errors:

- `400` move to self, move under descendant, or invalid root move
- `404` node or target parent not found

### `DELETE /api/nodes/{node_id}`

删除节点。

Notes:

- 删除根节点会删除整个 notebook。
- 删除非根节点会删除该节点及其子树。

Response:

```json
{
  "ok": true
}
```

### `GET /api/nodes/{node_id}/messages`

返回节点消息。消息内容会经过 effective context 处理，包含回填 patch 信息。

Response:

```json
{
  "messages": []
}
```

### `GET /api/messages/{message_id}/patches`

返回某条消息关联的回填 patch。

Response:

```json
{
  "patches": []
}
```

## 5. Chat

### `POST /api/chat`

非流式 AI 问答。

Request:

```json
{
  "notebookId": "nb-...",
  "nodeId": "node-...",
  "message": "解释这个概念",
  "userMessageId": "msg-optional",
  "assistantMessageId": "msg-optional",
  "modelName": "deepseek-v4-flash",
  "thinkingMode": "fast",
  "webSearch": false,
  "webQuery": null,
  "ragEnabled": false
}
```

Response:

```json
{
  "messageId": "msg-...",
  "role": "assistant",
  "content": "...",
  "createdAt": "2026-05-27T...",
  "userMessage": {},
  "message": {},
  "nodeId": "node-...",
  "nodeTitle": "generated title or null",
  "nodeSummary": "generated summary or null",
  "sources": [],
  "webSearchWarning": null
}
```

Errors:

- `404` node or notebook not found
- `502` model provider error
- `503` model configuration error

### `POST /api/chat/stream`

流式 AI 问答，返回 `text/event-stream`。

Request 与 `/api/chat` 相同。

SSE delta:

```text
data: {"content":"partial text"}
```

SSE done:

```text
event: done
data: {"messageId":"msg-...","role":"assistant","content":"..."}
```

SSE error:

```text
event: error
data: {"error":"..."}
```

### `POST /api/chat/stop`

保存用户中断时已经生成的 assistant 内容。

Request:

```json
{
  "nodeId": "node-...",
  "content": "partial assistant answer",
  "assistantMessageId": "msg-optional"
}
```

Response:

```json
{
  "message": {}
}
```

### `POST /api/chat/retry`

重新生成某条 assistant 消息。

Request:

```json
{
  "nodeId": "node-...",
  "assistantMessageId": "msg-...",
  "modelName": "deepseek-v4-flash",
  "thinkingMode": "fast"
}
```

Response:

```json
{
  "messageId": "msg-...",
  "role": "assistant",
  "content": "...",
  "createdAt": "...",
  "message": {},
  "nodeId": "node-...",
  "nodeTitle": null,
  "nodeSummary": null,
  "archivedPatchCount": 0
}
```

### `POST /api/chat/retry/stream`

流式 retry，SSE 格式与 `/api/chat/stream` 相同。

## 6. Long Tasks

### `POST /api/long-tasks`

创建长任务。

Request:

```json
{
  "node_id": "node-...",
  "notebook_id": "nb-...",
  "question": "复杂学习问题",
  "title": "可选标题",
  "auto_run": false,
  "model": "deepseek-v4-flash",
  "thinkingMode": "fast"
}
```

Response `201`:

```json
{
  "id": "task-...",
  "status": "CREATED",
  "title": "可选标题",
  "original_question": "复杂学习问题",
  "node_id": "node-...",
  "model_name": "deepseek-v4-flash",
  "thinking_mode": "fast"
}
```

Notes:

- 如果 `auto_run` 为 true，后端会直接加入后台执行。
- 如果提供 `node_id`，`notebook_id` 会以 node 所属 notebook 为准。

### `POST /api/long-tasks/{task_id}/run`

启动或继续执行长任务。

Response:

```json
{
  "task_id": "task-...",
  "status": "RUNNING",
  "message": "Long task started"
}
```

### `GET /api/nodes/{node_id}/long-tasks`

查询某节点最近长任务。

Query:

```text
limit=20
```

Response:

```json
{
  "tasks": []
}
```

### `GET /api/long-tasks/{task_id}`

查询长任务详情。

Response:

```json
{
  "id": "task-...",
  "title": "标题",
  "original_question": "...",
  "status": "RUNNING",
  "current_step_index": 0,
  "plan_summary": "...",
  "node_id": "node-...",
  "notebook_id": "nb-...",
  "model_name": "deepseek-v4-flash",
  "thinking_mode": "fast",
  "final_answer": null,
  "error_message": null,
  "created_at": "...",
  "updated_at": "...",
  "finished_at": null,
  "steps": []
}
```

### `GET /api/long-tasks/{task_id}/steps/{step_id}`

查询步骤详情、证据和输出。

Response:

```json
{
  "id": "step-...",
  "task_id": "task-...",
  "step_index": 0,
  "title": "明确问题边界",
  "goal": "...",
  "step_type": "analyze",
  "status": "DONE",
  "need_retrieval": false,
  "retrieval_mode": "none",
  "output_summary": "...",
  "error_message": null,
  "evidence": [],
  "outputs": []
}
```

### `POST /api/long-tasks/{task_id}/cancel`

取消长任务。

Response:

```json
{
  "task_id": "task-...",
  "status": "CANCELLED"
}
```

### `POST /api/long-tasks/{task_id}/steps/{step_id}/retry`

重试失败步骤。只有 `FAILED` 步骤可以 retry。

Response:

```json
{
  "task_id": "task-...",
  "step_id": "step-...",
  "status": "RUNNING",
  "message": "Long task step retry started"
}
```

### `GET /api/long-tasks/{task_id}/steps/{step_id}/context-debug`

查看某步骤构造出来的上下文概况，并写入一次 `context_debug` model call log。

Response:

```json
{
  "task_id": "task-...",
  "step_id": "step-...",
  "estimated_tokens": 1000,
  "context_chars": 4000,
  "truncated": false,
  "sections": [],
  "used_evidence": []
}
```

## 7. Backfill

### `POST /api/backfill/draft`

基于子对话生成回填草稿，不直接写回父消息。

Request:

```json
{
  "sourceChildNodeId": "node-...",
  "targetMessageId": "msg-...",
  "editType": "expand",
  "userInstruction": "更口语一点",
  "modelName": "deepseek-v4-flash",
  "thinkingMode": "fast"
}
```

Response `201`:

```json
{
  "draft": {
    "sourceChildNodeId": "node-...",
    "targetMessageId": "msg-...",
    "editType": "expand",
    "targetRangeStart": 0,
    "targetRangeEnd": 10,
    "originalText": "...",
    "replacementText": "...",
    "rangeSuggestion": null
  }
}
```

Errors:

- `400` insufficient child conversation context
- `404` source child node or target message not found
- `409` target message version changed or patch range overlap
- `502` model provider error
- `503` model configuration error

### `POST /api/backfill/patches`

应用回填 patch。

Request:

```json
{
  "sourceChildNodeId": "node-...",
  "targetMessageId": "msg-...",
  "editType": "expand",
  "targetRangeStart": 0,
  "targetRangeEnd": 10,
  "replacementText": "替换后的内容"
}
```

Response `201`:

```json
{
  "patch": {}
}
```

### `POST /api/backfill/patches/{patch_id}/archive`

归档回填 patch。

Response:

```json
{
  "patch": {}
}
```

## 8. Web Search And Context Debug

### `POST /api/web/search`

直接调用 web search provider。

Request:

```json
{
  "query": "search query",
  "maxResults": 5
}
```

Response:

```json
{
  "results": [],
  "provider": "auto"
}
```

### `POST /api/web/fetch`

抓取网页正文。

Request:

```json
{
  "url": "https://example.com"
}
```

Response:

```json
{
  "page": {}
}
```

### `POST /api/nodes/{node_id}/web-search`

在节点上下文中执行搜索并保存来源。

Request:

```json
{
  "query": "search query",
  "maxResults": 5,
  "fetchTopK": 3
}
```

Response:

```json
{
  "sources": []
}
```

### `GET /api/context/debug`

查看当前节点构造出的模型上下文概况。

Query:

```text
node_id=node-...
query=optional user query
webSearch=true
modelName=deepseek-v4-flash
thinkingMode=fast
```

Response:

```json
{
  "node_id": "node-...",
  "model_config": {
    "model": "deepseek-v4-flash",
    "thinkingMode": "fast"
  },
  "sections": [],
  "sources": [],
  "estimated_tokens": 1000,
  "truncated": false,
  "web_search_warning": null,
  "final_context_preview": "..."
}
```

## 9. API Groups And Ownership

所有用户数据接口都必须通过当前 token 约束 owner。

| API 组 | owner 校验依据 |
| --- | --- |
| tree / notebook | `notebooks.owner_user_id` |
| nodes | node 所属 notebook owner |
| messages | message -> node -> notebook owner |
| long tasks | `long_tasks.user_id` |
| long task steps | `long_task_steps.user_id` |
| backfill | source child node、target message 和 patch 的 owner |
| web sources | `web_sources.user_id` |

任何跨用户访问都应该表现为 `404`、`401` 或 `403`，避免泄漏资源存在性。
