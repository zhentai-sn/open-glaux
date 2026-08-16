# 统一图像标注工具箱（bbox / polygon / brush）

> **用途**：脑暴 / 需求文档——消灭图像编辑区的工具碎片化，建立跨模态统一的通用标注能力。
> **日期**：2026-08-16 · **状态**：`review` · **去向**：→ Feature SDD（新立，与 [SDD 02 智能体图像标注](../sdd/feats/02-agent-image-annotation/README.md) 互补）
> **半衰期**：进入 SDD 后冻结（`promoted`），以 SDD 为准。

## 1. 背景与问题

### 1.1 编辑区工具碎片化（现状盘点）

项目已有一轮统一：[Editor](../../frontend/src/components/Editor.tsx) 的 `.etools` 工具栏由任务注册表（`GET /tasks`）驱动，[Viewer](../../frontend/src/components/Viewer.tsx) 按 `viewer` 字符串分派引擎。但三个查看器内部各长了一套私有编辑工具，碎片化集中在五点：

1. **CT 双工具栏并存，共享栏是死控件**：注册表给 CT 声明 `brush`，Editor 渲染出"画笔"按钮，但 `"brush"` 不在 store 的 `Tool` 联合类型里（靠 `as Tool` 强转）；`VolumeViewer` 完全不读 `store.tool`，用本地 `brushOn` state + 私有浮动工具条。
2. **工具状态分裂**：2D（CornerstoneViewer / WsiViewer）消费 `store.tool`；3D（VolumeViewer）的 brushOn/brushMode/brushClass/radius/ww/wl 全是组件本地 `useState`。StatusBar 的 `TOOL_LABEL/TOOL_GLYPH` 硬编码 5 个 id，不认识 brush。
3. **各查看器自带浮动 chrome**：内联样式 + 硬编码颜色（`#6a3fb0`、`#4FB0FF`、`rgba(60,60,70,.9)`），不走项目 CSS 变量主题。
4. **i18n 失效**：浮动 UI 全部硬编码中文（"画笔 ✓""擦/画""腹部/纵隔/肺/骨""复现验证"），共享层却走 `useI18n` 双语。
5. **编辑链路三处复制**："工具切换→光标→提示→服务端回流→回滚→Notice"范式在三个查看器各写一遍（editSeqRef 守卫 + 失败回滚）。

### 1.2 通用标注能力缺失

对照经典 CV 标注工具箱（bbox / polygon / point / mask brush / 智能辅助）：

| 能力 | 契约层 | 交互层 |
| --- | --- | --- |
| bounding box | ❌ 无原语（WSI ROI 框只是任务输入，用完即弃） | ❌ |
| polygon | ⚠️ `polyline(closed)` 契约就绪，无任务产出/编辑 | ❌ 无逐点绘制、无顶点增删 |
| 2D mask brush | ⚠️ `mask` 契约是占位（"编码延后落地"） | ❌（画笔只有 3D labelmap 版） |
| polyline 编辑 | ✅ | ⚠️ 仅 IMT 高斯形变手柄，不能加点删点从零画 |
| 3D labelmap brush | ✅ | ✅（但私有实现，绕过共享工具栏） |

根因是项目的"模型优先"取向（跑模型→修正结果），通用人工标注一直缺位。它同时是 [SDD 02](../sdd/feats/02-agent-image-annotation/README.md) 的缺失前提——该 SDD 声明 agent 建议态标注 accept 后"归影像标注既有逻辑"，而这个"既有逻辑"目前不存在。

## 2. 目标

建立一套**跨模态统一**的标注工具箱：

- 工具语义（tool id + options）与工具状态全部进 store，注册表驱动；
- bbox / polygon / brush 三个通用标注工具覆盖**全部模态**（raster_2d / volume_3d 逐切片 / wsi）；
- 标注产物带后端持久化（SQLite + base_seq 乐观并发）；
- 现有任务专属工具**统一替换**为通用工具（IMT 手柄 → 通用折线编辑、WSI ROI → bbox、CT 私有画笔 → 通用 brush）；
- 为 SDD 02（agent 建议态标注）留好数据与端点接缝。

**实现路线已拍板：路线 A「统一工具框架」**——工具语义/状态/交互全部进 store + 注册表，查看器只留画布，任务工具改造为通用工具。备选路线 B（独立标注层并存）被否：碎片化会变本加厉。

## 3. 已拍板决策

| 编号 | 决策 | 备注 |
| --- | --- | --- |
| D-1 | 标注产物**含后端持久化**（SQLite + base_seq），不做纯会话态 | |
| D-2 | **全部模态覆盖**：raster_2d / volume_3d（逐切片）/ wsi | 2D/3D 交互形态可以不同，工具语义统一 |
| D-3 | 任务专属工具**统一替换**（非共存） | WSI ROI→bbox、CT 画笔→brush、IMT 手柄→通用折线编辑（保留形变交互作为自定义工具） |
| D-4 | 路线 A：统一工具框架 | 见 §2 |
| D-5 | **复用 `@cornerstonejs/tools`（已在依赖中，未使用）** | 见 §5 依赖选型；落实纲领「复用优先」纪律 |
| D-6 | WSI 标注走 **Annotorious OpenSeadragon 插件** | 见 §5 |
| D-7 | 存储选 **SQLite 单文件**（非 JSON sidecar） | 见 §7.1 |

## 4. 数据契约

### 4.1 原语层（science-core `contracts.py` 与前端 `api/types.ts` 镜像）

| 原语 | 变化 | 说明 |
| --- | --- | --- |
| `bbox` | **新增** | `{kind:"bbox", id, role, x0, y0, x1, y1}`，像素坐标 |
| `polyline` | 复用 | `closed=true` 即多边形；补齐顶点增删编辑语义 |
| `mask` | **落地** | 2D 栅格掩膜从占位转正：PNG/RLE 引用，对齐 CT `mask_png_ref` 传输格式 |
| `volume_mask` | 复用 | CT 逐切片 brush 仍写 labelmap（已有闭环），契约不动 |
| `point_set` | 不动 | 本期不做点标注编辑 |

### 4.2 标注实体（新增 `Annotation`）

标注 = 一条几何原语 + 元数据，与任务模型结果（Detection）**分离**：

```
Annotation {
  id, image_id,          // 挂在哪个对象：超声图 / volume / slide
  z?,                    // CT 逐切片标注的层号（2D/WSI 为 null）
  primitive,             // bbox | polyline(closed) | mask
  label/class_id,        // 语义标签 + 可选类别（颜色走 ClassSpec）
  status,                // draft | confirmed（为 SDD 02 预留 suggested 态）
  source,                // manual | model | agent
  seq                    // 乐观并发序号（base_seq 范式）
}
```

关键边界：

- 任务结果（LI/MA 壁线、颅骨椭圆、labelmap、核质心）仍归 Detection 管线，**不是**标注；
- `status` / `source` 为 SDD 02 预留接缝——agent 建议态标注 accept 后即为 `confirmed + source=agent`。

## 5. 依赖选型（复用优先，不重复造轮子）

**前置发现**：`@cornerstonejs/tools@3.33.5` 已在 `frontend/package.json` 依赖中，与 core 同版本，但代码中完全未使用——三个查看器全是手写 canvas overlay。

| 候选 | 结论 |
| --- | --- |
| **`@cornerstonejs/tools`** ✅ 采用 | 官方标注/分割工具库：`RectangleROITool`（bbox）、`PlanarFreehandROITool`/`SplineROITool`（polygon）、`BrushTool` + Scissors 系（labelmap 编辑）、`PanTool`/`ZoomTool`/`StackScrollMouseWheelTool`/`WindowLevelTool`（相机与调窗）。ToolGroup 按视口激活 + active/passive/enabled/disabled 四态，天然是"统一工具框架"的形态；标注存物理坐标空间、SVG 渲染、事件流可桥接。注：CornerstoneViewer 旧注释"不用 CS3D 标注工具"仅指其**测量输出**（与 `/task/measure` 权威口径打架），几何标注不受影响——测量仍走自有管线 |
| **Annotorious（`@annotorious/openseadragon`）** ✅ 采用（WSI） | BSD-3，活跃维护，被 EXACT 等病理标注平台采用；rectangle/polygon/ellipse 绘制+顶点编辑，W3C WebAnnotation 数据模型 + 事件 API；需一层到 Glaux Annotation 契约的映射 |
| Label Studio / CVAT | ❌ 排除：整套标注平台（独立服务+账号体系），非可嵌入库，与注册表驱动 + agent 原生架构冲突 |
| OHIF Viewer | ❌ 排除：完整阅片器框架，引入等于交出前端架构主权 |
| IMT 高斯形变手柄 | ⚠️ 无现成对应物：基于 CS3D `BaseTool` 框架写自定义工具（扩展框架，不算造轮子） |

## 6. 统一工具框架

### 6.1 工具语义层（store 单一真相源）

`Tool` 类型扩为统一集合：

| 工具 id | 语义 | 替代 |
| --- | --- | --- |
| `cursor` | 选择 / 平移 | 不变 |
| `bbox` | 框绘制 + 缩放/移动 | 吸收 WSI `roi` |
| `polygon` | 逐点绘制 + 顶点增删改 + 闭合 | 吸收 IMT `editli/editma`（升级为通用折线/多边形编辑） |
| `brush` | 画笔 paint/erase | 吸收 CT 私有画笔并下放到 2D |
| `reset` | 重跑活动模型 | 不变，Editor 统一拦截 |

新增 `toolOptions` 进 session store（随 `switchModality` 统一复位）：`brush: {mode, class_id, radius}`、`polygon: {drawing}`、`voi: {ww, wl}`。VolumeViewer 本地 state 全部迁入，私有工具条删除。

### 6.2 工具声明层（注册表两级化）

`TaskPlugin.tools` 保持"任务推荐工具"；新增**引擎级能力声明**：

```
raster_2d: cursor/bbox/polygon/brush + 能力位 { zoom: wheel }
volume_3d: cursor/bbox/polygon/brush + 能力位 { z_scroll: wheel, voi: true }
wsi:       cursor/bbox/polygon       + 能力位 { deep_zoom: true }   # brush 无服务端落点，禁用
```

工具栏显示 = 引擎能力 ∩ 任务推荐。CT 窗位预设（腹部/纵隔/肺/骨）移入注册表或 i18n，不再硬编码。

### 6.3 渲染层（ViewerChrome 统一外壳）

- 查看器只留画布 + 指针交互；工具条、笔刷选项、WW/WL、z 指示、信息条由统一 chrome 渲染，全走主题 CSS class（`etool` 一族）+ `useI18n`；
- StatusBar 删硬编码 `TOOL_LABEL/TOOL_GLYPH`，改从当前 task 注册表 tools 取。

### 6.4 Glaux 侧只写"桥"，不写交互

启用 `@cornerstonejs/tools` 后，前端工作量收敛为：

1. `store.tool` ↔ CS3D ToolGroup 激活态的桥；
2. CS3D 标注事件 → Annotation 契约 → 后端回流的桥（editSeqRef / base_seq 范式保留）；
3. IMT 高斯形变手柄一个自定义 BaseTool；
4. WSI：Annotorious 初始化 + W3C 格式 ↔ Annotation 契约映射（核质心 overlay 保留自绘——只读展示，非标注）。

## 7. 三引擎交互与任务工具替换映射

### 7.1 引擎 → 工具实现

| 引擎 | bbox | polygon | brush | 相机/导航 |
| --- | --- | --- | --- | --- |
| raster_2d | CS3D `RectangleROITool` | CS3D `PlanarFreehandROITool` | CS3D `BrushTool` + labelmap | CS3D Pan/Zoom/WL；手写 overlay 退役，模型结果转 CS3D 只读渲染层 |
| volume_3d | 同上（当前 z 切片） | 同上 | 同上直接编辑 labelmap | + `StackScrollMouseWheelTool` 切 z、`WindowLevelTool` 拖拽调窗（预设按钮保留） |
| wsi | Annotorious rectangle | Annotorious polygon | 本期禁用（无服务端落点） | OSD 原生 pan/zoom |

### 7.2 任务工具替换（D-3）

| 现有 | 替换为 | 行为保持 |
| --- | --- | --- |
| IMT `editli/editma` 高斯手柄 | CS3D 自定义 BaseTool | 拖手柄形变壁线交互不变，另获通用折线顶点增删 |
| IMT 壁线编辑回流 | 不变 | 仍走 `/task/measure` 重算 + editSeqRef |
| WSI `roi` 框选 | 通用 `bbox` | 松开后按注册表 `on_commit` 触发核检测；框本身作为 bbox 标注持久化（双语义） |
| CT 私有画笔 | 通用 `brush`（CS3D） | 提交仍走 `POST /volume/{id}/mask-edit` + base_seq，只换 UI/交互 |

### 7.3 关键语义约定

- **画完即提交**：bbox/polygon/brush 产物一律先成 `draft` 标注写后端，不打断用户；任务联动（如框完跑检测）由注册表 `on_commit` 钩子声明，不硬编码；
- **模型结果 ≠ 标注**：跑模型产物走 Detection 管线渲染，不进 annotation 表；"转为标注"动作本期不做，留接缝；
- **reset 语义不变**：重跑活动模型只影响 Detection，不清标注。

## 8. 后端 API 与存储

### 8.1 存储（D-7）

SQLite 单文件 `<ANNOTATIONS_ROOT>/annotations.sqlite`（stdlib `sqlite3`，agent-runtime 侧已有 SQLite 先例）。mask 栅格数据不进表，落 PNG 文件 + 表内存 ref。备选 JSON sidecar 被否：并发写与全量查询需自行加锁扫描。

### 8.2 REST API（新 router `annotations`）

```
GET    /annotations?image_id=...[&z=..]    列出某对象的标注
POST   /annotations                         创建（服务端分配 id + seq=1）
PATCH  /annotations/{id}                    更新几何/标签，携带 base_seq；不匹配 → 409
DELETE /annotations/{id}                    删除，携带 base_seq
```

- 乐观并发沿用 CT mask-edit 的 `base_seq` 范式（前端 editSeqRef 序号守卫 + 409 → Notice + 回滚）；
- 错误走 Atlas 验证过的"领域错误带 code → HTTP 映射"（`NOT_FOUND` / `CONFLICT` / `INVALID_GEOMETRY`）；
- 几何 payload 按 §4.2 契约原样序列化，后端校验坐标不越出图像 dims。

### 8.3 任务联动钩子

`TaskPlugin` 新增可选声明（后端在创建成功后派发，复用 `_detect_for_spec`）：

```python
on_commit={"bbox": {"action": "run_task"}}   # WSI：bbox 落库后触发核检测
```

语义在后端是单一事实源——agent 将来走同一端点自动获得相同行为（SDD 02 接缝）。

### 8.4 明确不动

- CT labelmap 编辑端点（`POST /volume/{id}/mask-edit`）不重写；
- Detection 管线（`/task/run`、`/task/measure`）零改动。

## 9. 与 SDD 02 的关系

互补不冲突：SDD 02 是 agent 侧"自然语言 → 建议态标注"的**产出流**；本需求是人侧"手动绘制/编辑"的**基础能力**。SDD 02 §11 声明"accepted 后归影像标注既有逻辑"——本需求的 Annotation 契约 + 端点正是那块缺失的"既有逻辑"。SDD 02 的 `suggested` 态映射为本契约 `status=suggested`（预留态），accept 即转 `confirmed`。

## 10. 非目标

- 点标注（point）手动编辑；
- 智能辅助标注（SAM 点击式）——归 SDD 02 精度层；
- WSI 上的 brush 编辑（无服务端落点）；
- 3D 跨切片传播（SAM2 memory 式）；
- 标注导出（COCO/LabelMe）、版本管理、多人协作审阅流；
- "模型结果转标注"动作（留接缝，不做 UI）。

## 11. 验收标准（概览）

- [ ] 三个引擎的 bbox/polygon（volume_3d 另含 brush）可绘制、可编辑（移动/缩放/顶点增删）、刷新后仍在（持久化）；
- [ ] 全部工具 UI 走统一工具栏（`.etool` 主题 + i18n 双语），查看器内无残留私有浮动工具条；
- [ ] CT 的 `store.tool === "brush"` 生效，无双工具栏；StatusBar 工具显示随注册表，无硬编码表；
- [ ] WSI 用 bbox 框选：框落库为标注，同时触发核检测（on_commit），行为与旧 ROI 工具一致；
- [ ] IMT 壁线编辑经统一框架完成，测量口径（`/task/measure`）与旧实现一致；
- [ ] 并发编辑触发 409 时：Notice 提示 + 前端回滚，不静默覆盖；
- [ ] `switchModality` 后 toolOptions 复位，无跨模态状态泄漏；
- [ ] 前端代码中不再有三份 editSeqRef/回滚范式的复制（收敛到共享桥）。

## 12. 开放问题（留给 SDD）

- Q1：CS3D `PlanarFreehandROITool` 顶点交互是否满足医学标注精度要求，还是需换 `SplineROITool` 或自定义；
- Q2：2D brush 的 labelmap 在前端的宿主——CS3D segmentation 模块 vs 自持 mask 缓冲（影响与后端 mask 同步策略）；
- Q3：Annotorious W3C 格式与 Annotation 契约的映射层放前端还是后端；
- Q4：`ANNOTATIONS_ROOT` 的位置与 `GLAUX_` 环境变量命名（对齐 config.py 现有路径装配惯例）；
- Q5：标注与 Atlas/记忆层的联动（已验证标注是否沉淀为领域记忆）——远期，本期只留 source/status 字段。
