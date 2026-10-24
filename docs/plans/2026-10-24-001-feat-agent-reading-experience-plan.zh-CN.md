---
kind: record
status: active
title: "实施计划：智能体输出阅读体验（排版 · 流式节律 · 过程可见）"
date: 2026-10-24
---

# 实施计划：智能体输出阅读体验

- 设计依据：`dsh-claude-style@0.18.3`（本机 `~/.dsh/profiles/desktop/node_modules/dsh-claude-style`）的 `docs/STYLE.md` 与 `lib/client.js`。只借机制与数值，不直接复用其 DOM 覆盖式实现。
- 前序工作：2026-10-21 品牌皮肤提交（暖纸基底、`--serif` token、小鸮状态机）。
- 上位约束：[前端视觉交互设计纲领](../designs/frontend-design-charter.zh-CN.md) G13、M2、M3、M5、M6；[品牌皮肤与小鸮吉祥物 · 设计](../designs/2026-10-21-001-brand-skin-and-mascot.zh-CN.md) §3.2。
- 现状实测：阅读面样式 48 行（[global.css](../../frontend/src/styles/global.css#L2853-L2900)）；`AgentConversation.tsx` 842 行；`Markdown.tsx` 15 行；设置面板 146 行；会话 store 708 行；`global.css` 内 17 处 `12.5px`，`--serif` 全仓 0 处引用。

## P0 执行结果（2026-10-24）

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| T1 阅读 token / 偏好 | 完成 | `tokens.css` 三档；`store/reading.ts` + 7 项单测；`main.tsx` 首帧前落 `<html data-reading>` |
| T2 阅读面排版 | 完成 | `global.css` 阅读面字号、标题衬线、表格容器；`Markdown.tsx` 包 `.md-table`；`Markdown.test.tsx` |
| T3 设置分区 | 完成 | 外观分区新增阅读字号与跟随；中英文案；`SettingsPanel.test.tsx` |
| T4 跟随策略 | 完成 | `useFollowTail.ts` + 5 项单测；“回到最新”胶囊；发送、重新生成与切会话贴底 |
| T5 等待行 | 完成 | `TurnActivity.tsx` + 8 项测试；工具名映射与 3s 计时 |
| T6 活文档 | 完成 | 纲领 §6 共享层与阅读面说明；SDD 00 §5.1 / §15.2、最近更新 |

P0 采用推荐值、未先等 §8 的回答：默认 14px、跟随默认开、只做标题衬线、Workbench 保持 13px、等待行不 sticky。评审要改的，按 §8 改。

门禁：`npm run lint`、`npm test`（75 文件 / 513 测试）、`npm run build` 通过；人工矩阵（§6.2）尚未走查。

## 0 目标与边界

达成：

1. 对话阅读面有可选字号与稳定的段落、标题、代码、表格节奏，长文可连续阅读。
2. 流式输出期间不抢用户滚动位置；用户回读时给出明确的“回到最新”。
3. 首 token 之前与工具等待期间，有一行文字说明智能体正在做什么，并带耗时。
4. 代码块可复制、有语言标签；工具步骤一行说清“读/写/改了什么”。
5. 字号可调，跟随与渐现可关；`prefers-reduced-motion` 下全部降级为瞬时呈现。

不做：

- 衬线正文字体与字体打包；语法高亮色板；turn rail；文件引用可点；diff 视图；消息入场动画。
- 改变 720px 阅读列宽、Composer 宽度或 Focus/Workbench 信息架构。
- 逐字复用插件 CSS、Sodium 渲染引擎或 Anthropic 字体（许可见 §9）。

## 1 现状与差距

| 面 | 现状 | 证据 | 影响 |
| --- | --- | --- | --- |
| 正文字号 | `12.5px / 1.65`，段距 6px；h1 仅 15px；`--serif` 定义后未使用 | [global.css](../../frontend/src/styles/global.css#L2855-L2867)、[tokens.css](../../frontend/src/styles/tokens.css#L118-L127) | 720px 列约 58em 宽，长文偏密；标题层级几乎不可辨；品牌设计“标题衬线”未落地 |
| 助手容器 | Workbench 侧栏正文是带底色卡片；Focus 已拍平，聊天发行版（`.chat-main`）未拍平 | [global.css](../../frontend/src/styles/global.css#L1055-L1057)、[global.css](../../frontend/src/styles/global.css#L2584-L2589)、[global.css](../../frontend/src/styles/global.css#L3815-L3816) | 三种列宽的阅读密度不一致；发行版里长回答像聊天记录而非文档 |
| 跟随滚动 | 每次消息变化无条件 `scrollTop = scrollHeight` | [AgentConversation.tsx](../../frontend/src/components/agent/AgentConversation.tsx#L349-L352) | 用户向上回读时被持续拽回底部 |
| 流式呈现 | 每个 `message.delta` 替换整条消息并重渲整段 Markdown；无渐现、无写入光标 | [agentSessions.ts](../../frontend/src/store/agentSessions.ts#L630-L641)、[AgentConversation.tsx](../../frontend/src/components/agent/AgentConversation.tsx#L660-L667) | 长回答高频重排；读者看不出“还在写”还是“卡住了” |
| 等待反馈 | 首 token 前只有小鸮动画，没有文字 | [AgentConversation.tsx](../../frontend/src/components/agent/AgentConversation.tsx#L397-L405) | G13 的“1s 出过程性反馈”、M3 的“过程感即信任感”未兑现 |
| 代码与过程 | 代码块是裸 `pre`；步骤头只有“N 步 + 总耗时” | [global.css](../../frontend/src/styles/global.css#L2880-L2888)、[AgentConversation.tsx](../../frontend/src/components/agent/AgentConversation.tsx#L578-L588) | 代码不可扫读；用户不知道这一步改了哪个文件 |

## 2 设计决策

以下决策在评审后冻结；标“待确认”的项见 §8。

### D1 · 阅读字号与作用域

| 档位 | 字号 | 行高 | 段落间距 |
| --- | --- | --- | --- |
| 紧凑 | 13px | 21px | 8px |
| 标准（默认） | 14px | 23px | 10px |
| 舒适 | 15px | 25px | 12px |

- 落点：`.focus-conversation .md` 与 `.chat-shell .chat-main .md`。Workbench 侧栏（约 340px）维持 13px / 1.65。聊天发行版用 `.chat-main`（960px 列），不是 `.focus-conversation`，选择器要同时覆盖，否则发行版拿不到阅读档。
- 实现：偏好写 `<html data-reading>`，`tokens.css` 按属性给出 `--read-size` / `--read-leading` / `--read-gap`；组件不写死字号。
- 理由：720px 列在 12.5px 下约 58em，14px 下约 51em，比现状更接近常见正文行长；行盒从 20.6px 升到 23px，段落间距从 6px 收到 10px，总高度增幅可控。
- 代价：修订纲领 §3.2 的“正文 13px”。本计划把 13px 保留给 chrome 与侧栏，把对话阅读面定义为 13–15px 可选、默认 14px（§5）。

### D2 · 字体与标题层级

- 标题用 `--serif`（品牌设计已决定但未实现）：h1 `20/28`、h2 `17/24`、h3 `15/21`，字重 600，字距 `-0.01em`。插件标题为 18/26 与 16/24，我们按 14px 正文等比收到上面三档。
- 正文默认无衬线，与纲领 §3.2 一致；衬线正文放到 P2，等中文衬线字体方案（设计 §9.1）确定。
- 表格、代码、数值仍走等宽与 `tabular-nums`，不参与衬线。

### D3 · 跟随滚动

- 判定：`scrollHeight - scrollTop - clientHeight <= 25px` 才算“在底部”；与插件同阈值。
- 进入 hold：滚轮、触摸、在流内按下指针或选中文本，且不在底部。
- 退出 hold：用户滚回底部，或点击“回到最新”胶囊。
- 自己的发送、切换会话时强制回到底部并恢复跟随；流式期间用即时滚动，不用 smooth，避免与 token 到达互相追逐。
- 关闭跟随（设置项）后只在发送时到底，其余时刻不自动滚动；胶囊仍然可用。
- 胶囊落在 Composer 上方右侧，只在 hold 且正在运行时出现。

### D4 · 等待行

- 出现条件：`phase` 为运行中，且当前没有流式正文（首 token 前、工具执行中、工具结束后等待续写）。
- 文案映射（全部走 i18n）：

| 情形 | 文案键 | 示例 |
| --- | --- | --- |
| 等待首 token | `agent_wait_thinking` | 正在思考… |
| `read` | `agent_wait_reading` | 正在阅读 `atlas.py` |
| `write` | `agent_wait_writing` | 正在写入 `metrics.json` |
| `edit` | `agent_wait_editing` | 正在修改 `atlas.py` |
| `bash` | `agent_wait_bash` | 正在运行命令… |
| `run_task` | `agent_wait_task` | 正在运行任务… |
| `consult_atlas` | `agent_wait_atlas` | 正在检索图谱… |
| `agent` | `agent_wait_subagent` | 正在调度子智能体… |
| `ask_user` | `agent_wait_user` | 等待你的确认… |
| 其他工具 | `agent_wait_tool` | 正在调用 `{tool}`… |
| 工具结束、等待续写 | `agent_wait_composing` | 正在整理结果… |

- 耗时：运行超过 3s 后显示，`tabular-nums`；小于 1 分钟显示 `12s`，之后 `1m 05s`。
- 动效：文案变化用 120ms 透明度交换（旧文字淡出、新文字淡入），不做位移、模糊、扫光；reduced-motion 下直接替换。
- 位置：P0 放在对话流末尾（跟随滚动保证可见）；sticky 固定到 Composer 上方放 P2。
- 可访问性：`role="status"`，只在工具边界与阶段变化时更新文本，避免逐秒播报。

### D5 · 流式渐现

- 只对“新到达的字符”做透明度渐现：8 个 highlight 桶从 20% 到 100%，120ms 内推进；用 CSS Custom Highlight API（`::highlight()` + `StaticRange`），不改 React 树、不触发重排。
- 上限 300 字符；文档不可见、`prefers-reduced-motion`、用户关闭渐现时都不执行。
- 特性检测失败时静默降级为整段呈现。
- 默认开启；设置项可关。插件自身默认关闭，说明这是可选项而非必需；本计划按纲领 M2“流式文本线性渐现”默认开启，评审可改。

### D6 · 工具过程摘要

- 步骤头从“N 步 · 4.2s”扩展为“读 3 · 写 1 · 改 2 · 4.2s”，文件最多列 2 个，其余折叠为 `+N`。
- 数据只取已有工具入参（`path` / `command` / `description`）与 `tool.start` / `tool.end` 时刻；缺数据就省略，不猜。
- 不做数字滚动与增删行统计（P2，等 `edit` 的 before/after 契约确定）。

## 3 任务分解

### P0（第一版，目标 2–3 天）

#### T1 · 阅读 token 与偏好存储

- 写域：`frontend/src/styles/tokens.css`、新增 `frontend/src/store/reading.ts`、`frontend/src/store/reading.test.ts`、`frontend/src/main.tsx`（初始化时机）。
- 内容
  1. 新增 `--read-size` / `--read-leading` / `--read-gap` 与 `:root[data-reading="compact|standard|comfortable"]` 三档覆盖。
  2. store 保留 `size`、`follow`、`reveal` 三项，键 `glaux.reading.v1`；非法值回落标准档；localStorage 不可用时不抛错。
  3. 初始化在 React 挂载前写 `<html data-reading>`，避免首屏字号跳变。
- 验收：单测覆盖默认值、持久化、非法值、storage 异常；首屏无字号闪烁。
- 依赖：无。

#### T2 · 阅读面排版

- 写域：`frontend/src/styles/global.css`（`.md` 段与 Focus 作用域）、`frontend/src/components/agent/Markdown.tsx`（表格包一层滚动容器）。
- 内容
  1. `.focus-conversation .md` 与 `.chat-shell .chat-main .md` 使用 `--read-*`；段落、列表、引用按新节奏。聊天发行版顺带拍平助手正文卡片（与 Focus 一致），保守做法是先只改字号。
  2. 标题衬线，字号按 D2；Workbench 内标题维持现有字号，只换衬线。
  3. 行内代码 `line-height: 1.3`、`padding: 1px 5px`、`border-radius: 5px`，字号随正文一档。
  4. 代码块 `13px / 1.55`、内边距 `12px 14px`、`--radius-md`、1px `--line` 边框。
  5. 表格用 `.md-table` 容器承接横向滚动，表格本体 `border-collapse: collapse`、表头 `--sidebar`、单元格 `13px` 与 `tabular-nums`。
  6. 引用保持容器语义：2px 左边框 + `--mid` 文字，内部行内代码不被染成链接色。
- 验收：560 / 720 / 1440 三种列宽下无溢出、无孤行；浅深两档可读；`Markdown` 现有测试与文档视图的自定义 `components` 不回归。
- 依赖：T1。

#### T3 · 设置面板“阅读”分区

- 写域：`frontend/src/components/focus/SettingsPanel.tsx`、`frontend/src/i18n/en.ts`、`frontend/src/i18n/zh.ts`、`frontend/src/styles/global.css`（设置行样式如需）。
- 内容
  1. 在“外观”分区追加三行：阅读字号（分段控件：紧凑 / 标准 / 舒适）、跟随滚动（开 / 关）、流式渐现（开 / 关）。
  2. 复用 `Segmented`；不新造开关组件。
  3. 文案双语，键名统一 `settings_reading_*`。
- 验收：修改即时生效并持久化；键盘可达；中英文切换无缺键（`I18nKey` 类型约束）。
- 依赖：T1；渐现一项在 T8 落地后再接。

#### T4 · 跟随策略与“回到最新”

- 写域：新增 `frontend/src/components/agent/useFollowTail.ts` 与测试、`AgentConversation.tsx`、`global.css`（胶囊）。
- 内容
  1. 封装阈值判定、hold 进入/退出、rAF 合并滚动。
  2. 发送、切换会话时强制到底并恢复跟随。
  3. 胶囊：`aria-label`、“回到最新”，点击后恢复跟随。
  4. 卸下现有 `useEffect` 里的无条件滚动。
- 验收：单测用 mock 的 `scrollHeight` / `clientHeight` / `scrollTop` 覆盖三种状态；手动验证流式中途上滚不回弹、点胶囊回到底部。
- 依赖：无（可与 T1 并行）。

#### T5 · 等待行

- 写域：新增 `frontend/src/components/agent/TurnActivity.tsx` 与测试、`AgentConversation.tsx`、`global.css`、`i18n/en.ts`、`i18n/zh.ts`。
- 内容
  1. 纯函数 `activityFor(phase, live, latestCall, timings)` 产出 `{ key, vars }`，便于单测。
  2. 计时从进入运行态开始，空闲、出错、切换到其他会话时清零。
  3. 渲染在对话流末尾；`role="status"`；文案切换 120ms 透明度交换，reduced-motion 关闭。
- 验收：映射表逐项单测；计时格式单测；手动验证首 token 前、工具中、工具后三段文案。
- 依赖：T1（如需读阅读字号做对齐）。

#### T6 · 活文档同步（随 P0 提交）

- 写域：`docs/designs/frontend-design-charter.zh-CN.md`、`docs/sdd/feats/00-reference-agent-conversations/README.md`。
- 内容
  1. 纲领 §3.2：正文 13px 改为“chrome 与侧栏 13px；对话阅读面 13–15px 可选，默认 14px”；补“标题衬线”的落地说明。
  2. SDD 00 §5.1 增补：阅读字号、跟随与“回到最新”、等待行；§15.2 增补对应验收项。渐现与代码工具条在 T8/T9 提交时补入同一节。
- 验收：活文档与实现同一提交；不写变更记录。
- 依赖：T1–T5。

### P1（第二版）

#### T7 · delta 合帧

- 写域：`frontend/src/store/agentSessions.ts` 与测试。
- 内容：按会话缓冲 `message.delta`，每帧只落最新一条；`message.end` / `run.settled` 立即冲刷，保证快照到达时不丢文本。
- 验收：假时钟下单测冲刷与最终态；连续 delta 的最终消息等于最后一条；重连快照不被旧缓冲覆盖。
- 依赖：无。

#### T8 · 流式渐现

- 写域：新增 `frontend/src/components/agent/useStreamReveal.ts` 与测试、`global.css`、`Markdown.tsx` 挂载点、设置项接线。
- 内容
  1. 渲染后用 `TreeWalker` 找到新增字符范围，构造 `StaticRange`，按 8 个桶分配 `Highlight`。
  2. rAF 推进桶；消息结束、卸载、切会话时清理；仅处理 `.md` 内文本节点。
  3. 特性检测 `CSS.highlights` 与 `Highlight`；不支持时 no-op。
- 验收：范围计算纯函数单测；jsdom 无 Highlight API 时走 no-op 不报错；手动验证不修改 DOM 子节点数量、不引起布局偏移。
- 依赖：T7（降低每帧重算次数）。

#### T9 · 代码块工具条

- 写域：新增 `frontend/src/components/agent/CodeBlock.tsx` 与测试、`Markdown.tsx`、`global.css`。
- 内容：语言标签（取 `language-*`，缺省 `text`）、复制按钮（成功后 1.2s 显示“已复制”）、键盘可达；暂不做语法高亮。
- 验收：复制内容与原文一致；空语言、未知语言、长代码块不溢出；不破坏文档视图对 `components` 的覆盖。
- 依赖：T2（代码块样式）。

#### T10 · 工具过程摘要

- 写域：`AgentConversation.tsx`（`ToolCallItem` 与步骤头）、新增纯函数与测试、`i18n`。
- 内容：读/写/改计数、文件列表（最多 2 个 + `+N`）、保留总耗时；失败计数沿用现有样式。
- 验收：计数与文件名单测；窄栏 340px 下不换行溢出；中英文案。
- 依赖：无。

### P2（后续，不在本次承诺）

- 衬线正文与中文字体子集（依赖设计 §9.1 决策）。
- 语法高亮：复用已装的 `@codemirror/language` / `@lezer/highlight`，按语言映射 parser，新增受控的语法色 token。
- 正文文件路径可点，打开现有 `DocumentView` / `FileCard` 预览。
- turn rail（右侧轮次导航）。
- 等待行 sticky 到 Composer 上方。
- 长会话性能：完成消息 memo、`content-visibility`、离线行高度估算。
- 消息入场动画（flight / grow 二选一）。
- diff 视图与增删行统计。

## 4 执行顺序

```text
P0
T1 ──> T2 ──> T3（渐现项等 T8）
 │
 ├────> T5
T4 ───────┤
T1–T5 ────┴──> T6（随 P0 提交）

P1
T7 ──> T8
T9 ──> T10
T8、T9、T10 各自提交时补 SDD 00 的对应验收项
```

T4、T7、T9、T10 写域互不重叠，可并行；T2 依赖 T1 的 token；T8 依赖 T7 降低重渲频率；T6 必须与 P0 同一提交。

## 5 活文档同步清单

| 文档 | 改动 | 时机 |
| --- | --- | --- |
| [纲领 §3.2](../designs/frontend-design-charter.zh-CN.md) | 正文 13px 改为“chrome 13px、阅读面 13–15 默认 14px”；标题衬线落地 | T6，与 P0 同提交 |
| [SDD 00 §5.1 / §15.2](../sdd/feats/00-reference-agent-conversations/README.md) | P0 增补阅读字号、跟随、等待行；T8/T9 提交时补渐现与代码工具条 | T6，后续随任务 |
| [SDD 01 §6.2](../sdd/feats/01-dual-mode-shell/README.md) | 仅当阅读列宽或 Composer 内缩变化时更新；本计划不变 | 按需 |
| `frontend/src/i18n/en.ts` / `zh.ts` | 新增 `settings_reading_*`、`agent_wait_*`、`agent_copy_*` | 随各任务 |
| `NOTICE` | 仅当逐字复用插件 CSS 时追加 MIT 声明；本计划按机制重写，不带入 | 按需 |

## 6 验收

### 6.1 自动

```bash
cd frontend
npm run lint
npm test
npm run build
```

- 新增单测：`reading.test.ts`、`useFollowTail.test.ts`、`TurnActivity.test.ts`、`useStreamReveal.test.ts`、`CodeBlock.test.tsx`，以及 T7/T10 的纯函数测试。
- 既有 `AgentConversation.test.tsx`、`Markdown` 相关测试全绿。

### 6.2 人工矩阵

| 维度 | 取值 |
| --- | --- |
| 列宽 | 340（Workbench）/ 560 / 720 / 960（chat 发行版）/ 1440 |
| 主题 | 暖纸浅色 / 暖夜 |
| 语言 | 中文 / English |
| 动效 | 默认 / reduced-motion |
| 输入 | 键盘 / 鼠标 / 触摸板 |

检查项：首 token 前有等待行；流式中途上滚不回弹；点“回到最新”恢复；代码块复制成功；标题衬线生效；缩放到 125% 不破版；reduced-motion 下无渐现、无循环动画。

## 7 风险

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 默认 14px 与纲领 13px 冲突 | 中 | T6 同提交修订纲领；评审未通过则默认回 13px，14px 仅作选项 |
| 渐现与高频 delta 叠加造成抖动 | 中 | 先做 T7 合帧；渐现只处理新增字符并限 300 字符；可一键关闭 |
| CSS Highlight API 在目标 Electron 版本缺失 | 低 | 特性检测后整段呈现；不阻塞其他任务 |
| 跟随策略与现有“自动到底”测试/交互冲突 | 低 | 现有测试未覆盖滚动；新增单测锁定行为 |
| 等待行文案在中文里过长 | 低 | 文件名截断，最多一行；窄栏省略文件名 |
| 表格容器改动影响文档视图 | 低 | `Markdown` 的 `components` 覆盖保持不变；补测试 |
| localStorage 偏好与隐私模式 | 低 | 读写 try/catch，回落默认 |

## 8 开放问题

1. **默认字号**：14px（推荐）还是保持 13px、把 14/15 只作选项？前者需要纲领修订，后者改动面最小。
2. **衬线正文**：本次只做标题衬线；是否接受“拉丁衬线 + 中文黑体回落”作为后续选项？
3. **渐现默认值**：推荐默认开启（纲领 M2），插件默认关闭；是否改为默认关闭、由用户打开？
4. **Workbench 侧栏**：340px 下是否也享受 13px 以外的阅读档？推荐不，保持紧凑。
5. **等待行位置**：P0 放流末尾，P2 再做 sticky；是否接受先不 sticky？

## 9 借鉴来源与许可

从插件借的是三类东西：

1. **规则**：prose 行高 23px、段距 12px、标题 18/26 与 16/24、表格 14px + 0.5px 外框、行内代码 `line-height:1.2`、引用作为容器、文件路径按链接处理。
2. **机制**：CSS Custom Highlight 做 token 渐现、25px 跟随阈值与 reader-hold、等待行动词、过程摘要、`content-visibility`。
3. **产品形态**：把阅读字号、字体、渐现、跟随做成用户可选，而不是写死。

不借：

- 覆盖宿主 DOM 的实现（hashed class 匹配、MutationObserver、外部样式表）；我们有自己的 React 树，直接实现。
- 装饰性循环（color wash、loader 点阵、螃蟹/鲸鱼）；与纲领 G11、G12、M4 冲突，且小鸮已有状态机。
- Anthropic 字体（专有，仅个人使用）、Sodium 引擎（PolyForm Shield）、24 桶高亮与掉帧让渡逻辑（等有性能证据再上）。

许可：插件除 `packages/client/src/features/sodium/` 外为 MIT；本计划不复制其代码或 CSS 片段，只按规则重写。若后续逐字复用，需在 `NOTICE` 追加 MIT 声明并保留版权行。
