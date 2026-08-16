# 实现计划 · Atlas 图谱（人工策展的图文案例库）

> **用途**：把[《Atlas · 图谱》SDD](../sdd/feats/03-atlas/README.md)（`ready`）拆成可逐项执行、验证和提交的实现任务。
>
> **日期**：2026-08-16 · **类别**：plan（ce-plan 风格） · **状态**：draft
>
> **范围**：三进程都动。backend 新增 LanceDB 案例存储 + 导入解析 + REST；frontend 新增 Atlas 视图（Workbench 左侧栏 / Focus 右侧拓展区）与导入向导；agent-runtime 新增"图像入模型"能力、`/atlas/describe` 内部端点、图谱检索 + 两步 VLM 助手模块。首个内容场景：膜性肾病 EDD TEM 图谱。
>
> **完成线**：能导入一份含嵌入图的 PDF 与一个网页，框 ROI、填标签、勾选外发确认后案例入库并生成 VLM 描述；Atlas 页面两种模式下可浏览/检索/下架/恢复；`GET /atlas/exemplars/search` 按标签+文本返回 ≤ 10 条；runtime 侧 `AtlasClient` + `selectExemplars()` 两步助手有单测；SDD §15 除依赖 02 `locate_roi` 的三条外全部可勾。

---

## 1. 实施边界

### 1.1 本期目标

- backend：`app/atlas/` 包（LanceDB 表 + 图像目录 + 解析器 + 检索），`routers/atlas.py` 挂到 `main.py`；`GLAUX_ATLAS_ROOT` 配置；Python 侧出站守卫 `app/net_guard.py`（重建）。
- frontend：`View` 加 `"atlas"`；`components/atlas/` 组件族（AtlasView / ExemplarList / ExemplarDetail / ImportWizard / RoiPicker）；Focus 右侧拓展区可在 Stage 与 Atlas 间切换；会话内"参考图谱 N 条"卡片组件（先按事件契约做好，数据源等 02）。
- agent-runtime：`model-runtime` 增加带图像的单轮调用能力；`/agent-api/v1/atlas/describe` 端点；`src/atlas/` 模块（`AtlasClient`、`selectExemplars` 两步逻辑、事件构造）；`atlas.referenced` 事件类型进 contracts。
- CLI：`backend` 内 `python -m app.atlas.cli import-dataset`（COCO / YOLO / LabelMe）。
- 依赖：backend 加 `lancedb`、`pymupdf`、`httpx`（升为运行依赖）、`beautifulsoup4`；agent-runtime 零新依赖（pi-ai 图像内容块已核实可用，见 §5）。

### 1.2 明确不做

- 不实现 02 的 `locate_roi`；本期只交付它将调用的 runtime 模块与接线点（§1.3-1）。
- 不做视觉 embedding、受控词表、在线沉淀、SAM2、像素掩膜导入、扫描版 PDF（SDD §2）。
- 不改 dockview 布局键 `glaux.layout.v1` 的结构（Atlas 复用 `sidebar` 面板，仅切 `sidebarView`）。
- 不做多用户/权限；不做案例导出。

### 1.3 SDD 不变量与既定偏差处理

1. **`locate_roi` 接线延后到 02 实现期。** SDD §5.2/§6.3 描述的"两步 VLM 后定位"依赖 02 的工具；02 目前 `draft`。本期在 runtime 交付 `AtlasClient.search()` + `selectExemplars()`（第一步：VLM 从候选挑 1–3 张）+ `atlas.referenced` 事件构造，并以 fake model 单测覆盖；"第二步定位"与事件发射由 02 的 `locate_roi` 调用。SDD §15 涉及 `locate_roi` 的三条验收项在本期标"无法验证（依赖 02）"，SDD 保持 `ready` 语义不变，此偏差在 SDD §14 已声明（03 与 02 解耦）。
2. **图像入模型是新能力。** agent-runtime 今天只把 `image_id` 字符串给工具，从不向模型发像素。T5 新增 `describeImage()`/`chooseAmongImages()` 走 pi-ai 的图像内容块；这一能力同样是 02 的前置，实现时按 SDD 03 §7.6 的模板契约做，不为 02 预设额外接口。
3. **backend 主进程不加载重模型**（架构不变量）：LanceDB / PyMuPDF / httpx / bs4 均为数据 IO 库，允许进主进程；VLM 描述生成通过 HTTP 调 agent-runtime，backend 不引入任何 LLM SDK。
4. **出站守卫**：backend 的 `net_guard.py` 已在退役 P3 删除；网页导入需要它，本期按 `agent-runtime/src/security/net-guard.ts` 的规则（scheme 限 http/https、解析后 IP 分类、私网/环回/链路本地/fake-ip 默认拒绝、`GLAUX_VLM_ALLOW_FAKEIP` 同名开关）在 Python 侧重建，并复制其测试用例。
5. **外发分级**：runtime 侧 `AtlasClient.search()` 必须传 `egress`；托管 provider 一律 `shareable`，只有连接被判定为本地（baseUrl 解析为环回）时才 `any`。判定函数放 runtime，backend 不猜。

## 2. 当前状态证据

| 证据 | 现状 | 对计划的约束 |
| --- | --- | --- |
| [routers/api.py:35](../../backend/app/routers/api.py) / [main.py:37](../../backend/app/main.py) | 单一 `APIRouter()` 无前缀，`app.include_router(router)`；路径扁平按 `tags` 分组 | 新建 `routers/atlas.py` 独立 `APIRouter(prefix="/atlas", tags=["atlas"])`，`main.py` 第二个 `include_router` |
| [config.py:21-38](../../backend/app/config.py) | `_env_path()` 模式；`GLAUX_DATA_ROOT` → `DATA_ROOT` | 加 `GLAUX_ATLAS_ROOT`（默认 `~/glaux_atlas`，**不**放 DATA_ROOT 下——那是 CUBS 数据集根），下设 `db/` 与 `images/` |
| [routers/api.py:340-349](../../backend/app/routers/api.py) | `GET /image/{id}` 返回 `Response(media_type="image/png")`；前端 `imageUrl()` 只拼 URL | Atlas 原图/裁剪图照此：`GET /atlas/exemplars/{id}/image|crop`，前端 URL builder |
| [pyproject.toml:6-31](../../backend/pyproject.toml) | 运行依赖无 httpx（仅 dev）；注明"主进程无 LLM SDK / 无 TF" | `lancedb pymupdf httpx beautifulsoup4` 进 `dependencies`，注释说明为 IO 库 |
| [tests/test_api.py:9-16](../../backend/tests/test_api.py) | 模块级 `TestClient(app)`，无 conftest | Atlas 测试用 `tmp_path` + monkeypatch `config.ATLAS_ROOT` |
| [session.ts:105](../../frontend/src/store/session.ts) / [ActivityBar.tsx:6](../../frontend/src/components/ActivityBar.tsx) / [SideBar.tsx:346-352](../../frontend/src/components/SideBar.tsx) / [Shell.tsx:27](../../frontend/src/components/Shell.tsx) | `View = "explorer" \| "market"`；ActivityBar `key` 为 i18n 键硬联合；SideBar 按 `view` 分支；Shell 面板标题三元 | 四处各加一个 `"atlas"` 分支；Shell 标题改查表 |
| [FocusShell.tsx:81-101](../../frontend/src/components/focus/FocusShell.tsx) / [session.ts:69-73](../../frontend/src/store/session.ts) | 右列为 `StagePanel`，由 `hasVisual && stageOpen` 门控；`FocusLayout {railOpen, stageOpen}` | `FocusLayout` 加 `rightView: "stage" \| "atlas"`（默认 `stage`），右列按它渲染 StagePanel 或 AtlasPanel；顶栏加切换钮 |
| [client.ts:34-70](../../frontend/src/api/client.ts) | `BASE="/api"`，`get/post` 助手，`api` 对象 | 新增 `api.atlas.*`：`list/search/get/create/retire/restore/delete/importPdf/importUrl/tags` + `imageUrl/cropUrl` |
| [i18n/en.ts](../../frontend/src/i18n/en.ts) 末行 `I18nKey` | 扁平键，en 为类型源 | 新键前缀 `atlas_`，中英同步 |
| [uiMode.test.ts](../../frontend/src/store/uiMode.test.ts) | store 测试范式 | `atlasView.test.ts` 照此 |
| [run-task.ts:92-104](../../agent-runtime/src/pi/tools/run-task.ts) / [harness-registry.ts:49-53](../../agent-runtime/src/pi/harness-registry.ts) | 工具工厂 + `defaultToolFactory` 数组 | 本期**不**新增工具（接线归 02）；`src/atlas/` 只是库模块 |
| [model-runtime.ts:86+](../../agent-runtime/src/pi/model-runtime.ts) / [contracts.ts:69](../../agent-runtime/src/contracts.ts) | 只构造模型；无图像内容块；`ViewerContext.image_id` 是字符串 | T5 新增 `vision.ts`：`describeImage(runtime, png, template)`、`chooseAmongImages(runtime, target, candidates)`（pi-ai `ImageContent` 已核实） |
| [connection-routes.ts:11-19](../../agent-runtime/src/transport/connection-routes.ts) / [server.ts:45-46](../../agent-runtime/src/transport/server.ts) | 路由函数按需注册，路径全写 | `registerAtlasRoutes(server, deps)`：`POST /agent-api/v1/atlas/describe` |
| [net-guard.ts:134-144](../../agent-runtime/src/security/net-guard.ts) | `classifyIp` / `assertUrlAllowed` | Python 重建以此为规范；`tests/security/net-guard.test.ts` 用例平移 |
| [Makefile:32-41](../../Makefile) | `make test` 三段；backend 测试带 TMPDIR 兜底 | 不加新 target；CLI 走 `uv run python -m app.atlas.cli` |

## 3. 任务分解

### T1 · backend 存储与检索（SDD §9 / §7.2 / §7.7 / §10 / §11）
- `app/atlas/store.py`：LanceDB 表 `exemplars`，schema 严格对齐 SDD §9（含 `status`、`egress_consent`、`import_batch_id`）；`open()` 惰性建表；`upsert()` 以幂等键 `(source_type, source, image_sha256, roi)` 查重；`retire/restore/delete`（delete 前查 `referenced` 标记，见 T1 末条）；`list(filters)`。
- `app/atlas/images.py`：原图与裁剪图落 `ATLAS_ROOT/images/<sha256[:2]>/<sha256>.png`，裁剪按 `roi` 生成；返回相对路径。
- `app/atlas/search.py`：标签归一（`normalize_tag`：trim / NFKC 全半角 / casefold）；`search(tags, q, egress, limit=10)`：用 LanceDB 原生 FTS（BM25，`FTS(base_tokenizer="ngram", ngram_min_length=2, ngram_max_length=3, prefix_only=False)`，中英文皆可分词——见 §5 核实记录）对合成列 `search_text = caption + description.summary + findings[].name + extra.values` 检索，`where` 预过滤 `status='active'` + `array_has_any(tags, …)` + egress → 截断 10；`q` 为空时退化为仅过滤 + 按 `created_at` 倒序。不自写计分、不引模型。
- `app/atlas/referenced.py`：`mark_referenced(exemplar_ids)`（runtime 在 `atlas.referenced` 时回调 `POST /atlas/exemplars/referenced`），落一张小表 `exemplar_refs`，硬删除前检查。
- `config.py`：`ATLAS_ROOT = _env_path("GLAUX_ATLAS_ROOT", HOME / "glaux_atlas")`、`AGENT_RUNTIME_URL`。

### T2 · backend 导入解析与 REST（SDD §4 / §6.1 / §6.2 / §13）
- `app/atlas/parse_pdf.py`：PyMuPDF 遍历页 → `page.get_images()` 抽嵌入图（过滤 < 64px 与纯色）→ 同页文本块中与图 bbox 最近的段落作 `caption` 候选 + 页码；无嵌入图 → `NO_FIGURES_FOUND`。
- `app/net_guard.py`（重建）+ `app/atlas/parse_web.py`：`assert_url_allowed()` 后 `httpx.get`（超时 10s、最大 10MB、只跟 http(s) 重定向且每跳再校验）→ bs4 抽 `<img>`（跳过 data:/svg/图标尺寸）+ `alt` / `<figcaption>` / 最近 `<p>`；图片 URL 逐个再过守卫再抓；失败码 `FETCH_BLOCKED` / `FETCH_FAILED`。
- `app/atlas/importer.py`：批次 `import_batch_id`；`create_exemplars(items)`：写图 → 写表（`describe_status="pending"`）；VLM 描述由前端调 runtime 后经 `PUT /exemplars/{id}/description` 写回（凭据不经 backend）；CLI `--describe` 时由 CLI 进程直接调 runtime（`GLAUX_AGENT_RUNTIME_URL`，默认 `http://127.0.0.1:8010`，凭据取环境变量）；`egress=shareable` 时必须带 `egress_consent`，否则 422。
- `app/atlas/cli.py`：`import-dataset <dir> --format coco|yolo|labelme --tags … --source-name … --license … [--shareable --i-confirm-egress]`；多边形 → 外接框 `roi` + `geometry`；可重跑（幂等键）。
- `routers/atlas.py`（`prefix="/atlas"`）：`POST /imports/pdf`（multipart）→ 候选列表；`POST /imports/url` → 候选列表；`POST /exemplars`（批量创建）；`GET /exemplars`（list + filters）；`GET /exemplars/search`；`GET /exemplars/{id}`、`/image`、`/crop`；`POST /exemplars/{id}/retire|restore`；`PUT /exemplars/{id}/description`；`DELETE /exemplars/{id}`；`POST /exemplars/referenced`；`GET /tags`（频次）。
- `main.py`：`app.include_router(atlas_router)`。

### T3 · frontend Atlas 视图（SDD §5.1 / §8 / D-14）
- `store/session.ts`：`View` 加 `"atlas"`；`FocusLayout` 加 `rightView`（loader 损坏回退 `stage`）；`setFocusLayout` 已有。
- `api/atlas.ts`（独立模块，避免与 client.ts 循环引用）：`atlasApi.*` 与类型（`Exemplar`、`ImportCandidate`、`ImportSession`、`ExemplarInput`、`AtlasApiError` 带后端错误码）；`agent/runtime/client.ts` 加 `atlasDescribe`。
- `components/atlas/AtlasView.tsx`：搜索框 + 标签筛选条（`GET /tags`）+ 状态筛选（active/retired）+ `ExemplarList`；点击进 `ExemplarDetail`（原图 + ROI 叠加 canvas + 图注 + description 表格 + 来源 + egress 徽标 + 下架/恢复/删除/重试描述）。
- `components/atlas/ImportWizard.tsx`：三步——① 选 PDF 或填 URL → 候选网格（缩略图 + 图注，勾选）；② 逐图 `RoiPicker`（轻量 DOM 矩形叠加，SDD D-18；一图多框，每框独立标签输入 + 已有标签联想）；③ 来源信息 + 外发许可（默认 local-only；切 shareable 弹出协议文本 + 勾选框，未勾不能提交）→ 提交 → 结果摘要。
- Workbench：`ActivityBar` 加 Atlas 入口（图标：打开的书）；`SideBar` 加 `view === "atlas"` 分支；`Shell.tsx` 标题改查表。
- Focus：`FocusShell` 右列按 `focusLayout.rightView` 渲染 `StagePanel` 或 `AtlasPanel`（同一 `AtlasView`，窄版样式）；`FocusTopBar` 加"图谱"切换钮（参考 Codex 右侧面板：常驻可折叠、与舞台互斥）。
- `components/agent/AtlasRefCard.tsx`：渲染 `atlas.referenced` 事件（候选 N、选中 K、被外发排除 M；点开跳 `ExemplarDetail`；案例已下架/删除时显示快照缩略图 + 标记）。本期只做组件与事件类型解析，会话中出现依赖 02。
- 样式：`global.css` 追加 `.atlas-*` section；Focus 内以 `.focus-shell .atlas-view` 作用域收窄。
- i18n：`atlas_*` 键中英齐备（入口、向导三步、协议文本、状态、错误码文案）。

### T4 · frontend 测试
- `store/atlasView.test.ts`：`sidebarView="atlas"` 设置/持久化；`focusLayout.rightView` 缺省 / 损坏回退。
- `components/atlas/ImportWizard.test.tsx`：shareable 未勾选不能提交；勾选后请求体含 `egress_consent`；`NO_FIGURES_FOUND` 呈现手动上传引导。
- `components/agent/AtlasRefCard.test.tsx`：三种数量渲染；已删除案例的降级展示。

### T5 · agent-runtime 视觉调用、describe 端点、图谱助手（SDD §7.6 / §6.3 / §12）
- ~~核实 pi-ai 0.82.1 的图像内容块 API~~ **已核实（2026-08-16，见 §5）**：`UserMessage.content` 接受 `ImageContent {type:"image", data:base64, mimeType}`，anthropic-messages 与 openai-completions 两条路径对用户消息中的图像块**无条件转换**（`model.input.includes("image")` 只门控工具结果里的图像）。直接用 pi-ai，不走原生 SDK；`tests/compatibility/pi-public-api.test.ts` 追加类型断言以钉住此契约。
- 顺带修正：`model-runtime.ts:120` 对非 Anthropic 模型硬编码 `input: ["text"]`，改为探测结果 `vision === "yes"` 时为 `["text","image"]`（否则未来工具结果里的图会被静默丢弃）。
- `src/pi/vision.ts`：`describeImage(runtime, {png, hint}) → Description`（提示词嵌入 SDD §7.6 固定字段 + `extra`，要求 JSON 输出，解析失败重试一次后抛 `DESCRIBE_FAILED`）；`chooseAmongImages(runtime, {target, candidates:[{id,png,summary}], k}) → id[]`。
- `src/transport/atlas-routes.ts`：`POST /agent-api/v1/atlas/describe`（body：png base64 + 可选 hint + 连接凭据同 `/connection/*` 的传法）→ Description；凭据只在请求内存（沿用 00 约束）。
- `src/atlas/client.ts`：`AtlasClient(backendBaseUrl)`：`search({tags, q, egress})`、`fetchCrop(id)`、`markReferenced(ids)`；`egressFor(connection)`：baseUrl 解析为环回 → `any`，否则 `shareable`。
- `src/atlas/select.ts`：`selectExemplars(runtime, client, {tags, q, targetPng}) → {candidates, selected, excludedByEgress}`：候选 0 → 直接返回；≤ 3 → 跳过挑选；否则调 `chooseAmongImages`。
- `src/contracts.ts`：`atlas.referenced` 事件 payload 类型（候选 ids、选中 ids、excluded 数、trace_id）；`makeAtlasReferencedEvent()`。
- 测试：`tests/integration/atlas-describe.test.ts`（fake provider 返回固定 JSON；schema 校验；失败重试）、`tests/integration/atlas-select.test.ts`（0/2/6 候选三条路径；egress 过滤计数）、`tests/security/atlas-routes.test.ts`（凭据不落日志）。

### T6 · backend 测试
- `tests/test_atlas_store.py`：幂等键去重、标签归一一致性、search 只返回 active、egress 过滤、retire/restore/delete 门禁。
- `tests/test_atlas_parse.py`：用 PyMuPDF 现场生成含嵌入图的 PDF → 抽出；纯文本 PDF → `NO_FIGURES_FOUND`。
- `tests/test_net_guard.py`：平移 TS 用例（私网/环回/fake-ip/开关）。
- `tests/test_atlas_api.py`：REST 全端点；`shareable` 缺 consent → 422；describe 失败仍入库且 `describe_status=pending`（monkeypatch runtime 调用）。
- `tests/test_atlas_cli.py`：COCO 小样本目录导入 + 重跑幂等。

### T7 · 种子与价值验证（SDD D-12 / D-17）
- 准备 EDD TEM 种子：维护者自有 TEM 图（可 shareable）+ 教科书/开放获取文献插图（local-only 或勾选后 shareable）；目标先到每桶 10–30 张。
- 固定 10 张自有 TEM 测试图 + 人工框；脚本 `scripts/atlas-eval.ts`（runtime 侧）：对每张图分别跑"无图谱直接让 VLM 给 bbox"与"`selectExemplars` 后 few-shot 给 bbox"，输出 IoU 均值/中位数。**本期只交付脚本与首轮数字，不设通过阈值**（02 落地后再复跑）。

### T8 · 收尾
- SDD §15 逐项自查，出"已完成 / 未完成 / 无法验证（依赖 02）"三类清单；SDD → `implemented`。
- `docs/architecture.zh-CN.md` 目录树与三进程图补 Atlas；`docs/runbooks/` 加 `atlas-import.md`（PDF/网页/CLI 三种导入、外发协议、环境变量）。

## 4. SDD §15 验收映射

| 验收项 | 验证方式 |
| --- | --- |
| 文字版 PDF 导入出候选，勾选/框/标签后入库 `textbook` | T6 API 测试 + 浏览器走查 |
| 扫描版 PDF → `NO_FIGURES_FOUND`，无残留 | T6 parse 测试 |
| 公网 URL 出候选；私网/fake-ip → `FETCH_BLOCKED` 无对外请求 | T6 net_guard + API 测试（monkeypatch httpx 断言未调用） |
| COCO 多边形导入，`geometry`/`roi` 正确，重跑幂等 | T6 CLI 测试 |
| 同图同 ROI 重复导入同 id | T6 store 测试 |
| 标签归一检索一致 | T6 store 测试 |
| `egress=shareable` 不含 local-only 与 retired | T6 store 测试 |
| ≥ 4 候选时先挑选后定位，会话出卡片 | **无法验证（依赖 02 `locate_roi`）**；本期以 T5 `atlas-select` 测试覆盖挑选步 |
| 无匹配时与无 Atlas 一致 | **无法验证（依赖 02）**；T5 测试覆盖候选 0 直返 |
| 外发开关关闭时任何案例不外发，卡片提示排除数 | **无法验证（依赖 02）**；T5 `egressFor` + 过滤计数测试 |
| 下架不可检索、历史卡片可开、恢复可检索 | T6 store/API + T4 卡片测试 |
| 被引用过的不可硬删 | T6 store 测试（先 `mark_referenced`） |
| describe 失败仍入库可重试；成功含全部固定字段且 `extra` 为对象 | T6 API + T5 describe 测试 |
| 检索链路无 torch | T6：`sys.modules` 断言 `torch` 不在 |

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| pi-ai 0.82.1 图像内容块 API 与预期不符 / 某 provider 不支持多图 | **已消解（2026-08-16 核实）**：pi-ai `ImageContent` 在两条 API 路径均无条件转换为 provider 原生图像块。剩余风险仅"某 provider 单条消息多图上限"，`chooseAmongImages` 保留退化路径：逐张打分（k 次单图调用） |
| LanceDB 在 WSL 下的 wheel / 文件锁兼容问题 | **已消解（2026-08-16 核实）**：WSL + uv/py3.12 下 `lancedb 0.37.1 / pyarrow 25 / pymupdf 1.28.2 / bs4 / httpx` 一次装通；建表、`array_has_any` 标签过滤、原生 FTS（BM25）+ `where` 预过滤均正常；`ngram(2–3)` 分词器中文命中正确、`simple` 分词器对中文失效（故 T1 采用 ngram）。表目录固定在 WSL 侧 `ATLAS_ROOT` |
| PyMuPDF 抽嵌入图 + 同页文本 | **已消解（2026-08-16 核实）**：`page.get_images()` 返回嵌入图元信息、`page.get_text()` 取同页文本，满足 T2 解析需求 |
| PDF 邻近文本判定不准（图注跑到别的图） | 图注只是候选，向导里可编辑；不追求解析精度 |
| 网页抓取被站点反爬/需登录 | 只做匿名 GET；失败即 `FETCH_FAILED` 引导手动上传 |
| 教科书版权 | 缺省 local-only；shareable 须勾选协议并落 `egress_consent`；协议文本 i18n 双语 |
| Focus 右列 Stage/Atlas 互斥影响既有走查 | `rightView` 默认 `stage`，不改现有默认路径；损坏回退 `stage` |
| 03 完成后 02 迟迟不落，图谱"只能看不能用" | T7 eval 脚本本身就是"用"的最小闭环；同时 Atlas 页面的检索对用户可见，具备独立价值 |

## 变更记录

- **2026-08-16**：v1，依据 `ready` SDD 制定；§1.3-1 记录 `locate_roi` 接线延后到 02、§1.3-2 记录图像入模型为新能力。
- **2026-08-16**：v1.1，开工前核实三项待确认（pi-ai 图像块、LanceDB+PyMuPDF 在 WSL 可用性、LanceDB FTS 中文分词），结论回写 §3-T1/T5 与 §5；T1 文本检索改用 LanceDB 原生 FTS(ngram)。
- **2026-08-16**：v1.2，T3/T4 落地时的两处调整回写 SDD（D-18 RoiPicker 不复用 cornerstone；D-19 Focus 右侧 rightView 互斥 + 会话卡片跳转），`api.atlas` 改为独立 `api/atlas.ts`；导入向导 NO_FIGURES_FOUND / FETCH_BLOCKED / FETCH_FAILED 三类错误分别呈现，手动上传作为兜底路径。
