# 实现计划 · 统一图像标注工具箱（bbox / polygon / brush）

> **用途**：把[《统一图像标注工具箱》SDD 04](../sdd/feats/04-unified-annotation-toolbox/README.md)（`ready`）拆成可逐项执行、验证和提交的实现任务。
>
> **日期**：2026-08-16 · **类别**：plan（ce-plan 风格） · **状态**：draft
>
> **范围**：两个进程动，agent-runtime 不动。science-core 加 `bbox` 原语与注册表能力位/`on_commit`；backend 新增 SQLite 标注存储 + `/annotations` REST；frontend 启用 `@cornerstonejs/tools`（已在依赖）、引入 `@annotorious/openseadragon`（新依赖），三查看器迁移到统一工具框架。
>
> **完成线**：三引擎上 bbox/polygon（CT 另含 brush）可画、可编辑、刷新仍在；查看器内无残留私有浮动工具条；WSI 框选落标注且触发核检测；IMT 测量口径不回退；SDD §15 十一条全勾。

---

## 1. 实施边界

### 1.1 本期目标

- science-core：`contracts.py` 加 `bbox` 原语（`primitive_to_dict` 同步）；`tasks.py` 的 `TaskPlugin` 加引擎能力位与 `on_commit` 声明，`plugin_to_view` 下发。
- backend：`app/annotations/`（SQLite store + mask 文件落盘）、`routers/annotations.py`（CRUD + base_seq + on_commit 派发）、`config.py` 加 `GLAUX_ANNOTATIONS_ROOT`（默认 `~/glaux_annotations`，D-11）。
- frontend：`Tool` 类型扩 `bbox/polygon/brush` + `toolOptions`；`annotationBridge`（事件↔契约↔API 的唯一桥，收敛 editSeqRef 范式）；ViewerChrome 统一工具栏；三查看器迁移（CS3D tools / Annotorious / IMT 自定义 BaseTool）。
- 依赖：frontend `npm i @annotorious/openseadragon`；`@cornerstonejs/tools` 已在 package.json，无需新增。

### 1.2 明确不做

- agent-runtime 侧任何改动（agent 写标注归 SDD 02，其建议态实体已在本期契约预留 `suggested/agent`）。
- 点标注编辑、WSI brush、3D 跨切片传播、标注导出、多人协作（SDD §2）。
- CT `mask-edit` 端点与 Detection 管线（`/task/run`、`/task/measure`）零改动（SDD §7.4 / D-13 / D-14）。

### 1.3 SDD 不变量与既定偏差处理

1. **IMT 壁线编辑走 `/task` 既有端点（D-14）**：只换交互（通用折线编辑 + 自定义形变手柄），数据归属仍是 Detection；自由标注才落 `/annotations`。
2. **CT brush 提交仍走 `mask-edit`**：CS3D segmentation 只做交互与渲染层，导出笔迹后复用既有 `api.volumeMaskEdit` + base_seq 链路。
3. **CS3D tools 只借用交互，不借用测量**：RectangleRoi/Freehand 的自带测量值一律不展示、不进 metrics（权威口径在 `/task/measure`）。
4. **后端主进程不加重依赖**：SQLite 走 stdlib `sqlite3`，无新 Python 依赖。

## 2. 当前状态证据

| 证据 | 现状 | 对计划的约束 |
| --- | --- | --- |
| [package.json](../../frontend/package.json) | `@cornerstonejs/core`+`tools` 均 `^3.33.5`（tools 未使用）；`openseadragon ^4.1.1` | T3 启用 tools 包；Annotorious 需先核实与 OSD 4.1.1 的版本兼容（§5） |
| [viewer/cornerstone.ts](../../frontend/src/viewer/cornerstone.ts) | `csReady()` 注册 `web:` PNG loader + metaProvider（spacing=1） | CS3D 工具需在这套自定义 loader 上工作——T0 spike 首验 |
| [store/session.ts](../../frontend/src/store/session.ts) | `Tool = cursor/editli/editma/roi/reset`；`setTool` 单值 | 扩 `bbox/polygon/brush` + `toolOptions`；`switchModality` 复位点已存在 |
| [components/Editor.tsx](../../frontend/src/components/Editor.tsx) | `.etools` 由 `tv.tools` 渲染；`onTool` 拦截 reset | 工具 id 换统一集合后此处近乎不改；选项条由 ViewerChrome 新挂 |
| [components/Viewer.tsx](../../frontend/src/components/Viewer.tsx) | `ENGINES` 按 `viewer` 字符串分派 | 引擎能力位随 `/tasks` 下发，分派逻辑不变 |
| [components/VolumeViewer.tsx](../../frontend/src/components/VolumeViewer.tsx) | 本地 `brushOn/ww/wl` state + `_toolbarStyle/_voiBarStyle` 内联工具条；`api.volumeMaskEdit` + baseSeqRef | T6 迁移主体；`volumeMaskEdit` 提交链保留 |
| [components/WsiViewer.tsx](../../frontend/src/components/WsiViewer.tsx) | `tool==="roi"` 时 overlay 拦指针；框完 `runWsiTask`；核质心自绘 | T7：ROI 框选换 Annotorious bbox + `on_commit`；核质心 overlay 保留 |
| [components/CornerstoneViewer.tsx](../../frontend/src/components/CornerstoneViewer.tsx) | 手写 overlay：polyline 高斯形变手柄 + editSeqRef 范式 + 壁线编辑回流 | T5：交互换 CS3D 工具；形变手柄做成自定义 BaseTool |
| [components/StatusBar.tsx](../../frontend/src/components/StatusBar.tsx) | `TOOL_LABEL/TOOL_GLYPH` 硬编码 5 id | T4 改查注册表 |
| [glaux_core/tasks.py](../../science-core/glaux_core/tasks.py) | `TaskPlugin`/`ToolDef`/`plugin_to_view`；CT 已声明 `brush`（前端死控件的根源） | T1 加能力位与 `on_commit`；四任务的 tools 元组改统一集合 |
| [glaux_core/contracts.py](../../science-core/glaux_core/contracts.py) | Primitive 联合：Polyline/EllipseShape/Mask/VolumeMask/PointSet | T1 加 `Bbox`；`Mask` 从占位转正（ref 语义不变） |
| [frontend/src/api/types.ts](../../frontend/src/api/types.ts) | `Primitive` 判别式镜像 | T1 同步加 `bbox` + `Annotation` 类型 |
| [routers/api.py](../../backend/app/routers/api.py) / [main.py](../../backend/app/main.py) | 主 router 无前缀；Atlas 已示范独立 `prefix="/atlas"` router | 新建 `routers/annotations.py`（无前缀，路径 `/annotations*`，与主 router 风格一致） |
| [config.py](../../backend/app/config.py) | `_env_path()` 模式（`GLAUX_DATA_ROOT`/`GLAUX_ATLAS_ROOT` 先例） | T2 加 `GLAUX_ANNOTATIONS_ROOT` |
| [tests/test_api.py](../../backend/tests/test_api.py) | 模块级 `TestClient(app)`；Atlas 用 `tmp_path` + monkeypatch 根目录 | annotations 测试照 Atlas 范式 |

## 3. 任务分解

### T0 · 开工前 spike（半天，阻塞后续）——✅ 已完成（2026-08-16，结论见 §5 与变更记录 v1.1）

1. ✅ 最小 demo：在现有 `web:` loader 的 StackViewport 上启用 `@cornerstonejs/tools`（init + ToolGroup + `RectangleROITool`），确认标注在自定义 metaProvider（spacing=1、无 DICOM）下正常创建/渲染/事件回调；
2. ✅ `PlanarFreehandROITool` 逐点 + 顶点编辑在同一 viewport 可行；
3. ⚠️ StackViewport 上 segmentation（labelmap + BrushTool）：`data:{}` 与派生 imageIds 两路均未画入体素，API 面已摸清（`activeSegmentation` / `convertStackToVolumeLabelmap` / `getLabelmapImageIds`）——转 T5 专项，不通则退化自持 mask 缓冲（脑暴 Q2 备选）；
4. ✅/⚠️ `@annotorious/openseadragon@3.8.9` 声明层兼容 `openseadragon@4.1.1`（peer `^4||^5||^6`），OSD + annotator 初始化成功；建标注在受控浏览器 CSP 沙箱下报 pixi unsafe-eval（本仓 index.html 无 CSP，真实浏览器不复现，已加 `@pixi/unsafe-eval@7` 保险）——验收走查需真实浏览器复核。

任一不通 → 回 SDD 调整 D-8/D-9 再继续（铁律：先改 SDD）。

### T1 · science-core 契约与注册表（SDD §7.1 / §9.2）——✅ 已完成（2026-08-17，v1.2）

- `contracts.py`：`Bbox` dataclass（id/role/x0/y0/x1/y1）进 Primitive 联合；`primitive_to_dict`/`primitive_from_dict` 往返。
- `tasks.py`：`TaskPlugin` 加 `capabilities: tuple[str, ...]`（如 `("bbox","polygon","brush")`，wsi 无 brush）与 `on_commit: dict | None`（WSI：`{"bbox": {"action": "run_task"}}`）；四任务 tools 元组改统一集合（IMT 的 editli/editma 并入 polygon 语义 + 任务说明，roi→bbox）；`plugin_to_view` 下发新字段。
- 测试：`tests/test_tasks.py` 既有断言同步改（tools 集合、新字段）；bbox 原语往返测试。

### T2 · backend 标注存储与 REST（SDD §8 / §9.1 / §10 / §13）——✅ 已完成（2026-08-17，v1.2）

- `config.py`：`ANNOTATIONS_ROOT = _env_path("GLAUX_ANNOTATIONS_ROOT", HOME / "glaux_annotations")`。
- `app/annotations/store.py`：stdlib sqlite3；建表严格按 SDD §9.1（含 CHECK、`(image_id, z)` 索引）；`create/list/get/update/delete`；update/delete 校验 `base_seq`，不匹配抛 `CONFLICT`；mask 落 `masks/<id>.png`（base64 PNG 解码），删标注连带删文件；`AnnotationError(code, message)` 领域错误（Atlas 范式）。
- `routers/annotations.py`：`GET /annotations?image_id=&z=`、`POST /annotations`、`PATCH /annotations/{id}`、`DELETE /annotations/{id}`；几何校验（kind 与字段齐备、坐标在图像 dims 内——dims 经数据源注册表/图像元数据取）；错误码映射 404/409/422；创建成功后按注册表 `on_commit` 派发（复用 `_detect_for_spec`；钩子失败不回滚标注，响应附 `hook_error` 字段）。
- `main.py`：挂载。
- 测试 `tests/test_annotations.py`：CRUD 全路径、409 并发、422 越界几何、mask 文件落盘与删除、on_commit 成功/失败两路（monkeypatch `_detect_for_spec`）。

### T3 · frontend 状态层与 annotationBridge（SDD §6.1 / §7.1 / §10）——✅ 已完成（2026-08-17，v1.2）

- `api/types.ts`：`bbox` 原语 + `Annotation` 接口；`api/client.ts`：`api.annotations.list/create/update/remove`。
- `store/session.ts`：`Tool` 扩 `bbox/polygon/brush`（删 editli/editma/roi，迁移期 Editor/StatusBar 同步）；`toolOptions: { brush: {mode, class_id, radius}, voi: {ww, wl} }` + setter；`switchModality` 复位 tool 与 toolOptions；`annotations: Annotation[]` + 增删改 action。
- `annotation/bridge.ts`：**唯一**的编辑回流桥——`postAnnotation`/`patchAnnotation`/`removeAnnotation` 内置 editSeqRef 序号守卫、409/网络失败 Notice + 回滚；三个查看器一律经它，不允许再各自复制。
- `viewer/csTools.ts`：tools 包一次性 init（`addTool` 各工具 + segmentation 模块初始化），ToolGroup 工厂；`activateTool(vpEl, tool)` 把 `store.tool` 映射为 ToolGroup active 态（bridge 的一部分）。
- 测试：`annotation/bridge.test.ts`（序号守卫、409 回滚、过期响应丢弃——toolBridge.test.ts 范式）。

### T4 · ViewerChrome 统一外壳（SDD §7.1 / §6.3）——✅ 已完成（2026-08-17，v1.2）

- `components/ViewerChrome.tsx`：统一工具栏（`.etools` 现有样式族）+ 工具选项条（brush mode/class/radius、polygon 提示）+ 信息条 + CT 窗位预设条（预设表移入注册表/i18n）；全部 `useI18n`，无内联样式。
- Editor：Viewer 外挂载 chrome；`onTool` 的 reset 拦截保留。
- StatusBar：删 `TOOL_LABEL/TOOL_GLYPH`，改查当前 task 的 `tv.tools`。
- i18n：`tool_*` / `chrome_*` 键中英齐备（含原 CT 私有 UI 的"画笔/擦/画/腹部/纵隔/肺/骨"）。
- 样式：`global.css` 追加 `.chrome-*`（复用 `etool` 变量）。

### T5 · CornerstoneViewer 迁移（raster_2d，SDD §6.2 / §6.3 / D-12 / D-14）——✅ 已完成（2026-08-17，v1.2）

- 启用 `csTools` ToolGroup：cursor(Pan/Zoom)、bbox(RectangleROI)、polygon(PlanarFreehandROI)、brush(segmentation Brush)；手写 overlay 画布退役。
- 任务结果渲染层：LI/MA 壁线与颅骨椭圆转 CS3D 只读标注渲染（passive 态，不可交互）或保留轻量绘制层——取工作量小者，实现时记录决策。
- IMT 形变手柄：自定义 BaseTool（继承 tools 框架），挂在 polygon 工具的"选中壁线"态上；拖拽形变 → 走既有 `/task` 壁线编辑端点（D-14）+ editSeqRef（经 bridge 复用）。
- bbox/polygon 自由标注事件 → bridge 落 `/annotations`。
- 2D brush：segmentation labelmap 宿主（D-9），提交导出 PNG → `/annotations`（kind=mask）。
- 测量口径回归：同一图像同一形变 IMT_mean 与旧实现偏差 ≤ 1e-6 mm（手测脚本或测试快照）。

### T6 · VolumeViewer 迁移（volume_3d，SDD §6.2 / §7.4 / D-13）——✅ 已完成（2026-08-17，v1.2）

- 交互层换 CS3D：brush（BrushTool + Scissors）、z 滚动（StackScrollMouseWheelTool）、拖拽调窗（WindowLevelTool）；本地 `brushOn/brushMode/brushClass/radius/ww/wl` 全迁 store.toolOptions；私有工具条/`_voiBarStyle` 删除，选项进 ViewerChrome。
- brush 提交：CS3D segmentation 笔迹 → 既有 `api.volumeMaskEdit`（base_seq 不变）；labelmap 叠色渲染尽量换 CS3D segmentation 原生渲染，换不动则保留现有叠色 canvas（记录决策）。
- 逐切片 bbox/polygon：当前 z 的标注经 bridge 落 `/annotations`（带 z）；切 z 时按 z 过滤渲染。
- 图例/z 计数信息条并入 ViewerChrome。

### T7 · WsiViewer 迁移（wsi，SDD §6.2 / §6.3 / D-10）——✅ 已完成（2026-08-17，v1.2）

- 引入 `@annotorious/openseadragon`：bbox/polygon 绘制与顶点编辑；W3C 标注 ↔ Annotation 契约映射函数（前端，D-10）。
- 创建事件 → bridge 落 `/annotations`；后端 `on_commit` 触发核检测后走既有 Detection 回流；删除旧 `tool==="roi"` overlay 拦截逻辑与 `MIN_ROI` 前端判断（后端 422 兜底 + Notice）。
- 核质心 overlay 与复现验证按钮保留（验证按钮并入 chrome 信息区，走 i18n）。

### T8 · frontend 测试——✅ 已完成（2026-08-17，v1.2）

- `store/annotationTools.test.ts`：tool/toolOptions 设置、`switchModality` 复位无泄漏（三模态轮转）。
- `annotation/bridge.test.ts`（T3 已建）补 409 + mask 路径。
- `components/ViewerChrome.test.tsx`：引擎能力位过滤（wsi 无 brush 按钮）、i18n 键存在性。
- W3C 映射纯函数单测（WsiViewer 迁移包内）。

### T9 · 收尾

- SDD §15 逐项自查，出"已完成 / 未完成 / 无法验证"清单；SDD 04 → `implemented`。
- `docs/architecture.zh-CN.md` 补 annotations 模块；`docs/runbooks/` 加 `annotation-toolbox.md`（工具用法、`GLAUX_ANNOTATIONS_ROOT`、存储布局）。
- 旧代码清点：确认 `editli/editma/roi` 字样、`TOOL_LABEL`、三处内联工具条样式全部消失（grep 为证）。

## 4. SDD §15 验收映射

| 验收项 | 验证方式 |
| --- | --- |
| 三引擎 bbox/polygon（+brush）可画可编辑，刷新仍在 | T5/T6/T7 浏览器走查 + T2 API 读回测试 |
| 统一工具栏，无内联浮动条/硬编码中文 | T9 grep + T8 chrome 测试 + 双语切换走查 |
| CT brush 经 store 生效、私有工具条删除、StatusBar 查表 | T6/T4 代码评审 + 走查 |
| WSI bbox 落库且触发检测，行为与旧 ROI 一致，过小仍提示 | T2 on_commit 测试 + 走查对比 |
| IMT 口径不回退（≤1e-6 mm） | T5 回归脚本/快照 |
| 409 并发不落写 + 前端丢弃过期 | T2 store 测试 + T3 bridge 测试 |
| 422 越界几何 + 草稿移除 | T2 测试 + T3 bridge 测试 |
| switchModality 复位无泄漏 | T8 store 测试 |
| editSeqRef 范式仅一份 | T9 grep（`editSeqRef` 仅现于 bridge） |
| 钩子失败标注仍落库 + 提示 | T2 on_commit 失败测试 + 走查 |
| 2D mask 落库且重载一致 | T2 测试 + T5 走查 |

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| CS3D tools 在自定义 `web:` loader（无 DICOM、spacing=1）上行为异常 | **已消解（2026-08-16 spike）**：RectangleROI 建标注（含 handles）、PlanarFreehand 闭合轮廓（1114 点）与顶点编辑均在 `web:` loader StackViewport 上验证通过 |
| `@annotorious/openseadragon` 与 OSD 4.1.1 不兼容 | **已消解（声明层）（2026-08-16 spike）**：v3.8.9 peer `>= ^4.0.0 \|\| ^5 \|\| ^6`，OSD viewer + annotator 初始化成功；残留项：pixi WebGL 层需 eval，受控浏览器 CSP 沙箱下 `createAnnotation` 报 unsafe-eval（本仓无 CSP，真实浏览器不复现）——已引 `@pixi/unsafe-eval@7` 保险，T7 验收走查需真实浏览器复核 |
| StackViewport labelmap 宿主（D-9）不通 | **部分验证（2026-08-16 spike）**：`data:{}` 与派生 imageIds 两路 BrushTool 均未画入体素（3.33.5 stack labelmap 需预建每帧派生 imageId，且有 `isReferenceViewable` 引用校验）；API 面已摸清（`activeSegmentation`/`convertStackToVolumeLabelmap`/`getLabelmapImageIds`）——T5 专项处理；不通则退化自持 mask 缓冲（脑暴 Q2 备选），先改 SDD D-9 再实现 |
| **spike 新发现的实现注意项** | ① cornerstone-tools 监听 **MouseEvent**（mousedown/mousemove/mouseup/dblclick），不是 PointerEvent——桥/测试的事件模拟用 MouseEvent；② 3.33.5 是 `ToolGroupManager.createToolGroup`（非 `ToolGroup.createToolGroup`），id 重复返回 undefined 需防御；③ StrictMode 双挂载会重复建 ToolGroup/RenderingEngine，组件卸载需 destroy；④ pixi 需 eval → `@pixi/unsafe-eval@7` 为 T7 必需依赖（已入 spike 分支 package.json） |
| VolumeViewer 迁移面最大（labelmap 叠色 + 笔迹 + 相机全自写） | T6 允许分两步提交：先换工具与状态，叠色渲染保留 canvas 后补；每步单独可验证 |
| PlanarFreehand 顶点精度不满足医学微调 | D-8 已留 Spline 并存后手；本期不阻塞 |
| IMT 形变手柄自定义 BaseTool 与 CS3D 事件模型磨合 | 手柄逻辑（高斯形变数学）从现有代码平移，仅外壳换框架；T5 口径回归兜底 |
| 2D brush PNG 导出与后端 mask 解释不一致 | 复用 CT `_maskToPng` 的白底语义（convert("L")→bool 已验证），T2 测试覆盖 |
| i18n/样式回归波及 Focus/Workbench 双模式 | chrome 只挂在 Editor 内；双模式各走查一遍（T9） |

## 变更记录

- **2026-08-16**：v1，依据 `ready` SDD 04（含 D-14）制定；T0 列四项开工前核实，任一不通先回 SDD。
- **2026-08-17**：v1.2，T1–T8 全部完成（science-core 24 过 / backend test_api 19 + annotations 11 过 / frontend 62 过）。新增实施决策回写 SDD：D-15（brush 宿主退化为自持缓冲，spike3 未打通的正式处置）、D-16（IMT polygon 专属壁线编辑）。逐切片标注用 imageId `#z=` 后缀天然隔离（csAnno niftiTarget）。浏览器走查因自动化浏览器渲染进程冻结受阻，待人工恢复后按 SDD §15 逐项验收；SpikePage/ProbePage 与 `GLAUX_BACKEND_PORT` 探针入口合入前清理。
- **2026-08-16**：v1.1，T0 spike 完成（worktree `open-glaux-annobox-spike`，分支 `feat/annotation-toolbox-spike`，自包含验证页 `frontend/src/spike/SpikePage.tsx`，合成指针事件自动化跑）：Spike 1/2 通过（bbox/freehand/顶点编辑在 `web:` loader 上全部可用）；Spike 3 stack labelmap 宿主未通（转 T5 专项，退化方案已备）；Spike 4 声明层兼容、运行时待真实浏览器复核（pixi eval 为受控浏览器 CSP 假象）。新增四项实现注意项（MouseEvent/ToolGroupManager/StrictMode/@pixi/unsafe-eval）回写 §5；依赖新增 `@annotorious/openseadragon@3.8.9` 与 `@pixi/unsafe-eval@7`。
