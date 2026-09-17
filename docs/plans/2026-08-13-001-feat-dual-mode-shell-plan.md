---
kind: record
status: done
---

# 实现计划 · 双模式外壳(Focus / Workbench)

> **用途**:把[《双模式外壳》SDD](../sdd/feats/01-dual-mode-shell/README.md)(`ready`)拆成可逐项执行、验证和提交的实现任务。
>
> **日期**:2026-08-13 · **类别**:plan(ce-plan 风格) · **状态**:completed
>
> **范围**:纯前端外壳层。新增 Focus 模式(对话优先 + 按需舞台),现有布局保留为 Workbench;顶栏一键无损切换。零后端改动。
>
> **完成线**:清空 localStorage 首次进入呈现 Focus 空状态;Focus 内可选图、看叠加与度量摘要、做点选/圈画修正、与参考智能体对话;一键切到 Workbench 且往返无损;SDD §15 全部验收项可勾。

---

## 1. 实施边界

### 1.1 本期目标

- store 新增 `uiMode`(`glaux.uiMode.v1`)与 Focus 布局微状态(`glaux.focusLayout.v1`),按 SDD §9 契约。
- 新增 `components/focus/` 组件族:FocusShell / FocusTopBar / SessionRail / StagePanel / ModeSwitch,全部由现有组件组合(SDD §8)。
- `App.tsx` 按 `uiMode` 分叉;`TitleBar` 加切换按钮。
- 动效 token 进 `tokens.css` 共享层;模式切换 crossfade 与舞台开合按纲领 §5;`prefers-reduced-motion` 降级。
- i18n 新键中英齐备;vitest 覆盖 uiMode 默认/持久化/损坏回退与切换幂等。

### 1.2 明确不做

- 不改 AgentConversation / SessionDrawer / ConversationComposer / ConnectionConfig / 各 Viewer 的组件语义(仅组合 + CSS 作用域覆盖)。
- 不改 dockview 布局、`glaux.layout.v1` 键及 Workbench 视觉(仅 TitleBar 右侧加一个按钮)。
- 不接领域任务进 Pi 会话(feats/00 非目标);对话内嵌 `taskrun` 卡片因此顺延,见 §1.3 第 3 条。
- 不做跨标签页 uiMode 同步、埋点、移动端。

### 1.3 SDD 不变量与既定偏差处理

1. 单一 store,切换零请求、零数据搬运(SDD §5.3/§6.3);数据装载 effect 保持只在 App 挂载时执行。
2. `uiMode` 读取仅接受字面量 `"focus" | "workbench"`,否则回退 `focus`(SDD §6.3-5)。
3. **度量呈现 v0 落点**:SDD §7-4 原文"经对话内 taskrun 卡片"依赖参考智能体接入领域工具,而 feats/00 明确本阶段不接工具、Pi 会话内不会产生任务运行。故 v0 度量摘要卡挂在舞台(数据同 store.metrics),对话内嵌卡片待领域工具接入后补——**此偏差已先回写 SDD §7-4 再动代码**(铁律 1.3)。

## 2. 当前状态证据

| 证据 | 现状 | 对计划的约束 |
| --- | --- | --- |
| [App.tsx:63-72](../../frontend/src/App.tsx) | 外壳树 `.ide`(TitleBar/ActivityBar/Shell/StatusBar)硬编码 | 分叉点就在这;数据装载 effect(20-61 行)不动 |
| [Shell.tsx:40](../../frontend/src/components/Shell.tsx) | dockview 布局持久化键 `glaux.layout.v1`,恢复/保存自洽 | Focus 不读不写它;切回 Workbench 自动恢复,零新代码 |
| [session.ts:168](../../frontend/src/store/session.ts) | 单一 zustand store;`loadConnection()` 已示范 localStorage 加载器写法 | `uiMode`/`focusLayout` 照此模式加,含损坏回退 |
| [AgentConversation.tsx:94-238](../../frontend/src/components/agent/AgentConversation.tsx) | 自带工具条(☰/＋/⋯ 配置弹层)、流、Composer、SessionDrawer 浮层 | Focus 对话列整体复用它;CSS 作用域内隐藏其内部 SessionDrawer 浮层避免与 SessionRail 重复 |
| [SessionDrawer.tsx:90](../../frontend/src/components/agent/SessionDrawer.tsx) | 依赖 agentSessions store,头部 ✕ 调 `setDrawerOpen(false)` | SessionRail 常驻挂载它;✕ 在 rail 作用域内 CSS 隐藏,rail 自带收起钮 |
| [Editor.tsx:26-44](../../frontend/src/components/Editor.tsx) | 工具条由任务注册表 `tv.tools` 驱动;reset 走 `reRunActiveModel` | StagePanel 复用同一注册表逻辑;不复用 Editor 的 tabs/breadcrumb(IDE chrome) |
| [actions.ts:107-134](../../frontend/src/data/actions.ts) | `selectImage/selectVolume/selectSlide/switchModality` 齐备 | FocusTopBar 选择器直接调用,零新数据逻辑 |
| [useConversation.ts:21](../../frontend/src/agent/useConversation.ts) | `send()` 为独立 hook,可在任意组件使用 | 空状态示例卡点击即 `send(text)`;未配连接则开 ⚙ 弹层 |
| [StatusBar.tsx:26-28](../../frontend/src/components/StatusBar.tsx) | 头条度量/坐标读取模式已示范 | 舞台角标与度量摘要照此读注册表,Focus 不渲染 StatusBar(D8) |
| [global.css:41/93](../../frontend/src/styles/global.css) | 单文件样式;`.ide/.body` 为 Workbench 根 | Focus 样式追加为独立 section,选择器以 `.focus-shell` 作用域 |
| [i18n/en.ts](../../frontend/src/i18n/en.ts) | 扁平键字典 + `t(key, vars)` 插值 | 新键前缀 `focus_` / `mode_`,中英同步加 |

## 3. 任务分解

### T1 · store 与 token(SDD §9)
- `session.ts`:`loadUiMode()`(仅接受两字面量,否则 `focus`)、`uiMode` + `setUiMode`(写 `glaux.uiMode.v1`,try/catch);`focusLayout {railOpen:false, stageOpen:true}` + `setFocusLayout(patch)`(写 `glaux.focusLayout.v1`,JSON,损坏回默认)。
- `tokens.css`:`--motion-fast:140ms` `--motion-base:240ms` `--motion-slow:320ms` + `--ease-out/--ease-in/--ease-in-out`(纲领 §5)。

### T2 · Focus 组件族(SDD §8)
- `components/focus/ModeSwitch.tsx`:无状态按钮,`setUiMode(对侧)`;两模式顶栏共用。
- `components/focus/FocusTopBar.tsx`:标识 + 模态/图像双选择器(注册表驱动,调 `switchModality`/`selectImage|Volume|Slide`)+ ⚙(弹 ConnectionConfig)+ ModeSwitch。
- `components/focus/SessionRail.tsx`:收窄条(☰ 展开、＋ 新会话);展开态常驻挂载 SessionDrawer,宽度过渡 `--motion-base`。
- `components/focus/StagePanel.tsx`:工具条(任务注册表 `tv.tools`,reset 同 Editor 语义)+ `<Viewer/>`(ErrorBoundary 包裹)+ 度量摘要条(store.metrics × 注册表,§1.3-3)+ 角标(图名 · CF/spacing · 坐标 · 来源)+ 收起钮;渲染条件 `hasVisual && stageOpen`,`hasVisual` 为派生值。
- `components/focus/FocusShell.tsx`:布局壳(TopBar + Rail + 对话列(AgentConversation + 空状态示例卡)+ StagePanel);示例卡点击 → 连接可用即 `send(text)`,否则开 ⚙。

### T3 · 外壳接线
- `App.tsx`:`uiMode === "focus" ? <FocusShell/> : <现状树>`;两分支根节点挂 crossfade 动画类。
- `TitleBar.tsx`:右侧加 `<ModeSwitch/>`。

### T4 · 样式与动效
- `global.css` 追加 `.focus-shell` section:三区布局(对话列居中 ≤720px)、空状态 hero、示例卡、舞台、rail 过渡;`.focus-shell .agent-conversation .session-drawer{display:none}` 与 rail 内 `✕` 隐藏两处作用域覆盖(带注释);crossfade keyframes;`@media (prefers-reduced-motion: reduce)` 全部降级瞬时。

### T5 · i18n
- `en.ts`/`zh.ts` 新键:`mode_to_workbench` `mode_to_focus` `focus_tagline` `focus_hero_title` `focus_hero_sub` `focus_example_*`(3 组)`focus_stage_collapse` `focus_stage_source_*` 等,中英齐备。

### T6 · 测试与验收自查
- `store/session.test.ts`(新):uiMode 缺省/合法/损坏回退;setUiMode 持久化;focusLayout 损坏回退。
- `components/focus/ModeSwitch.test.tsx`(新):点击写 store + localStorage;重复点击幂等。
- 跑 `npm test` 全量 + `npm run lint` + `tsc`;浏览器人工走查(空状态/选图/切换往返/reduced-motion)。
- 对照 SDD §15 逐项出「已完成/未完成/无法验证」清单;SDD → `implemented`。

## 4. SDD §15 验收映射

| 验收项 | 验证方式 |
| --- | --- |
| 清空存储首进 Focus 空状态,无 IDE 面板 DOM | 浏览器走查 + store 测试(默认值) |
| Focus 任务结果与 Workbench 同数据 | 单一 store 结构保证 + 走查(舞台叠加/度量摘要 vs 底部面板) |
| 往返切换后消息/图/metrics/草稿不变 | 走查(草稿属 Composer 本地 state,组件不卸载则保留——注:对话列在两模式分属不同实例,草稿保留以 store/组件不卸载为限,走查确认) |
| 切换零请求 | 走查(网络面板) |
| dockview 布局往返保留 | 走查(拖拽后往返) |
| 舞台修正手势与 Workbench 一致 | 复用同一 Viewer + tool store,走查确认 |
| 刷新保持模式;损坏回退不白屏 | store 测试 + 走查 |
| i18n 齐备 | lint(无硬编码)+ 中英切换走查 |
| reduced-motion 降级 | 走查(系统设置/DevTools 模拟) |

## 5. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 切换即卸载对话列,Composer 未发送草稿丢失 | **已消解**:实施中按 §15 要求把草稿升入 store(内存态),SDD §8 已备案「复用微调」;浏览器走查确认双向往返保留 |
| dockview/cornerstone 在 jsdom 下不可测 | 组件测试只覆盖 Focus 族与 store;Workbench 分支靠现有测试 + 走查 |
| CSS 作用域覆盖(隐藏 drawer 浮层/✕)随上游类名漂移失效 | 覆盖处集中注释并在 SDD §8 备案;上游类名变更时同 PR 修正 |
| 双对话列实例(Focus/Workbench 各一)初始化竞争 | AgentConversation 自带 `initialize()` 幂等(feats/00);走查确认 |

## 变更记录

- **2026-08-13**:v1,依据 `ready` SDD 制定;§1.3-3 记录 taskrun 卡片 v0 落点偏差(已回写 SDD)。
