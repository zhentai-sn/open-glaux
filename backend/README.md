# backend · Glaux IDE 的 FastAPI 薄壳

把 §5 契约的端点接到 science-core / caroSegDeep 隔离环境。
**主进程刻意不引入 TensorFlow**——`/segment` 经隔离子进程（uv/py3.8/TF2.4）调用。
**主进程也不含任何 LLM SDK**——自然语言理解归 agent-runtime；智能体经 `run_task` 工具调本服务的
`/task/run`（退役 orchestration，2026-08-16，见 `docs/designs/2026-08-16-001-retire-orchestration`）。

## 端点（见 `docs/designs/…-frontend` §5）

| 端点 | 映射内核 | M0 状态 |
| --- | --- | --- |
| ~~`POST /interpret`~~ | 已退役（2026-08-16）——NL 由 agent-runtime 处理 | — |
| `POST /run` | `kernel.py`（读 `glaux_core.tasks.REGISTRY`） | mock |
| `POST /measure` | `measurement.pdm.imt`（共同支撑+对称 PDM） | mock |
| `GET /images` | `io.cubs.read_dataset` | mock |
| `GET /image/{id}` | tiff→PNG | mock（stdlib 合成 PNG） |
| `GET /models` | ModelAdapter 注册表 | mock |
| `POST /segment` | caroSegDeep 隔离子进程 | mock |
| `POST /correction` | 记忆层 U7 schema | mock |

M1 只换实现、不换形状（`app/schemas.py` 即契约单一事实源）。

## 运行

```bash
cd backend
uv venv && uv pip install -e ".[dev]"
uv run uvicorn app.main:app --reload --port 8000
# 文档: http://localhost:8000/docs
```

## 测试

```bash
cd backend
uv run pytest
```
