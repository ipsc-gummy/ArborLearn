# ArborLearn User Flow

> 本文档描述 ArborLearn 的核心用户路径。它用于产品说明、答辩讲解和回归检查，不改变项目的 AI 问答学习平台定位。

## 1. 总览

ArborLearn 的用户体验不是“一次提问一次回答”，而是把学习过程沉淀为可追踪的树状知识空间。

```text
注册或登录
-> 进入 notebook
-> 创建学习主题
-> 在节点内提问
-> 从关键片段展开子节点
-> 基于树路径继续追问
-> 对复杂问题启动长任务
-> 将子对话结论回填到父对话
-> 通过历史、搜索和 RAG 复习与扩展
```

## 2. 注册与工作区初始化

用户通过 email/password 注册或登录。后端创建用户后会初始化入门 notebook，前端保存 bearer token，并在后续 API 请求中附带 `Authorization` header。

关键 API：

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/tree`

验证重点：

- 未登录用户不能读取树状学习数据。
- 新用户能拿到初始 notebook。
- 同一用户刷新页面后仍能恢复自己的 tree state。

## 3. Notebook 与节点树

每个 notebook 是一个学习主题容器，每个节点是一段聚焦对话。根节点代表主题入口，子节点代表从某个概念、选中文本或延伸问题分出的局部追问。

节点包含：

- `title`：节点标题。
- `summary`：节点摘要。
- `selected_text`：创建子节点时的触发文本。
- `context_mode`：`mainline` 或 `isolated`，用于影响上下文继承方式。
- `source_metadata_json`：回填锚点和来源信息。

关键 API：

- `POST /api/nodes`
- `PATCH /api/nodes/{id}`
- `DELETE /api/nodes/{id}`
- `GET /api/nodes/{id}/messages`

验证重点：

- 子节点继承父节点 notebook。
- 用户不能访问其他用户的节点。
- 移动节点时不能移动到自身或子孙节点下。

## 4. 节点内 AI 问答

用户在当前节点内提问后，后端会先保存 user message，再调用 context builder 生成模型上下文。上下文来自 root、父链、当前节点摘要、近期消息、可选 web evidence 和 RAG。

关键 API：

- `POST /api/chat`
- `POST /api/chat/stream`
- `POST /api/chat/retry`
- `POST /api/chat/stop`

上下文规则：

- root 节点提供主题级方向。
- ancestor 节点提供学习路径语义。
- parent 节点提供局部触发背景。
- current node 提供当前问题和近期对话。
- web search / RAG 只作为证据补充，不替代树状上下文主线。

验证重点：

- assistant message 能保存到当前节点。
- stream 中断后仍能保存部分回答。
- retry 不破坏用户消息和节点归属。

## 5. 从片段展开子对话

用户可以在父对话中选中一段内容并创建子节点。子节点会保存与父消息相关的 source metadata，用于后续把子对话结论安全回填。

典型场景：

- 对一个术语继续追问。
- 对一个步骤展开推导。
- 对一个不确定结论做局部纠错。
- 保持主线不被局部问题打断。

验证重点：

- 子节点创建时保存 parent / notebook 关系。
- source metadata 能定位父消息、选区、hash 和锚点上下文。
- 子节点的局部追问不会污染父节点原始消息。

## 6. 长任务

复杂问题可以进入 long task 流程。任务先被创建为 `CREATED`，运行后经历规划、步骤执行、证据收集、汇总和完成状态。

状态：

```text
CREATED -> PLANNING -> RUNNING -> SUMMARIZING -> DONE
                    -> FAILED
                    -> CANCELLED
```

关键 API：

- `POST /api/long-tasks`
- `POST /api/long-tasks/{task_id}/run`
- `GET /api/nodes/{node_id}/long-tasks`
- `GET /api/long-tasks/{task_id}`
- `POST /api/long-tasks/{task_id}/cancel`
- `POST /api/long-tasks/{task_id}/steps/{step_id}/retry`

验证重点：

- `auto_run=false` 时不调用真实模型，只创建任务元数据。
- 任务只能被 owner 读取、运行、取消。
- 取消后任务状态为 `CANCELLED`。
- 失败信息能落到任务或步骤记录中。

## 7. 回填

回填把子对话中形成的局部结论写回父对话。它不是直接覆盖原文，而是通过 hash、anchor、range 和 conflict check 保护父消息。

流程：

```text
父消息选区
-> 创建带 source metadata 的子节点
-> 子节点中追问并形成结论
-> 生成或手写 replacement text
-> 校验父消息 hash 与选区 anchor
-> 检查重叠 patch
-> 应用 patch
-> 父消息展示 effective content
```

关键 API：

- `POST /api/backfill/draft`
- `POST /api/backfill/patches`
- `POST /api/backfill/patches/{patch_id}/archive`
- `GET /api/messages/{message_id}/patches`

验证重点：

- 父消息变化后旧回填不能静默应用。
- 重叠 range 要返回冲突。
- 用户确认后才写入 applied patch。

## 8. 搜索与 RAG

搜索和 RAG 用于补充证据。它们可以增强回答，但不应该取代用户自己构建的学习树。

关键 API：

- `POST /api/web/search`
- `POST /api/web/fetch`
- `POST /api/nodes/{node_id}/web-search`
- `GET /api/context/debug`

验证重点：

- 没有 provider key 时应给出配置错误，而不是破坏基础问答。
- 搜索来源应保留 URL、标题、摘要和 provider。
- RAG 关闭时基础 chat 和 smoke check 仍应可用。

## 9. 回归检查映射

| 用户路径 | 最小检查 | 可选 live 检查 |
| --- | --- | --- |
| 注册与认证 | smoke check auth | 浏览器注册登录 |
| Notebook / node | smoke check tree + node CRUD | 前端创建、移动、删除节点 |
| 节点问答 | owner isolation pytest | `--include-chat-live` |
| 长任务 | smoke check create/list/detail/cancel | long task full run |
| 回填 | backfill pytest / manual | backfill draft live model |
| 搜索与 RAG | health config | `--include-web-search` / RAG live |
