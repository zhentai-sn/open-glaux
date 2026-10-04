---
kind: living
status: implemented
---

# Atlas · 图谱（人工策展的图文案例库）

## 0. 状态

| 项 | 值 |
| --- | --- |
| SDD 状态 | `implemented`（v2.0 上传即入库 2026-10-01 实现完成、自查见 §15 v2.0；v1.2 图谱接入会话 2026-08-20 实现完成、自查见 §15 v1.2；v1.1 图册 collection + Focus 右侧栏 2026-08-16 完成；v1 §15.1 结论不变；待维护者端到端验收） |
| 创建日期 | 2026-08-16 |
| 最近更新 | 2026-10-01 |
| 目标阶段 | 第一阶段：上传即入库的图谱 + agent 检索先验（VLM 两步 few-shot） |
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

让 Glaux 拥有一本"可查阅的图谱"：用户像使用普通知识库一样上传图片、PDF 或网页地址，系统自动
入库并补齐字段；用户事后按需修改。agent 在定位目标前先"翻图谱"，用相似案例做 few-shot。

首个场景（决策 D-12）：**膜性肾病的 EDD 电子致密物图谱**——透射电镜（TEM）下肾小球基底膜
上皮下电子致密物沉积的标准图例。选它的理由：范围极小（一种病、一种结构、一种成像）、维护者
熟悉、教科书/文献插图丰富、TEM 图是 2D 灰度图无需三维/多帧支持。

- 用户在 Atlas 页面上传图片或 PDF、或填入网页地址，文件即刻入库：PDF 与网页的插图全部抽出，
  每张图以整图为 ROI 形成一条案例（D-23、D-24）。
- 入库后经用户确认（D-28），由 VLM 生成结构化描述，并据此补齐标签与图注（D-25）；运行期零模型依赖即可检索。
- 用户在案例详情页修改 ROI、标签、图注、图册与外发许可，在同一张图上追加区域；列表支持批量操作（D-26）。
- 用户用脚本批量导入带多边形/检测框标注的数据集。
- agent 的 `locate_roi` 在定位前，先按标签与文本检索到 ≤ 10 条候选，再让 VLM 从中挑
  1–3 张最相似的作为 few-shot 定位当前图。
- 用户能看到 agent 引用了哪些案例，并可点开查看。

## 4. 输入

### 4.1 用户输入

上传时用户只需给出文件或地址；其余字段由系统自动填写，入库后可在详情页修改（§7.8）。

| 输入 | 上传时必填 | 缺省值（自动填写） | 说明 |
| --- | --- | --- | --- |
| 图片文件 | 四选一 | — | PNG / JPEG / WebP / 单层 TIFF，可多选、可拖放；一文件一条案例 |
| PDF 文件 | 四选一 | — | 文字版，非扫描版；PyMuPDF 抽取全部嵌入图（短边 < 64px 与纯色图过滤）与邻近文本，每张插图一条案例 |
| 网页 URL | 四选一 | — | 抽取页面内全部图片与其 alt / figcaption / 邻近段落；经出站守卫校验 |
| 标注数据集目录 | 四选一 | — | 图像 + 多边形/检测框标注文件（COCO / YOLO / LabelMe JSON）+ 元数据；经 CLI 导入，规则见 §6.2 |
| ROI | 否 | 整图 `[0, 0, w, h]` | 详情页可改框；同图可追加区域（D-23） |
| 标签 | 否 | VLM 描述的 `modality`、`subject`、`findings[].name`（D-25） | 自由填写，归一后入库；描述完成前可为空 |
| 图册（collection） | 否 | 上传时所在图册；在根目录上传时为空 = "未分册" | 路径式归属，如 `肾脏/膜性肾病/EDD`（`/` 分级）（D-20） |
| 图注 / 说明 | 否 | PDF 图注 / 网页 alt 或 figcaption；无则取 VLM `summary` | 详情页可改 |
| 来源信息 | 否 | 图片：文件名；PDF：文件名、PDF 元数据标题、页码、图序号；网页：页面 URL + 图片 URL（抓取时间即 `created_at`，不进 `source`，以免重复导入破坏幂等） | 详情页可补书名 / 版次 |
| 外发许可 | 否 | `local-only` | 改为 `shareable` 须勾选确认（D-16），不做自动判定 |

### 4.2 系统输入

- 现有 VLM 连接配置（agent-runtime 探测与调用），用于导入期生成结构化描述。
- 现有影像查看器（cornerstone3D）用于导入预览与 ROI 框选。
- `GLAUX_ATLAS_ROOT`（backend `config.py`，默认 `~/glaux_atlas`，与 `~/glaux_datasets`/`~/glaux_models` 同级约定）：下设 `db/`（LanceDB）与 `images/`。不放在 `GLAUX_DATA_ROOT` 下——那是 CUBS 数据集根，图谱是跨数据源的人工资产。

### 4.3 输入约束

- PDF / 网页解析只抽取图片与其图注/邻近文本，不入库正文全文；扫描版 PDF 不支持（无嵌入图则报 `NO_FIGURES_FOUND`）。
- 网页抓取走与 agent-runtime 一致的出站守卫规则（解析后 IP 判定 + 私网/链路本地/保留拒绝；fake-ip 段 `198.18.0.0/15` 默认放行，`GLAUX_VLM_HOST_ALLOW` / `GLAUX_VLM_ALLOW_FAKEIP` 同名开关），只抓 http(s)、不执行脚本、不带凭据；与 runtime 唯一差异：公开页面允许明文 http（只读抓取，无凭据可泄）。
- 标签自由填写，但归一（去首尾空白、全半角、大小写）后入库；不做同义合并。
- 外发许可缺省为 `local-only`；改为 `shareable` 须勾选"我确认有权将该图发往第三方模型服务"，勾选记录随案例保存（D-16）。
- 单次上传上限：文件数 50、单文件 50 MB、单次产生的案例数 200；超限整批拒绝（`UPLOAD_TOO_LARGE`），不部分入库。

## 5. 输出

### 5.1 用户可见输出

- Atlas 页面：
  - **上传入口**：列表顶部「上传」按钮（选文件）与「从网页导入」输入框；整个列表区域接受拖放。上传后列表即时出现新案例，顶部显示本批结果（入库 N 条、失败 K 个文件）与生成描述的确认条（§6.1），确认后显示描述进度。
  - **图册树**（路径式层级 + 计数，点节点看该子树）。
  - **案例列表**：标签 / 状态 / 文本筛选；状态徽标「描述中」「待描述」「未确认」（§7.8）；多选后批量移动图册、改外发许可、下架、删除、标为已确认。
  - **案例详情**：原图 + ROI 叠加、图注、VLM 描述、标签、来源、图册、外发许可，均可就地编辑；「重新框选」「在此图上添加区域」「重新生成描述」「标为已确认」。
- 会话中：agent 引用案例时显示"参考图谱 N 条"卡片，可点开对应案例。

### 5.2 系统输出

- LanceDB 案例记录（§9）与独立存放的图像文件（原图 / 裁剪图）。
- backend REST（前缀 `/atlas`）：
  - 上传（直接入库，D-24）：`POST /uploads`（multipart，`files[]` + 可选 `collection`）、`POST /uploads/url`（`{url, collection?}`）→ `{batch_id, items: [{exemplar_id, created, file}], errors: [{file, code, message}]}`；单个文件失败记入 `errors`，不影响同批其它文件；
  - `POST /exemplars`（批量创建，供 CLI 与测试使用，`tags` 可为空）、`GET /exemplars`（列表 + 筛选，增加 `describe_status`、`reviewed` 过滤）、`GET /exemplars/search`（检索，≤ 10）、`GET /exemplars/{id}`、`GET /exemplars/{id}/image|crop`（PNG）；
  - `PATCH /exemplars/{id}`：修改 `roi`、`tags`、`caption`、`notes`、`source`、`collection`、`egress`（+`egress_consent`）中的任意子集，或只提交 `{reviewed: true}`；改 `roi` 时重新生成裁剪图（§7.8）；
  - `POST /exemplars/{id}/regions`（`{roi}`）：在同一原图上追加一条案例，继承来源、图册、外发许可，描述置 `pending`；
  - `POST /exemplars/{id}/retire|restore`（下架 / 恢复）、`PUT /exemplars/{id}/description`（写入 VLM 描述，并按 §7.8 补齐未确认案例的标签与图注）、`DELETE /exemplars/{id}`；
  - `POST /exemplars/referenced`（runtime 回写"已被会话引用"，用于硬删除门禁）；`GET /tags`（标签频次，供联想）；
  - `GET /collections`（图册路径 + 直属计数，前端拼树）；`GET /exemplars` 与 `GET /exemplars/search` 支持 `collection` 前缀过滤（等于该路径或其子路径）。
  - 导入暂存端点 `/imports/*` 与导入向导随 v2.0 移除（D-24）；`PUT /exemplars/{id}/collection` 并入 `PATCH /exemplars/{id}`。
- agent-runtime 内部端点 `POST /agent-api/v1/atlas/describe`（**前端或 CLI** 调用，生成 §7.6 描述；凭据不经 backend）。
- runtime 模块（供 02 `locate_roi` 调用）：`AtlasClient.search()`、`selectExemplars()`（两步中的挑选步）、`atlas.referenced` 事件构造；`locate_roi` 的可选入参 `exemplar_hint` 即其产物。

### 5.3 输出保证

- 检索结果数量上限 10（可配置），仅返回与请求外发场景相容的案例（§7.4）。
- 案例只能经 Atlas 页面上传或 CLI 导入创建、经 Atlas 页面修改与删除；agent 对图谱无写权限。
- 删除案例不影响已完成的会话记录（会话中只保留 `exemplar_id` 引用与快照缩略图）。

## 6. 核心流程

### 6.1 上传（图片 / PDF / 网页）

```mermaid
sequenceDiagram
    participant U as 用户
    participant F as Atlas 页面
    participant B as backend
    participant P as 解析器（PyMuPDF / 网页抽图）
    participant V as VLM（经 agent-runtime）
    participant S as LanceDB + 图像目录

    U->>F: 拖放或选择文件 / 填网页地址（当前图册）
    F->>B: POST /atlas/uploads 或 /atlas/uploads/url
    B->>P: PDF / 网页：抽全部插图 + 图注/邻近文本 + 页码/URL
    P-->>B: 插图列表
    B->>S: 每张图一条案例：ROI=整图、标签空、describe_status=pending、reviewed=false
    B-->>F: batch_id + exemplar_id 列表 + 文件级错误
    F->>U: 确认条：将把 N 张图发送到 <连接名 · host> 生成描述
    U->>F: 「生成描述」（或「暂不」→ 保持待描述）
    loop 描述队列（并发 2）
        F->>V: POST /agent-api/v1/atlas/describe（裁剪图 + 连接凭据）
        V-->>F: 描述 JSON
        F->>B: PUT /atlas/exemplars/{id}/description
        B->>S: 写描述；未确认案例补标签与图注；重建检索文本
    end
    U->>F: 按需在详情页修改 → PATCH /atlas/exemplars/{id}（reviewed=true）
```

描述队列由前端驱动（凭据边界，见下）。**每次调用 VLM 前都须取得用户确认（D-28）**：

- 上传成功后，列表顶部出现确认条，写明张数、目标连接名称与 host：「将把 N 张图发送到 <连接名 · host> 生成描述」，按钮「生成描述」「暂不」。用户点「生成描述」后本批才入队；点「暂不」或离开页面，案例保持「待描述」。
- 打开 Atlas 页面且存在 `describe_status=pending` 的案例时，同样以确认条提示「N 条待描述」，不自动入队。
- 详情页「重新生成描述」按钮、列表多选后的「生成描述」批量操作本身即用户确认，按钮文案带目标 host；批量操作仍弹出一次含张数与 host 的确认。
- 确认只对当次列出的案例有效，不记忆、不跨批次、不跨页面会话；切换连接后须重新确认。
- 当前连接不可用（未配模型或非视觉连接）时不出现确认条，案例保持「待描述」，页面提示配置视觉连接。
- 单条失败保持 `pending` 并记失败次数（仅前端内存），同一页面会话内最多自动重试 1 次，之后只能在详情页手动重试。
- 外发：描述生成发往用户自配的当前连接，与 v1 相同，不受案例 `egress` 约束（§7.4 末条）。

凭据边界：VLM 连接凭据只从前端发往 agent-runtime（同 00 的约束），**不经 backend**；backend 只存描述结果。
CLI 批量导入可选 `--describe`，由 CLI 进程直接调 runtime（凭据取自环境变量），同样不落 backend；显式传入 `--describe` 即视为确认，缺省不调用 VLM。

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

图谱 = 一本人工编纂的、带插画的教科书。**策展过的标准样式**，不是使用日志。写入口只有用户上传与 CLI 导入；系统负责补齐字段，策展（修改、确认、下架）靠人工。

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
- `egress` 只约束 agent 运行期把案例作为 few-shot 随行。导入期描述生成是用户上传动作的一部分，图发往用户自配的当前连接，与在对话中发送图片同类，不受 `egress` 约束。

### 7.5 标签规则

- 自由填写；详情页编辑时提示已有标签（按使用频次）。
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

### 7.8 自动填充与人工确认规则（v2.0，D-23～D-26）

1. **上传即入库。** 上传请求返回时案例已是 `active`，可被检索；不存在"候选 / 暂存"中间态。
2. **ROI 缺省为整图。** `crop_ref` 留空，`/crop` 回落到原图，不另存文件。
3. **描述完成后补字段。** `PUT /description` 写入成功且案例 `reviewed=false` 时，backend 按下表覆盖字段；`reviewed=true` 时只写描述、不动其它字段。

   | 字段 | 自动值 |
   | --- | --- |
   | `tags` / `tags_raw` | `modality`、`subject`、`findings[].name` 去重，最多 8 个，按 §7.5 归一 |
   | `caption` | 仅当原值为空时取 `summary` |

4. **人工修改即确认。** 任何经 `PATCH` 的字段修改都把 `reviewed` 置为 `true`；也可不改字段、直接标为已确认。`reviewed` 不可回退为 `false`。
5. **改 ROI。** 新 ROI 不等于整图时重新裁剪并写 `crop_ref`；`describe_status` 置 `pending`，按 §6.1 经用户确认后重新描述（描述对应裁剪图）。描述完成后因案例已确认，标签与图注不被覆盖。
6. **追加区域。** `POST /exemplars/{id}/regions` 新建的案例 `reviewed=true`（用户亲手框选），标签初值复制自原案例。
7. **检索不区分是否确认。** 未确认案例与已确认案例同等参与检索；标签为空的案例只经文本匹配命中（§7.2 第 1 条）。`reviewed` 只用于页面筛选与提示。
8. **批量操作** 由前端逐条调用单条端点完成，任一条失败不回滚其它条，结果按条汇报。批量改为 `shareable` 只勾选一次确认，确认记录写入每条案例，其 `egress_consent.import_batch_id` 记录本次批量操作号。

## 8. 涉及对象

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| Atlas 页面（Workbench） | `frontend/src/components/atlas/`；`store/session.ts` 的 `View` 含 `"atlas"`；ActivityBar 入口 | 左侧侧栏视图：列表（含上传入口与拖放区）/ 详情 |
| Atlas 页面（Focus） | `frontend/src/components/focus/`：左侧栏竖条的图谱入口打开，图谱替换舞台占据右侧工作区，对话列保留 | 同一组件在 Focus 模式下整栏挂到右侧工作区 |
| 上传入口 | `frontend/src/components/atlas/UploadBar.tsx`（`useAtlasUpload` 供 `AtlasView` 拖放区共用） | 选文件 / 拖放 / 网页地址，本批结果与文件级错误 |
| 描述确认与队列 | `frontend/src/components/atlas/DescribeConfirm.tsx`（确认条）；`describe.ts` 的 `runDescribeQueue`（进度写 `store/atlas.ts` 的 `describeJob`） | §6.1：确认后才入队、并发 2、自动重试 1 次、切换连接即停止（D-28） |
| 案例编辑 | `ExemplarDetail.tsx`（字段就地编辑、重新框选、添加区域、标为已确认）；`ExemplarList.tsx`（状态徽标、多选批量操作） | §7.8 |
| ROI 框选 | `frontend/src/components/atlas/RoiPicker.tsx`：轻量 canvas/DOM 矩形叠加（案例图为静态 PNG，不上 cornerstone 栈；D-18） | 详情页重新框选与添加区域，坐标换算回图像像素 |
| 上传与编辑服务 | `backend/app/atlas/importer.py`：`upload_files()` / `upload_url()` 直接入库（取代 `stage_*` 暂存会话）；`store.py`：`update()`、`add_region()`、描述写回时的自动补字段 | §6.1、§7.8 |
| 案例存储 | `backend/app/atlas/`（新增）：LanceDB 表 `GLAUX_ATLAS_ROOT/db/` + 图像 `GLAUX_ATLAS_ROOT/images/` | 原图与标记分存 |
| PDF 解析 | backend 依赖 PyMuPDF（`pymupdf`），主进程可用（IO 库，非重模型） | 抽嵌入图 + 同页邻近文本 |
| 网页解析 | backend：`httpx` + HTML 解析；出站守卫需在 Python 侧按 `agent-runtime/src/security/net-guard.ts` 规则重建（backend 的 `net_guard.py` 已在退役 orchestration P3 删除） | 抽 `<img>` + alt / figcaption / 邻近段落 |
| VLM 描述生成 | agent-runtime 新增端点 `/agent-api/v1/atlas/describe`，由前端（导入向导）或 CLI 调用；结果经 `PUT /atlas/exemplars/{id}/description` 写回 backend | 复用现有 provider 连接；凭据不经 backend |
| REST | `backend/app/routers/atlas.py`（新增） | §5.2 端点 |
| 检索先验接入 | `agent-runtime/src/pi/tools/consult-atlas.ts`（v1.2 D-21；02 的 `locate_roi` 落地后共用 `selectExemplars`）| 调 search，拼 few-shot，把选中案例作图像块交给模型 |
| 工具门控 | `agent-runtime/src/pi/harness-registry.ts` 的 `defaultToolFactory` | 仅在 `connection.vision === true` 且非 `observe` 时挂 `consult_atlas`（D-22） |
| 卡片持久化 | `agent-runtime/src/pi/session-service.ts` 的 `visibleMessage` | 会话视图保留带 `glaux.atlas_referenced` 的 `toolResult`：content 只留截断后的文本，图像块不进快照（SDD 15 §9.6） |
| 会话卡片 | `frontend/src/components/agent/AtlasRefCard.tsx`，由 `AgentConversation` 按工具结果 details 渲染 | "参考图谱 N 条" |
| CLI | `scripts/` 或 backend 模块入口 | 数据集批量导入 |

## 9. 数据或字段要求

案例记录（LanceDB 表 `exemplars`）：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `exemplar_id` | string (uuid) | 是 | 主键 |
| `image_ref` | string | 是 | 原图文件相对路径（`atlas/images/...`） |
| `crop_ref` | string | 否 | ROI 裁剪图路径（教科书来源建议必有） |
| `roi` | `[x, y, w, h]`（图像像素坐标，左上原点，整数） | 是 | 目标框；前后端、CLI、裁剪统一此约定。v2.0 补 `reviewed` 列时，把 v1 向导写入的 `textbook` / `web` 案例由 `[x0, y0, x1, y1]` 换算为本约定并重建裁剪图，幂等键不变 |
| `geometry` | polygon（像素坐标点集） | 否 | 数据集来源的多边形；第一期不支持像素掩膜 |
| `tags` | string[] | 是（可为空数组） | 归一后标签；上传后、描述完成前为空（§7.8） |
| `tags_raw` | string[] | 是（可为空数组） | 原文（用户填写或自动提取） |
| `caption` | string | 否 | 图注 / 说明 |
| `description` | JSON | 否 | VLM 结构化描述（§7.6 模板：固定字段 + `extra`） |
| `source_type` | enum | 是 | `upload`（图片文件）/ `textbook`（PDF）/ `web` / `dataset` |
| `source` | JSON | 是 | 自动填写：`{filename}`；PDF `{filename, title?, page, figure}`；网页 `{url, image_url}`；数据集名/许可证。用户可补书名/版次 |
| `egress` | enum | 是 | `shareable` / `local-only` |
| `egress_consent` | JSON | `egress=shareable` 时必填 | `{confirmed_at, import_batch_id, statement_version}`：用户勾选"我确认有权将该图发往第三方模型服务"的记录（D-16） |
| `status` | enum | 是 | `active` / `retired`（§11） |
| `describe_status` | enum | 是 | `done` / `pending`（VLM 描述失败待重试）/ `skipped`（CLI 跳过） |
| `image_sha256` | string | 是 | 原图内容哈希（幂等键组成部分，§10） |
| `created_at` | datetime | 是 | 导入时间 |
| `import_batch_id` | string | 是 | 同一次导入的批次号（幂等与批量下架） |
| `collection` | string | 是（可为空） | 图册路径原文，如 `肾脏/膜性肾病/EDD`；空 = 根目录（v1.1，D-20） |
| `collection_key` | string | 是（可为空） | 归一后的图册路径（casefold），用于前缀过滤与分组 |
| `reviewed` | bool | 是 | 是否经人工修改或确认；页面上传为 `false`；CLI 数据集导入（几何来自人工标注、标签由命令行指定）、`POST /exemplars`（字段由调用方显式给出）与追加区域为 `true`（§7.8）。旧库打开时补列，缺省 `true`（v1 案例均经人工框选与填标签） |

一图多标记：同一 `image_ref` 可对应多条记录（不同 `roi`/`tags`）。

引用记录（表 `exemplar_refs`）：`exemplar_id`、`trace_id`、`referenced_at`；由 runtime 经 `POST /atlas/exemplars/referenced` 写入，硬删除前查询是否存在（§7.7）。

前端状态：`FocusLayout.sideView = "atlas"`（[01-dual-mode-shell v1.5](../01-dual-mode-shell/README.md) §9；旧值 `browserView:"atlas"` / `rightView:"atlas"` 载入时迁移）。「在图谱中打开」设置 `{rightOpen:true, sideView:"atlas"}`。

## 10. 幂等规则

- 导入幂等键：`(source_type, source, image_sha256, roi)`，在**创建时**计算并固定；重复上传同一文件（同名同内容）返回已有 `exemplar_id`，`created=false`，不新建。`collection` 不参与幂等键——同一项以不同图册重复上传仍返回已有记录（图册以首次为准，移动用 `PATCH`）。
- 入库后经 `PATCH` 修改 `roi` 或 `source` 不重算幂等键：幂等键记录的是"从哪次导入来"，不是当前内容；`exemplar_id`、引用记录不变。
- 追加区域的幂等键为 `(source_type, source, image_sha256, 新 roi)`；同图同框重复追加返回已有记录。
- CLI 批量导入可重跑；同一 `import_batch_id` 重跑只补缺不重复。
- 检索为只读，无幂等问题。

## 11. 状态或生命周期规则

```mermaid
stateDiagram-v2
    [*] --> active: 上传 / CLI 导入写入成功
    active --> retired: 用户下架
    retired --> active: 用户恢复
    active --> deleted: 硬删除（仅限从未被会话引用）
    retired --> deleted: 硬删除（仅限从未被会话引用）
    deleted --> [*]
```

- 案例无"建议态"，写入即 `active`。`describe_status`（`pending` → `done`）与 `reviewed`（`false` → `true`）是与 `status` 正交的两个属性，不构成生命周期状态。
- `retired` 不参与检索与默认列表，历史会话引用仍可打开；可恢复。
- 硬删除仅对从未被 `atlas.referenced` 引用过的案例开放；被引用过的只能下架。
- 与会话生命周期解耦：删会话不动案例，下架/删除案例不改会话。

## 12. 审计或事件规则

| 事件 | 触发时机 | payload 要点 |
| --- | --- | --- |
| `atlas.import.completed` | 一次上传或 CLI 导入批次结束 | batch_id、新建条数、已存在条数、失败文件数、source_type 分布、trace_id |
| `atlas.exemplar.updated` | `PATCH` 成功或追加区域 | exemplar_id、改动字段名列表（不含字段值）、trace_id |
| `atlas.referenced` | agent 在一次 `consult_atlas`（v1.2 D-21；`locate_roi` 落地后同）中使用了案例 | 候选 exemplar_id 列表、VLM 选中的 1–3 条、被外发限制排除的条数、trace_id、选中案例快照（caption/tags，供案例删除后降级展示）。runtime 侧类型 `AtlasReferencedPayload`（`contracts.ts`）；进入会话的载体：`consult_atlas` 工具结果 `details = {kind: "glaux.atlas_referenced", payload}`，前端 `AtlasRefCard.parseAtlasReferenced` 解析（`locate_roi` 接线时沿用） |
| `atlas.exemplar.retired` / `.restored` | 用户下架 / 恢复 | exemplar_id、trace_id |
| `atlas.exemplar.deleted` | 用户硬删除 | exemplar_id、trace_id |

审计：每次案例图外发（作为 few-shot 发往托管 VLM）记录 exemplar_id、目标 host、trace_id；不记录图像内容。

## 13. 异常和人工处理

| 失败类别 | 错误码（示意） | 用户感知 | 处理 |
| --- | --- | --- | --- |
| PDF 无可抽插图（含扫描版） | `NO_FIGURES_FOUND`（文件级） | 本批进度中该文件标红："未识别到嵌入图，可截图后上传图片" | 同批其它文件照常入库 |
| 文件类型不支持 / 图像无法解码 | `UNSUPPORTED_FILE` / `BAD_IMAGE`（文件级） | 该文件标红并给出原因 | 同上 |
| 超出单次上传上限 | `UPLOAD_TOO_LARGE`（整批） | 提示上限，未入库任何文件 | 用户分批上传 |
| 网页 URL 被出站守卫拒绝 / 抓取失败 | `FETCH_BLOCKED` / `FETCH_FAILED` | 提示地址不允许或不可达 | 用户改地址或下载图片后上传 |
| VLM 描述生成失败 | `DESCRIBE_FAILED` | 案例已入库，标记"待描述" | 自动重试 1 次，之后详情页手动重试 |
| 无可用视觉连接 | 非错误 | 新案例标记"待描述"，页面提示配置视觉连接 | 配好连接后打开图谱，确认后补描述 |
| 用户未确认生成描述 | 非错误 | 案例保持"待描述"，标签为空，只经图注文本（PDF / 网页来源）可检索 | 之后在确认条、详情页或批量操作中确认 |
| 修改 ROI 越界或退化（零宽 / 零高） | `BAD_ROI` | 框选器拒绝提交 | — |
| 检索无结果 | 非错误 | agent 正常走无先验路径，会话中不提示或轻提示 | — |
| 案例被外发限制排除 | 非错误 | 会话卡片提示"N 条本地案例未使用" | 用户可切本地模型 |
| 存储写入失败 | `ATLAS_WRITE_FAILED` | 明确报错，批次回滚 | 带 trace_id 排查 |

## 14. 与其他 SDD 的调用关系

- 被 [02-agent-image-annotation](../02-agent-image-annotation/README.md) 的 `locate_roi` 调用（可选先验）；02 不依赖 03 即可 `ready`。
- 依赖 [00-reference-agent-conversations](../00-reference-agent-conversations/README.md) 的会话与 SSE 通道（会话卡片、事件）。
- 依赖 [01-dual-mode-shell](../01-dual-mode-shell/README.md) 的外壳：Workbench 下为左侧侧栏视图；Focus 下为右侧工作区（v1.5 `sideView`），入口在左侧栏。
- 依赖 agent-runtime 现有 VLM 连接与出站守卫（导入期描述生成、few-shot 外发）。
- 阶段二与 02 的 D-3 修订（SAM2 自部署）联动。

## 15. 验收标准

v2.0（上传即入库）：

- [x] 上传一份含 N 张嵌入图的文字版 PDF，请求返回时列表出现 N 条案例：`source_type = textbook`、ROI 为整图、图注取自 PDF、`reviewed=false`；无任何勾选或填写步骤。——`test_atlas_api.py::test_upload_pdf_and_images_direct_to_active`
- [x] 一次上传多张图片与一个扫描版 PDF：图片各成一条 `source_type = upload` 的案例；扫描版 PDF 在本批结果中报 `NO_FIGURES_FOUND`，不产生记录，不影响同批图片。——同上（同批含扫描版 PDF 与 `.txt`，分别报 `NO_FIGURES_FOUND` / `UNSUPPORTED_FILE`）；浏览器走查拖放图片 + 文本文件
- [x] 输入公网网页 URL，页面内全部图片直接入库，图注取 alt / figcaption；输入私网地址返回 `FETCH_BLOCKED`，无对外请求（fake-ip 段 `198.18.0.0/15` 默认放行，除非显式关闭开关）。——`test_upload_url_success_creates_all_figures`、`test_upload_url_private_is_400_and_no_request`；守卫规则见 `test_net_guard.py`
- [x] 在图册 `A/B` 下上传，新案例的 `collection = A/B`；在根目录上传，新案例出现在"未分册"。——`test_upload_pdf_and_images_direct_to_active`（`collection`）；`AtlasView.test.tsx` 上传携带当前图册
- [x] 超过单次上限（51 个文件）整批拒绝，返回 `UPLOAD_TOO_LARGE`，无记录。——`test_upload_too_many_files_rejects_whole_batch`
- [x] 上传后、用户点「生成描述」前，agent-runtime 未收到任何 `/atlas/describe` 请求；确认条显示张数与目标 host；点「暂不」后案例保持「待描述」。——`AtlasView.test.tsx`「确认前不调 runtime」「暂不」；浏览器走查网络面板无 `/agent-api/v1/atlas/describe` 请求
- [x] 打开图谱时存在待描述案例，只出现确认条，不自动发起描述；切换连接后此前的确认失效。——`AtlasView.test.tsx`；切换连接即停止由 `runDescribeQueue` 的连接比对实现，未单测
- [x] 视觉连接可用且用户确认后，案例依次由「描述中」变为已描述；`tags` 等于描述中 `modality`、`subject`、`findings[].name` 的归一去重（≤ 8），原图注为空的案例图注取 `summary`。——`test_description_fills_tags_and_caption_until_reviewed`、`test_tags_may_be_empty_until_described`；`AtlasView.test.tsx` 确认后逐条写回
- [x] 无视觉连接时上传成功、案例显示「待描述」且无确认条；配好连接后重新打开图谱出现确认条，确认后补描述。——`AtlasView.test.tsx`「无模型连接」；浏览器走查
- [x] CLI 导入不带 `--describe` 时不调用 VLM。——`test_atlas_cli.py`（不带 `--describe` 置 `skipped`）
- [x] 详情页修改标签后 `reviewed=true`；对该案例重新生成描述，标签与图注不被覆盖。——`test_description_fills_tags_and_caption_until_reviewed`；`AtlasView.test.tsx` 详情保存只提交改动字段；浏览器走查
- [x] 详情页重新框选：`crop_ref` 更新、`describe_status` 回到 `pending` 并重新描述；`exemplar_id`、幂等键、引用记录不变。——`test_patch_roi_recrops_and_resets_description`；浏览器走查重新框选
- [x] "在此图上添加区域"新建一条同原图、同来源与图册的案例，`reviewed=true`；同图同框重复添加返回已有记录。——`test_add_region_inherits_and_is_idempotent`
- [x] 列表多选后批量改为 `shareable` 须勾选一次确认，每条案例都写入 `egress_consent`；批量移动图册、下架、删除按条汇报结果，被引用过的案例删除失败不影响其它条。——`AtlasView.test.tsx`「批量改为可外发」（同一批次号、单条失败按条汇报）
- [x] 旧库打开后补 `reviewed` 列且旧案例为 `true`，不需要重建。——`test_old_table_without_collection_column_is_migrated`、`test_migrate_legacy_rois_converts_xyxy_and_recrops`；本机 v1 库副本实测 5 条 ROI 换算、裁剪图重建
- [x] 前端不再有导入向导，backend 不再有 `/imports/*` 端点。——`ImportWizard.tsx` 与 `/imports/*` 已删除

v1 / v1.1 / v1.2（已完成）：

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
- [x] Focus 下图谱从左侧栏入口打开，替换舞台占据右侧工作区（01 v1.5 D20）；会话卡片"在图谱中打开"展开右侧栏并换成图谱工作区的对应案例。——`SessionRail.test.tsx`、`FocusSidePanel.test.tsx`、`atlasView.test.ts` revealExemplar

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
  `toolResult`，content 只留文本——案例图不进快照，前端另经 `/atlas/exemplars/{id}/crop` 取。
- 模型连接不是回环时 `local-only` 案例不随行、卡片提示排除数——`egressFor` 只对回环 base_url 放开 `any`，
  `excluded_by_egress` 计数在 `consult_atlas` 结果文案与卡片中均呈现（有测试）；`GLAUX_ANNOT_ALLOW_EGRESS`
  只约束第三方分割服务（02 §7.4），不参与这里的判定。

**仍未达成**

- "带选中案例定位"的第二步（出 bbox）由 SDD 02 的 `locate_roi` 承担，已实现：`use_atlas` 缺省开启，
  经 `selectExemplars` 挑 1–3 条案例与目标图一起送模型（`agent-runtime/src/pi/tools/locate-roi.ts`）。
  `consult_atlas` 只把案例交给模型看，不产出坐标。
- 首个场景种子内容与首轮 IoU 数字（D-17）——前置条件已具备，维护者决定在 v2.0 落地、导入路径固定后再做。

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
| D-19 | v1：Focus 右侧图谱与舞台互斥、顶栏 📖 切换。**v2（2026-08-16 同日修订）**：图谱是 Focus 右侧栏三个标签（舞台/文件/图谱）之一，右侧栏由 [01 v1.1 D10–D13](../01-dual-mode-shell/README.md) 定义；顶栏 📖 移除；从会话卡片"打开"时展开右侧栏并切到图谱标签。**v3（2026-09-25）**：图谱升为 Focus 左侧栏一级入口，点击后替换舞台占据右侧工作区，对话列保留，见 [01 D20](../01-dual-mode-shell/README.md) | 图谱作为舞台内标签 | v1 是过渡形态；Codex 式常驻可折叠右侧栏让"舞台 / 文件 / 图谱"成为同一位置的三种视角 | 2026-08-16 |
| D-21 | 图谱接入会话的宿主改为**独立只读工具 `consult_atlas`**：模型自行决定何时翻图谱，检索链 `selectExemplars` 原样复用；`locate_roi` 落地后共用同一函数，本工具可留可退 | 继续等 SDD 02 `locate_roi`（03 原设计）；每轮对话自动前置检索 | `locate_roi` 连同整套标注工具、权限门控、前端 bbox 回写是一个大特性，图谱不该压在它后面；"翻图谱"本身就是一次独立的、只读的、模型可判断时机的动作；自动前置检索则是每轮都付 VLM 成本、且用户问"你是谁"也要翻一次 | 2026-08-20 |
| D-22 | `consult_atlas` 仅在连接声明 `connection.vision === true` 时注册 | 恒挂工具，图发出去由模型自己处理 | pi-ai 的 `downgradeUnsupportedImages` 会把不支持图像的模型收到的图静默换成"image omitted"占位——挂了工具只会让模型以为自己翻过图谱，比没有图谱更坏（同 SDD 00 D-022 的判断） | 2026-08-20 |
| D-20 | 图谱增加**图册（collection）**路径式层级作为整理维度：一案例属一图册，`/` 分级，缺省根目录；标签继续负责检索维度；`search` 可按图册限定范围 | 仅用标签分面树；固定两级分类 | 平铺 + 自由标签是 D-10 的副作用——标签是检索维度不是整理维度；"图册 = 教科书章节"与心智模型同构；路径式不需要预建目录，零受控词表 | 2026-08-16 |
| D-23 | 上传时 ROI 缺省为整图；精确框选、同图多区域改在详情页按需进行 | VLM 自动提议主体框；整图 + 详情页"让模型框一下" | 维护者 2026-10-01 选定。检索主要依赖标签与描述文本，整图不降低可检索性；不增加入库期模型调用；需要精确区域的案例由用户在详情页补 | 2026-10-01 |
| D-24 | 上传即入库：图片、PDF、网页的全部插图直接写入为 `active` 案例；移除导入向导与 `/imports/*` 暂存端点；图片文件新增 `source_type = upload` | 保留勾选插图一步；保留向导作为"高级导入" | 维护者 2026-10-01 提出并选定。普通知识库的用法是"上传即可用"；v1 向导要求每张图框 ROI、填标签、填来源才能入库，字段全压在用户身上；封面、logo 等无关图由 64px 过滤与事后下架 / 删除处理；两套入口并存增加维护面 | 2026-10-01 |
| D-25 | VLM 描述完成后自动补齐未确认案例的标签（`modality`、`subject`、`findings[].name`，≤ 8）与空图注（`summary`）；描述队列由前端驱动 | backend 调 runtime 生成描述；标签只由用户填 | 自动填写是"上传即入库"能被检索的前提；凭据只到 runtime 的边界（§6.1）决定队列放在前端；无视觉连接时保持"待描述"，不阻塞入库 | 2026-10-01 |
| D-26 | 新增 `reviewed` 标记：人工修改或确认即置 `true`，此后自动填充不覆盖用户内容；检索不区分是否确认 | 引入"草稿 / 已发布"生命周期，未确认不参与检索 | 用户编辑必须优先于模型输出；按确认状态过滤检索会让上传后的案例在用户整理前不可用，与"上传即可用"矛盾；`reviewed` 与 `status`、`describe_status` 正交，不扩展生命周期 | 2026-10-01 |
| D-27 | 导入期描述生成发往用户自配的当前连接，不受案例 `egress` 约束；`egress` 只约束运行期 few-shot 随行 | `local-only` 案例只在本机模型下生成描述 | 与 v1 行为一致；描述生成是用户上传动作的一部分，与在对话中发送图片同类；若按 `egress` 拦截，缺省 `local-only` 加托管模型时所有上传案例都无法自动描述，"上传即入库"失效；是否发送由 D-28 的逐次确认把关 | 2026-10-01 |
| D-28 | 图谱侧每次调用 VLM 前须取得用户确认：上传后与打开页面时以确认条列出张数与目标连接 host，用户点「生成描述」才入队；详情页与批量的「生成描述」按钮即确认；确认不记忆、不跨批次与连接；CLI 须显式 `--describe` | 上传后自动描述；首次确认后记住选择 | 维护者 2026-10-01 提出。描述生成会把图像发往模型服务，可能涉及版权图与外部费用，发送动作须由用户逐次发起；记住选择会让后续批次在用户不知情时外发 | 2026-10-01 |

## 17. 待确认问题

无。历史问题已全部转入 §16（Q1 → D-16，Q2 → D-17）。
