#!/bin/bash
# ArborLearn 一键部署脚本
# 使用方法: bash deploy.sh

set -e

echo "=========================================="
echo "      ArborLearn 部署脚本"
echo "=========================================="

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为 root 用户
if [ "$(id -u)" != "0" ]; then
    echo -e "${RED}错误: 请以 root 用户身份运行此脚本${NC}"
    exit 1
fi

# 服务器配置
SERVER_IP="8.163.11.131"
APP_DIR="/opt/arborlearn"
DATA_DIR="/var/lib/arborlearn"

# 步骤 1: 更新系统
echo -e "\n${YELLOW}步骤 1: 更新系统和安装依赖${NC}"
apt update && apt upgrade -y
apt install -y git curl wget nginx python3 python3-pip python3-venv

# 步骤 2: 安装 Docker 和 Docker Compose
echo -e "\n${YELLOW}步骤 2: 安装 Docker 和 Docker Compose${NC}"
curl -fsSL https://get.docker.com | sh
apt install -y docker-compose

# 启动 Docker
systemctl start docker
systemctl enable docker

# 步骤 3: 创建目录结构
echo -e "\n${YELLOW}步骤 3: 创建目录结构${NC}"
mkdir -p $APP_DIR
mkdir -p $DATA_DIR/data
mkdir -p $DATA_DIR/logs

# 步骤 4: 克隆代码
echo -e "\n${YELLOW}步骤 4: 克隆代码${NC}"
cd $APP_DIR
if [ -d ".git" ]; then
    git pull origin main
else
    git clone https://github.com/ipsc-gummy/ArborLearn.git .
fi

# 步骤 5: 创建环境变量配置
echo -e "\n${YELLOW}步骤 5: 配置环境变量${NC}"

cat > $APP_DIR/.env << 'EOF'
# 模型配置（必填 - 请修改为你的 API Key）
MODEL_API_KEY=sk-your-deepseek-api-key-here
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash

# 认证密钥（必填 - 请修改为随机字符串）
AUTH_SECRET=your-super-secret-key-change-this-must-be-at-least-32-characters

# CORS 配置
CORS_ORIGINS=http://8.163.11.131

# RAG 配置
ENABLE_RAG=true
VECTOR_EMBEDDING_MODEL=all-MiniLM-L6-v2
HF_ENDPOINT=https://hf-mirror.com

# 数据路径
DATABASE_PATH=/app/data/treelearn.sqlite3
VECTOR_DB_PATH=/app/data/lancedb
EOF

# 创建后端环境变量
cat > $APP_DIR/backend/.env << 'EOF'
PORT=8000
HOST=0.0.0.0
MODEL_API_KEY=sk-your-deepseek-api-key-here
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash
AUTH_SECRET=your-super-secret-key-change-this-must-be-at-least-32-characters
DATABASE_URL=sqlite:///./data/treelearn.sqlite3
ENABLE_RAG=true
VECTOR_STORE_PATH=./data/lancedb
EMBEDDING_MODEL=all-MiniLM-L6-v2
HF_ENDPOINT=https://hf-mirror.com
CORS_ORIGINS=http://8.163.11.131
EOF

# 创建前端环境变量
cat > $APP_DIR/frontend/.env << 'EOF'
VITE_API_BASE_URL=http://8.163.11.131
VITE_RAG_ENABLED=true
EOF

# 步骤 6: 配置 Docker Compose
echo -e "\n${YELLOW}步骤 6: 配置 Docker Compose${NC}"

cat > $APP_DIR/docker-compose.prod.yml << 'EOF'
version: '3.8'

services:
  backend:
    build: .
    ports:
      - "127.0.0.1:8000:8000"
    environment:
      - MODEL_API_KEY=${MODEL_API_KEY}
      - MODEL_BASE_URL=${MODEL_BASE_URL:-https://api.deepseek.com}
      - MODEL_NAME=${MODEL_NAME:-deepseek-v4-flash}
      - AUTH_SECRET=${AUTH_SECRET}
      - DATABASE_PATH=/app/data/treelearn.sqlite3
      - VECTOR_DB_PATH=/app/data/lancedb
      - ENABLE_RAG=true
      - VECTOR_EMBEDDING_MODEL=all-MiniLM-L6-v2
      - HF_ENDPOINT=https://hf-mirror.com
    volumes:
      - /var/lib/arborlearn/data:/app/data
      - /var/lib/arborlearn/logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  nginx:
    image: nginx:latest
    ports:
      - "80:80"
    volumes:
      - ./deploy/nginx.conf:/etc/nginx/conf.d/default.conf
      - ./frontend/dist:/usr/share/nginx/html
    depends_on:
      - backend
    restart: unless-stopped
EOF

# 步骤 7: 配置 Nginx
echo -e "\n${YELLOW}步骤 7: 配置 Nginx${NC}"

cat > $APP_DIR/deploy/nginx.conf << 'EOF'
server {
    listen 80;
    server_name 8.163.11.131;

    root /usr/share/nginx/html;
    index index.html;

    # API 反向代理
    location /api/ {
        proxy_pass http://backend:8000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass $http_upgrade;
    }

    # 静态文件
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
}
EOF

# 步骤 8: 构建前端
echo -e "\n${YELLOW}步骤 8: 构建前端${NC}"
cd $APP_DIR/frontend
npm install
npm run build

# 步骤 9: 启动服务
echo -e "\n${YELLOW}步骤 9: 启动 Docker 服务${NC}"
cd $APP_DIR
docker-compose -f docker-compose.prod.yml up -d --build

# 等待服务启动
echo -e "\n${YELLOW}等待服务启动...${NC}"
sleep 30

# 检查服务状态
echo -e "\n${YELLOW}步骤 10: 检查服务状态${NC}"
docker-compose -f docker-compose.prod.yml ps

# 显示完成信息
echo -e "\n${GREEN}=========================================="
echo "      部署完成！"
echo "=========================================="
echo ""
echo "服务地址: http://${SERVER_IP}"
echo "API 地址: http://${SERVER_IP}/api"
echo "Swagger 文档: http://${SERVER_IP}/docs"
echo ""
echo "需要修改的配置:"
echo "1. 编辑 $APP_DIR/.env 设置 MODEL_API_KEY"
echo "2. 编辑 $APP_DIR/backend/.env 设置 AUTH_SECRET"
echo ""
echo "查看日志: docker-compose -f docker-compose.prod.yml logs -f"
echo "重启服务: docker-compose -f docker-compose.prod.yml restart"
echo "==========================================${NC}"
