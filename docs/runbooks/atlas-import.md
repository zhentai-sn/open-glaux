---
kind: living
status: living
---

# Atlas · 图谱导入 runbook —— PDF / 网页 / 数据集三种导入、外发协议、环境变量

> 规范：[docs/sdd/feats/03-atlas/README.md](../sdd/feats/03-atlas/README.md) ·
> 计划：[docs/plans/2026-08-16-001-feat-atlas-plan.md](../plans/2026-08-16-001-feat-atlas-plan.md)

## 一句话

图谱（Atlas）= 一本人工策展的、带插画的教科书：把教科书插图 / 网页图片 / 标注数据集样本导入为
"图 + ROI + 标签 + 图注 + VLM 结构化描述"的案例，agent 定位前先"翻图谱"做 few-shot。
写入口只有导入；agent 通过 `consult_atlas` 工具或 `locate_roi` 的内部检索读取图谱，对图谱无写权限。

## 进程与端口

| 进程 | 职责 | 端点 |
| --- | --- | --- |
| backend :8000 | LanceDB 存储、图像目录、PDF/网页抽图、REST | `/atlas/*` |
| agent-runtime :8010 | VLM 描述生成、检索先验（挑选步） | `POST /agent-api/v1/atlas/describe` |
| frontend :5173 | Atlas 页面（Workbench 活动栏「图谱」/ Focus 右侧栏「图谱」标签）、导入向导；只在完整版，对话预览版不含图谱 | 反代 `/api/atlas/*` → backend，`/agent-api/*` → runtime |

凭据边界：VLM 凭据只从前端 / CLI 发往 agent-runtime，**不经 backend**；backend 只保存描述结果。

## 环境变量

| env | 进程 | 缺省 | 作用 |
| --- | --- | --- | --- |
| `GLAUX_ATLAS_ROOT` | backend | `~/glaux_atlas` | 图谱根：`db/`（LanceDB）、`images/`（sha256 寻址 PNG）、`staging/`（导入暂存）。不要放进 `GLAUX_DATA_ROOT`（那是 CUBS 数据集根） |
| `GLAUX_AGENT_RUNTIME_URL` | backend CLI | `http://127.0.0.1:8010` | CLI `--describe` 直连 runtime |
| `GLAUX_BACKEND_URL` | agent-runtime | `http://127.0.0.1:8000` | runtime `AtlasClient` 访问 backend |
| `GLAUX_VLM_HOST_ALLOW` | backend、agent-runtime | 空 | 出站守卫白名单（逗号分隔 host），网页导入 / 模型调用同规则 |
| `GLAUX_VLM_ALLOW_FAKEIP` | backend、agent-runtime | **默认放行**（置 `0`/`false`/`no`/`off` 关闭） | `198.18.0.0/15` fake-ip 段默认放行——走 fake-ip 代理（Clash 等）的机器开箱即用；其余私网段无论开关一律拒 |
| `GLAUX_VLM_PROVIDER / MODEL / BASE_URL / API_KEY / CONTEXT_WINDOW / MAX_TOKENS` | CLI `--describe`、`atlas-eval.ts` | — | 凭据取环境变量，只进 runtime 进程内存 |

## 导入方式一：教科书 PDF（Atlas 页面）

1. 打开 Atlas（Workbench 活动栏"图谱"，或 Focus 右侧栏的"图谱"标签）→ ＋ 导入 → "教科书 PDF" → 选文件 → 抽取插图。
   backend `POST /atlas/imports/pdf` 用 PyMuPDF 抽嵌入图 + 同页最近文本块作图注，候选暂存 `staging/<import_id>/`（不入库）。
2. 勾选要保留的插图 → 下一步：在每张图上拖拽框 ROI（一图多框；单击选中、双击删除，"整图作为一个区域"兜底），
   每框填标签（逗号分隔，联想已有标签）与图注（默认带入抽取图注）。
3. 下一步：书名 / 版次 / 页码；外发许可缺省 **仅本地（local-only）**；改"可外发（shareable）"必须勾选
   "我确认有权将该图发往第三方模型服务，且图中不含个人身份信息"，勾选记录随请求 `egress_consent{confirmed_at, import_batch_id, statement_version}` 保存。
4. 提交 → `POST /atlas/exemplars`（幂等键 `(source_type, source, image_sha256, roi)`，重复导入返回同一 `exemplar_id`）。
   勾选"导入后生成 VLM 描述"且连接设置里选了视觉模型时，前端逐条：取裁剪图 → runtime `/atlas/describe` → `PUT /atlas/exemplars/{id}/description`。
   描述失败案例仍入库，标"待补描述"，详情页可重试。

扫描版 PDF（无嵌入图）返回 `NO_FIGURES_FOUND`：向导提示手动上传截图（"手动上传图片"，走 `image_base64`），其余步骤相同。

## 导入方式二：网页 URL

同上，第一步选"网页 URL"。backend `POST /atlas/imports/url` 用 httpx + bs4 抽 `<img>` + alt / figcaption / 邻近段落；
逐跳过出站守卫（解析后 IP：回环与 fake-ip 段放行；私网 / 链路本地 / 保留拒绝 → `FETCH_BLOCKED`），公开地址允许明文 http，
不执行脚本、不带凭据、有大小与超时上限；抓取失败 `FETCH_FAILED` → 引导手动上传。

## 导入方式三：标注数据集（CLI）

```bash
cd backend && uv run python -m app.atlas.cli import-dataset /path/to/dataset --format coco --tags TEM,EDD,GBM --source-name "MN-EDD-v1" --license CC-BY-4.0
```

- `--collection 肾脏/膜性肾病/EDD`：归入图册（v1.1，路径式，`/` 分级，缺省根目录 = "未分册"）；页面导入向导第三步同名输入框，详情页可"移动"。
- `--format coco|yolo|labelme`：多边形 → 外接框 `roi` + 多边形存 `geometry`；检测框直接作 `roi`。
- `--shareable` 必须同时 `--i-confirm-egress`（等价于页面勾选协议）。
- `--describe`：CLI 进程直接调 runtime 生成描述（凭据取 `GLAUX_VLM_*` 环境变量，不经 backend）；不带则 `describe_status=skipped`。
- `--limit N` 先导小样；同一命令可重跑（幂等，只补缺）。

## 检索、下架、删除

- 检索 `GET /atlas/exemplars/search?tags=…&q=…&egress=shareable|any&limit=10[&collection=肾脏/膜性肾病]`：[图册范围 →] 标签过滤 → FTS(ngram) → 只返回 `active` → egress 过滤 → 排序截断。图册树 `GET /atlas/collections`；移动 `PUT /atlas/exemplars/{id}/collection`。
  `egress=any` 只有 runtime 判定连接 base_url 解析为回环（本地模型）时才用；托管 provider 一律 `shareable`。
- Focus 模式下图谱是右侧栏（舞台 / 文件 / 图谱）的一个标签，可折叠成图标竖条；Workbench 仍在左侧活动栏。
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
| "先在连接设置里选择一个视觉模型" | 描述生成需要 ⚙ 连接设置里选定支持图像的模型 |
| 描述"待补描述" | VLM 返回非 JSON 两次 / 网络失败 → 详情页"生成描述"重试 |
