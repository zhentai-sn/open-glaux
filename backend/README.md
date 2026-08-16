# backend · Glaux IDE 的 FastAPI 薄壳

把 §5 契约的端点接到 science-core / caroSegDeep 隔离环境。
**主进程刻意不引入 TensorFlow**——`/segment` 经隔离子进程（uv/py3.8/TF2.4）调用。
**主进程也不含任何 LLM SDK**——自然语言理解归 agent-runtime；智能体经 `run_task` 工具调本服务的
`/task/run`（退役 orchestration，2026-08-16，见 `docs/designs/2026-08-16-001-retire-orchestration`）。

## 端点（2026-08-16 清理后，只保留前端 / agent-runtime 实际调用的）

| 端点 | 映射内核 | 说明 |
| --- | --- | --- |
| `GET /tasks` | `glaux_core.tasks.REGISTRY` → `plugin_to_view` | 多模态前端的单一真相源 |
| `POST /task/run` | `kernel.run_task`（取数 → 分割/检测 → 测量 → TaskOutput） | 前端选图/重跑 + agent-runtime `run_task` 工具的执行面 |
| `POST /task/measure` | `kernel.measure_task`（注册表 `measure` 原语） | 人工修正后由图元重测 |
| `GET /images` `GET /volumes` `GET /slides` | 各模态 dataset 适配器 | 数据发现 |
| `GET /image/{id}` | tiff→PNG | 光栅模态 |
| `GET /volume/{id}` `GET /volume/{id}/labelmap` `POST /volume/{id}/mask-edit` | `dataset_ct` / `segment_ts` | CT：NIfTI 流 + labelmap + 画笔编辑回流 |
| `GET /wsi/{id}/tile/…` `GET /wsi/{id}/verify` | `dataset_wsi` / `segment_wsi` | 病理：DeepZoom 瓦片 + 复现验证 |
| `GET /models` `GET /capabilities` `GET/POST/DELETE /datasources` | 注册表 | 插件市场 / 数据源 |
| ~~`/interpret` `/intent/*`~~ | 已退役——NL 由 agent-runtime 处理 | 见 `docs/designs/2026-08-16-001-retire-orchestration` |
| ~~`/task/detect` `/correction` `/volume/{id}/segment\|raw\|verify` `/wsi/{id}/dzi\|thumbnail\|region`~~ | 已删（孤儿端点，前端从未调用） | 同上设计 §3.3 后续清理 |

`app/schemas.py` 即契约单一事实源；`glaux_core.tasks.TaskSpec` 是内核入口，pydantic 版在 HTTP 边界做校验。

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
