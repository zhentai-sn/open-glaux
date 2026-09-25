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
| `GET /images?modality=` | `SOURCES[modality]`（`app/sources/`） | 数据发现；元素为 `ObjectMeta`（SDD 10 §5.1） |
| `GET /image/{id}` | `resolve_object` → `Source.frame` | 缺省索引的一帧；未知 id 404，slide 需 level 故 422 |
| `GET /objects/{id}` `…/frame` `…/raw` `…/tiles/{l}/{c}/{r}` `POST …/edits` | `routers/objects.py` | 对象表征面（SDD 10 §5.2）：元数据、带 `X-Glaux-Frame` 的单帧、原始字节、瓦片、掩膜编辑 |
| `GET /volume/{id}/labelmap` | `segment_ts` | 任务结果字节面，有意保留 |
| `GET /wsi/{id}/verify` | `Detector.verify`（`detectors/wsi.py`） | 病理复现验证，有意保留；参考文件只对内置示例源提供，导入源与项目源的切片 422 |
| `GET /models` `GET /capabilities` | 注册表 | 插件市场 / 能力清单 |
| `GET/POST /datasources` `DELETE /datasources/{id}` `POST /datasources/samples` | `datasource_registry` | 数据源；`POST` 导入 `GLAUX_DATASETS_ROOT` 下的文件夹（API 与脚本用，前端不提供入口）；`samples` 挂载内置示例源；元素带 `project_id`（空为未归属），`origin` 含 `project` |
| `POST /uploads/images` | `routers/uploads.py` | 浏览器上传（SDD 08）；模态由 `SOURCES[*].formats` 推断：图像 → `natural_image`，mp4 / webm → `video`；只汇总 `browser_upload` 为真的 Source，CT、WSI 不受理；可带表单字段 `project_id`，登记的数据源归属该项目，落盘仍在 `GLAUX_DATASETS_ROOT/uploads/`（SDD 13） |
| `GET /fs/roots` `GET /fs/dirs?path=` | `routers/fs.py`、`paths.py` | 目录选择器（SDD 13）：快捷根与单层子目录；路径接受 POSIX、`C:\…`、`\\wsl.localhost\<发行版>\…` 三种写法。仅回环来源 |
| `GET/POST /projects` `DELETE /projects/{id}` | `routers/projects.py` → `datasource_registry` | 项目登记（SDD 13）：`POST` 按规范化路径幂等（新建 201、已存在 200），不扫描目录；`GET` 实时判定 `status: ok \| missing`；`DELETE` 连带注销项目源，不删磁盘文件。仅回环来源 |
| `GET /projects/{id}/entries?path=` `POST /projects/{id}/objects` | `routers/projects.py` → `Source.object_id_for` | 按需识别（SDD 13）：列一层并按后缀给候选模态；打开文件时按「目录 + 模态」登记 `origin=project` 的数据源并返回 `ObjectMeta`。错误体 `{detail: {code, message}}`，`code` 为 `outside_project` / `unsupported_format`（后缀无候选模态）/ `corrupt`（内容与后缀不符）等。仅回环来源 |
| `GET /objects/{id}/clip` `…/frame-at` | `dataset_video.py`、`video_clip.py` | SDD 11 原声音画短片段、PTS 时间映射与关键帧证据；仅视频对象可用 |
| `/annotations` `/annotations/{id}` `/annotations/{id}/mask` | `routers/annotations.py` | 统一标注（SDD 04） |
| `/atlas/*`（`exemplars`、`collections`、`tags`、`imports/*`） | `routers/atlas.py` | 图谱：案例库与文献导入（SDD 03） |
| ~~`/interpret` `/intent/*`~~ | 已退役——NL 由 agent-runtime 处理 | 见[退役设计](../docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md) |
| ~~`/task/detect` `/correction` `/volume/{id}/segment\|raw\|verify` `/wsi/{id}/dzi\|thumbnail\|region`~~ | 已删（孤儿端点，前端从未调用） | 同上设计 §3.3 后续清理 |

`app/schemas.py` 即契约单一事实源；`glaux_core.tasks.TaskSpec` 是内核入口，pydantic 版在 HTTP 边界做校验。

「仅回环来源」由 `routers/loopback.py` 的 `require_loopback` 以 router 级依赖实现：直连地址与 `X-Forwarded-For`、`Forwarded` 头中的每一跳都须是 `127.0.0.1` 或 `::1`，否则 403。开发态 Vite 代理开启 `xfwd`，经 `vite --host` 从局域网访问时这两组端点返回 403。测试经 `app.dependency_overrides[require_loopback]` 放行。

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
