---
kind: record
status: done
---

# Emil Kowalski 前端交互技能集调研与 Glaux 采纳建议

日期：2026-10-24。

目的：核对 [`emilkowalski/skills`](https://github.com/emilkowalski/skills)（`main` @ `2d22863`，2026-10-24 直接读取）的 15 个技能，判断哪些能增益本仓的打磨层、哪些与[前端设计纲领](../designs/frontend-design-charter.zh-CN.md)冲突而不采纳。本文是调研记录，不改 SDD 状态，不引入依赖，不实施改动；落地动作只给建议与归属。

## 1. 结论

**这个技能集不提供新标准，它提供两样我们缺的东西：把动效判定变成可引用判据的数值表，和把审查变成自包含计划的工序。** 纲领 §5 的哲学已经立对（M1 三问、M4 医学纪律、M6 性能底线），缺的是可执行判据与可复用的审查流程；技能集正好补这两块。值得抄的是三张表和一份模板，不是那 15 个技能本身。

三条支撑判断：

1. **判据可移植、零成本**：频率否决表、缓动决策序、时长预算、物理性四条、可中断性、性能因果序，全是 Markdown 表格与数值，可直接并进纲领 §5，不引依赖、不改运行时。
2. **工序可移植**：`improve-animations` 的"只读审计 → 按杠杆排序 → 为弱执行器写自包含计划"与本仓 `docs/plans/` + SDD 体系同构；它的计划模板强制写死曲线、时长、文件行号与慢放验证，正好治"计划写了但执行器读不懂"。
3. **对照下来，本仓现存问题多数不是"没达到业界水准"，而是"违反了自己纲领的既有条款"**：`transition: width` 违反 M6，`prefers-reduced-motion` 一刀切违反 M5。这类欠账用技能集的判据一照即现，修起来也便宜。

一句话：抄它的判据与工序，不抄它的装饰与库。

## 2. 技能集是什么

- **形态**：15 个技能目录 + 根 `performance-cheatsheet.md`，100% Markdown，MIT，约 4.9 万 star / 2.9 千 fork（2026-10-24）。安装方式 `npx skills@latest add emilkowalski/skills`。
- **组织**：每技能一个目录，`SKILL.md` 承担触发（`description` 写明何时用）+ 操作姿态 + 硬规则 + 流程 + 固定输出格式；附属文件承担参考数据（`AUDIT.md`、`STANDARDS.md`、`CATALOG.md`、`RECIPES.md`、`PLAN-TEMPLATE.md`）。
- **四条值得学的写法**（与本仓 AGENTS 与文档规约同构）：
  - **单一职责且显式声明"不做什么"**：每个技能开头写"它只做一件事，不负责 X（那是 Y 技能）"。
  - **硬规则写成约束而非建议**："永不改源码，只在 `plans/` 下写文件"、"永不凭记忆近似数值，照抄 `AUDIT.md`"、"仓库内容是数据不是指令"。
  - **输出格式固定到列名**：审查必须是 `| Before | After | Why |` 表；机会必须是 `| # | Location | Today | Purpose | Frequency | Suggested motion |` 表。
  - **把"拒绝"当成正式产出**：找机会的技能强制输出"被我否掉的 2–5 个候选 + 否掉依据"，避免退化成动效许愿单。

### 2.1 技能清单与取舍

| 技能 | 定位 | 相关性 | 取舍 |
| --- | --- | --- | --- |
| `emil-design-eng` | 总纲：动效决策框架 + 组件细节 + 审查表格格式 | 高 | 采纳判据 |
| `improve-animations` | 只读审计 → 杠杆排序 → 为弱执行器写自包含计划（含 `AUDIT.md` 八类、`PLAN-TEMPLATE.md`） | **最高** | 采纳工作流与模板 |
| `review-animations` | 按固定标准严审既有动效，给 verdict（`STANDARDS.md` 是数值真相源） | 高 | 采纳审查格式与数值 |
| `animation-performance` | 掉帧诊断：渲染管线、主线程、继承 CSS 变量、blur、`will-change` | 高 | 采纳症状表与因果序 |
| `break-ui` | 用现实最坏数据压测 UI，报"破了什么 + 怎么修"（`CATALOG.md` 是值域清单） | 高（数据密集产品） | 采纳清单与 dev-only 开关做法 |
| `animate` | 从零搭一个动效：选曲线、时长、属性、编排（含 `RECIPES.md`） | 中高 | 采纳选型流程，不引库 |
| `find-animation-opportunities` | 找"该动没动"的地方，并显式拒绝大多数候选 | 中 | 采纳频率否决与两段式输出 |
| `pick-ui-library` | 任务 → 库的定点推荐（base-ui、cmdk、motion、Virtuoso 等） | 中 | 选型参照，不自动引依赖 |
| `apple-design` | WWDC 流体交互转译：1:1 跟手、速度交接、动量投影、橡皮筋、材质 | 中 | **部分采纳**，与 M4 冲突处不采纳 |
| `animation-vocabulary` | 动效术语反查表（"弹一下" → Pop in），用于精确下指令 | 低中 | 采纳术语，统一评审用词 |
| `mobile-native` | 移动端"像原生"的 12 条平台级修复 | 低（桌面为主） | 只取 `100dvh` 与 hover 门控 |
| `prototype` | 同一处 UI 多版本并排切换评审 | 低 | 不采纳（已有 `designs/assets` 评审页） |
| `ask-sonner` | Sonner toast 的用法与坑 | 低 | 不采纳（无 sonner，Notice 队列自建） |
| `animate-expo` | React Native / Expo 动效与手势 | 无 | 不采纳 |
| `write-swift` | 现代 Swift 写法 | 无 | 不采纳 |

### 2.2 与我们的对应关系

技能集可拆成四类，只有前三类与本仓有关：

- **判据**（`emil-design-eng`、`STANDARDS.md`、`AUDIT.md`）：可直接并进纲领 §5。
- **工序**（`improve-animations`、`review-animations`）：可直接并进 `docs/plans/` 与评审清单。
- **领域清单**（`break-ui`、`mobile-native`、`pick-ui-library`）：按需取用。
- **无关项**（`animate-expo`、`write-swift`、`ask-sonner`、`prototype`）：不取。

## 3. 可移植的判据（数值表）

### 3.1 该不该动：频率否决表

| 频率 | 裁决 |
| --- | --- |
| 100+ 次/日（键盘快捷键、命令面板开合、核心导航） | **不动效，永远。** |
| 数十次/日（hover、列表导航、频繁开关） | 删除或压到不可感 |
| 偶发（模态、抽屉、通知） | 标准动效 |
| 罕见/首次（引导、空状态、成功、庆祝） | 可给愉悦预算 |

依据：Raycast 的命令面板没有开合动效，对日调用上百次的动作这是最优解。**键盘触发的动作一律不动效**，这是否决项而非判断题。

### 3.2 缓动决策序

入场/退场 → `ease-out`；屏内位移或形变 → `ease-in-out`；hover/变色 → `ease`；匀速（进度、跑马灯）→ `linear`；其余默认 `ease-out`。**入场禁用 `ease-in`**：它起手慢，正好压在用户最关注的瞬间，同样 200ms 的 `ease-in` 比 `ease-out` 更"迟钝"。内建 `ease`/`ease-out` 力度偏弱，改用强曲线（照抄，不自造）：

```css
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);      /* UI 入场 */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);  /* 屏内位移 */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);   /* 抽屉 */
```

### 3.3 时长预算

| 场景 | 时长 |
| --- | --- |
| 按压反馈 | 100–160ms |
| tooltip、小浮层 | 125–200ms |
| 下拉、选择器 | 150–250ms |
| 模态、抽屉 | 200–500ms |
| 说明性动画 | 可更长 |

UI 动效一律 ≤300ms。感知速度与实际速度同等重要：更快的 spinner 让同样的加载显得更快；同一工具栏里第一个之后的 tooltip 免延迟免动效。本仓 M2 对模式切换给了 320ms 的明文例外——**例外必须写进标准才算例外**，不能由实现默认继承。

### 3.4 物理性四条

- **禁 `scale(0)`**：起点 `scale(0.9–0.97)` + `opacity: 0`，现实里没有东西从"无"里长出来。
- **浮层 origin 指向触发器**：`transform-origin: var(--transform-origin)`；**模态豁免**，保持居中（它不锚定在触发器上）。
- **按压反馈**：`:active` 上 `scale(0.97)`（0.95–0.98），`transition: transform 160ms ease-out`。
- **百分比位移**：`translateY(100%)` 相对元素自身尺寸，优于写死像素。

### 3.5 可中断性

CSS `transition` 可在中途被重定向到新目标；`@keyframes` 从零重放。凡快速触发或可反转的 UI（通知堆叠、开关、折叠、拖拽）用 transition 或 spring。免 JS 的入场用 `@starting-style`（旧浏览器回退 `data-mounted`）。手势用 spring 保留速度，中断时不出现"撞墙"。

### 3.6 性能因果序（诊断顺序，别跳步）

1. 动了哪些属性：布局（`width`/`height`/`padding`/`margin`/`top`/`left`）→ paint（`box-shadow`/`border-radius`/`color`）→ 合成（`transform`/`opacity`）。
2. 掉帧是否与页面繁忙同时发生（导航、取数、水合）：是则改用 CSS 或 WAAPI 走合成器线程。
3. 是否每帧 `setState`：手写动画写 `ref.current.style`，不写 state。
4. 是否随内容增长变慢：父级 `setProperty('--x')` 驱动子元素 `transform` 会让每帧重算全部后代样式。
5. 是否在动 `blur()` 且超过 20px（Safari 尤甚）。
6. 以上都排除后才 `will-change: transform`，且只加在动画元素上。

两条常被忽略的结论：`transition: all` 必然把意外属性拉出合成路径；`box-shadow` 动画每帧重绘，应换 `filter: drop-shadow()`。

### 3.7 无障碍

- `prefers-reduced-motion` 是**更少更轻，不是归零**：保留 `opacity`/`color` 过渡，去掉位移与缩放。
- hover 动效必须门控：`@media (hover: hover) and (pointer: fine)`。触摸的首次点按会留下假 hover，按钮"按下去还弹着"。
- 按下反馈放 `:active` 或 `pointerdown`，不放 `click`（`click` 在手指抬起时才触发，观感是延迟）。

### 3.8 编排

组进场 `stagger` 30–80ms（装饰性，不得阻塞交互）；非对称时长——用户决策处慢（按住删除 2s linear）、系统响应处快（释放 200ms ease-out）；跨态淡入淡出若出现"双影"，用 2px blur 过渡遮罩（保持 <20px）。

## 4. 与本仓现状对照

证据取自 2026-10-24 的 `frontend/src`；行号以该快照为准。

### 4.1 已对齐（写下来防回退）

| 维度 | 证据 | 结论 |
| --- | --- | --- |
| ease-out 曲线 | `tokens.css:162` = `cubic-bezier(0.2, 0, 0, 1)` | 与推荐曲线同族（强减速），保留 |
| 入场禁 `ease-in` | `--ease-in` 已定义但全仓零 `var(--ease-in)` 引用 | 已合规 |
| 微交互时长 | `--motion-fast: 140ms` | 落在 100–160ms 预算内 |
| 浮层/面板时长 | `--motion-base: 240ms` | 落在 150–500ms 预算内 |
| 按压反馈 | `global.css:78-89` 十类控件 `:active` 下沉 0.5px | 密度界面比 `scale(0.97)` 更稳，保留 |
| 性能常见坑 | 全仓 0 处 `transition: all`、0 处 `will-change` | 两条最高频的坑本仓没有 |
| 禁 `scale(0)` | 无 `scale(0)` 入场 | 已合规 |
| spinner / 骨架 | `global.css:3386` `.spin` 0.9s linear；`3390` shimmer 1.4s | 符合（快 spinner、合成属性） |

### 4.2 差距（按杠杆排序）

| # | 现象 | 证据 | 违反 | 修法 |
| --- | --- | --- | --- | --- |
| 1 | reduced-motion 一刀切 | `global.css:41-47` `* { transition: none !important; animation: none !important }` | 纲领 M5 原文（"仅保留不透明度渐变与状态的瞬时切换"）与技能 §3.7 | 改为只关位移/缩放类与循环 animation，保留 `color`/`opacity`/`background` 过渡；spinner 静态降级保留 |
| 2 | 过渡布局属性 | `global.css:2906` `transition: width var(--motion-base)`（会话栏收窄） | 纲领 M6 与技能 §3.6 | 改 `transform: translateX` 或 `clip-path`；宽度变化会让相邻内容每帧重排 |
| 3 | 进场用 keyframes，快速连发时从零重放 | `global.css:1369` notice（队列会连发）、`1612` turn-activity-in（每次工具调用重放）、`3115`/`3898` stagein；`1794` composer-pop-in 触发稀疏，可保留 | 技能 §3.5 | Notice 与 turn-activity 换 `transition` + `@starting-style`；stage 按实际触发频率决定 |
| 4 | 无 origin 叙事 | 全仓未变量化 `transform-origin`，浮层/舞台不指向触发器 | 技能 §3.4 | 给 stage / notice / cfgpop 加 `--transform-origin` 或逐例指定 |
| 5 | hover 未按能力门控 | 全仓 `:hover` 无 `@media (hover: hover)` | 技能 §3.7 | 桌面为主，暂缓；出平板/WebView 形态前补 |
| 6 | 手势无动量 | `PyramidViewer.tsx:231/320/382`、`FrameStackViewer.tsx:569`、`RoiPicker.tsx:52`、`PaneResizer.tsx:32` 已 `setPointerCapture`（1:1 跟手），全仓无速度/阻尼 | 与 M4 一致，**不改** | 仅非医学画布（抽屉、侧栏）可考虑，暂不做 |

### 4.3 两处需要裁决的表面冲突

纲领 M2 与技能原文有两处正面撞车，都不是谁错，而是缺一句限定：

- **退场用 `ease-in`**：M2 写"退场 `ease-in` 且更短"，技能写"UI 永不 `ease-in`"。裁决：保留我们的写法，但把理由写进 M2——退场要"离开得快"，`ease-in` 的加速符合退场；入场一律不用。技能那句的射程只到入场。
- **模式切换 320ms**：技能写"UI 动效 ≤300ms"，M2 给模式切换 320ms crossfade。裁决：保留 320ms，并在 M2 写明它是唯一例外（它承载 G8"同一世界的两种视角"，不是装饰性动效）。

订正：初稿把 `shellfade` 记为"时长越界"，核实 `global.css:2817` 的注释后确认它就是模式切换 crossfade，320ms + `ease-in-out` 正是 M2 明文许可，不构成差距。

### 4.4 数据最坏情况（`break-ui` 视角）

通用 SaaS 的最坏值我们基本都有，Glaux 的值域更极端，需按领域补。建议每个值域建一份 dev-only 夹具 + `?data=worst` 开关，夹具留在仓里当回归资产。

| 值域 | 真实最坏值 | 典型破法 | 处置 |
| --- | --- | --- | --- |
| 文件名/路径 | `IMG_20250914_183022_HDR_portrait_edited_edited.HEIC`、`Q3 Board Deck — FINAL (revised) v12 [approved by legal].pdf`、中文长路径、UUID、`*.svs`/`*.ndpi` | 无空格不可断行；尾部截断吃掉差异（版本号在末尾） | 中间截断 + `title`，必要时 `overflow-wrap: anywhere` |
| 计数 | 0 / 1 / 1,284 / 100,000+ 标注、`Showing 40 of 1,284`、`142%` / `-3%` | 千分位、复数（"1 members"）、进度越界 | `Intl.NumberFormat` + `Intl.PluralRules`，进度钳位 |
| 数字排版 | 更新中的数值（`99` → `100`） | 列宽抖动、列不对齐 | 纲领 G7 已要求等宽 + `tabular-nums`，补 null/NaN 守卫 |
| 时间 | 相对时间阈值、未来时间、`2025-12-31T23:30:00-08:00` | "0 秒前"、跨日、时区错位 | `Intl.RelativeTimeFormat` / `DateTimeFormat` |
| 集合 | 0 / 1 / 整页 / 整页+1 / 1,000+ 未分页 | 空状态缺失、翻页空页、滚动卡顿 | 空/单/满三态必须都有；1,000+ 先分页，再评估虚拟化 |
| 图像 | 404、无图、极端长宽比（WSI 全片、4000×200 全景）、透明 PNG、慢加载 | 破图图标、拉伸变形、布局抖动 | `onError` 回退、`object-fit: cover`、固定 `aspect-ratio` |
| 状态 | 加载骨架与终态不符、错误原文外泄、部分可选字段缺失、枚举全量 | 骨架跳变、技术栈甩给用户、行高不齐 | 骨架对齐终态布局；错误文案走 i18n（P1 已做）；缺字段省行而非占位 |
| 环境 | 面板被拖到 320px、200% 缩放、深色 | 溢出、固定高度裁字、对比度不足 | 面板最小宽度 + 文本 `overflow-wrap`；不用固定高度裁字 |

## 5. 建议落地的三件事

A 已于 2026-10-24 落地（见[前端设计纲领 §5](../designs/frontend-design-charter.zh-CN.md)）；B、C 待定。

| # | 动作 | 产出物 | 成本 | 收益 | 归属 |
| --- | --- | --- | --- | --- | --- |
| A | 判据并进纲领 §5 | 新增「动效判据」小节（①频率否决 ②缓动选择序 ③物理性 ④可中断性 ⑤编排 ⑥无障碍 ⑦掉帧诊断序）；M2 写明入场禁 `ease-in` 与 320ms 唯一例外；M5 改"减弱不归零"并禁全局兜底；M6 补三条实现纪律；新增 G14（最坏数据先于漂亮数据） | 0.5 天 | 后续评审有可引用条款，agent 不必每次重新发明 | [前端设计纲领](../designs/frontend-design-charter.zh-CN.md)（活文档，就地更新） |
| B | 立"审查 → 自包含计划"工序 | 8 类审查清单 + 计划模板：写死曲线/时长/`file:line`、边界（不改结构/不加依赖）、机械验收（Makefile `lint`/`test`）+ 手感验收（DevTools Animations 面板 10% 慢放、Rendering 面板切 reduced-motion） | 模板 0.5 天；每次审查 1 天 | P3 与后续打磨可交弱执行器 | `docs/plans/`（模板）+ [前端品质路线图](../roadmaps/20260818-frontend-quality-roadmap.zh-CN.md) P3 |
| C | dev-only 最坏数据开关 | 见 §4.4 的夹具与 `?data=worst` | 1–2 天 | 把"按好看数据设计"的系统性偏差变成可复跑回归 | 各 Feature SDD 的验收节 |

顺序：A（最便宜，先堵规则漂移）→ B（治执行）→ C（治数据）。

## 6. 不采纳

| 项 | 理由 |
| --- | --- |
| Apple 材质与层次（`backdrop-filter` 玻璃、材料权重、vibrancy、滚动边缘模糊） | 与 G11"秩序之美·深色冷调"、G12"不解释因果即噪音"冲突；我们的"商业级"定义刻意对立于消费软件的装饰之美 |
| 手势动量、速度交接、橡皮筋、动量投影（`apple-design` §5–§9） | 与 M4"直接操纵的对象不许有惯性"直接冲突：医学画面拖手柄带惯性会破坏核对精度。仅在非医学画布（抽屉、侧栏）可考虑，暂不做 |
| 引入动画库（motion / Framer Motion） | 在出现 CSS 表达不了的编排之前不引；技能自己也承认"简单 hover/fade 用 CSS 是对的" |
| Sonner / cmdk / NumberFlow / Virtuoso | 引入依赖需另立 SDD（按[纲领 §七 决策过滤器](../roadmaps/charter.zh-CN.md)与路线图 §3 同一把尺子）；Virtuoso 等出现 1,000+ 行未分页列表再评估 |
| `prototype` 多版本切换 | 已有 `docs/designs/assets/` 下的 HTML 评审页，重复 |
| `animate-expo`、`write-swift` | 技术栈无关 |
| 用 `*` 把 reduced-motion 动效全关 | 反向：这是本仓要改掉的（§4.2 第 1 条） |

## 7. 附：可直接用的审查提示词

把下面这段交给任意 agent，即可对本仓跑一次只读动效审查（等价于 `improve-animations` 的 `standard` 档）：

```text
只读审查 frontend/src 的动效与交互反馈，不修改任何源码，不装依赖、不跑构建。
判据（照抄，不近似）：入场/退场 ease-out；屏内位移 ease-in-out；hover 变色 ease；
匀速 linear；入场禁用 ease-in；UI 动效 ≤300ms；按压 100–160ms；浮层 125–200ms；
禁 scale(0)（起点 0.9–0.97 + opacity:0）；浮层 transform-origin 指向触发器（模态豁免）；
只动 transform/opacity；禁 transition: all；reduced-motion 是减弱不是归零；
hover 动效须 @media (hover: hover) and (pointer: fine)。
本仓约束：tokens.css 是时长与缓动的唯一真相源（--motion-fast/base/slow、--ease-out/in/in-out）；
遵守 docs/designs/frontend-design-charter.zh-CN.md 的 M1/M4/M5/M6——医学画布上的直接操纵不加缓动与惯性，
禁止持续循环动画。
按八类各扫一遍：① 目的与频率（键盘触发的动作是否动效）② 缓动与时长 ③ 物理性与 origin
④ 可中断性（keyframes 是否用在快速触发处）⑤ 性能（布局属性、transition: all、继承 CSS 变量）
⑥ 无障碍（reduced-motion、hover 门控）⑦ 一致性与 token（重复或近似重复的曲线）
⑧ 缺失的机会（瞬变的状态切换）。
输出一张表：| # | 严重度 | 类别 | 位置(file:line) | 现象 | 修法 |，按杠杆排序；
每条必须在 file:line 复核过，不确定标"需实机验证"。另列 2–4 条"被我否掉的候选 + 否掉依据"。
不要给修复代码，只给定位与修法。
```

## 8. 参考

一手来源（2026-10-24 直接读取，`main` @ `2d22863`）：

- 仓库与说明：[emilkowalski/skills](https://github.com/emilkowalski/skills)
- 判据：`skills/emil-design-eng/SKILL.md`、`skills/review-animations/STANDARDS.md`、`skills/improve-animations/AUDIT.md`
- 工序：`skills/improve-animations/SKILL.md`、`skills/improve-animations/PLAN-TEMPLATE.md`、`skills/review-animations/SKILL.md`
- 性能：`skills/animation-performance/SKILL.md`、`performance-cheatsheet.md`
- 领域清单：`skills/break-ui/SKILL.md` + `CATALOG.md`、`skills/mobile-native/SKILL.md`、`skills/pick-ui-library/SKILL.md`
- 流体交互：`skills/apple-design/SKILL.md`（WWDC 2018 *Designing Fluid Interfaces* 的转译）

本仓相关文档：

- [前端视觉交互设计纲领 §5 动效规范](../designs/frontend-design-charter.zh-CN.md)
- [前端品质提升路线图](../roadmaps/20260818-frontend-quality-roadmap.zh-CN.md)（P0–P2 已落地，P3 待办）
- [产品纲领 §七 决策过滤器](../roadmaps/charter.zh-CN.md)
