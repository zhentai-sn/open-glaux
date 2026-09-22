# backend · Glaux 的 FastAPI 服务

把 HTTP 端点接到 science-core 内核（`glaux_core.tasks.REGISTRY`）与各隔离模型子进程。
**主进程刻意不引入 TensorFlow / torch**——caroSegDeep、HC、TotalSegmentator、核分割各走自己的
venv 子进程（`app/segment_proc.py`、`app/segment_ts.py`、`app/segment_wsi.py`，路径见 `app/config.py`）。
**主进程也不含任何 LLM SDK**——自然语言理解归 agent-runtime；智能体经 `run_task` 工具调本服务的
`/task/run`（退役 orchestration，2026-08-16，见[退役设计](../docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md)）。

## 端点

完整列表见运行中的 `/docs`（OpenAPI）；下表是前端 / agent-runtime 实际调用的部分。

| 端点 | 映射内核 | 说明 |
| --- | --- | --- |
| `GET /health` | — | 存活探测 |
| `GET /tasks` | `glaux_core.tasks.REGISTRY` → `plugin_to_view` | 多模态前端的单一真相源 |
| `POST /task/run` | `kernel.run_task`（取数 → 分割/检测 → 测量 → TaskOutput） | 前端选图/重跑 + agent-runtime `run_task` 工具的执行面 |
| `POST /task/measure` | `kernel.measure_task`（注册表 `measure` 原语） | 人工修正后由图元重测 |
| `GET /images` `GET /volumes` `GET /slides` | 各模态 dataset 适配器 | 数据发现 |
| `GET /image/{id}` | tiff→PNG | 光栅模态 |
| `GET /volume/{id}` `GET /volume/{id}/labelmap` `POST /volume/{id}/mask-edit` | `dataset_ct` / `segment_ts` | CT：NIfTI 流 + labelmap + 画笔编辑回流 |
| `GET /wsi/{id}/tile/…` `GET /wsi/{id}/verify` | `dataset_wsi` / `segment_wsi` | 病理：DeepZoom 瓦片 + 复现验证 |
| `GET /models` `GET /capabilities` | 注册表 | 插件市场 / 能力清单 |
| `GET/POST/DELETE /datasources` `POST /datasources/samples` | `datasource_registry` | 数据源；`samples` 挂载内置示例源 |
| `POST /uploads/images` | `routers/uploads.py` | 浏览器上传图像（SDD 08） |
| `/annotations` `/annotations/{id}` `/annotations/{id}/mask` | `routers/annotations.py` | 统一标注（SDD 04） |
| `/atlas/*`（`exemplars`、`collections`、`tags`、`imports/*`） | `routers/atlas.py` | 图谱：案例库与文献导入（SDD 03） |
| ~~`/interpret` `/intent/*`~~ | 已退役——NL 由 agent-runtime 处理 | 见[退役设计](../docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md) |
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
