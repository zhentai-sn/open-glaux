# 统一图像标注工具箱（Unified Annotation Toolbox）

## 0. 文档状态

| 字段 | 内容 |
| --- | --- |
| 状态 | `implemented` |
| 当前阶段 | 代码完成并与 SDD 对齐；浏览器走查验收待补（自动化浏览器渲染进程冻结，人工恢复后按 §15 逐项过） |
| 上位 SDD | [Glaux SDD 索引](../../README.md) |
| 承接需求 | [脑暴 20260816-02 · 统一图像标注工具箱](../../../brainstorms/20260816-02-unified-annotation-toolbox.zh-CN.md)（D-1～D-7 已拍板） |
| 负责人 | Glaux 项目维护者 |
| 最后更新 | 2026-08-17 |

## 1. 本 SDD 负责什么

跨模态统一的人工标注能力：**bbox / polygon / brush** 三个通用标注工具在全部查看器引擎（`raster_2d` / `volume_3d` 逐切片 / `wsi`）上的绘制、编辑、持久化与任务联动，以及承载它们的**统一工具框架**（工具语义进 store、工具声明进注册表、工具栏走统一 chrome）。标注产物是独立于任务模型结果（Detection）的一等实体 `Annotation`。

## 2. 本 SDD 不负责什么

| 相邻能力 | 归属 |
| --- | --- |
| agent 自然语言 → 建议态标注的产出流（`locate_roi` / `segment_region` / `propose_annotation`、SAM API、权限门控） | [SDD 02 · 智能体图像标注](../02-agent-image-annotation/README.md)（`draft`）；其 accept 后的正式标注即本 SDD 的 `confirmed` 实体 |
| 任务模型结果的生成与测量（`/task/run`、`/task/measure`、Detection 管线） | 任务注册表现有契约，本 SDD 零改动 |
| CT labelmap 编辑端点本身（`POST /volume/{id}/mask-edit` + base_seq） | 既有闭环保留，本 SDD 只换前端交互层 |
| 点标注（point）手动编辑、WSI brush、3D 跨切片传播、标注导出（COCO/LabelMe）、多人协作审阅 | 非目标（脑暴 §10） |
| 标注与 Atlas / 记忆层的联动 | 远期；本期仅以 `source` / `status` 字段留接缝 |

## 3. 当前阶段目标

一期交付：

1. 前端三个查看器的 bbox / polygon（`volume_3d` 另含 brush）可绘制、可编辑、刷新后仍在（后端持久化）；
2. 全部标注 UI 走统一工具栏与 chrome（主题 CSS + i18n），查看器内无残留私有浮动工具条；
3. 现有任务专属工具统一替换为通用工具（IMT 手柄 / WSI ROI / CT 私有画笔），测量与任务行为不回退；
4. 后端 `annotations` REST + SQLite 存储 + `on_commit` 任务联动钩子。

## 4. 输入来源

| 输入 | 必填 | 说明 |
| --- | --- | --- |
| 用户画布交互 | 是 | CS3D 工具事件（raster_2d / volume_3d）或 Annotorious 事件（wsi）产出的几何 |
| 当前对象上下文 | 是 | `image_id`（超声图 / volume / slide id）+ 可选 `z`（CT 逐切片） |
| 注册表 | 是 | `GET /tasks` 下发的引擎能力位与 `on_commit` 钩子声明 |
| `base_seq` | 更新/删除必填 | 乐观并发序号，取最近一次成功响应的 `seq` |

输入约束：几何坐标为对应对象的像素坐标（WSI 为 level-0 px），不得越出图像 dims（后端校验）。

## 5. 输出结果

- REST 响应：创建/更新返回完整 `Annotation`（含服务端 `id` / `seq`）；
- 前端 store：`annotations` 列表 + `tool` / `toolOptions` 状态；
- 任务联动副作用：`on_commit` 钩子派发的 Detection 更新（如 WSI 框完跑核检测），经既有回流通道呈现；
- 错误：领域错误码 → HTTP 映射（§13），前端以 Notice 胶囊提示。

不产生服务端事件流（SSE）；agent 对标注的感知留待 SDD 02（其事件契约在该 SDD §12）。

## 6. 核心流程

### 6.1 标注创建（以 raster_2d polygon 为例）

```mermaid
sequenceDiagram
    participant U as 用户
    participant T as CS3D 工具 (tools 包)
    participant B as 桥 (annotationBridge)
    participant S as session store
    participant API as backend /annotations

    U->>T: 逐点绘制 + 闭合
    T->>B: ANNOTATION_COMPLETED 事件（世界坐标）
    B->>B: 世界坐标 → 像素坐标 → Annotation payload
    B->>S: editSeqRef 序号 +1
    B->>API: POST /annotations（primitive + image_id）
    API->>API: 几何校验 → 写 SQLite（seq=1）→ on_commit 钩子
    API-->>B: 201 {id, seq, ...}
    B->>S: 序号校验通过 → 落 annotations
    Note over B,S: 409/网络失败 → 序号守卫丢弃过期响应 + Notice + 前端移除草稿
```

### 6.2 三引擎交互管线

```mermaid
flowchart LR
    subgraph FE[前端]
        TG[CS3D ToolGroup] -->|raster_2d / volume_3d| CB[annotationBridge]
        AN[Annotorious OSD] -->|wsi, W3C 映射| CB
        CB --> ST[(session store)]
        ST --> Chrome[ViewerChrome 统一工具栏]
    end
    subgraph BE[backend]
        API[/annotations REST/] --> SQ[(SQLite annotations)]
        API --> HOOK[on_commit 钩子]
        HOOK --> DET[_detect_for_spec]
    end
    ST --> API
    DET -->|Detection 回流| ST
```

### 6.3 任务工具替换映射

| 现有 | 替换为 | 行为保持 |
| --- | --- | --- |
| IMT `editli/editma` 高斯手柄 | CS3D 自定义 BaseTool（D-12/D-16） | 拖手柄形变壁线不变；`polygon` 按钮在 IMT 专属壁线编辑 |
| WSI `roi` 框选 | 通用 `bbox` | 框落库为标注 + `on_commit` 触发核检测（双语义） |
| CT 私有画笔 | 通用 `brush`（CS3D） | 提交仍走 `POST /volume/{id}/mask-edit`（§7.4） |

## 7. 核心规则

### 7.1 工具集合与声明

- 统一 `Tool` 集合：`cursor / bbox / polygon / brush / reset`；store 新增 `toolOptions`（`brush: {mode, class_id, radius}`、`voi: {ww, wl}`），随 `switchModality` 复位；
- `TaskPlugin` 新增引擎级能力声明：`raster_2d` 支持 cursor/bbox/polygon/brush；`volume_3d` 同左 + `{z_scroll, voi}`；`wsi` 支持 cursor/bbox/polygon（brush 无服务端落点，禁用）；
- 工具栏显示 = 引擎能力 ∩ 任务推荐；StatusBar 工具展示从注册表取，禁止硬编码表；
- `reset` 只重跑活动模型（影响 Detection），不清标注。

### 7.2 标注与模型结果的边界

- 跑模型产物（LI/MA 壁线、颅骨椭圆、labelmap、核质心）归 Detection 管线渲染，**不进** annotations 表；
- 用户绘制/编辑的产物一律先成 `draft` 标注落库，不打断操作流；
- **任务绑定几何例外**：直接参与任务测量的模型产物（IMT 的 LI/MA 壁线）的编辑仍走既有 `/task` 编辑端点（需同步重算测量），不走 `/annotations`——其交互换成统一框架的通用折线编辑（D-12），但数据归属仍是 Detection；自由标注（与测量无关的额外 polygon/bbox）才落 annotations；
- "模型结果转标注"本期不做（留接缝）。

### 7.3 on_commit 钩子

- 声明于 `TaskPlugin`（如 WSI：`on_commit={"bbox": {"action": "run_task"}}`），后端在标注创建成功后派发，复用 `_detect_for_spec`；
- 钩子失败不影响标注落库（标注已 201），失败走 Notice 提示（§13）。

### 7.4 CT brush 例外

`volume_3d` 下 brush 编辑 labelmap 的提交端点仍是既有 `POST /volume/{id}/mask-edit`（base_seq 范式），**不走** `/annotations`——labelmap 是任务结果而非标注。`/annotations` 在 CT 下承载的是逐切片 bbox/polygon 标注。画笔宿主实施期为 overlay 自持笔迹缓冲（D-15）。

## 8. 涉及对象

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| `Annotation` 契约 | `science-core/glaux_core/contracts.py` + `frontend/src/api/types.ts` 镜像 | 新增实体；`bbox` 原语新增、`mask` 原语落地 |
| annotations 存储 | backend `<ANNOTATIONS_ROOT>/annotations.sqlite` + `masks/` 目录 | 新模块 `app/annotations/`（store + router） |
| annotationBridge | `frontend/src/annotation/` | CS3D 事件 ↔ Annotation 契约 ↔ API 的桥；收敛 editSeqRef/回滚范式 |
| ViewerChrome | `frontend/src/components/` | 统一工具栏 / 选项条 / 信息条（主题 CSS + i18n） |
| TaskPlugin | `science-core/glaux_core/tasks.py` | 引擎能力位 + `on_commit` 声明；`plugin_to_view` 同步下发 |
| IMT 形变手柄工具 | `frontend/src/viewer/`（CS3D 自定义 BaseTool） | 领域特化，扩展 tools 框架 |

存储关系（`mask_ref` 为文件路径引用，逻辑关联，非外键）：

```mermaid
erDiagram
    ANNOTATIONS ||--o| MASK_FILES : "mask_ref 指向（逻辑关联）"
    ANNOTATIONS {
        TEXT id PK
        TEXT image_id
        INTEGER z
        TEXT kind
        TEXT primitive_json
        TEXT label
        INTEGER class_id
        TEXT status
        TEXT source
        INTEGER seq
        TEXT mask_ref
        TEXT created_at
        TEXT updated_at
    }
```

## 9. 数据或字段要求

### 9.1 `annotations` 表（SQLite，数据字典）

| 字段 | 类型 | 可空 | 默认值 | 键/约束 | 索引 | 用途 | 数据来源 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | TEXT | 否 | — | PK | — | 标注唯一 id（uuid4） | 服务端生成 |
| `image_id` | TEXT | 否 | — | 逻辑关联至数据源对象 | `idx_annotations_image(image_id, z)` | 挂靠对象（图/卷/切片 id） | 前端上下文 |
| `z` | INTEGER | 是 | NULL | — | 同上 | CT 逐切片层号；2D/WSI 为 NULL | 前端上下文 |
| `kind` | TEXT | 否 | — | CHECK(kind IN ('bbox','polyline','mask')) | — | 原语判别 | payload |
| `primitive_json` | TEXT | 否 | — | — | — | 几何原语 JSON（§9.2） | payload |
| `label` | TEXT | 否 | `''` | — | — | 语义标签（双语取 i18n 键或自由文本） | 用户 |
| `class_id` | INTEGER | 是 | NULL | — | — | 可选类别（颜色走 ClassSpec） | 用户 |
| `status` | TEXT | 否 | `'draft'` | CHECK(status IN ('draft','confirmed','suggested','rejected')) | — | 生命周期态（§11） | 服务端 |
| `source` | TEXT | 否 | `'manual'` | CHECK(source IN ('manual','model','agent')) | — | 产出方（SDD 02 接缝） | 服务端 |
| `seq` | INTEGER | 否 | `1` | — | — | 乐观并发序号 | 服务端递增 |
| `mask_ref` | TEXT | 是 | NULL | 逻辑关联至 `masks/` 文件 | — | kind='mask' 时的 PNG 相对路径 | 服务端落盘 |
| `created_at` | TEXT | 否 | — | — | — | ISO8601 | 服务端 |
| `updated_at` | TEXT | 否 | — | — | — | ISO8601 | 服务端 |

迁移策略：首版建表即最终结构（无既有数据）；后续变更走显式 migration 函数。mask 文件存 `<ANNOTATIONS_ROOT>/masks/<id>.png`，删除标注时同步删文件。

### 9.2 `Annotation` JSON 契约（前后端镜像）

```
{
  id, image_id, z?,
  primitive: {kind:"bbox", x0,y0,x1,y1}
           | {kind:"polyline", closed:true, points:[[x,y],...], role}
           | {kind:"mask", ref},
  label, class_id?,
  status: "draft"|"confirmed"|"suggested"|"rejected",
  source: "manual"|"model"|"agent",
  seq
}
```

`bbox` 原语同步加入 science-core `contracts.py` 的 Primitive 联合与 `primitive_to_dict`。

## 10. 幂等规则

- 幂等键为 `id`（服务端生成）；`POST` 每次产生新标注，不做客户端去重（绘制交互每次闭合即新意图）；
- `PATCH` / `DELETE` 必带 `base_seq`：`base_seq != 当前 seq` → `409 CONFLICT`，不产生任何写；
- 前端并发守卫沿用 editSeqRef 序号范式：过期响应（含过期的 409 回滚）一律丢弃；
- `on_commit` 钩子重复派发以 Detection 管线既有幂等性为准（重跑覆盖），不重复落标注。

## 11. 状态或生命周期规则

```mermaid
stateDiagram-v2
    [*] --> draft: 用户绘制落库
    draft --> confirmed: 用户确认（本期自动：落库即视为可用，确认动作留接缝）
    suggested --> confirmed: SDD 02 人工接受
    suggested --> rejected: SDD 02 人工拒绝
    draft --> [*]: DELETE
    confirmed --> [*]: DELETE
    rejected --> [*]: DELETE
```

- `draft`：人工绘制产物的默认态，参与渲染，不参与任务测量；
- `confirmed`：本期人工标注落库后前端即按可用处理；显式"确认"动作不做 UI，态值预留；
- `suggested` / `rejected`：仅由 SDD 02 流程写入，本 SDD 的实现保证其可存储、可渲染区分（虚线/半透明），不实现其转换入口；
- `reset`（重跑模型）不触碰任何标注。

## 12. 审计或事件规则

- 本 SDD 不产生服务端事件流（无 SSE）；标注变更的可追溯性由 `source` + `updated_at` + `seq` 承担；
- agent 通道的标注事件（`annotation.suggested` 等）属 SDD 02 §12，本 SDD 只保证其落地实体兼容；
- 前端 Notice（info/crit）不算事件，提示文案走 i18n。

## 13. 异常和人工处理

| 失败类别 | 错误码 | HTTP | 用户感知 | 处理 |
| --- | --- | --- | --- | --- |
| 标注不存在 | `NOT_FOUND` | 404 | Notice 提示并刷新列表 | 前端移除本地副本 |
| 并发冲突 | `CONFLICT` | 409 | "标注已被更新，请重试" | 丢弃本次编辑，重拉最新 |
| 几何非法（越界/点数不足/自交多边形面积为零） | `INVALID_GEOMETRY` | 422 | Notice 指明原因 | 前端移除草稿 |
| on_commit 钩子失败 | — | 标注仍 201 | Notice：标注已保存，检测未触发 | 用户可 reset 或重新框选 |
| 网络失败 | — | — | Notice + 回滚 | editSeqRef 守卫，不静默 |

前端空状态：无标注时画布照常显示 Detection 结果，不额外提示；工具未启用引擎能力时工具栏不出现该按钮（不置灰）。

## 14. 与其他 SDD 的调用关系

- **[02-agent-image-annotation](../02-agent-image-annotation/README.md)**（draft，被依赖）：其 §11 "accepted 后归影像标注既有逻辑"由本 SDD 承接——`propose_annotation` 落库走本 SDD `POST /annotations`（`status=suggested, source=agent`），接受/拒绝即 PATCH status。本 SDD 先行实现，SDD 02 推进 `ready` 时应核对本契约并删除其 §17-Q3/Q4 重叠项。
- **[01-dual-mode-shell](../01-dual-mode-shell/README.md)**（accepted）：ViewerChrome 落入 Workbench 编辑区既有布局，不改外壳结构。
- **[03-atlas](../03-atlas/README.md)**（ready）：无直接调用；远期"已验证标注沉淀案例"另立需求。
- 依赖任务注册表（`GET /tasks`）现有下发通道扩展字段（能力位 / on_commit），不构成新 SDD。

## 15. 验收标准

- [ ] 三个引擎上 bbox / polygon（`volume_3d` 另含 brush）可绘制、可编辑（移动/缩放/顶点增删），刷新页面后标注仍在（读自 `GET /annotations`）。
- [ ] 全部标注工具 UI 走统一工具栏：查看器组件内无内联样式浮动工具条、无硬编码中文工具文案（i18n 双语可切换验证）。
- [ ] CT 模态 `store.tool === "brush"` 生效（共享工具栏画笔按钮可用），VolumeViewer 本地 `brushOn` 与私有工具条删除；StatusBar 工具显示随注册表，`TOOL_LABEL` 硬编码表删除。
- [ ] WSI 用 bbox 框选：框落库为标注且触发核检测（`on_commit`），检测行为（计数/密度）与旧 ROI 工具一致；框选过小（<24px）仍提示不触发。
- [ ] IMT 壁线编辑经统一框架完成，`/task/measure` 输出与替换前一致（同一图像同一形变的 IMT_mean 偏差 ≤ 1e-6 mm）。
- [ ] `PATCH` 携带过期 `base_seq` 时返回 409 且不落写；前端收到 409 时 Notice 提示并丢弃过期响应，不覆盖最新态。
- [ ] `POST` 几何越出图像 dims 时返回 422 `INVALID_GEOMETRY`，前端草稿被移除。
- [ ] `switchModality` 后 `tool` 回 `cursor`、`toolOptions` 复位，无跨模态状态泄漏（连续切换三模态后各工具行为正常）。
- [ ] 标注读写回流范式仅一份实现（annotationBridge）；任务绑定编辑（IMT 壁线测量 / CT mask-edit）属 Detection 链路，各自领域内单一 seq 守卫（wallSeq / 组件内 editSeqRef），三查看器无标注回流复制代码。
- [ ] `on_commit` 钩子失败时标注仍成功落库（201），用户收到"标注已保存、检测未触发"提示。
- [ ] 2D brush 产物落库为 `kind='mask'`，`masks/<id>.png` 存在且重新加载后叠加渲染一致。

## 16. 决策记录

承接脑暴 D-1～D-7（含后端持久化 / 全模态 / 统一替换 / 路线 A / 复用 `@cornerstonejs/tools` / Annotorious / SQLite），本 SDD 新增收敛决策：

| 编号 | 决策 | 备选 | 选择理由 | 时间 |
| --- | --- | --- | --- | --- |
| D-8 | polygon 工具用 CS3D `PlanarFreehandROITool` | `SplineROITool`、自绘 | 同时支持逐点与自由手绘、顶点可编辑，覆盖面最大；Spline 留作后续精度选项（可并存） | 2026-08-16 |
| D-9 | 2D brush 产物落 `/annotations`（kind=mask，PNG 传输）；宿主实现见 D-15（实施期从 CS3D segmentation 退化为自持缓冲） | 自持 mask 缓冲 | PNG 传输格式与 CT mask-edit 一致；宿主选型随 spike3 结果收敛 | 2026-08-16 |
| D-10 | Annotorious W3C 格式 → Annotation 契约的映射在**前端**完成 | 后端映射 | 后端只认一份 Annotation 契约，免维护双格式；W3C 是纯前端库的私有传输细节 | 2026-08-16 |
| D-11 | `ANNOTATIONS_ROOT` 默认 `~/glaux_annotations`，环境变量 `GLAUX_ANNOTATIONS_ROOT` 覆盖 | 放数据集根下 | 对齐 `GLAUX_ATLAS_ROOT` 惯例（不污染数据集） | 2026-08-16 |
| D-12 | IMT 高斯形变手柄实现为 CS3D 自定义 BaseTool | 保留手写 overlay 交互 | 落实纲领「复用优先」：扩展成熟框架而非平行实现 | 2026-08-16 |
| D-13 | CT brush 不走 `/annotations`，仍走 `mask-edit` | 统一到 annotations | labelmap 是任务结果而非标注；成熟闭环不重写 | 2026-08-16 |
| D-14 | IMT 壁线编辑仍走既有 `/task` 编辑端点（交互换通用折线编辑），不走 `/annotations` | 统一到 annotations | 壁线编辑必须同步重算测量（`/task/measure` 权威口径）；数据归属 Detection 而非自由标注 | 2026-08-16 |
| D-15 | 2D/CT brush 宿主退化为 overlay 自持 mask 缓冲（提交分别走 `/annotations` kind=mask / `mask-edit`）；CS3D segmentation 原生交互与渲染留后续 | D-9 的 CS3D labelmap 宿主 | T0 spike3 未打通 StackViewport labelmap（3.33.5 需预建派生 imageId + 引用校验）；退化方案行为等价且不阻塞本期交付 | 2026-08-17 |
| D-16 | IMT 模态的 `polygon` 按钮专属壁线形变（ImtWallHandleTool），不与自由多边形并存 | 双入口并存 | 主键交互只能激活一个工具；自由标注已有 bbox 承接，壁线编辑是 IMT 核心操作 | 2026-08-17 |

## 17. 待确认问题

无（脑暴 Q1～Q5 已收敛为 D-8～D-12；实现期若暴露契约缺口，按铁律先回本 SDD）。
