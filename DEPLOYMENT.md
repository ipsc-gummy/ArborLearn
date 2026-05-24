# TreeLearn + RAG 部署指南

本指南帮助您在服务器上部署 TreeLearn 并启用 RAG（检索增强生成）功能。

## 目录

- [方案一：Docker 部署（推荐）](#方案一docker-部署推荐)
- [方案二：手动部署](#方案二手动部署)
- [GitHub Actions 自动部署](#github-actions-自动部署)
- [RAG 模型下载配置](#rag-模型下载配置)
- [常见问题](#常见问题)

---

## 方案一：Docker 部署（推荐）

### 前置要求

- Docker 20.10+
- Docker Compose 2.0+
- 域名（可选，用于 HTTPS）

### 部署步骤

#### 1. 服务器准备

```bash
# 安装 Docker
curl -fsSL https://get.docker.com | sh

# 安装 Docker Compose
sudo apt update
sudo apt install docker-compose

# 启动 Docker
sudo systemctl start docker
sudo systemctl enable docker
```

#### 2. 上传代码到服务器

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/ArborLearn.git
cd ArborLearn

# 创建数据目录
mkdir -p data logs
chmod 777 data logs
```

#### 3. 配置环境变量

```bash
# 创建 .env 文件
cat > .env << 'EOF'
# 模型配置（必填）
MODEL_API_KEY=sk-your-deepseek-api-key
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash

# 认证密钥（必填，使用随机字符串）
AUTH_SECRET=your-super-secret-key-change-this

# CORS 配置
CORS_ORIGINS=https://your-domain.com

# RAG 配置
ENABLE_RAG=true
VECTOR_EMBEDDING_MODEL=all-MiniLM-L6-v2
HF_ENDPOINT=https://hf-mirror.com

# 数据路径
DATABASE_PATH=/app/data/treelearn.sqlite3
VECTOR_DB_PATH=/app/data/lancedb
EOF
```

#### 4. 启动服务

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 查看服务状态
docker-compose ps
```

#### 5. 配置 Nginx（可选，用于 HTTPS）

```nginx
# /etc/nginx/sites-available/treelearn
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /api {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# 启用站点
sudo ln -s /etc/nginx/sites-available/treelearn /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 方案二：手动部署

### 1. 服务器环境

```bash
# 安装 Python 3.11
sudo apt update
sudo apt install python3.11 python3.11-venv python3-pip git curl

# 创建用户
sudo useradd -m -s /bin/bash treelearn
sudo mkdir -p /app/treelearn
sudo chown treelearn:treelearn /app/treelearn
```

### 2. 部署后端

```bash
# 切换到应用用户
sudo -u treelearn -i
cd /app/treelearn

# 克隆代码
git clone https://github.com/YOUR_USERNAME/ArborLearn.git .
cd backend

# 创建虚拟环境
python3.11 -m venv venv
source venv/bin/activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cat > .env << 'EOF'
MODEL_API_KEY=sk-your-deepseek-api-key
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash
AUTH_SECRET=your-super-secret-key
ENABLE_RAG=true
VECTOR_EMBEDDING_MODEL=all-MiniLM-L6-v2
HF_ENDPOINT=https://hf-mirror.com
EOF

# 下载嵌入模型（重要！）
python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# 创建数据目录
mkdir -p ../data

# 测试运行
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 3. 配置 systemd 服务

```bash
# 创建服务文件
sudo cat > /etc/systemd/system/treelearn-backend.service << 'EOF'
[Unit]
Description=TreeLearn Backend API
After=network.target

[Service]
User=treelearn
Group=treelearn
WorkingDirectory=/app/treelearn/backend
Environment="PATH=/app/treelearn/backend/venv/bin"
ExecStart=/app/treelearn/backend/venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 启用并启动服务
sudo systemctl daemon-reload
sudo systemctl enable treelearn-backend
sudo systemctl start treelearn-backend

# 查看状态
sudo systemctl status treelearn-backend
```

### 4. 部署前端

```bash
# 退出后端用户
exit

# 继续作为 root 或其他用户
cd /app/treelearn/frontend

# 安装 Node.js（如果未安装）
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 安装依赖
npm install

# 配置 API 地址
echo "VITE_API_BASE_URL=https://your-domain.com" > .env

# 构建生产版本
npm run build

# 使用 Nginx 或其他静态服务器托管
```

---

## GitHub Actions 自动部署

### 1. 配置 GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions 中添加：

| Secret 名称 | 说明 | 示例 |
|-----------|------|------|
| `DOCKER_USERNAME` | Docker Hub 用户名 | `yourusername` |
| `DOCKER_PASSWORD` | Docker Hub 密码 | `yourpassword` |
| `SERVER_HOST` | 服务器 IP 地址 | `123.456.789.10` |
| `SERVER_USER` | 服务器 SSH 用户名 | `root` |
| `SERVER_SSH_KEY` | 服务器 SSH 私钥 | `-----BEGIN OPENSSH...` |

### 2. 配置服务器

在服务器上配置无密码 SSH 登录：

```bash
# 在 GitHub Actions 运行机器上生成 SSH 密钥对
ssh-keygen -t ed25519 -C "github-actions"

# 将公钥添加到服务器的 authorized_keys
cat ~/.ssh/id_ed25519.pub | ssh user@server "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"

# 测试连接
ssh -i ~/.ssh/id_ed25519 user@server "echo 'SSH connection successful'"
```

### 3. 触发部署

推送代码到 main 分支，或在 GitHub Actions 页面手动触发：

```
GitHub Repository → Actions → Deploy Backend with RAG to Server → Run workflow
```

---

## RAG 模型下载配置

### 使用国内镜像（推荐）

由于网络原因，建议使用 HuggingFace 国内镜像：

```bash
# 设置环境变量
export HF_ENDPOINT=https://hf-mirror.com

# 或在 Python 代码中设置
import os
os.environ['HF_ENDPOINT'] = 'https://hf-mirror.com'
```

### 预下载模型

在 Dockerfile 或部署脚本中预先下载：

```dockerfile
# Dockerfile
ENV HF_ENDPOINT=https://hf-mirror.com
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
```

### 手动下载模型

如果自动下载失败，可以手动下载：

```bash
# 安装 huggingface_hub
pip install huggingface_hub

# 下载模型
mkdir -p ~/.cache/huggingface/hub/models--sentence-transformers--all-MiniLM-L6-v2
cd ~/.cache/huggingface/hub/models--sentence-transformers--all-MiniLM-L6-v2

# 从镜像站下载并解压
wget https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main/config.json
wget https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main/model.safetensors
# ... 其他文件
```

---

## 常见问题

### Q1: 模型下载失败

**原因**：网络问题或防火墙

**解决方案**：
1. 使用国内镜像：`export HF_ENDPOINT=https://hf-mirror.com`
2. 使用代理：`export HTTPS_PROXY=http://proxy:port`
3. 手动下载模型文件

### Q2: Docker 构建失败

**原因**：内存不足

**解决方案**：
```bash
# 增加 Docker 内存到 4GB+
docker build -m 4g -t treelearn-backend .
```

### Q3: RAG 检索没有结果

**原因**：向量数据库为空

**解决方案**：
1. 确保 `ENABLE_RAG=true`
2. 检查日志确认模型加载成功
3. 用户发送消息后，系统会自动索引内容到向量库

### Q4: 服务启动慢

**原因**：首次加载嵌入模型

**解决方案**：
- 正常现象，首次加载约需 30-60 秒
- 可以使用 `docker-compose` 的 `--build` 标志预构建镜像

### Q5: 数据库迁移

**原因**：代码更新后数据库结构变更

**解决方案**：
```bash
# 备份数据
cp data/treelearn.sqlite3 data/treelearn.sqlite3.bak

# 重新初始化（注意：这会清空数据！）
rm data/treelearn.sqlite3
# 重启服务会自动创建新数据库
```

---

## 性能优化建议

### 1. 使用 GPU 加速（可选）

如果服务器有 NVIDIA GPU：

```dockerfile
# Dockerfile
FROM nvidia/cuda:11.8-cudnn8-runtime-ubuntu22.04
RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

### 2. 使用更大的嵌入模型

```env
VECTOR_EMBEDDING_MODEL=all-mpnet-base-v2
```

### 3. 配置 Redis 缓存（可选）

添加 Redis 加速检索：

```yaml
# docker-compose.yml
redis:
  image: redis:alpine
  ports:
    - "6379:6379"
```

---

## 监控和日志

### 查看日志

```bash
# Docker 部署
docker-compose logs -f backend

# Systemd 部署
journalctl -u treelearn-backend -f
```

### 健康检查

```bash
curl http://localhost:8000/api/health
```

### 性能监控

```bash
# 查看资源使用
docker stats

# 或
htop
```

---

## 安全建议

1. **使用 HTTPS**：配置 SSL 证书
2. **环境变量**：敏感信息不要提交到 Git
3. **定期备份**：备份数据库和向量数据
4. **防火墙**：只开放必要端口（80, 443）
5. **更新依赖**：定期更新 Docker 镜像和依赖

---

## 获取帮助

- 提交 Issue: https://github.com/YOUR_USERNAME/ArborLearn/issues
- 查看 API 文档: http://your-server:8000/docs
