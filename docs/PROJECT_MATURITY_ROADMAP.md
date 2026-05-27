# ArborLearn Project Maturity Roadmap

> 本文档用于规划 ArborLearn 从可运行原型走向成熟工程交付的补强路径。重点不是改变产品定位，而是把现有 AI 问答学习平台的能力讲清楚、验清楚、维护清楚。

## 1. 产品定位

ArborLearn 是一个 AI 问答驱动的树状学习平台。系统把用户的学习过程组织为 notebook、tree node 和 conversation message，让用户可以围绕一个主题建立主线学习路径，并在局部问题上创建子对话分支。

当前核心体验可以概括为：

```text
注册/登录
-> 创建或进入 notebook
-> 构建树状学习节点
-> 在节点内进行 AI 问答
-> 基于父子路径构建上下文
-> 对复杂问题启动长任务
-> 将子对话结论回填到父对话
-> 通过搜索、RAG 和历史记录继续复习
```

成熟度建设应围绕这条路径展开，而不是把项目改造成其他类型的平台。

## 2. 现有能力盘点

### 2.1 前端

- React + Vite 应用。
- TreeLearn 树状学习空间。
- notebook dashboard、knowledge tree、node panel、chat composer。
- 长任务面板，支持创建任务、轮询状态、查看步骤、证据和最终答案。
- 回填面板，支持从子对话生成草稿并确认写回父对话。
- 模型和 thinking mode 选择。
- 节点级 web search 开关。

### 2.2 后端

- FastAPI 后端。
- email/password 注册登录。
- HMAC bearer token 认证。
- notebook、node、message 数据持久化。
- 用户 owner 隔离：节点、消息、任务等 API 都按 user 约束读取。
- chat / chat stream / retry / stop 接口。
- context builder：根据根节点、父节点、当前节点、最近对话、web evidence 和 RAG 构造模型上下文。
- long task runner：规划任务、执行步骤、保存 evidence、保存阶段输出、生成最终答案。
- backfill：基于 raw markdown 坐标、内容 hash 和 anchor 上下文做安全回填。
- web search：检索、抓取、证据筛选。
- vector store / RAG：为知识库检索提供基础。
- model_call_logs：记录模型调用输入输出长度、耗时、成功状态、证据数量等。

### 2.3 数据模型

已有核心表：

- `users`
- `notebooks`
- `nodes`
- `messages`
- `conversation_patches`
- `web_sources`
- `long_tasks`
- `long_task_steps`
- `task_evidence`
- `step_outputs`
- `model_call_logs`

这些表已经具备较好的工程化基础，后续文档应重点解释它们在学习闭环中的职责。

### 2.4 部署

已有部署材料：

- `Dockerfile`
- `docker-compose.yml`
- `docker-compose.prod.yml`
- `deploy.sh`
- `DEPLOYMENT.md`
- `deploy/README.md`
- `deploy/nginx.conf`
- `deploy/arborlearn-backend.service`

后续需要把部署文档从“能启动”升级为“能排障、能维护、能解释依赖”。

## 3. 成熟度补强维度

### 3.1 模块边界

需要在文档中明确以下边界：

- 前端只负责学习空间交互、局部状态、流式展示和用户操作入口。
- 后端负责认证、权限校验、数据持久化、AI 调用编排和任务状态。
- 数据库负责保存用户学习空间、对话历史、回填记录、任务过程和模型调用日志。
- context builder 负责把树结构转换成模型可消费的 prompt。
- long task runner 负责复杂问题的可恢复分步执行。
- backfill 负责把局部子对话结论安全映射回父对话。
- web search / RAG 负责补充外部证据，但不能替代树状上下文主线。

### 3.2 状态生命周期

需要把核心对象的状态生命周期写清楚。

`notebook`：

- 创建
- 更新标题或内容
- 置顶
- 作为树状学习空间的根级容器

`node`：

- 创建根节点或子节点
- 修改标题、摘要、上下文模式
- 移动父节点
- 删除节点及子树
- 通过 `source_metadata_json` 关联回填锚点

`message`：

- 用户消息写入
- assistant 消息流式生成
- stop 后保存部分回答
- retry 时基于旧 assistant message 重新生成
- 被 backfill patch 影响后生成 effective content

`long_task`：

- `CREATED`
- `PLANNING`
- `RUNNING`
- `SUMMARIZING`
- `DONE`
- `FAILED`
- `CANCELLED`

`long_task_step`：

- `PENDING`
- `RUNNING`
- `DONE`
- `FAILED`
- `SKIPPED`

`conversation_patch`：

- `draft`
- `applied`
- `rejected`
- `archived`

### 3.3 验证闭环

需要增加轻量 regression / smoke 检查，证明核心链路仍然可用。

建议第一版覆盖：

```text
GET  /api/health
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
GET  /api/tree
POST /api/nodes
PATCH /api/nodes/{id}
GET  /api/nodes/{id}/messages
POST /api/long-tasks
GET  /api/nodes/{id}/long-tasks
GET  /api/long-tasks/{task_id}
```

AI 模型调用、web search、RAG 可以先作为可选检查，避免 smoke 脚本强依赖外部 API key。

### 3.4 可观测性

当前已有 `model_call_logs`，后续应在文档中说明：

- 哪些模型调用会被记录。
- 记录哪些字段。
- 如何通过日志判断失败来源。
- long task 的步骤输出、evidence 和最终答案如何排查。
- web search 降级时如何反馈。

第一阶段不一定要做完整监控系统，但要让项目报告能说明“出了问题怎么定位”。

### 3.5 部署维护

部署文档需要补充：

- 必需环境变量和可选环境变量。
- 本地开发启动顺序。
- Docker 部署启动顺序。
- 数据目录和 SQLite 路径。
- RAG 启用时的模型下载与缓存说明。
- 常见错误：认证失败、CORS、模型 API key、数据库路径、向量库路径、web search provider。
- 日志查看方式。
- 数据备份建议。

## 4. 文档体系规划

建议最终形成以下文档层次。

### 4.1 `README.md`

面向第一次打开项目的人，说明：

- ArborLearn 是什么。
- 解决什么学习问题。
- 核心功能。
- 快速启动。
- 目录结构。
- 主要 API。
- 部署文档入口。
- 测试/检查入口。

README 应保持短而清楚，不承载全部细节。

### 4.2 `docs/ARCHITECTURE.md`

面向技术评审和后续开发者，说明：

- 设计目标。
- 总体架构。
- 前后端分层。
- 数据模型。
- 树状上下文构建流程。
- AI chat 流程。
- long task 流程。
- backfill 流程。
- web search / RAG 作为证据补充的边界。

### 4.3 `docs/API.md`

面向前后端协作，说明：

- 认证接口。
- tree / notebook / node / message 接口。
- chat 接口。
- long task 接口。
- backfill 接口。
- web search / context debug 接口。
- 认证要求。
- 常见错误码和错误语义。

### 4.4 `docs/TESTING.md`

面向交付和回归，说明：

- 本地手动检查。
- smoke 脚本使用方式。
- 哪些改动后必须跑哪些检查。
- 哪些检查依赖真实模型 API。
- 哪些检查可以离线完成。

### 4.5 `docs/DEPLOYMENT.md`

可以由现有 `DEPLOYMENT.md` 和 `deploy/README.md` 整理而来，说明：

- Docker 部署。
- 手动部署。
- nginx 反向代理。
- systemd 后端服务。
- 环境变量。
- 数据目录。
- 日志。
- 故障排查。

### 4.6 `docs/REPORT_OUTLINE.md`

面向课程报告，建议按以下顺序：

1. 项目背景与问题定义。
2. 设计目标。
3. 总体架构。
4. 核心用户流程。
5. 数据模型。
6. AI 问答与树状上下文。
7. 长任务执行链。
8. 回填机制。
9. 搜索与 RAG。
10. 认证、权限与数据隔离。
11. 部署方案。
12. 测试与稳定性保障。
13. 当前不足与后续改进。

## 5. 第一阶段落地清单

第一阶段只做低风险增强。

### P0

- 新增 `docs/ARCHITECTURE.md`，把现有模块边界讲清楚。
- 新增 `docs/API.md`，整理已有 API contract。
- 新增 `docs/TESTING.md`，定义 smoke/regression 范围。
- 新增一个不依赖真实模型的 smoke 脚本，验证 auth、tree、node、long task 基础链路。

### P1

- 更新 `README.md`，把项目定位、启动方式和文档入口写清楚。
- 整合 `DEPLOYMENT.md` 与 `deploy/README.md`，减少重复和断裂。
- 为 long task / backfill 增加更明确的前端错误说明和重试入口。
- 为 `model_call_logs` 增加排查说明。

### P2

- 增加后端最小 pytest。
- 增加前端关键交互测试或人工验收 checklist。
- 对 chat stream、retry、stop、backfill conflict 做更细回归。
- 逐步引入 CI 或本地统一检查命令。

## 6. 质量约束

后续迭代需要遵守：

- 不改变 ArborLearn 的 AI 问答学习平台定位。
- 不在正式文档中描述外部参照来源。
- 不覆盖未提交改动。
- 文档必须以当前代码真实实现为依据。
- 脚本第一版尽量不依赖外部模型、搜索或 RAG 服务。
- 对需要 API key 的能力，单独标记为 optional / live check。

## 7. 当前文档落地状态

第一轮已拆出以下详细文档：

1. `docs/ARCHITECTURE.md`
2. `docs/API.md`
3. `docs/TESTING.md`
4. `docs/REPORT_OUTLINE.md`

同时已新增 `scripts/smoke_check.py`，把文档里的核心链路变成可重复验证入口。

后续建议继续补：

- 部署文档整合。
- 后端 pytest。
- chat / backfill / RAG live check。
