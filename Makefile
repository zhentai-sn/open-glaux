# Glaux — 开发编排。前端 Vite(5173) + 后端 FastAPI(8000) + Agent Runtime(8010)。
# 前端经同源代理访问 /api 与 /agent-api（见 frontend/vite.config.ts）。

.PHONY: dev backend frontend agent-runtime install install-backend install-frontend install-agent-runtime test test-agent-runtime test-frontend test-backend test-science-core test-version lint check-literals version version-check

## 同时起三个进程（需要 GNU make -j 或三个终端）：
##   make -j3 dev
dev: backend frontend agent-runtime

backend:
	# SDD 08 D-4：开发环境显式开发者模式（内置示例源可见）
	cd backend && GLAUX_DEV_MODE=$${GLAUX_DEV_MODE:-1} uv run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

agent-runtime:
	cd agent-runtime && npm run dev

## 依赖安装
install: install-backend install-frontend install-agent-runtime

install-backend:
	cd backend && uv venv --python 3.12 && uv pip install -e ".[dev,video]"

install-frontend:
	cd frontend && npm install

install-agent-runtime:
	cd agent-runtime && npm install

## 校验
test: test-version test-agent-runtime test-frontend test-backend test-science-core

test-version:
	python3 scripts/test_version_matrix.py

test-agent-runtime:
	cd agent-runtime && npm test

test-frontend:
	cd frontend && npm test

test-backend:
	cd backend && env TMPDIR=/tmp TEMP=/tmp TMP=/tmp uv run pytest -q

# D3(2026-08-27 技术债审计):science-core 是测量与分割的算法真相源,
# 此前从未挂进 make test——169 个用例全绿只是因为最近没人动它,红了也没人知道。
test-science-core:
	cd science-core && env TMPDIR=/tmp TEMP=/tmp TMP=/tmp uv run pytest -q

lint:
	cd backend && uv run ruff check .
	# 注:science-core 未声明 ruff 依赖也无 [tool.ruff] 配置,接它需先建基线——属 D9(第 1 期),不在 D3 范围。
	cd frontend && npm run lint
	cd agent-runtime && npm run lint

# SDD 10 D-14：模态字面量比较计数。W0 只打印基线、不阻断，不挂进 make test；W7 改 --strict 并纳入 test 前置。
check-literals:
	bash scripts/ci/check-modality-literals.sh

version:
	python3 scripts/version_matrix.py

version-check:
	python3 scripts/version_matrix.py --check
