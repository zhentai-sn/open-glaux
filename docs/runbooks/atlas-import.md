---
kind: living
status: living
---

# Atlas · 图谱导入 runbook —— 页面上传、数据集 CLI、外发协议、环境变量

> 规范：[docs/sdd/feats/03-atlas/README.md](../sdd/feats/03-atlas/README.md) ·
> 计划：[docs/plans/2026-08-16-001-feat-atlas-plan.md](../plans/2026-08-16-001-feat-atlas-plan.md)

## 一句话

图谱（Atlas）= 一本人工策展的、带插画的教科书：上传图片、PDF、网页或用 CLI 导入标注数据集，形成
"图 + ROI + 标签 + 图注 + VLM 结构化描述"的案例，agent 定位前先"翻图谱"做 few-shot。
上传即入库，字段由系统补齐、人工修改；写入口只有页面上传与 CLI；agent 通过 `consult_atlas` 工具或 `locate_roi` 的内部检索读取图谱，对图谱无写权限。

## 进程与端口

| 进程 | 职责 | 端点 |
| --- | --- | --- |
| backend :8000 | LanceDB 存储、图像目录、PDF/网页抽图、REST | `/atlas/*` |
| agent-runtime :8010 | VLM 描述生成、检索先验（挑选步） | `POST /agent-api/v1/atlas/describe` |
| frontend :5173 | Atlas 页面（Focus 左侧栏「图谱」入口 / Workbench 活动栏「图谱」）、上传入口与案例编辑；只在完整版，对话预览版不含图谱 | 反代 `/api/atlas/*` → backend，`/agent-api/*` → runtime |

凭据边界：VLM 凭据只从前端 / CLI 发往 agent-runtime，**不经 backend**；backend 只保存描述结果。

## 环境变量

| env | 进程 | 缺省 | 作用 |
| --- | --- | --- | --- |
| `GLAUX_ATLAS_ROOT` | backend | `~/glaux_atlas` | 图谱根：`db/`（LanceDB）、`images/`（sha256 寻址 PNG）。不要放进 `GLAUX_DATA_ROOT`（那是 CUBS 数据集根） |
| `GLAUX_AGENT_RUNTIME_URL` | backend CLI | `http://127.0.0.1:8010` | CLI `--describe` 直连 runtime |
| `GLAUX_BACKEND_URL` | agent-runtime | `http://127.0.0.1:8000` | runtime `AtlasClient` 访问 backend |
| `GLAUX_VLM_HOST_ALLOW` | backend、agent-runtime | 空 | 出站守卫白名单（逗号分隔 host），网页导入 / 模型调用同规则 |
| `GLAUX_VLM_ALLOW_FAKEIP` | backend、agent-runtime | **默认放行**（置 `0`/`false`/`no`/`off` 关闭） | `198.18.0.0/15` fake-ip 段默认放行——走 fake-ip 代理（Clash 等）的机器开箱即用；其余私网段无论开关一律拒 |
| `GLAUX_VLM_PROVIDER / MODEL / BASE_URL / API_KEY / CONTEXT_WINDOW / MAX_TOKENS` | CLI `--describe`、`atlas-eval.ts` | — | 凭据取环境变量，只进 runtime 进程内存 |

## 导入方式一：页面上传（图片 / PDF / 网页）

1. 打开 Atlas（Focus 左侧栏的"图谱"入口，或 Workbench 活动栏"图谱"），在要放入的图册下（图册树选中节点；"全部""未分册"落根目录）：
   - 点「上传」选文件，或把文件拖进图谱列表：`POST /atlas/uploads`（multipart，`files[]` + `collection`）。
   - 在地址框填网页 URL →「导入网页」：`POST /atlas/uploads/url`。
2. 请求返回即已入库（`active`）：
   - 图片：一文件一条，`source_type=upload`，`source={filename}`。
   - PDF：PyMuPDF 抽全部嵌入图（短边 < 64px 与纯色图过滤），每张一条，`source_type=textbook`，`source={filename, title?, page, figure}`，图注取同页最近文本块。
   - 网页：httpx + bs4 抽全部 `<img>`，每张一条，`source_type=web`，`source={url, image_url}`，图注取 alt / figcaption；
     逐跳过出站守卫（回环与 fake-ip 段放行；私网 / 链路本地 / 保留拒绝 → `FETCH_BLOCKED`），公开地址允许明文 http，不执行脚本、不带凭据。
   - 所有新案例：ROI 为整图 `[0, 0, w, h]`、标签为空、外发许可 **仅本地（local-only）**、`describe_status=pending`、`reviewed=false`。
3. 单次上限：50 个文件、单文件 50 MB、200 条案例，超限整批拒绝 `UPLOAD_TOO_LARGE`。单个文件失败（扫描版 PDF `NO_FIGURES_FOUND`、`UNSUPPORTED_FILE`、`BAD_IMAGE`）只列在本批结果里，不影响同批其它文件。
4. 生成描述须用户确认：列表顶部确认条写明待描述张数与目标「模型 · host」，点「生成描述」才发图（runtime `/atlas/describe` → `PUT /atlas/exemplars/{id}/description`，并发 2、失败自动重试 1 次）；点「暂不」保持待描述。确认不记忆，切换连接后须重新确认。
   描述写回时，未确认案例自动补标签（`modality`、`subject`、`findings[].name`，≤ 8）与空图注（`summary`）。
5. 整理（详情页，`PATCH /atlas/exemplars/{id}`，任何修改即置 `reviewed=true`，之后描述不再覆盖标签与图注）：
   - 改标签、图注、备注、书名 / 版次、图册、外发许可；改为「可外发」须勾选"我确认有权将该图发往第三方模型服务，且图中不含个人身份信息"，记录写入 `egress_consent{confirmed_at, import_batch_id, statement_version}`。
   - 「重新框选」改 ROI（`[x, y, w, h]`）：重建裁剪图，描述回到待描述。
   - 「在此图上添加区域」：`POST /atlas/exemplars/{id}/regions`，同一原图新建一条案例，继承来源、图册、外发许可与标签。
   - 「标为已确认」：`PATCH {reviewed: true}`。
   - 列表多选后可批量移动图册、改外发许可、标为已确认、生成描述、下架、删除，按条汇报结果。

## 导入方式二：标注数据集（CLI）

```bash
cd backend && uv run python -m app.atlas.cli import-dataset /path/to/dataset --format coco --tags TEM,EDD,GBM --source-name "MN-EDD-v1" --license CC-BY-4.0
```

- `--collection 肾脏/膜性肾病/EDD`：归入图册（v1.1，路径式，`/` 分级，缺省根目录 = "未分册"）；页面上传时取当前图册，详情页可改。CLI 导入的案例 `reviewed=true`。
- `--format coco|yolo|labelme`：多边形 → 外接框 `roi` + 多边形存 `geometry`；检测框直接作 `roi`。
- `--shareable` 必须同时 `--i-confirm-egress`（等价于页面勾选协议）。
- `--describe`：CLI 进程直接调 runtime 生成描述（凭据取 `GLAUX_VLM_*` 环境变量，不经 backend）；不带则 `describe_status=skipped`。
- `--limit N` 先导小样；同一命令可重跑（幂等，只补缺）。

## 检索、下架、删除

- 检索 `GET /atlas/exemplars/search?tags=…&q=…&egress=shareable|any&limit=10[&collection=肾脏/膜性肾病]`：[图册范围 →] 标签过滤 → FTS(ngram) → 只返回 `active` → egress 过滤 → 排序截断。图册树 `GET /atlas/collections`；移动 `PATCH /atlas/exemplars/{id}`（`{collection}`）。
  `egress=any` 只有 runtime 判定连接 base_url 解析为回环（本地模型）时才用；托管 provider 一律 `shareable`。
- Focus 模式下图谱从左侧栏入口打开，替换舞台占据右侧工作区；左侧栏点「舞台」回到舞台，再点「图谱」收起右侧栏；Workbench（需 `VITE_GLAUX_WORKBENCH=1`）仍在左侧活动栏。
- 下架 `POST /atlas/exemplars/{id}/retire`：不参与检索与默认列表，历史会话卡片仍可打开；`restore` 恢复。
- 硬删除 `DELETE /atlas/exemplars/{id}`：被会话引用过（`POST /atlas/exemplars/referenced` 写入 `exemplar_refs`）的返回 `REFERENCED`，只能下架。

## 价值验证脚本（SDD D-17）

```bash
cd agent-runtime
GLAUX_VLM_PROVIDER=openai-compatible GLAUX_VLM_MODEL=<vision-model> GLAUX_VLM_BASE_URL=http://localhost:11434/v1 GLAUX_VLM_API_KEY=<key-or-placeholder> \
GLAUX_VLM_CONTEXT_WINDOW=32768 GLAUX_VLM_MAX_TOKENS=1024 \
npx tsx scripts/atlas-eval.ts --manifest ../eval/tem-edd.json --out ../eval/tem-edd.result.json
```

manifest：`{"query": "…", "tags": ["TEM","EDD"], "items": [{"image": "img/001.png", "gt": [x0,y0,x1,y1]}, …]}`。
输出每张图"无图谱 / 有图谱"两种方式的 IoU 与均值 / 中位数。本期不设通过阈值；`locate_roi` 已实现（`agent-runtime/src/pi/tools/locate-roi.ts`），可直接复跑对比。
注意：pi-ai 对 openai-compatible 需要一个 API key 值，本地服务可填占位符。

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| Atlas 页面显示"图谱不可用（HTTP_404）" | backend 是旧进程（无 `/atlas` 路由）→ 重启 backend |
| "图谱不可用（ATLAS_UNAVAILABLE …）" | backend 缺 lancedb 依赖 → `cd backend && uv sync` |
| 网页导入一律 `FETCH_BLOCKED` | 目标解析到真实私网 → `GLAUX_VLM_HOST_ALLOW` 加白；若报的是 `198.18.x.x`，检查是否被显式设了 `GLAUX_VLM_ALLOW_FAKEIP=0` |
| "N 条案例待描述。先在设置里配置一个视觉模型连接" | 描述生成需要在「设置 → 模型与连接」里选定支持图像的模型 |
| 案例一直"待补描述" | 未在确认条点「生成描述」，或 VLM 返回非 JSON 两次 / 网络失败 → 确认条或详情页「生成描述」重试 |
| v1 库首次以 v2.0 打开 | backend 补 `reviewed` 列（旧案例为已确认），并把 v1 向导写入的 `textbook` / `web` 案例 ROI 由 `x0,y0,x1,y1` 换算为 `x,y,w,h`、重建裁剪图；旧 `staging/` 目录不再使用，可删除 |
