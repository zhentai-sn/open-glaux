# Glaux IDE · 前端设计稿与交互需求清单

> **用途**：把 Agentic IMT 标注器的前端（VS Code 式 IDE）定成可实现的 handoff 规范——
> 布局、设计 token、组件树、i18n、交互需求清单、后端契约。
> **日期**：2026-07-06 · **类别**：design（设计） · **状态**：v1 · **技术栈**：FastAPI + React
> **依据**：[纲领](../roadmaps/charter.zh-CN.md) · [计划 Phase B](../plans/2026-07-05-001-feat-cubs-imt-pipeline-plan.zh-CN.md)（U9 编排 / U10–U11 外壳与修正 UI）
> **视觉参照**：高保真交互 mockup（VS Code 布局，中英切换）——见会话 Artifact `v4-vscode-ide`。
> **半衰期提醒**：真实验证数值（IMT 0.918mm、vs A1 |bias| 66.6µm）来自 2026-07-06 端到端跑批，随模型/口径更新会变。

---

## 0. 一页纸

**是什么**：一个把「自然语言智能体」与「颈动脉 IMT 标注/测量」合到一起的 IDE 式工作台。
研究者在里面选图 → 智能体解释意图、跑内核（标定→分割→测量）、给出提议 → 人拖边界修正、智能体即时重测 → 结果携 provenance 入库。

**为什么是 IDE**：项目结构天然对位——数据集=**文件树**、分割模型适配器=**扩展/插件**、
影像标注=**编辑器**、编排智能体=**Copilot 式右栏**、测量=**底部面板**。这把「集成不自研、
模型无关」「确定性内核 + 意图独立失败面」直接画进了熟悉的交互范式。

**三条不可退让的产品不变量**（从科学内核继承）：
1. **测量确定性**：IMT 数字来自曲线原生 PDM，不经 LLM 估值；UI 只展示、可修正、可审计。
2. **意图守卫**：歧义/超范围**显式识别**（澄清/拒绝），绝不静默错跑——在 Agent 栏可见。
3. **标定硬拒绝**：无标定绝不出假 IMT；UI 需有对应的拒绝态。

---

## 1. 布局与信息架构

八区，网格式外壳（桌面优先，IDE 语义）：

```
┌───────────────────────── Title bar (菜单 + 标题 + 窗口控件) ─────────────────────────┐
├──┬──────────────┬──────────────────────────────────┬───────────────────────────────┤
│A │ Side bar     │ Editor                           │ Agent (secondary sidebar)     │
│c │  Explorer /  │  ├ Tabs + Breadcrumb             │  ├ 头(模型徽标)               │
│t │  Search /    │  ├ Canvas(影像+LI/MA+ROI+工具)   │  ├ 对话流(步骤/提议/澄清/拒绝)│
│i │  SCM /       │  └ ─────────────────────────     │  └ 指令输入 + 示例胶囊        │
│v │  Models      │  Bottom Panel(Measurements/       │                               │
│. │              │   Output/Problems, 可折叠)        │                               │
├──┴──────────────┴──────────────────────────────────┴───────────────────────────────┤
└───────────────────────── Status bar (分支/作业/工具/坐标/IMT/模型/语言/通知) ────────┘
```

| 区 | 职责 | 关键内容 |
| --- | --- | --- |
| **Title bar** | 应用标识 + 顶层菜单 | File/Edit/Selection/View/Run/Help；居中标题 `<file> — <workspace> — Glaux` |
| **Activity bar** | 切换侧边栏视图 + 全局动作 | Explorer · Search · SourceControl · **Models(角标=已装适配器数)** · Run&Measure · Settings |
| **Side bar** | 当前活动视图 | 见 §3–§5 |
| **Editor** | 影像标注主区 | 标签页 · 面包屑 · 画布 + 标注工具浮层 · 底部面板 |
| **Agent** | 智能体协作（**产品差异化 C 位**） | 意图→四步→提议；澄清/拒绝；修正后重测回话 |
| **Bottom panel** | 结构化结果与日志 | Measurements(测量+区域) · Output(内核日志) · Problems |
| **Status bar** | 全局状态 + 语言切换 | 分支 · 作业 37/100 · 工具 · 坐标 · IMT · 模型 · **EN/中** · 通知 |

**响应式**：`≥1120px` 全布局；`<1120px` 隐藏 Agent 栏（可由活动栏切出）；`<820px` 隐藏侧边栏。

---

## 2. 设计 Token

结构色借 VS Code Dark+，领域色（智能体/边界/语义）自定，冷调中性、非默认深色主题。

**颜色**
| 名 | 值 | 用途 |
| --- | --- | --- |
| editor / sidebar / activity / titlebar | `#1E1E1E` / `#252526` / `#2D2D30` / `#323233` | 结构底 |
| line / line2 / hover / sel | `#2B2B2B` / `#3C3C3C` / `#2A2D2E` / `#094771` | 描边 · 悬停 · 选中 |
| ink / mid / faint / bright | `#CCCCCC` / `#9D9D9D` / `#6E7681` / `#E7E7E7` | 文本层级 |
| accent / status | `#0E70C0` / `#0E639C` | 交互蓝 · 状态栏蓝（VS Code 签名） |
| **agent** | `#B58BF2` | 智能体专属紫（发言/提议/步骤） |
| LI / MA / ROI | `#4FB0FF` / `#FF8A5B` / `#2DD4BF` | 边界叠加（沿用 `overlay.py` 约定） |
| good / warn / crit | `#4EC98A` / `#E9B44C` / `#F76D6D` | 语义（置信 / 澄清 / 拒绝·硬拒绝），**与 accent 分离** |

**排版**
- UI：`system-ui` 栈（VS Code 一致，避免 webfont 风险）。
- **数值一律等宽 + `tabular-nums`**（IMT / CF / 坐标 / |bias|）——仪器面板质感，列对齐。
- 尺度：菜单/正文 13px、区域标题 11px uppercase letter-spacing .08em、IMT 提议 23px、面板数值 18px。

**间距/圆角**：4/6/8px 圆角；活动栏 48px、侧边栏 250px、Agent 栏 340px、底部面板体 150px、状态栏 22px。

---

## 3. 组件树（React）

```
<GlauxIDE lang>
├─ <TitleBar menus title/>
├─ <Body>
│  ├─ <ActivityBar view onSelect onRun onSettings/>
│  ├─ <SideBar view>
│  │   ├─ <ExplorerTree tree onOpenFile onToggleDir/>
│  │   ├─ <SearchView/>
│  │   ├─ <SourceControlView changes/>
│  │   └─ <ModelsView models active onActivate/>      // 扩展=适配器
│  ├─ <EditorArea>
│  │   ├─ <EditorTabs tabs active onClose/>
│  │   ├─ <Breadcrumb path/>
│  │   ├─ <AnnotationCanvas image li ma roi tool onEditBoundary onMeasure/>
│  │   │    └─ <ToolOverlay tool onSelectTool/>        // 选择/编辑LI/编辑MA/ROI/重置
│  │   └─ <BottomPanel tab collapsed>
│  │        ├─ <MeasurementsView imt regions agreement/>
│  │        ├─ <OutputView log/>
│  │        └─ <ProblemsView problems/>
│  └─ <AgentPanel model messages onSubmit onAccept onCorrect/>
│       ├─ <AgentTurn steps proposal|clarify|refuse/>
│       └─ <Composer chips onSubmit/>
└─ <StatusBar branch job tool coords imt model lang onToggleLang/>
```

**状态管理**：单一 `session` store —— `{ activeImage, tool, boundaries{li,ma,source}, roi, imt, model,
intent{scope,spec}, messages[], lang, panel{tab,collapsed}, sidebar{view} }`。
边界修正是唯一会改测量的动作；`imt` 由 `boundaries` 派生（前端可即时估算，权威值走后端 `/measure`）。

---

## 4. 国际化（i18n）

- 全 UI 串外部化为 `{ en, zh }` 字典，键名即 mockup 中的 `data-i18n` 键（可直接迁 `react-i18next` 的 `t('key')`）。
- **智能体动态发言也走字典**（四步/澄清/拒绝/重测句），含插值 `{model}` `{w}` `{v}`。
- 切换入口在**状态栏右侧**（`EN/中`，VS Code 语言模式位）。切换即时、无刷新。
- **不翻译**：文件/目录名、模型 id、数值与单位（mm/µm/px）、`TaskSpec` 字段名。
- 默认语言：跟随浏览器 `navigator.language`，`zh*` → 中文，否则英文；用户切换后记住（localStorage）。

---

## 5. 后端契约（FastAPI → science-core / orchestration）

| 端点 | 入 | 出 | 映射内核 |
| --- | --- | --- | --- |
| `POST /interpret` | `{nl, lang, has_image}` | `IntentResult{scope, spec?, reason}` | `glaux_orchestrator.intent` |
| `POST /run` | `TaskSpec` | `TaskResult{mean_mm,max_mm,pdm_mean_mm,cf,cf_source,model_version,roi}` | `orchestrator.run_spec` |
| `POST /measure` | `{li[], ma[], cf, x_window?}` | `{mean_mm,max_mm,pdm_mean_mm,per_column_um[]}` | `measurement.pdm.imt`（对齐口径） |
| `GET /images?job` | — | `[{id, center, cf, methods[]}]` | `io.cubs.read_dataset` |
| `GET /image/{id}` | — | 灰度图（PNG/tiff→PNG） | 影像 IO |
| `GET /models` | — | `[{id,pub,desc,active,backend}]` | ModelAdapter 注册表 |
| `POST /segment` | `{image_id, model, roi?}` | `{li[], ma[], model_version}` | 分割适配器（caroSegDeep 隔离环境经子进程/服务） |
| `POST /correction` | `{image_id, which, points[], imt}` | `{ok, provenance}` | 记忆层捕获（U7 schema） |

**分割后端隔离**：caroSegDeep 跑在独立 uv/py3.8/TF2.4 环境，`/segment` 经子进程或本地服务调用，
**不进 FastAPI 主进程**（沿用 `ModelAdapter` 隔离，见 `eval/README` 的真模型验证记录）。

---

## 6. 交互需求清单

> P0=v1 必须 · P1=v1 应有 · P2=可延后。勾选=已实现。

### R1 · 全局外壳
- [ ] **P0** 八区网格布局按 §1 落地；三档响应式断点（1120 / 820）。
- [ ] **P0** 深色主题按 §2 token；语义色与 accent 严格分离。
- [ ] **P1** 面板/侧边栏宽度可拖拽调整（VS Code 手感）。
- [ ] **P2** 明/暗主题切换（默认暗）。

### R2 · 活动栏
- [ ] **P0** 6 项：Explorer / Search / SCM / Models / Run&Measure / Settings；选中态左侧竖条 + 高亮。
- [ ] **P0** 点 Explorer/Search/SCM/Models 切换侧边栏视图；侧边栏标题随之变。
- [ ] **P0** Models 图标显**已装适配器数**角标。
- [ ] **P0** Run&Measure 触发一次「解释→四步」跑批（等价在 Agent 发默认指令）。
- [ ] **P1** hover tooltip（中英）。

### R3 · 侧边栏 · 资源管理器（文件树）
- [ ] **P0** 渲染 CUBS 数据集树：`images/`(可展开、当前图选中态+未保存圆点) · `CF/` · `LIMA-Profiles/<method>/` · `cohort_*.csv`。
- [ ] **P0** 目录可展开/收起；文件可选中。
- [ ] **P0** 金标准 method（Manual-A1）标 `gold`；智能体产出（caroSegDeep）标 `agent`。
- [ ] **P1** 选中图像 → 编辑器打开对应标签、画布载入该图 + 该图已有标注。
- [ ] **P2** 右键菜单（比较 method、导出、重跑分割）。

### R4 · 侧边栏 · Models（扩展=适配器）
- [ ] **P0** 列出已装分割适配器（caroSegDeep 启用中 · 其余可启用），含描述/来源/后端。
- [ ] **P0** 点未启用适配器 → 切换 active，状态栏与 Agent 徽标同步，Agent 回「已切换模型」。
- [ ] **P0** 「市场」区列出未安装模型（nnU-Net/MedSAM…）占位。
- [ ] **P1** 切换模型后重跑分割用当前图（调 `/segment`）。
- [ ] **P2** 适配器详情页（权重来源、许可证、隔离环境状态）。

### R5 · 侧边栏 · 搜索 / 源代码管理
- [ ] **P1** 搜索：按 id/中心/method/置信度过滤数据集。
- [ ] **P1** SCM：列出本图「未提交的人工修正」（`M tech_437 · MA boundary`）；说明修正版本化 + 回流记忆层。
- [ ] **P2** SCM diff：修正前后边界叠加对比 + IMT 变化量。

### R6 · 编辑器 · 标签 + 面包屑
- [ ] **P0** 多标签（图像/CSV）；active 态；未保存圆点；可关闭。
- [ ] **P0** 面包屑 `workspace › images › <file>`。
- [ ] **P1** CSV 标签打开 → 底部/编辑器展示队列表（cohort）。

### R7 · 编辑器 · 影像画布 + 标注工具
- [ ] **P0** 渲染灰度 B-mode 影像 + **LI(蓝)/MA(珊瑚) 叠加 + ROI(teal) 括号 + 比例尺(由 CF 算)**。
- [ ] **P0** 工具浮层：选择/平移 · 编辑 LI · 编辑 MA · 移动 ROI · 重置为模型输出。
- [ ] **P0** **编辑 LI/MA**：显控制手柄，**拖动即修正边界并即时重算 IMT**（前端估算）；松手→标 `human` 来源 + 触发 Agent 重测回话 + 权威值走 `/measure`。
- [ ] **P0** 影像明确标注「示意渲染 · 非真实患者数据」（真实部署替换为真图，去此标）。
- [ ] **P1** 缩放/平移；坐标随光标显示于状态栏（含 mm）。
- [ ] **P1** ROI 拖拽改变测量支撑区间，重算。
- [ ] **P2** 撤销/重做修正栈；卡尺工具。

### R8 · 智能体面板（差异化 C 位）
- [ ] **P0** 指令输入 + 示例胶囊 + 发送；Enter 提交。
- [ ] **P0** 意图**三态可见**：in-scope→展示**四步**(Interpret/Calibrate/Segment/Measure，每步打勾)+**IMT 提议卡**(值/置信/Accept/Correct)；ambiguous→黄色**追问澄清**；out-of-scope→红色**拒绝**（均不静默错跑）。
- [ ] **P0** 提议卡 `Correct boundaries` → 切到 Edit MA 工具并提示。
- [ ] **P0** 人工修正后，Agent **自动追加重测回话**（新 IMT + 已入记忆层）。
- [ ] **P0** 步骤里的 `Segment → <model>` 随当前适配器变。
- [ ] **P1** 流式渲染四步（逐步出现），而非一次性。
- [ ] **P1** Accept → 写队列并给回执；对话历史保留（切语言不清空历史，仅翻译 chrome）。
- [ ] **P2** 展开每步的推理/中间产物（provenance drill-down）。

### R9 · 底部面板
- [ ] **P0** 三标签：Measurements / Output / Problems，可折叠。
- [ ] **P0** Measurements：Mean/Max IMT · PDM(对称) · **vs A1 |bias|** · n/cols；区域行(LI/MA/ROI + 来源徽标 agent/human)。
- [ ] **P0** Output：内核四步日志（时间戳 + in_scope + CF + 分割 + IMT）。
- [ ] **P1** Problems：无标定/超生理区间/低置信 等告警；无则「未检出问题」。
- [ ] **P2** Measurements 加 Bland-Altman 迷你图（vs A1，LoA）。

### R10 · 状态栏
- [ ] **P0** 分支 · 作业 `id · n/N` · 工具 · 坐标 · **IMT** · 模型 · **EN/中** · 通知。
- [ ] **P0** 工具/坐标/IMT/模型随交互实时更新。
- [ ] **P1** 点作业项 → 快速跳图；点模型项 → 打开 Models 视图。

### R11 · 国际化
- [ ] **P0** 全 chrome + 智能体动态发言中英双语，状态栏一键切换、即时。
- [ ] **P0** 数值/单位/标识符不翻译。
- [ ] **P1** 跟随浏览器语言默认 + localStorage 记忆。

### R12 · 状态与守卫（贯穿）
- [ ] **P0** 置信态（confident，绿）：正常展示测量。
- [ ] **P0** **硬拒绝态**：图缺 CF/标定 → Problems 告警 + Agent 拒绝出 IMT（不静默 0）。
- [ ] **P0** **歧义/超范围态**：Agent 澄清/拒绝，内核不触发（面板不出新数）。
- [ ] **P1** 加载态（分割/测量进行中骨架）、空态（未选图）、错误态（后端失败可重试）。

### R13 · 无障碍 / 键盘
- [ ] **P1** 全交互键盘可达；可见 focus 环；`prefers-reduced-motion` 关动画。
- [ ] **P1** 工具快捷键（V/L/M/R）、语言切换、提交（Enter）。
- [ ] **P2** 画布叠加对色觉障碍可辨（LI/MA 不仅靠色，加虚实/标签）。

### R14 · 后端契约落地
- [ ] **P0** `/interpret` `/run` `/measure` `/models` `/images` `/image` 按 §5。
- [ ] **P0** `/segment` 经隔离环境调用，主进程无 TF 依赖。
- [ ] **P1** `/correction` 落记忆层 schema（U7）。

---

## 7. 非目标（v1 之外）

- 多用户/权限、云端多租户（MVP 本地/桌面优先，见纲领）。
- 训练/微调模型（集成不自研）。
- 颈动脉斑块、其他解剖（v0 只做远壁 CCA IMT；超范围由 Agent 显式拒绝）。
- 真实 VLM 意图后端接线（`ClaudeVLMBackend` 接缝已留，接线属 Phase B 后续）。

## 8. 数据真实性约定

mockup 与 demo 用**真实验证数值**（IMT 0.918mm、vs A1 |bias| 66.6µm、CF 0.0559）以保可信；
影像为**示意渲染**并显式标注，真实部署替换为真图并去标注。绝不用假数字冒充测量结果。

## 变更记录
- **2026-07-06**：v1。由 VS Code 式高保真 mockup（`v4-vscode-ide`）导出；定八区布局、设计 token、
  组件树、i18n、后端契约与 R1–R14 交互需求清单，作为 FastAPI + React 实现 handoff。
