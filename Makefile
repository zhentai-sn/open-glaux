# Glaux — 开发编排。前端 Vite(5173) + 后端 FastAPI(8000) + Agent Runtime(8010)。
# 前端经同源代理访问 /api 与 /agent-api（见 frontend/vite.config.ts）。

.PHONY: dev backend frontend agent-runtime install install-backend install-frontend install-agent-runtime test test-agent-runtime test-frontend test-backend test-version lint version version-check

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
test: test-version test-agent-runtime test-frontend test-backend

test-version:
	python3 scripts/test_version_matrix.py

test-agent-runtime:
	cd agent-runtime && npm test

test-frontend:
	cd frontend && npm test

test-backend:
	cd backend && env TMPDIR=/tmp TEMP=/tmp TMP=/tmp uv run pytest -q

lint:
	cd backend && uv run ruff check .
	cd frontend && npm run lint
	cd agent-runtime && npm run lint

version:
	python3 scripts/version_matrix.py

version-check:
	python3 scripts/version_matrix.py --check
