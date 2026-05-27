# ArborLearn Technical Report Outline

> 本文档用于组织课程报告和答辩材料。写作重点是解释 ArborLearn 为什么这样设计、如何保证核心链路可运行、以及后续如何演进，而不是简单罗列功能。

## 1. 项目背景

建议回答三个问题：

- 学习者在使用通用 AI 聊天工具学习时遇到什么问题？
- 为什么一次性线性对话不适合长期学习？
- ArborLearn 为什么选择“树状学习空间 + AI 问答”的形态？

可表达的核心观点：

```text
普通聊天适合即时问答，但不擅长维护学习主题的结构、分支和复习路径。
ArborLearn 把学习过程组织成树状 notebook，让主线学习和局部追问同时存在。
```

## 2. 需求分析

### 2.1 目标用户

- 需要系统学习课程、论文、技术文档的学生。
- 希望把 AI 问答结果沉淀为结构化学习路径的用户。
- 需要围绕复杂问题进行多步骤分析的学习者。

### 2.2 核心需求

- 创建多个学习 notebook。
- 在一个主题下维护树状学习节点。
- 针对当前节点与 AI 对话。
- 从父节点选中文本创建子对话。
- 保持主线与支线的上下文边界。
- 对复杂问题进行分步长任务分析。
- 将子对话结论安全回填到父对话。
- 支持搜索、RAG 和历史记录辅助复习。

### 2.3 非功能需求

- 用户数据隔离。
- 核心 API 可回归验证。
- 模型调用失败可解释。
- 部署流程可复现。
- 文档能支持后续维护。

## 3. 总体设计

建议配一张总体架构图，说明：

- 前端：React / Vite。
- 状态管理：Zustand。
- 后端：FastAPI。
- 数据库：SQLite。
- AI 接入：OpenAI-compatible chat completions。
- 辅助模块：context builder、long task runner、backfill、web search、vector store。

可引用 `docs/ARCHITECTURE.md` 中的架构图。

## 4. 核心用户流程

用一条完整路径讲清产品闭环：

```text
注册/登录
-> 创建 notebook
-> 创建根节点
-> 在节点中提问
-> AI 基于树状上下文回答
-> 选中文本创建子节点
-> 子节点中继续追问
-> 将子节点结论回填父对话
-> 对复杂问题启动长任务
-> 查看步骤、证据、阶段输出和最终答案
```

写作时要强调：这些不是孤立功能，而是围绕“学习过程可沉淀”组织的闭环。

## 5. 数据库设计

建议按业务对象解释，而不是直接贴 SQL。

### 5.1 用户与学习空间

- `users`
- `notebooks`
- `nodes`
- `messages`

说明：

- notebook 是用户的学习空间。
- node 是树状结构的基本单位。
- message 是节点内 AI 问答记录。
- `owner_user_id` 保证用户数据隔离。

### 5.2 回填机制

- `conversation_patches`

说明：

- 保存回填来源、目标消息、原文范围、替换文本和状态。
- 通过内容 hash、anchor text、prefix、suffix 防止错位写回。
- 通过 overlap 检测避免多个子对话覆盖同一段父消息。

### 5.3 长任务机制

- `long_tasks`
- `long_task_steps`
- `task_evidence`
- `step_outputs`

说明：

- long task 记录复杂问题的整体状态。
- step 记录任务拆解和每一步状态。
- evidence 记录检索证据。
- output 记录阶段性模型输出。

### 5.4 可观测性

- `model_call_logs`

说明：

- 记录模型调用类型、模型、thinking mode、输入输出规模、耗时、成功状态和错误信息。
- 为调试 long task、chat 和 context debug 提供基础。

## 6. 树状上下文设计

建议重点讲“为什么树结构能改善 AI 学习体验”。

核心逻辑：

- 根节点提供主题级背景。
- 祖先节点提供当前学习路径。
- 父节点提供直接问题来源。
- 当前节点提供局部对话历史。
- 子节点默认隔离，避免局部追问污染主线。

可以配流程：

```text
node_id
-> 查询父链
-> 读取 root / ancestors / parent / current
-> 读取最近对话
-> 合并 web evidence / RAG
-> 生成 model messages
-> 调用模型
```

## 7. AI 问答模块

建议说明：

- 模型通过 OpenAI-compatible API 接入。
- 支持非流式和流式回答。
- 支持 retry 和 stop。
- 支持模型选择和 thinking mode。
- 模型配置来自环境变量和前端请求。

错误处理可说明：

- 配置错误返回 `503`。
- provider 错误返回 `502`。
- 未登录或资源不属于当前用户时拒绝访问。

## 8. 长任务执行链

建议把长任务作为项目成熟度亮点之一。

状态机：

```text
CREATED -> PLANNING -> RUNNING -> SUMMARIZING -> DONE
                         |             |
                         v             v
                      FAILED       CANCELLED
```

关键设计：

- 先由模型规划 3-6 个步骤。
- 每个步骤单独保存状态和输出。
- 检索步骤可保存 evidence。
- 最终答案基于步骤输出和证据汇总。
- 失败时保存错误信息。
- 用户可以取消任务。

## 9. 回填机制

建议强调“安全写回”。

问题：

```text
用户在子对话里得到更好的解释后，如何把它合并回父对话，同时避免覆盖错误位置？
```

解决方式：

- 创建子节点时保存 source metadata。
- 回填时校验目标消息 hash。
- 用 anchor text + prefix + suffix 重新定位。
- 检查 patch overlap。
- AI 只生成草稿，最终由用户确认应用。

## 10. 搜索与 RAG

建议写成“证据补充层”，不要写成核心问答的替代品。

说明：

- web search 用于补充外部信息。
- RAG 用于从已沉淀内容中检索。
- context builder 会把证据加入 prompt。
- 回答中应保留来源或说明证据不足。

## 11. 认证与安全

建议说明当前实现边界：

- email/password 登录。
- 密码 PBKDF2 hash。
- HMAC bearer token。
- token 默认 14 天。
- 用户数据通过 owner 查询隔离。
- 生产环境必须设置 `AUTH_SECRET`。

可以补充限制：

- 当前不是完整 OAuth 用户系统。
- token 存在 localStorage，需要在生产环境评估 XSS 风险。
- SQLite 适合课程项目和轻量部署，大规模多用户需要迁移数据库。

## 12. 部署方案

建议按部署链路说明：

```text
frontend build
-> Nginx static files
-> /api reverse proxy
-> FastAPI backend under systemd
-> SQLite data directory
-> environment variables
```

重点说明：

- Docker 部署。
- 手动部署。
- nginx 代理。
- systemd 服务。
- 数据目录。
- 日志查看。
- 常见错误。

## 13. 测试与回归

建议把新增 smoke check 作为交付成熟度体现。

说明：

- `npm run build` 验证前端构建。
- `python3 -m py_compile` 验证 Python 文件语法。
- `scripts/smoke_check.py` 验证不依赖模型的核心 API。
- live check 验证 chat、web search、RAG、backfill draft 和完整 long task。

可以写入一次实际验证结果：

```text
smoke check 覆盖 health、auth、tree、node、long task metadata APIs，已在临时 SQLite 数据库上通过。
```

## 14. 当前不足

建议诚实但不要削弱项目：

- API contract 和测试体系刚建立，后续还需要扩展到 pytest。
- chat、backfill draft、RAG 仍依赖真实外部服务，需要 live check。
- 部署文档还可以继续整合。
- long task schema 存在非阻断的 Pydantic alias warning，后续可清理。
- 前端 long task/backfill 的错误恢复入口还可以更明确。

## 15. 后续改进

按优先级写：

### P0

- 保持 smoke check 稳定。
- 补充核心 API 的 pytest。
- 整合部署文档。

### P1

- 增强 long task 和 backfill 的前端状态反馈。
- 增加 chat stream 和 retry 的回归检查。
- 优化模型调用日志查询方式。

### P2

- 引入更完整的 CI。
- 数据库迁移脚本化。
- 多用户生产部署时迁移到 PostgreSQL。
- 更严格的权限和安全审计。
