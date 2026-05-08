# ArborLearn ECS Deployment

This guide assumes an Ubuntu ECS instance and deploys:

- frontend static files with Nginx
- FastAPI backend with systemd
- SQLite under `backend/data/`
- DeepSeek key in `/opt/arborlearn/backend/.env`

## 1. Clone

```bash
git clone https://github.com/ipsc-gummy/ArborLearn.git /opt/arborlearn
cd /opt/arborlearn
```

## 2. Backend

```bash
cd /opt/arborlearn/backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

Edit `/opt/arborlearn/backend/.env`:

```env
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-v4-flash
MODEL_API_KEY=your_deepseek_key
AUTH_SECRET=replace_with_a_long_random_value
CORS_ORIGINS=http://your_server_ip
DATABASE_PATH=data/treelearn.sqlite3
```

## 3. Frontend

```bash
cd /opt/arborlearn/frontend
npm install
npm run build
```

The production frontend uses same-origin `/api`, so Nginx must proxy `/api/` to the backend.

## 4. Systemd

```bash
cp /opt/arborlearn/deploy/arborlearn-backend.service /etc/systemd/system/arborlearn-backend.service
systemctl daemon-reload
systemctl enable --now arborlearn-backend
systemctl status arborlearn-backend
```

## 5. Nginx

```bash
cp /opt/arborlearn/deploy/nginx.conf /etc/nginx/sites-available/arborlearn
ln -sf /etc/nginx/sites-available/arborlearn /etc/nginx/sites-enabled/arborlearn
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

Open:

```text
http://your_server_ip
```

Do not expose port `8000` publicly. Only ports `80`, `443`, and SSH should be open.
