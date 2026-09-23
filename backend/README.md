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
| `POST /task/run` | `kernel.run_task`（公共前缀 → `DETECTORS[adapter_kind].detect` → 测量 → TaskOutput） | 前端选图/重跑 + agent-runtime `run_task` 工具的执行面；未知对象 404、几何族/选区/标定不符 422、检测不可用 503 |
| `POST /task/measure` | `kernel.measure_task`（注册表 `measure` 原语） | 人工修正后由图元重测；标定收 `Calibration`（`cf` 为过渡字段） |
| `GET /images` `GET /volumes` `GET /slides` | `SOURCES[modality]`（`app/sources/`） | 数据发现；元素为 `ObjectMeta`（SDD 10 §5.1） |
| `GET /image/{id}` | `resolve_object` → `Source.frame` | 缺省索引的一帧；未知 id 404，slide 需 level 故 422 |
| `GET /objects/{id}` `…/frame` `…/raw` `…/tiles/{l}/{c}/{r}` `POST …/edits` | `routers/objects.py` | 对象表征面（SDD 10 §5.2）：元数据、带 `X-Glaux-Frame` 的单帧、原始字节、瓦片、掩膜编辑 |
| `GET /volume/{id}` `POST /volume/{id}/mask-edit` `GET /wsi/{id}/tile/…` | `routers/objects.py` 的 alias | 旧路径，与 `/objects/*` 字节等价，W7 删 |
| `GET /volume/{id}/labelmap` | `segment_ts` | 任务结果字节面，有意保留 |
| `GET /wsi/{id}/verify` | `Detector.verify`（`detectors/wsi.py`） | 病理复现验证，有意保留 |
| `GET /models` `GET /capabilities` | 注册表 | 插件市场 / 能力清单 |
| `GET/POST /datasources` `DELETE /datasources/{id}` `POST /datasources/samples` | `datasource_registry` | 数据源；`samples` 挂载内置示例源 |
| `POST /uploads/images` | `routers/uploads.py` | 浏览器上传（SDD 08）；模态由 `SOURCES[*].formats` 推断：图像 → `natural_image`，mp4 / webm → `video` |
| `/annotations` `/annotations/{id}` `/annotations/{id}/mask` | `routers/annotations.py` | 统一标注（SDD 04） |
| `/atlas/*`（`exemplars`、`collections`、`tags`、`imports/*`） | `routers/atlas.py` | 图谱：案例库与文献导入（SDD 03） |
| ~~`/interpret` `/intent/*`~~ | 已退役——NL 由 agent-runtime 处理 | 见[退役设计](../docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md) |
| ~~`/task/detect` `/correction` `/volume/{id}/segment\|raw\|verify` `/wsi/{id}/dzi\|thumbnail\|region`~~ | 已删（孤儿端点，前端从未调用） | 同上设计 §3.3 后续清理 |

`app/schemas.py` 即契约单一事实源；`glaux_core.tasks.TaskSpec` 是内核入口，pydantic 版在 HTTP 边界做校验。

## 运行

```bash
cd backend
uv venv && uv pip install -e ".[dev,video]"   # video：PyAV，可选；缺它时 video 模态不可用
uv run uvicorn app.main:app --reload --port 8000
# 文档: http://localhost:8000/docs
```

## 测试

```bash
cd backend
uv run pytest
```
