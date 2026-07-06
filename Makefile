# Glaux — 开发编排。前端 Vite(5173) + 后端 FastAPI(8000)。
# 前端经 /api 反代到后端（见 frontend/vite.config.ts），故 CORS 仅开发期需要。

.PHONY: dev backend frontend install install-backend install-frontend test lint

## 同时起前后端（需要 GNU make -j 或两个终端）：
##   make -j2 dev
dev: backend frontend

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

## 依赖安装
install: install-backend install-frontend

install-backend:
	cd backend && uv venv --python 3.12 && uv pip install -e ".[dev]"

install-frontend:
	cd frontend && npm install

## 校验
test:
	cd backend && uv run pytest -q

lint:
	cd backend && uv run ruff check .
	cd frontend && npm run lint
