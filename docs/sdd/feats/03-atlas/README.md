---
kind: living
status: implemented
---

# Atlas · 图谱（人工策展的图文案例库）

## 0. 状态

| 项 | 值 |
| --- | --- |
| SDD 状态 | `implemented`（v1.2 图谱接入会话 2026-08-20 实现完成、自查见 §15 v1.2；v1.1 图册 collection + Focus 右侧栏 2026-08-16 完成；v1 §15.1 结论不变；待维护者端到端验收） |
| 创建日期 | 2026-08-16 |
| 最近更新 | 2026-09-23 |
| 目标阶段 | 第一阶段：人工导入的图谱 + agent 检索先验（VLM 两步 few-shot） |
| 首个场景 | **膜性肾病 EDD（电子致密物）TEM 图谱**——肾脏超微病理，透射电镜图像 |
| 上位 SDD | [Glaux SDD 索引](../../README.md) |
| 依据 | [图像标注案例库技术调研](../../../researches/20260816-01-tech-annotation-exemplar-store.zh-CN.md)（决策 D-1～D-10） |

进入 `ready` 的依据：心智模型（"一本带插画的教科书"）、数据来源（教科书 PDF / 网页 / 标注数据集）、
存储（LanceDB 在 backend、原图与标记分存）、检索链（标签过滤 → 候选 ≤ 10 → VLM 先挑
1–3 张再定位）、下架机制、页面位置、首个场景与外发许可（勾选确认制）均已拍板（§16 D-1～D-20），
§17 开放问题为零。实现计划见 [2026-08-16-001-feat-atlas-plan](../../../plans/2026-08-16-001-feat-atlas-plan.md)。

## 1. 负责人

| 角色 | 负责人 |
| --- | --- |
| 产品与范围 | Glaux 项目维护者 |
| 后端（存储、导入、检索 REST） | Glaux backend 维护者 |
| 前端（Atlas 页面、导入交互） | Glaux 前端维护者 |
| Agent Runtime（检索先验接入） | Glaux Agent Runtime 维护者 |
| 验收 | Glaux 项目维护者 |

## 2. 非目标

本阶段明确不包含：

- **在线自动沉淀**：不从 agent 标注闭环（[02](../02-agent-image-annotation/README.md) 的
  `annotation.resolved`）自动入库；不区分正负样本；不做撤回/过期机制（决策 D-6）。
- 视觉 embedding / 向量检索（BiomedCLIP、DINOv2）；仅当单桶候选超百张时另议（决策 D-7）。
- 受控词表、标签同义合并、本体对齐（决策 D-10）。
- 自部署 SAM2 与 memory 注入（阶段二；依赖 02 的 D-3 修订）。
- 多人协作、权限、云端同步、案例分享/导出为数据集。
- 教科书 PDF 的通用文档问答（那是文档 RAG，不是图谱）。
- 修改 02 的三个工具契约；本 SDD 只向 `locate_roi` 提供可选先验输入。
- 扫描版 PDF 的 OCR / 版面分析（决策 D-8）；像素掩膜（labelmap / NIfTI / RLE）导入（决策 D-15）。
- 改变 science-core 既有任务（如颈动脉超声分割）；本 SDD 的 TEM 场景只是图谱
  的首个内容场景。

## 3. 当前目标

让 Glaux 拥有一本"可查阅的图谱"：用户把教科书插图、网页图片与标注数据集样本人工导入为
标准案例，agent 在定位目标前先"翻图谱"，用相似案例做 few-shot，举一反三。

首个场景（决策 D-12）：**膜性肾病的 EDD 电子致密物图谱**——透射电镜（TEM）下肾小球基底膜
上皮下电子致密物沉积的标准图例。选它的理由：范围极小（一种病、一种结构、一种成像）、维护者
熟悉、教科书/文献插图丰富、TEM 图是 2D 灰度图无需三维/多帧支持。

- 用户在 Atlas 页面导入教科书 PDF 或网页，挑选插图、框选 ROI、填标签，形成图文案例。
- 用户用脚本批量导入带多边形/检测框标注的数据集。
- 导入期由 VLM 为每张图生成结构化描述，运行期零模型依赖即可检索。
- agent 的 `locate_roi` 在定位前，先按标签与文本检索到 ≤ 10 条候选，再让 VLM 从中挑
  1–3 张最相似的作为 few-shot 定位当前图。
- 用户能看到 agent 引用了哪些案例，并可点开查看。

## 4. 输入

### 4.1 用户输入

| 输入 | 必填 | 说明 |
| --- | --- | --- |
| 教科书 PDF | 三选一 | 本地文件（文字版，非扫描版）；PyMuPDF 抽取嵌入图与邻近文本 |
| 网页 URL | 三选一 | 抽取页面内图片与其 alt / figcaption / 邻近段落；经出站守卫校验 |
| 标注数据集目录 | 三选一 | 图像 + 多边形/检测框标注文件（COCO / YOLO / LabelMe JSON）+ 元数据；经 CLI 导入 |
| ROI 框选 | 教科书/网页来源必填 | 用户在导入预览中框出目标结构；一图可多框 |
| 标签 | 是 | 模态 / 部位 / 目标结构 / 任务，自由填写，导入器联想已有标签 |
| 图册（collection） | 否 | 路径式归属，如 `肾脏/膜性肾病/EDD`（`/` 分级），像教科书的章节；缺省为空 = 根目录"未分册"；导入器联想已有图册（v1.1，D-20） |
| 图注 / 说明 | 否 | 教科书图注默认带入，可编辑 |
| 来源信息 | 是 | 书名 / 版次 / 页码，或数据集名 / 许可证 |
| 外发许可 | 是 | `shareable`（可作 few-shot 外发给托管 VLM）/ `local-only`（仅本地使用）；缺省 `local-only`，改为 `shareable` 须勾选确认（D-16） |

### 4.2 系统输入

- 现有 VLM 连接配置（agent-runtime 探测与调用），用于导入期生成结构化描述。
- 现有影像查看器（cornerstone3D）用于导入预览与 ROI 框选。
- `GLAUX_ATLAS_ROOT`（backend `config.py`，默认 `~/glaux_atlas`，与 `~/glaux_datasets`/`~/glaux_models` 同级约定）：下设 `db/`（LanceDB）与 `images/`。不放在 `GLAUX_DATA_ROOT` 下——那是 CUBS 数据集根，图谱是跨数据源的人工资产。

### 4.3 输入约束

- PDF / 网页解析只抽取图片与其图注/邻近文本，不入库正文全文；扫描版 PDF 不支持（无嵌入图则报 `NO_FIGURES_FOUND`）。
- 网页抓取走与 agent-runtime 一致的出站守卫规则（解析后 IP 判定 + 私网/链路本地/保留拒绝；fake-ip 段 `198.18.0.0/15` 默认放行，`GLAUX_VLM_HOST_ALLOW` / `GLAUX_VLM_ALLOW_FAKEIP` 同名开关），只抓 http(s)、不执行脚本、不带凭据；与 runtime 唯一差异：公开页面允许明文 http（只读抓取，无凭据可泄）。
- 标签自由填写，但归一（去首尾空白、全半角、大小写）后入库；不做同义合并。
- 外发许可缺省为 `local-only`；改为 `shareable` 须勾选"我确认有权将该图发往第三方模型服务"，勾选记录随案例保存（D-16）。

## 5. 输出

### 5.1 用户可见输出

- Atlas 页面：**图册树**（v1.1，路径式层级 + 计数，点节点看该子树）+ 案例列表（标签/状态/文本筛选）、案例详情（原图 + ROI 叠加 + 图注 + VLM 描述 + 来源 + 图册，可移动到其它图册）、导入向导（含图册输入）。
- 会话中：agent 引用案例时显示"参考图谱 N 条"卡片，可点开对应案例。

### 5.2 系统输出

- LanceDB 案例记录（§9）与独立存放的图像文件（原图 / 裁剪图）。
- backend REST（前缀 `/atlas`）：
  - `POST /imports/pdf`、`POST /imports/url` → 候选插图列表（不入库）；
  - `POST /exemplars`（批量创建）、`GET /exemplars`（列表+筛选）、`GET /exemplars/search`（检索，≤ 10）、`GET /exemplars/{id}`、`GET /exemplars/{id}/image|crop`（PNG）；
  - `POST /exemplars/{id}/retire|restore`（下架 / 恢复）、`PUT /exemplars/{id}/description`（写入/重试后的 VLM 描述）、`DELETE /exemplars/{id}`；
  - `POST /exemplars/referenced`（runtime 回写"已被会话引用"，用于硬删除门禁）；`GET /tags`（标签频次，供联想）；
  - v1.1：`GET /collections`（图册路径 + 直属计数，前端拼树）、`PUT /exemplars/{id}/collection`（移动到图册）；`GET /exemplars` 与 `GET /exemplars/search` 增加 `collection` 前缀过滤（等于该路径或其子路径）；`POST /exemplars` 条目接受 `collection`。
- agent-runtime 内部端点 `POST /agent-api/v1/atlas/describe`（**前端或 CLI** 调用，生成 §7.6 描述；凭据不经 backend）。
- runtime 模块（供 02 `locate_roi` 调用）：`AtlasClient.search()`、`selectExemplars()`（两步中的挑选步）、`atlas.referenced` 事件构造；`locate_roi` 的可选入参 `exemplar_hint` 即其产物。

### 5.3 输出保证

- 检索结果数量上限 10（可配置），仅返回与请求外发场景相容的案例（§7.4）。
- 案例只能经导入创建、经 Atlas 页面删除；agent 对图谱无写权限。
- 删除案例不影响已完成的会话记录（会话中只保留 `exemplar_id` 引用与快照缩略图）。

## 6. 核心流程

### 6.1 导入（教科书 PDF / 网页）

```mermaid
sequenceDiagram
    participant U as 用户
    participant F as Atlas 页面
    participant B as backend
    participant P as 解析器（PyMuPDF / 网页抽图）
    participant V as VLM（经 agent-runtime）
    participant S as LanceDB + 图像目录

    U->>F: 选择教科书 PDF 或输入网页 URL
    F->>B: POST /atlas/imports (pdf | url)
    B->>P: 抽取图片 + 图注/邻近文本 + 页码/URL 锚点
    P-->>B: 候选插图列表
    B-->>F: 候选插图（缩略图 + 图注）
    U->>F: 勾选插图、框选 ROI、填标签、编辑图注
    F->>B: POST /atlas/exemplars (候选引用 + ROI + 标签 + 来源 + 外发许可)
    B->>S: 写图像文件 + 案例记录（describe_status=pending）
    B-->>F: exemplar_id 列表
    F->>V: POST /agent-api/v1/atlas/describe（裁剪图 + 连接凭据，逐条）
    V-->>F: 描述 JSON
    F->>B: PUT /atlas/exemplars/{id}/description
    B->>S: 更新描述 + 检索文本（describe_status=done）
```

凭据边界：VLM 连接凭据只从前端发往 agent-runtime（同 00 的约束），**不经 backend**；backend 只存描述结果。
CLI 批量导入可选 `--describe`，由 CLI 进程直接调 runtime（凭据取自环境变量），同样不落 backend。

### 6.2 导入（标注数据集，CLI）

`glaux atlas import-dataset <dir> --format coco|yolo|labelme --tags ... --license ...`：逐样本读取图 + 多边形/检测框 → 多边形取外接框为 ROI、多边形本身存 `geometry` → 同 6.1 后半段（VLM 描述可批量、可跳过）。

### 6.3 检索与使用（两步 VLM）

```mermaid
sequenceDiagram
    participant A as Agent (locate_roi)
    participant B as backend
    participant S as LanceDB
    participant V as VLM

    A->>B: GET /atlas/exemplars/search?tags=…&q=…&egress=…
    B->>S: 标签过滤 + 图注/描述文本匹配
    S-->>B: 候选 ≤ 10（active 且 egress 相容）
    B-->>A: 案例列表（裁剪图引用 + ROI + 描述）
    A->>V: 第一步：当前图 + 候选缩略图 → 挑最相似 1–3 张
    V-->>A: 选中 exemplar_id 列表
    A->>V: 第二步：当前图 + 选中案例（图 + ROI + 描述）→ 定位
    V-->>A: 粗定位 bbox
    A-->>A: 会话事件 atlas.referenced（§12，含两步的选中结果）
```

候选为 0 时跳过两步、直接走无先验定位；候选 ≤ 3 时可跳过第一步直接作为 few-shot（实现期可配置）。

## 7. 核心规则

### 7.1 心智模型

图谱 = 一本人工编纂的、带插画的教科书。**策展过的标准样式**，不是使用日志。写入口只有导入；演进靠人工。

### 7.2 检索规则

1. 先按标签精确过滤（归一后相等）；无标签命中时退化为仅文本匹配。v1.1：若请求带 `collection`，先限定在该图册及其子图册内（前缀匹配），再做标签/文本步——图册是**范围**，标签是**维度**。
2. 文本匹配对象：图注 + VLM 结构化描述 + 用户填写的说明；查询词来自 agent 的目标描述。
3. 结果按（命中标签数, 文本相关度）排序，截断为 ≤ 10。
4. 检索不调用任何模型，只返回 `active` 态案例；VLM 精看/挑选由 agent 侧完成（§6.3 两步）。

### 7.3 两种来源、两种读者

| 来源 | 携带几何 | 可喂给 |
| --- | --- | --- |
| 教科书插图 / 网页图片 | ROI 框（+ 可选多边形） | VLM few-shot |
| 标注数据集 | 多边形 + ROI 框 | VLM few-shot；阶段二 SAM2 memory（需多边形→掩膜栅格化） |

### 7.4 外发规则

- 案例图作为 few-shot 发往用户自配的模型连接，不受 `GLAUX_ANNOT_ALLOW_EGRESS` 约束（该开关只约束第三方分割服务，见 02 §7.4）。
- 在此之上按案例 `egress` 字段分级：仅 `shareable` 可随第三方服务外发；`local-only` 案例是否随行由 `egressFor(connection)` 判定——只有 `base_url` 解析为回环的本机模型才带上，否则从检索结果中排除并在会话中提示"N 条本地案例因外发限制未使用"。
- 缺省值与是否允许用户对教科书/网页来源改为 `shareable`：允许，须勾选确认（D-16）。

### 7.5 标签规则

- 自由填写；导入器提示已有标签（按使用频次）。
- 入库前归一：trim、全角转半角、大小写折叠；原文另存以便展示。

### 7.5a 图册规则（v1.1，D-20）

- 图册是路径字符串，`/` 分级：各段 trim、去空段、全角斜杠转半角；不区分大小写归一另存（`collection_key`）用于过滤，原文用于展示。空字符串 = 根目录（页面上显示为"未分册"）。
- 一条案例只属于一个图册（像文件属于一个文件夹）；标签仍可跨图册检索。
- 图册**不是**受控词表：任何路径都可以直接写出来，不需要预先创建；图册树由现有案例的路径派生（`GET /collections`），删完案例的图册自然消失。
- 移动案例到另一图册不改 `exemplar_id`、不影响幂等键与引用记录。

### 7.6 VLM 结构化描述模板

通用模板，不按模态分叉；固定字段 + 扩展字段：

| 字段 | 说明 |
| --- | --- |
| `modality` | 成像方式（如 TEM / 超声 / CT），模型判断 |
| `subject` | 图中主体结构（如 肾小球基底膜、上皮下区） |
| `findings` | 关键所见列表，每项 `{name, location, appearance}`（如 电子致密物 / 上皮下 / 均质高电子密度） |
| `pattern` | 整体分布/形态模式（如 弥漫、颗粒状、节段） |
| `summary` | 一句话概括，供文本检索 |
| `extra` | 键值对，模型自行提炼的其他关键字段（放大倍数、染色、伪影提示等） |

模板在导入期一次生成，允许用户在页面上修正；`summary` + `findings[].name` + `extra` 的值一并进入文本检索。

### 7.7 下架规则

- 案例可"下架"（`retired`）：保留记录与图像，不再出现在检索与默认列表中；历史会话引用仍可打开。
- 下架可恢复为 `active`；硬删除仅对从未被会话引用过的案例开放。

## 8. 涉及对象

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| Atlas 页面（Workbench） | `frontend/src/components/atlas/`（新增）；`store/session.ts` 的 `View` 增加 `"atlas"`；ActivityBar 新增入口 | 左侧侧栏视图：列表 / 详情 / 导入向导 |
| Atlas 页面（Focus） | `frontend/src/components/focus/`：右侧栏的浏览器列（与常驻舞台并排，与「文件」互斥） | 同一组件在 Focus 模式下挂到浏览器列 |
| ROI 框选 | `frontend/src/components/atlas/RoiPicker.tsx`：轻量 canvas/DOM 矩形叠加（候选插图为静态 PNG，不上 cornerstone 栈；D-18） | 导入预览中框选，一图多框，坐标换算回图像像素 |
| 案例存储 | `backend/app/atlas/`（新增）：LanceDB 表 `GLAUX_ATLAS_ROOT/db/` + 图像 `GLAUX_ATLAS_ROOT/images/` | 原图与标记分存 |
| PDF 解析 | backend 依赖 PyMuPDF（`pymupdf`），主进程可用（IO 库，非重模型） | 抽嵌入图 + 同页邻近文本 |
| 网页解析 | backend：`httpx` + HTML 解析；出站守卫需在 Python 侧按 `agent-runtime/src/security/net-guard.ts` 规则重建（backend 的 `net_guard.py` 已在退役 orchestration P3 删除） | 抽 `<img>` + alt / figcaption / 邻近段落 |
| VLM 描述生成 | agent-runtime 新增端点 `/agent-api/v1/atlas/describe`，由前端（导入向导）或 CLI 调用；结果经 `PUT /atlas/exemplars/{id}/description` 写回 backend | 复用现有 provider 连接；凭据不经 backend |
| REST | `backend/app/routers/atlas.py`（新增） | §5.2 端点 |
| 检索先验接入 | `agent-runtime/src/pi/tools/consult-atlas.ts`（v1.2 D-21；02 的 `locate_roi` 落地后共用 `selectExemplars`）| 调 search，拼 few-shot，把选中案例作图像块交给模型 |
| 工具门控 | `agent-runtime/src/pi/harness-registry.ts` 的 `defaultToolFactory` | 仅在 `connection.vision === true` 且非 `observe` 时挂 `consult_atlas`（D-22） |
| 卡片持久化 | `agent-runtime/src/pi/session-service.ts` 的 `visibleMessage` | 会话视图保留带 `glaux.atlas_referenced` 的 `toolResult`（剥空 content） |
| 会话卡片 | `frontend/src/components/agent/AtlasRefCard.tsx`，由 `AgentConversation` 按工具结果 details 渲染 | "参考图谱 N 条" |
| CLI | `scripts/` 或 backend 模块入口 | 数据集批量导入 |

## 9. 数据或字段要求

案例记录（LanceDB 表 `exemplars`）：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `exemplar_id` | string (uuid) | 是 | 主键 |
| `image_ref` | string | 是 | 原图文件相对路径（`atlas/images/...`） |
| `crop_ref` | string | 否 | ROI 裁剪图路径（教科书来源建议必有） |
| `roi` | bbox（图像像素坐标） | 是 | 目标框 |
| `geometry` | polygon（像素坐标点集） | 否 | 数据集来源的多边形；第一期不支持像素掩膜 |
| `tags` | string[] | 是 | 归一后标签 |
| `tags_raw` | string[] | 是 | 用户原文 |
| `caption` | string | 否 | 图注 / 说明 |
| `description` | JSON | 否 | VLM 结构化描述（§7.6 模板：固定字段 + `extra`） |
| `source_type` | enum | 是 | `textbook` / `web` / `dataset` |
| `source` | JSON | 是 | 书名/版次/页码，或 URL + 抓取时间，或数据集名/许可证 |
| `egress` | enum | 是 | `shareable` / `local-only` |
| `egress_consent` | JSON | `egress=shareable` 时必填 | `{confirmed_at, import_batch_id, statement_version}`：用户勾选"我确认有权将该图发往第三方模型服务"的记录（D-16） |
| `status` | enum | 是 | `active` / `retired`（§11） |
| `describe_status` | enum | 是 | `done` / `pending`（VLM 描述失败待重试）/ `skipped`（CLI 跳过） |
| `image_sha256` | string | 是 | 原图内容哈希（幂等键组成部分，§10） |
| `created_at` | datetime | 是 | 导入时间 |
| `import_batch_id` | string | 是 | 同一次导入的批次号（幂等与批量下架） |
| `collection` | string | 是（可为空） | 图册路径原文，如 `肾脏/膜性肾病/EDD`；空 = 根目录（v1.1，D-20） |
| `collection_key` | string | 是（可为空） | 归一后的图册路径（casefold），用于前缀过滤与分组 |

一图多标记：同一 `image_ref` 可对应多条记录（不同 `roi`/`tags`）。

引用记录（表 `exemplar_refs`）：`exemplar_id`、`trace_id`、`referenced_at`；由 runtime 经 `POST /atlas/exemplars/referenced` 写入，硬删除前查询是否存在（§7.7）。

前端状态：`FocusLayout.browserView = "atlas"`（[01-dual-mode-shell v1.4](../01-dual-mode-shell/README.md) §9；v1.1–v1.3 为 `rightView:"atlas"`）。「在图谱中打开」设置 `{rightOpen:true, browserView:"atlas"}`。

## 10. 幂等规则

- 导入幂等键：`(source_type, source, image_sha256, roi)`；重复导入相同项返回已有 `exemplar_id`，不新建。`collection` 不参与幂等键——同一项以不同图册重复导入仍返回已有记录（图册以首次为准，需移动请用 `PUT /exemplars/{id}/collection`）。
- CLI 批量导入可重跑；同一 `import_batch_id` 重跑只补缺不重复。
- 检索为只读，无幂等问题。

## 11. 状态或生命周期规则

```mermaid
stateDiagram-v2
    [*] --> importing: 用户开始导入
    importing --> active: 记录写入成功
    importing --> [*]: 用户取消 / 失败（无残留记录）
    active --> retired: 用户下架
    retired --> active: 用户恢复
    active --> deleted: 硬删除（仅限从未被会话引用）
    retired --> deleted: 硬删除（仅限从未被会话引用）
    deleted --> [*]
```

- 案例无"建议态"，写入即 `active`。
- `retired` 不参与检索与默认列表，历史会话引用仍可打开；可恢复。
- 硬删除仅对从未被 `atlas.referenced` 引用过的案例开放；被引用过的只能下架。
- 与会话生命周期解耦：删会话不动案例，下架/删除案例不改会话。

## 12. 审计或事件规则

| 事件 | 触发时机 | payload 要点 |
| --- | --- | --- |
| `atlas.import.completed` | 一次导入批次结束 | batch_id、条数、source_type、trace_id |
| `atlas.referenced` | agent 在一次 `consult_atlas`（v1.2 D-21；`locate_roi` 落地后同）中使用了案例 | 候选 exemplar_id 列表、VLM 选中的 1–3 条、被外发限制排除的条数、trace_id、选中案例快照（caption/tags，供案例删除后降级展示）。runtime 侧类型 `AtlasReferencedPayload`（`contracts.ts`）；进入会话的载体：`consult_atlas` 工具结果 `details = {kind: "glaux.atlas_referenced", payload}`，前端 `AtlasRefCard.parseAtlasReferenced` 解析（`locate_roi` 接线时沿用） |
| `atlas.exemplar.retired` / `.restored` | 用户下架 / 恢复 | exemplar_id、trace_id |
| `atlas.exemplar.deleted` | 用户硬删除 | exemplar_id、trace_id |

审计：每次案例图外发（作为 few-shot 发往托管 VLM）记录 exemplar_id、目标 host、trace_id；不记录图像内容。

## 13. 异常和人工处理

| 失败类别 | 错误码（示意） | 用户感知 | 处理 |
| --- | --- | --- | --- |
| PDF 无可抽插图（含扫描版） | `NO_FIGURES_FOUND` | 提示"未识别到嵌入图，可手动截图导入" | 引导手动上传图片 |
| 网页 URL 被出站守卫拒绝 / 抓取失败 | `FETCH_BLOCKED` / `FETCH_FAILED` | 提示地址不允许或不可达 | 用户改地址或手动上传 |
| VLM 描述生成失败 | `DESCRIBE_FAILED` | 案例仍入库，描述为空并标记"待补描述" | 页面可重试生成 |
| 检索无结果 | 非错误 | agent 正常走无先验路径，会话中不提示或轻提示 | — |
| 案例被外发限制排除 | 非错误 | 会话卡片提示"N 条本地案例未使用" | 用户可切本地模型 |
| 存储写入失败 | `ATLAS_WRITE_FAILED` | 明确报错，批次回滚 | 带 trace_id 排查 |

## 14. 与其他 SDD 的调用关系

- 被 [02-agent-image-annotation](../02-agent-image-annotation/README.md) 的 `locate_roi` 调用（可选先验）；02 不依赖 03 即可 `ready`。
- 依赖 [00-reference-agent-conversations](../00-reference-agent-conversations/README.md) 的会话与 SSE 通道（会话卡片、事件）。
- 依赖 [01-dual-mode-shell](../01-dual-mode-shell/README.md) 的外壳：Workbench 下为左侧侧栏视图；Focus 下为右侧栏的浏览器列（v1.4 `browserView`）。
- 依赖 agent-runtime 现有 VLM 连接与出站守卫（导入期描述生成、few-shot 外发）。
- 阶段二与 02 的 D-3 修订（SAM2 自部署）联动。

## 15. 验收标准

- [x] 导入一份含嵌入图的文字版 PDF，Atlas 页面出现候选插图与邻近文本；勾选、框 ROI、填标签后，案例出现在列表中，`source_type = textbook`。
- [x] 导入一个扫描版 PDF，返回 `NO_FIGURES_FOUND` 并提示手动上传，无残留记录。
- [x] 输入一个公网网页 URL，页面内图片与 alt/figcaption 出现在候选列表；输入私网地址返回 `FETCH_BLOCKED`，无对外请求（fake-ip 段 `198.18.0.0/15` 默认放行，除非显式关闭开关）。
- [x] 用 CLI 导入一个 COCO 多边形标注目录，`geometry` 为多边形、`roi` 为其外接框；重跑同一命令不产生重复记录。
- [x] 同一图重复导入相同 ROI，返回同一 `exemplar_id`。
- [x] 标签"电子致密物"与"电子致密物 "（尾空格）/ 全角输入检索结果一致。
- [x] `search` 请求 `egress=shareable` 时结果不含任何 `local-only` 案例；不含任何 `retired` 案例。
- [x] 图谱中有 ≥ 4 条匹配候选时，`consult_atlas` 先出现一次 VLM 挑选调用（返回 1–3 个 exemplar_id），选中案例作为图像块进入工具结果；会话中出现"参考图谱 N 条"卡片，可点开对应案例。——`consult-atlas-tool.test.ts`（目标图取自查看器、挑选结果、图像块、卡片 payload）+ `AgentConversation.test.tsx`（历史里渲染卡片）；`locate_roi` 落地后改由它承载定位步（D-21）
- [x] 图谱无匹配时行为与无 Atlas 时一致，无额外 VLM 调用与错误——`consult-atlas-tool.test.ts` 0 命中路径：无图像块、不记引用、如实告知模型"无匹配案例"。
- [x] 非视觉连接下 `consult_atlas` 不出现在工具集（D-22）——`consult-atlas-tool.test.ts` 门控用例。
- [x] 模型连接指向非回环端点时，`local-only` 案例不随行，卡片提示被排除数量（`egressFor` 判定，见 §7.4）——`consult-atlas-tool.test.ts`「reports egress-withheld local-only cases」、`AtlasRefCard.test.tsx`。
- [x] 下架案例后，它不再出现在检索与默认列表，引用它的历史会话卡片仍可打开；恢复后重新可检索。
- [x] 对被会话引用过的案例执行硬删除被拒绝；从未引用过的可硬删除。
- [x] VLM 描述生成失败时案例仍入库，页面显示"待补描述"并可重试；成功时 `description` 含 §7.6 全部固定字段且 `extra` 为对象。
- [x] 检索链路不加载任何本地模型（backend 进程无 torch 导入）。

v1.1（图册 + Focus 右侧栏）：

- [x] 导入向导与 CLI `--collection` 可给案例指定图册路径；页面图册树按路径分级显示并带直属/子树计数；点节点后列表只显示该图册及子图册的案例；未填图册的案例出现在"未分册"。——`ImportWizard.test.tsx` collection 透传、`test_atlas_cli.py`（参数）、`CollectionTree.test.tsx` 拼树/计数/前缀筛选/未分册；浏览器：种子 4 条移入 `肾脏/膜性肾病/EDD` 后右侧栏图谱标签显示树 `肾脏 4 ▸ 膜性肾病 4`
- [x] `GET /exemplars/search?collection=肾脏/膜性肾病` 只返回该路径及子路径下的案例；`selectExemplars` 透传 `collection`。——`test_atlas_store.py` / `test_atlas_api.py`；runtime `atlas-select.test.ts`；实测 `collection=肾脏/IgA` 0 命中、`肾脏` 4 命中
- [x] 图册路径 `肾脏 / 膜性肾病`（段内空格）、`肾脏／膜性肾病`（全角斜杠）与 `肾脏/膜性肾病` 归为同一图册。——`test_normalize_collection_segments_fullwidth_and_case`；前端 `normalizeKey` 同规则测试
- [x] 详情页可把案例移动到另一图册：`exemplar_id` 不变、幂等键与引用记录不变、树计数即时更新。——`test_collection_prefix_filter_counts_and_move`（移动后重复导入仍返回同 id、引用保留）；详情页"移动"按钮 + `bumpRefresh`
- [x] 旧库（无 `collection` 列）打开时自动补列为空字符串，旧案例出现在"未分册"，不需要重建。——`test_old_table_without_collection_column_is_migrated`；本机 v1 库重启后 `/collections` 返回 `[{"":4}]`
- [x] Focus 下图谱作为右侧栏"图谱"标签呈现（01 v1.1）；会话卡片"在图谱中打开"展开右侧栏并切到该标签的对应案例。——`FocusSidePanel.test.tsx`、`atlasView.test.ts` revealExemplar

### 15.1 开发侧自查（2026-08-16，实现完成后；端到端验收由维护者执行）

**已完成（自动化测试 + 浏览器走查覆盖）**

| 验收项 | 证据 |
| --- | --- |
| 文字版 PDF → 候选 → 框 ROI/标签 → 入库 `textbook` | backend `test_atlas_parse.py`（PyMuPDF 现场生成含图 PDF 抽出）+ `test_atlas_api.py`（imports/pdf → exemplars）；前端 `ImportWizard.test.tsx` 三步流；浏览器走查向导渲染与创建/详情/下架/删除链路 |
| 扫描版 PDF → `NO_FIGURES_FOUND`，无残留 | `test_atlas_parse.py` 纯文本 PDF；`ImportWizard.test.tsx` 呈现手动上传引导，`Next` 不可用；暂存会话在向导卸载时 `DELETE /imports/{id}` |
| 公网 URL 出候选；私网/fake-ip → `FETCH_BLOCKED` 无对外请求 | `test_net_guard.py`（9 项）+ `test_atlas_parse.py` 网页抽图（含重定向）+ `test_atlas_api.py`（monkeypatch 断言未发请求）；本机 fake-ip 代理下浏览器实测返回 `FETCH_BLOCKED` 并在向导中提示 |
| CLI 导入 COCO 多边形，`geometry`/`roi` 正确，重跑幂等 | `test_atlas_cli.py`（4 项） |
| 同图同 ROI 重复导入同 id | `test_atlas_store.py` 幂等键 |
| 标签归一检索一致 | `test_atlas_store.py`（尾空格 / 全角 / 大小写） |
| `egress=shareable` 不含 local-only 与 retired | `test_atlas_store.py` + `test_atlas_api.py` |
| 下架不可检索、历史卡片可开、恢复可检索 | `test_atlas_store.py` retire/restore；`AtlasRefCard.test.tsx` 已下架/已删除案例降级展示且可点开 |
| 被引用过的不可硬删；未引用可硬删 | `test_atlas_store.py`（`mark_referenced` 后 delete → `REFERENCED`） |
| describe 失败仍入库可重试；成功含全部固定字段且 `extra` 为对象 | agent-runtime `atlas-vision.test.ts`（一次重试 / `describe_failed` / 规整）+ `atlas-api.test.ts`（502 且凭据不落 body、请求后 dispose）；backend `PUT /description` 测试；前端详情页"生成描述"按钮 |
| 检索链路无 torch | `test_atlas_store.py::test_search_path_does_not_import_torch` |

**未完成**

- 首个场景（膜性肾病 EDD TEM）的**种子内容**尚未导入：需维护者自有 TEM 图 / 教科书插图；`agent-runtime/scripts/atlas-eval.ts` 已就绪但**首轮 IoU 数字未产出**（需 10 张自有测试图 + 人工框 + 一个视觉模型连接）。

**v1.2（2026-08-20）：图谱接入会话**

v1.1 自查里"无法验证（依赖 SDD 02 `locate_roi`）"的三条，除定位步本身外均已由 D-21 的 `consult_atlas` 接通并测到：

- 检索链与卡片已在真实会话链路里跑通（工具单测 + 经 harness 的集成用例 + 前端历史渲染用例）。
- 卡片随会话历史持久化：`session-service.visibleMessage` 保留带 `glaux.atlas_referenced` 的
  `toolResult` 并剥空 content——案例图不进快照，前端另经 `/atlas/exemplars/{id}/crop` 取。
- 模型连接不是回环时 `local-only` 案例不随行、卡片提示排除数——`egressFor` 只对回环 base_url 放开 `any`，
  `excluded_by_egress` 计数在 `consult_atlas` 结果文案与卡片中均呈现（有测试）；`GLAUX_ANNOT_ALLOW_EGRESS`
  只约束第三方分割服务（02 §7.4），不参与这里的判定。

**仍未达成**

- "带选中案例定位"的第二步（出 bbox）仍属 SDD 02 `locate_roi`，本 SDD 不修改 02 契约；
  `consult_atlas` 只把案例交给模型看，不产出坐标。
- 首个场景种子内容与首轮 IoU 数字（见下）——`consult_atlas` 是 D-17 度量的前置条件，现已具备。

## 16. 决策记录

| 编号 | 决策 | 备选 | 选择理由 | 时间 |
| --- | --- | --- | --- | --- |
| D-1 | 图谱由人工策展、批量导入、人工演进；不做在线自动沉淀 | 从 02 的裁决回执自动入库 | 解耦 02、砍掉撤回/过期/正负例复杂度；"教科书不是日志" | 2026-08-16 |
| D-2 | 用 VLM 视觉理解替代视觉向量：导入期生成描述，运行期标签+文本检索 | BiomedCLIP/DINOv2 embedding | 零运行期模型依赖；桶内候选量小时 VLM 精看足够 | 2026-08-16 |
| D-3 | LanceDB 在 Python backend 侧，原图与标记分存 | sqlite-vec；agent-runtime 直连 | 一表存几何/元数据/未来向量；与 science-core 入口接法一致 | 2026-08-16 |
| D-4 | 检索单元 = ROI 裁剪 + 部位标签 | 整图 | 教科书一图多结构；few-shot 更聚焦 | 2026-08-16 |
| D-5 | 产品形态为 Glaux 内页面，命名 Atlas / 图谱 | CLI-only；"知识库" | 医学"图谱"即带插画参考书；避开文档问答联想 | 2026-08-16 |
| D-6 | 标签自由填写，不设受控词表 | 定死词表 | 教科书目录即天然词表，先跑通再看发散程度 | 2026-08-16 |
| D-7 | 按案例 `egress` 字段分级外发（`shareable` / `local-only`），叠加在全局开关之上 | 统一走全局开关 | 版权内容不得随 few-shot 外发；缺省与改写规则见 D-16 | 2026-08-16 |
| D-8 | PDF 解析用 PyMuPDF 抽嵌入图 + 邻近文本；不支持扫描版 | RAGFlow / MinerU 类版面解析器 | 轻量、主进程可用；扫描版 OCR 收益低 | 2026-08-16 |
| D-9 | 首版支持网页导入（图 + alt/figcaption/邻近段落） | 仅 PDF | 文献/教学网页是 TEM 图例的重要来源 | 2026-08-16 |
| D-10 | VLM 描述模板通用、不按模态分叉：固定字段 + `extra` 扩展字段，模型自行提炼 | 按模态分模板 | 跨模态一致的检索文本；扩展字段吸收领域差异 | 2026-08-16 |
| D-11 | 两步 VLM：先从候选挑 1–3 张，再带选中案例定位 | 候选直接多图 few-shot | 降低多图 few-shot 的噪声与 token；对 provider 多图能力要求更低 | 2026-08-16 |
| D-12 | 首个内容场景 = 膜性肾病 EDD TEM 图谱 | 颈动脉超声 | 场景极小、维护者熟悉、教科书图例丰富、2D 灰度图；不改 science-core 主线楔子 | 2026-08-16 |
| D-13 | 下架机制：`retired` 保留记录不参与检索；被引用过的案例只能下架不能硬删 | 仅硬删除 | 保护历史会话引用；图谱是可修订的教材 | 2026-08-16 |
| D-14 | 页面位置：Workbench 左侧侧栏视图；Focus 右侧拓展视图（参考 Codex 桌面端） | 编辑区独立标签页 | 与现有双模式外壳布局一致 | 2026-08-16 |
| D-15 | 数据集几何第一期只支持多边形与检测框（COCO / YOLO / LabelMe） | 像素掩膜 / NIfTI / RLE | 对齐通用 CV 标注场景；掩膜留给阶段二 SAM2 路径 | 2026-08-16 |

| D-16 | 外发许可：缺省 `local-only`；导入时可逐条/逐批改为 `shareable`，但必须勾选确认"我确认有权将该图发往第三方模型服务"，勾选记录（时间、批次）随案例保存 | 强制 `local-only` 仅本地 VLM；按网页许可证自动判定 | TEM 首场景种子几乎全来自教科书/网页，强制 local-only 会让托管 VLM 下图谱无案例可用；责任交给用户显式承担 | 2026-08-16 |
| D-17 | 价值验证方式：固定 10 张自有 TEM 图，比较有/无图谱时 VLM 定位 bbox 与人工框的 IoU；种子规模不预设，以此度量迭代 | 预设种子条数 | 无法先验知道多少图例够用 | 2026-08-16 |
| D-18 | 导入预览 ROI 框选用轻量 DOM 矩形叠加（`RoiPicker`），不复用 cornerstone 矩形工具 | 复用 `CornerstoneViewer` | 候选插图是静态 PNG，cornerstone 栈解决的是医学影像渲染/坐标系问题，这里没有；轻量实现可在 Focus 窄栏与 jsdom 测试中直接跑 | 2026-08-16 |
| D-19 | v1：Focus 右侧图谱与舞台互斥、顶栏 📖 切换。**v2（2026-08-16 同日修订）**：图谱是 Focus 右侧栏三个标签（舞台/文件/图谱）之一，右侧栏由 [01 v1.1 D10–D13](../01-dual-mode-shell/README.md) 定义；顶栏 📖 移除；从会话卡片"打开"时展开右侧栏并切到图谱标签 | 图谱作为舞台内标签 | v1 是过渡形态；Codex 式常驻可折叠右侧栏让"舞台 / 文件 / 图谱"成为同一位置的三种视角 | 2026-08-16 |
| D-21 | 图谱接入会话的宿主改为**独立只读工具 `consult_atlas`**：模型自行决定何时翻图谱，检索链 `selectExemplars` 原样复用；`locate_roi` 落地后共用同一函数，本工具可留可退 | 继续等 SDD 02 `locate_roi`（03 原设计）；每轮对话自动前置检索 | `locate_roi` 连同整套标注工具、权限门控、前端 bbox 回写是一个大特性，图谱不该压在它后面；"翻图谱"本身就是一次独立的、只读的、模型可判断时机的动作；自动前置检索则是每轮都付 VLM 成本、且用户问"你是谁"也要翻一次 | 2026-08-20 |
| D-22 | `consult_atlas` 仅在连接声明 `connection.vision === true` 时注册 | 恒挂工具，图发出去由模型自己处理 | pi-ai 的 `downgradeUnsupportedImages` 会把不支持图像的模型收到的图静默换成"image omitted"占位——挂了工具只会让模型以为自己翻过图谱，比没有图谱更坏（同 SDD 00 D-022 的判断） | 2026-08-20 |
| D-20 | 图谱增加**图册（collection）**路径式层级作为整理维度：一案例属一图册，`/` 分级，缺省根目录；标签继续负责检索维度；`search` 可按图册限定范围 | 仅用标签分面树；固定两级分类 | 平铺 + 自由标签是 D-10 的副作用——标签是检索维度不是整理维度；"图册 = 教科书章节"与心智模型同构；路径式不需要预建目录，零受控词表 | 2026-08-16 |

## 17. 待确认问题

无。历史问题已全部转入 §16（Q1 → D-16，Q2 → D-17）。
