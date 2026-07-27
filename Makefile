# Glaux — 开发编排。前端 Vite(5173) + 后端 FastAPI(8000) + Agent Runtime(8010)。
# 前端经同源代理访问 /api 与 /agent-api（见 frontend/vite.config.ts）。

.PHONY: dev backend frontend agent-runtime install install-backend install-frontend install-agent-runtime test test-agent-runtime lint

## 同时起三个进程（需要 GNU make -j 或三个终端）：
##   make -j3 dev
dev: backend frontend agent-runtime

backend:
	cd backend && uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

agent-runtime:
	cd agent-runtime && npm run dev

## 依赖安装
install: install-backend install-frontend install-agent-runtime

install-backend:
	cd backend && uv venv --python 3.12 && uv pip install -e ".[dev]"

install-frontend:
	cd frontend && npm install

install-agent-runtime:
	cd agent-runtime && npm install

## 校验
test: test-agent-runtime
	cd backend && uv run pytest -q

test-agent-runtime:
	cd agent-runtime && npm test

lint:
	cd backend && uv run ruff check .
	cd frontend && npm run lint
	cd agent-runtime && npm run lint
