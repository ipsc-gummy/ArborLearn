# ArborLearn Deployment Guide

> 本文档是 ArborLearn 的权威部署入口。`deploy/` 目录保留可直接复制的 Nginx 与 systemd 配置文件，根目录 `DEPLOYMENT.md` 仅作为兼容入口。

## 1. 部署形态

推荐生产部署：

```text
Browser
-> Nginx :80/:443
   -> static frontend files
   -> /api proxy to FastAPI backend :8000
-> arborlearn-backend.service
-> backend/data/arborlearn.sqlite3
-> optional LanceDB / web search / model API
```

原则：

- 不直接暴露后端 `8000` 端口。
- 模型 key、认证密钥和数据库路径只放在服务器 `.env`。
- SQLite 数据目录和 vector store 目录需要可写、可备份。
- RAG 和 web search 是增强能力，基础 tree/auth/node/long-task metadata 不应依赖它们。

## 2. 服务器前置条件

Ubuntu ECS / VPS：

```bash
sudo apt update
sudo apt install -y git nginx python3 python3-venv python3-pip nodejs npm
```

如果使用 Docker 部署，还需要：

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
```

## 3. 代码目录

推荐路径：

```bash
git clone https://github.com/ipsc-gummy/ArborLearn.git /opt/arborlearn
cd /opt/arborlearn
```

更新时：

```bash
cd /opt/arborlearn
git fetch origin
git pull --ff-only
```

## 4. 后端环境

```bash
cd /opt/arborlearn/backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

编辑 `/opt/arborlearn/backend/.env`：

```env
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-pro
MODEL_API_KEY=your_model_key

AUTH_SECRET=replace_with_a_long_random_value
CORS_ORIGINS=http://your_server_ip,https://your_domain

DATABASE_PATH=data/arborlearn.sqlite3

EMAIL_VERIFICATION_REQUIRED=true
SMTP_HOST=smtpdm.aliyun.com
SMTP_PORT=465
SMTP_USER=no-reply@arborlearn.top
SMTP_PASSWORD=your_aliyun_directmail_smtp_password
SMTP_FROM=no-reply@arborlearn.top
SMTP_FROM_NAME=ArborLearn
EMAIL_CODE_SECRET=replace_with_a_long_random_value

ENABLE_RAG=false
VECTOR_DB_PATH=data/lancedb
VECTOR_EMBEDDING_MODEL=all-MiniLM-L6-v2

# Optional web search provider
# WEB_SEARCH_PROVIDER=auto
# TAVILY_API_KEY=tvly-...
# BRAVE_SEARCH_API_KEY=...
# SEARXNG_BASE_URL=http://127.0.0.1:8080
```

邮箱验证码部署注意：

- 阿里云 ECS 使用阿里云 DirectMail SMTP SSL，端口固定为 `465`，不要使用 `25` 端口。
- `SMTP_PASSWORD` 是发信地址的 SMTP 密码，只写入服务器真实 `.env`，不要提交到 Git。
- `EMAIL_CODE_SECRET` 用于验证码 hash，生产环境必须设置为长随机字符串。
- 修改 `backend/.env` 后执行 `systemctl restart arborlearn-backend.service`。

本地健康检查：

```bash
cd /opt/arborlearn/backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
curl -sS http://127.0.0.1:8000/api/health
```

## 5. systemd 后端服务

项目提供服务文件：

```text
deploy/arborlearn-backend.service
```

安装：

```bash
sudo cp /opt/arborlearn/deploy/arborlearn-backend.service /etc/systemd/system/arborlearn-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now arborlearn-backend
sudo systemctl status arborlearn-backend
```

常用命令：

```bash
sudo systemctl restart arborlearn-backend
sudo journalctl -u arborlearn-backend -f
sudo journalctl -u arborlearn-backend --since "30 min ago"
```

## 6. 前端构建

生产前端默认使用同源 `/api`，由 Nginx 代理到后端。

```bash
cd /opt/arborlearn/frontend
npm install
npm run build
```

构建产物：

```text
frontend/dist/
```

## 7. Nginx

项目提供配置文件：

```text
deploy/nginx.conf
```

安装：

```bash
sudo cp /opt/arborlearn/deploy/nginx.conf /etc/nginx/sites-available/arborlearn
sudo ln -sf /etc/nginx/sites-available/arborlearn /etc/nginx/sites-enabled/arborlearn
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

验证：

```bash
curl -I http://your_server_ip
curl -sS http://your_server_ip/api/health
```

## 8. Docker 部署

仓库提供：

```text
Dockerfile
docker-compose.yml
docker-compose.prod.yml
```

基本启动：

```bash
cd /opt/arborlearn
docker compose up -d --build
docker compose logs -f
```

如果启用 RAG，第一次启动可能需要下载 embedding model，耗时明显更长。发布说明或运维沟通中应提前说明。

## 9. GitHub Actions 自动部署

如果使用 GitHub Actions 推送到服务器，建议把 workflow 设计成“构建前端 -> 同步代码 -> 安装依赖 -> 重启 systemd -> health check”。

常见 Secrets：

| Secret | 说明 |
| --- | --- |
| `SERVER_HOST` | 服务器 IP 或域名 |
| `SERVER_USER` | SSH 用户 |
| `SERVER_SSH_KEY` | SSH 私钥 |
| `SERVER_PORT` | SSH 端口，默认可省略 |

服务器前置检查：

```bash
test -d /opt/arborlearn
test -f /opt/arborlearn/backend/.env
systemctl status arborlearn-backend
nginx -t
```

自动部署后至少验证：

```bash
curl -sS http://127.0.0.1:8000/api/health
curl -sS http://your_server_ip/api/health
```

注意：

- workflow 不应把 `MODEL_API_KEY`、`AUTH_SECRET` 等运行时密钥写入仓库。
- 如果 RAG 依赖发生变化，`pip install -r requirements.txt` 可能明显变慢。
- 如果服务器代码目录和 workflow 目标不一致，应先以服务器实际 `systemd` 配置为准。

## 10. Smoke Check

部署后建议先跑不依赖外部模型的检查：

```bash
python3 scripts/smoke_check.py --base-url http://127.0.0.1:8000
```

如果通过 Nginx 验证：

```bash
python3 scripts/smoke_check.py --base-url http://your_server_ip
```

可选 live checks：

```bash
python3 scripts/smoke_check.py \
  --base-url http://your_server_ip \
  --include-chat-live \
  --include-web-search
```

`--include-chat-live` 需要 `MODEL_API_KEY` 可用。`--include-web-search` 需要配置搜索 provider。

## 11. 演示会话与默认 Notebook

后端不再创建固定共享演示账号。前端“体验示例”会调用：

```text
POST /api/auth/demo
```

该接口每次创建一个独立临时用户，并自动初始化默认 notebook：

- `ArborLearn 入门笔记本`
- `Transformer 是如何工作的`

临时演示用户不会和其他访问者共享笔记本、节点或聊天记录。后端启动和创建新演示会话时会清理过期临时用户，前端只把演示 token 保存在浏览器 session 中。

## 12. 数据目录与备份

默认数据：

```text
backend/data/arborlearn.sqlite3
backend/data/lancedb/
```

备份 SQLite：

```bash
cd /opt/arborlearn/backend
sqlite3 data/arborlearn.sqlite3 ".backup data/arborlearn-$(date +%Y%m%d-%H%M%S).sqlite3"
```

如果未安装 sqlite3：

```bash
sudo apt install -y sqlite3
```

## 13. 常见问题

### 401 或登录状态丢失

检查：

- `AUTH_SECRET` 是否稳定，重启后不能随机变化。
- 前端是否访问正确域名。
- Nginx 是否正确转发 `/api`。

### CORS 错误

检查 `CORS_ORIGINS` 是否包含浏览器实际 origin，例如：

```text
http://your_server_ip
https://your_domain
```

### 模型 API 报错

检查：

- `MODEL_API_KEY` 是否存在。
- `MODEL_BASE_URL` 是否为 OpenAI-compatible `/chat/completions` 服务根地址。
- `MODEL_NAME` 是否在后端支持列表中。

### RAG 启动慢

原因通常是 embedding model 或向量库依赖下载较大。可以先设置：

```env
ENABLE_RAG=false
```

待基础部署稳定后再启用。

### Web search 不可用

检查是否配置了至少一个 provider：

- `TAVILY_API_KEY`
- `BRAVE_SEARCH_API_KEY`
- `SEARXNG_BASE_URL`

没有 provider 时，基础 tree/chat/smoke check 仍应可用。
