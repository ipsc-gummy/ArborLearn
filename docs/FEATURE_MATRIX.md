# ArborLearn Feature Matrix

> 本矩阵用于说明 ArborLearn 当前能力、演示条件和后续补强方向。状态划分面向交付管理，不代表产品定位变化。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Done | 已有实现，可作为核心能力说明 |
| Demo Ready | 可演示，但依赖配置或人工流程 |
| Config Required | 代码路径存在，但需要外部 key、模型、搜索 provider 或部署环境 |
| Needs Hardening | 能力存在，但仍需要测试、体验或边界处理补强 |
| Planned | 合理后续方向，当前不作为 MVP 承诺 |

## 产品体验

| 能力 | 状态 | 当前说明 | 后续动作 |
| --- | --- | --- | --- |
| Email/password auth | Done | 注册、登录、`/api/auth/me` 已实现 | 增加 owner isolation pytest |
| Tree notebook | Done | `notebooks` + root node 管理学习主题 | README 与报告中突出“树状学习空间” |
| Node conversation | Done | 每个节点有独立消息列表 | 补充前端空状态与错误反馈 |
| Child branch | Done | 子节点继承 notebook，可从局部片段展开 | 强化 source metadata 的说明与测试 |
| Model selection | Done | 支持 DeepSeek-compatible 模型选择 | 环境变量文档保持同步 |
| Streaming chat | Demo Ready | 前端和后端均有 stream 入口 | 增加 live check |
| Retry / stop | Demo Ready | API 与前端入口存在 | 增加手动回归步骤 |
| Long task panel | Demo Ready | 可创建、轮询、取消并展示步骤 | 增加状态机 pytest |
| Backfill workflow | Demo Ready | 支持草稿、应用、归档和冲突检测 | 补 anchor/hash/conflict 测试 |
| Web search | Config Required | 支持 provider 配置与节点级搜索 | 加 `--include-web-search` live check |
| RAG / vector store | Config Required | 有 vector store 与 context builder 接入 | 标注模型下载、缓存和降级策略 |

## 后端工程

| 能力 | 状态 | 当前说明 | 后续动作 |
| --- | --- | --- | --- |
| FastAPI route contract | Done | auth/tree/node/chat/long-task/backfill/search 已形成 API | 保持 `docs/API.md` 与实现同步 |
| SQLite schema | Done | 核心表覆盖用户、树、消息、回填、任务、证据、模型日志 | 增加迁移兼容说明 |
| Auth token | Done | HMAC bearer token | 增加过期与错误场景测试 |
| Owner isolation | Demo Ready | 主要查询按 user 过滤 | pytest 覆盖跨用户读取/修改失败 |
| Context builder | Demo Ready | 树路径 + 近期对话 + evidence/RAG | 增加 context debug 检查 |
| Long task runner | Needs Hardening | 状态、步骤、evidence、outputs 已具备 | 增加状态机和失败路径测试 |
| Model call logs | Done | 记录模型调用规模、耗时和错误 | 文档补排障用法 |
| Smoke check | Done | 默认不依赖外部服务 | 增加 live flags |
| Pytest suite | Needs Hardening | 当前缺少正式测试目录 | 新增最小 API pytest |

## 前端工程

| 能力 | 状态 | 当前说明 | 后续动作 |
| --- | --- | --- | --- |
| React / Vite build | Done | `npm run build` 可作为静态检查 | 保持发布前必跑 |
| Zustand store | Done | 管理 tree、auth、chat、long-task 状态 | 继续收敛 API 错误处理 |
| Knowledge tree UI | Done | 展示学习树与 active node | 增加截图和报告说明 |
| LongTaskPanel | Demo Ready | 状态、步骤、证据、答案展示 | 强化失败/取消文案 |
| BackfillPanel | Demo Ready | 草稿生成、应用、冲突提示 | 增加可恢复状态说明 |
| Screenshots | Done | 已有 light/dark showcase 图片 | README 中展示 light 版本 |

## 部署与运维

| 能力 | 状态 | 当前说明 | 后续动作 |
| --- | --- | --- | --- |
| Local dev | Done | backend uvicorn + frontend Vite | README 保持最短路径 |
| Docker compose | Demo Ready | 已有 compose 文件 | 与 `docs/DEPLOYMENT.md` 对齐 |
| ECS manual deploy | Demo Ready | Nginx + systemd + SQLite | 统一部署入口 |
| GitHub Actions deploy | Needs Hardening | 部署材料存在 | 以 live server 状态验证 workflow |
| Environment variables | Done | `.env.example` 已列核心配置 | README 增加简表 |
| Log inspection | Needs Hardening | systemd/Nginx/Docker 可查 | 部署文档补命令 |
| Data backup | Planned | SQLite 文件可备份 | 增加备份脚本或说明 |

## 报告材料映射

| 报告章节 | 可引用能力 |
| --- | --- |
| 项目背景 | AI 问答学习从线性聊天升级为树状知识工作台 |
| 需求分析 | 主线学习、局部追问、上下文继承、复杂任务、可回填记录 |
| 总体设计 | React/Vite + FastAPI + SQLite + model API |
| 数据库设计 | users/notebooks/nodes/messages/long_tasks/conversation_patches |
| 核心算法/机制 | context builder、long task runner、backfill anchor/hash/conflict |
| 系统测试 | smoke check、pytest、frontend build、live checks |
| 部署运维 | Nginx/systemd/Docker、环境变量、日志和数据目录 |

## 近期优先级

1. 保持 README、架构、API、测试、部署文档互相一致。
2. 用 smoke check 覆盖不依赖外部服务的核心 API。
3. 用最小 pytest 固化 owner isolation、node CRUD、long task 状态机。
4. 把 live checks 与外部服务依赖明确分离，避免无 key 环境阻塞基础回归。
5. 继续强化长任务和回填的错误恢复体验。
