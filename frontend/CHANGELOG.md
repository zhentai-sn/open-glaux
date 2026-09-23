# Frontend Changelog

本文件只记录 Frontend 独立发布；Glaux 整体发布见根目录 `CHANGELOG.md`。

## [Unreleased]

### Added

- 会话 store 新增唯一观测焦点 `focus`（`object_id` / `kind` / `index` / `region`，写入口 `setFocus` / `setIndex` / `setRegion`）与按模态分组的对象表 `objects`；派生选择器 `activeObject` / `objectsOf`（SDD 10 W3）。
- 数据动作收敛为 `loadObjects(modality, {open?})`、`openObject(id, modality?)`、`runTask(region?)`。
- 查看器按 `ObjectMeta.kind` 选引擎；无对应引擎的 kind 渲染「查看器引擎尚未接入：{kind}」空态。

### Changed

- `modality` 与 `activeModel` 初始为 `null`，不再写死颈动脉缺省；`setModels` 只取当前模态的活动模型，没有即 `null`。切模态时清空焦点、叠加、工具（回 `cursor`）与工具参数，并重选活动模型。
- 打开对象的自动运行规则为 `TaskView.trigger ?? "manual"`；无 `TaskView` 的模态（`natural_image`、`video`）不调 `/task/run`。`/task/run` 请求改发对象的 `calibration` 与 `region`，不再发 `cubs_cf` / `roi_box`。
- 查看器不再读 `TaskView.viewer`。
- 模态标签改由 `/datasources` 的 `label_key` → `label` → modality 原文取值，不再取自 `/tasks`。
- 文件树改为「对象」目录（`display_name`，为空取 `id`）与「方法」目录（`methods[]`，按 `role` 标 `gold` / `agent`）；工作区名取焦点对象所属数据源名。
- 导入面板的上传 `accept` 与预筛取 `/datasources[].importable` 并集，无数据源时只校验大小；文件夹导入的模态候选取 `object_kinds` 含 `volume` 或 `slide` 的任务。
- 「最近使用」持久化键升为 `glaux.recent.v2`，条目增 `kind`；首次读取时从 `glaux.recent.v1` 单向迁移（按冻结的 v1 模态表推断 `kind`，推断不出的条目丢弃）并删除 v1 键。
- Agent Viewer Context 新增 `collection`、`object`（`id` / `kind` / `axes` / `calibration`）与 `focus`；`image_id` / `modality` / `cubs_cf` / `roi_box` 作为过渡字段保留；无 `TaskView` 的对象不带 `task` / `method` / `cubs_cf`。
- Focus 空状态示例卡改为领域中性文案：「测量目标结构」「定位并标注目标」「先小批试跑核对」，以「对象」取代「图像」；舞台占位文案同改。
- 前端类型 `Modality` / `TaskType` 放宽为 `string`；`ObjectMeta.methods` 改为 `MethodRef[]`（`{name, role}`）。

### Removed

- **不兼容（0.x 破坏性变更）**：store 字段 `activeImage` / `activeVolume` / `activeSlide` / `wsiRoi`、对象列表 `images` / `naturalImages` / `volumes` / `slides` 与 `imageMeta` 删除，改读 `focus` / `objects`。
- **不兼容（0.x 破坏性变更）**：动作 `switchModality` / `loadImages` / `loadNaturalImages` / `selectImage` / `selectNaturalImage` / `selectVolume` / `selectSlide` / `runCurrentTask` / `runWsiTask` 删除，改用 `loadObjects` / `openObject` / `runTask`。
- 查看器的 `raster_2d` 兜底。
- 文件树中按数据集写死的目录（`images` / `slides` / `natural-images`、`LIMA-Profiles` / `ellipse-profiles` / `labelmaps` / `detections`、`CF`、`Folds`）。
- 前端 `ObjectMeta` 类型不再声明过渡字段 `cf` / `voxel_spacing_mm` / `mpp_um` / `dims`，读取即类型检查失败。

## [0.2.0] - 2026-08-31

### Added

- 文件栏空态与统一导入面板（拖拽/选择上传、服务端文件夹、加载示例数据），插件市场与文件栏共用同一组件。
- 「最近使用」列表，本地持久化，最多 10 条。
- Focus 右侧栏舞台常驻并与浏览器列左右分栏，新增第三条可拖拽分隔条；窄屏自动降级为整栏互斥。

### Changed

- 模态切换器可见性改由 `/datasources` 派生，标签仍取自 `/tasks`；窄容器下改纵向单列（阈值 = 候选数 × 120px）。
- 通用图像标签由「自然图像」改为中性的「通用图像 / General images」；不再作为常驻目录挂在每个医学模态下。
- `focusLayout` 的 `rightView` 三值枚举拆为 `browserView`（可为 `null`）与 `browserW`，旧值自动迁移，持久化键不变。

### Fixed

- 「最近使用」不再在启动期把尚未加载的对象误判为失效并永久剔除。
- 移除导入数据源时明示「不会删除磁盘上的文件」。
- IMT 壁线编辑从 `polygon` 拆为独立 `wall` 工具，修复多边形标注在 IMT 模态下画不出且静默无响应。
