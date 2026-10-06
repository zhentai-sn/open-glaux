---
kind: record
status: active
---

# SDD 23 标注标签与管理 · 实施计划

依据：[SDD 23](../sdd/feats/23-annotation-labels/README.md) §7、§9、§15、D-1～D-9。

## 现状要点

- **标注库**：`backend/app/annotations/store.py`，SQLite，`PRAGMA user_version` 记版本（当前 `SCHEMA_VERSION = 1`），打开时单事务升级；已有 `label`（自由文本）与 `class_id`（无外键）列，无 `label_id`。
- **标注接口**：`backend/app/routers/annotations.py` 的 GET / POST / PATCH / DELETE 与掩膜读取；无汇总、无度量。
- **作用域**：`resolve_object(object_id)` 返回 `ObjectRef.datasource`，其 `project_id` 为空即未归属（SDD 13）。
- **度量依据**：`ObjectMeta.axes` 的 `x`、`y` 带 `spacing` 与 `unit`（WSI 为 `um`，CT 为 `mm`，部分 2D 为 `mm`）。
- **叠加图例**：`backend/app/frame_overlay.py` 的 `legend` 直接取行内 `label`。
- **前端绘制**：`frontend/src/annotation/csAnno.ts` 的 `onCompleted` 与 `frontend/src/viewer/PyramidViewer.tsx` 落库时不带标签；建议态样式在 `applySuggestionStyle`；Cornerstone 文字框经 `HIDE_TEXT_BOX` 关闭（`frontend/src/viewer/csTools.ts`）。
- **浏览器列**：`focusLayout.browserView` 取值 `"files" | null`，活动栏入口在 `frontend/src/components/focus/SessionRail.tsx`。
- **建议确认**：`frontend/src/components/agent/SuggestionCard.tsx` 的 `resolveSuggestion`。
- **智能体**：`propose_annotation`、`revise_annotation` 已有 `label` 参数；工具按插件登记（`agent-runtime/src/plugins/annotation.ts`），中英文定义（SDD 20）。

## 波次

| 波次 | 内容 | 依赖 | 波末状态 |
| --- | --- | --- | --- |
| W1 | backend：库结构 v2、标签目录端点、`label_id` 读写、度量、汇总、图例取目录名 | — | backend 测试、ruff 通过 |
| W2 | runtime：`list_annotations`、建议结果提示目录、提示词 | W1 | runtime 测试、lint 通过 |
| W3 | 前端数据与绘制：接口与类型、目录与当前标签状态、标签弹层、画完打标签、按标签着色与显示名称、工具条选择器 | W1 | 前端测试、lint 通过 |
| W4 | 前端面板：活动栏入口、标注分区、标签分区、建议确认选标签 | W3 | 前端测试、lint 通过 |
| W5 | 活文档、浏览器走查、真实模型走查、§15 自查 | W1～W4 | SDD 23 转 `implemented` |

W2 与 W3 可并行。

## W1 · backend

### 库结构 v2（`app/annotations/store.py`）

- `SCHEMA_VERSION = 2`；新增 `_MIGRATE_V1_V2`：
  - `CREATE TABLE labels (id TEXT PRIMARY KEY, scope TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL, color TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL, seq INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(scope, name_key))`；`name_key` 为去首尾空白后的 `casefold()`。
  - `ALTER TABLE annotations ADD COLUMN label_id TEXT`；`CREATE INDEX idx_annotations_label ON annotations(label_id)`。
- 新建库直接建 v2 结构；v0 库依次执行 v0→v1、v1→v2。
- 标签方法：`list_labels(scope)`（含引用计数）、`create_label`、`update_label`（`base_seq`）、`delete_label`（有非驳回引用时抛冲突并带条数）、`merge_label(src, into)`（同一事务：改引用、删源；跨作用域拒绝）。
- 预设色板 12 色，按目录现有条数轮换取色。
- 标注 `create` / `update` 接受 `label_id`；写入时把目录名称写入 `label`（§7.2 规则 6）。
- 读取：`LEFT JOIN labels`，有 `label_id` 时以目录名称覆盖 `label`，并附 `label_color`。

### 作用域（`app/annotations/scope.py`，新）

- `scope_of(object_id) -> str`：`resolve_object(...).datasource.project_id or "global"`；对象不存在抛 `LookupError`（404）。
- 写标注时校验 `label_id` 所属作用域等于 `scope_of(image_id)`，否则 422。

### 自动关联（`routers/annotations.py`）

- POST / PATCH 只带 `label` 文本、不带 `label_id` 时，按作用域内 `name_key` 精确匹配目录；命中则写入 `label_id`。人工绘制始终显式带 `label_id`，此规则实际服务于智能体（§7.5 规则 1），匹配集中在 backend 一处。

### 度量（`app/annotations/measure.py`，新）

- `measure(row, axes, masks_root) -> dict | None`：框、多边形（鞋带公式）、掩膜（非零像素数，读 `masks/<id>.png`）；点返回 `None`。
- 换算：`x`、`y` 轴 `spacing` 都有且 `unit` 相同 → 面积乘 `sx·sy`，周长逐边按 `hypot(dx·sx, dy·sy)`；否则 `px`。
- 掩膜面积按 `(id, seq)` 缓存，避免重复解码。
- `GET /annotations` 每行附 `measures`；掩膜文件缺失时 `measures` 为 `null`。

### 端点

- `app/routers/labels.py`（新）：`GET /labels?object_id=`、`POST /labels`、`PATCH /labels/{id}`、`DELETE /labels/{id}?base_seq=`、`POST /labels/{id}/merge`；在 `main.py` 注册。
- `GET /annotations/summary?image_id=&index_from=&index_to=`：§7.4 分组（目录标签、未入目录按文本分组、未打标签），草稿与已确认计入条数与面积，建议单列，驳回不计。

### 叠加图例

- `app/routers/objects.py` 的 `_overlay` 改用带目录名称的读取结果，图例标签随改名更新（SDD 22 §9.1 不变）。

### 测试

- `tests/test_labels.py`：作用域隔离、名称判重不区分大小写、改名后标注读取取新名、有引用删除 409、合并、跨作用域合并 422、`base_seq` 冲突。
- `tests/test_annotation_measure.py`：框、凹多边形、掩膜面积与周长；WSI（`um`）、CT（`mm`）、无标定（`px`）。
- `tests/test_annotations.py` 增补：`label_id` 校验 422、文本自动关联、汇总分组与层过滤、v1→v2 迁移保留旧数据。

## W2 · runtime

- `src/pi/tools/list-annotations.ts`（新）：参数 `scope`（`current` | `all`）；调 `GET /labels?object_id=`、`GET /annotations/summary`、`GET /annotations`；文字输出目录、按标签汇总（注明面积不做并集）、标注列表（最多 200 条，超出给总数）；`details.kind = "glaux.annotations_listed"` 只用于轨迹，不渲染卡片。
- `propose-annotation.ts`、`revise-annotation.ts`：写入后若返回行无 `label_id` 且带了 `label`，结果文字追加「不在目录中」与目录名称（最多 50 个）；目录为空时说明目录为空，由用户确认时决定。
- `src/plugins/annotation.ts`：登记 `list_annotations`（effect `read`，需焦点，`projectScoped` 同 `propose_annotation`）；提示词按 §7.5 规则 6（中英文）。
- 测试：`tests/integration/list-annotations.test.ts`（输出格式、`current` 与 `all`、截断、无焦点不挂载）；建议命中与未命中目录的结果文字；插件登记表与提示词语言快照更新。

## W3 · 前端数据与绘制

- `src/api/types.ts`：`Label`、`AnnotationMeasures`、`AnnotationSummary`；`Annotation` 增 `label_id`、`label_color`、`measures`。
- `src/api/client.ts`：标签目录与汇总接口。
- `src/store/labels.ts`（新）：按作用域缓存目录；`currentLabelId` 按作用域记忆，切到另一作用域清空；目录写操作后刷新目录与当前对象标注。
- 标签弹层 `src/components/annotations/LabelPicker.tsx`（新）：搜索、键盘上下选择、回车确认、新建（名称 + 自动颜色）、Esc 取消；新建遇 409 直接选用已有项。
- 绘制流程：
  - `csAnno.ts` `onCompleted` 与 `PyramidViewer.tsx` 落库前取 `currentLabelId`；为空则弹出 `LabelPicker`，取消时移除临时形状不落库。
  - 二维画笔落库（`maskSinks.ts` 的 `annotationMaskSink`）同样带 `label_id`。
- 着色与名称：
  - `csAnno.ts`：样式按 `label_color`，建议态保留虚线，未打标签为灰色；几何或标签变化都触发重刷。
  - 标签名：Cornerstone 侧用叠加层在标注外接框左上绘制文字（不启用工具自带统计文字框）；`PyramidViewer.tsx` 在 SVG 中加 `<text>`。
  - 工具条「显示标签名」开关，存 `toolOptions`。
- 工具条：`src/viewer/chromeSegments.tsx` 新增当前标签选择段，框、多边形、二维画笔激活时显示。
- 测试：`LabelPicker` 组件测试；绘制后有无当前标签两条路径；着色随标签与状态变化；作用域切换清空当前标签。

## W4 · 前端面板

- `focusLayout.browserView` 增加 `"annotations"`；`SessionRail.tsx` 新增「标注」入口，语义与「文件」相同，二者互换。
- `src/components/annotations/AnnotationPanel.tsx`（新）：
  - 「标注」分区：汇总条（颜色、名称、条数、面积合计、建议数）+ 按标签分组列表（形状、状态、来源、面积）；体数据与视频的「当前层或帧 / 全部」切换。
  - 点击一行：查看器选中并居中，体数据与视频跳到对应层或帧。
  - 行内操作：改标签（`LabelPicker`）、删除、确认或驳回建议。
  - 「标签」分区：目录列表，新建、改名、改色、改说明、拖动排序、合并（选择目标）、删除（有引用时禁用并提示合并）。
- 数据来源：面板汇总调 `GET /annotations/summary`，列表用 store 中已带 `measures` 的标注；标注变化后刷新汇总。
- `SuggestionCard.tsx`：确认未入目录的建议时先弹 `LabelPicker`（预填文本），选定后 PATCH `label_id` 再确认。
- 单位格式：`src/annotation/units.ts`（新），`µm²` ≥ 10⁶ 换算为 `mm²`，三位有效数字。
- i18n：中英文新增键。
- 测试：面板分组与汇总、点击定位、删除被拒提示合并、建议确认选标签、单位格式。

## W5 · 活文档与验收

- 活文档：SDD 04（数据模型 `label_id`、工具条当前标签）、SDD 02（建议标签匹配目录、`list_annotations` 工具表行）、SDD 01（活动栏「标注」入口）、仓库骨架总览（端点与工具表）、操作手册（标签与面板用法）、根目录与 agent-runtime 的 CHANGELOG。
- 浏览器走查：普通图像与 WSI 各画框、多边形，验证打标签、着色、面板计数与面积（WSI 为 µm² 或 mm²）、改名、合并、删除被拒。
- 真实模型走查：在已有目录的 WSI 上请智能体标注并统计，核对 `list_annotations` 与面板一致；用目录外名称提建议，确认时选标签。
- §15 自查；SDD 23 转 `implemented`；本计划改为 `done`。

## 风险

| 风险 | 应对 |
| --- | --- |
| 用户已有标注库升级失败 | 单事务迁移，失败整体回滚；迁移测试覆盖 v0→v2 与 v1→v2 |
| 掩膜面积每次读取都解码 PNG | 按 `(id, seq)` 缓存；汇总只解码一次 |
| Cornerstone 内部文字框与自绘标签名冲突 | 保持 `HIDE_TEXT_BOX`，标签名走独立叠加层 |
| 文本自动关联误伤历史标注 | 只在写入时匹配；历史行不批量改写 |
| 弹层打断连续绘制 | 当前标签存在时不弹层；弹层支持纯键盘完成 |

## 实施偏差

（实施中记录与本计划不一致之处及原因。）
