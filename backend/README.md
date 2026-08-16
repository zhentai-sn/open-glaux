# backend · Glaux IDE 的 FastAPI 薄壳

把 §5 契约的八个端点接到 science-core / orchestration / caroSegDeep 隔离环境。
**主进程刻意不引入 TensorFlow**——`/segment` 经隔离子进程（uv/py3.8/TF2.4）调用。

## 端点（见 `docs/designs/…-frontend` §5）

| 端点 | 映射内核 | M0 状态 |
| --- | --- | --- |
| `POST /interpret` | `orchestrator.intent`（三态守卫） | mock（规则分类，行为对齐） |
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
