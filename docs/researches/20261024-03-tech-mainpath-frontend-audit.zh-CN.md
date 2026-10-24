---
kind: record
status: done
---

# Focus 主路径前端审查（动效 · 交互 · 数据健壮）

日期：2026-10-24。

目的：以[前端设计纲领 §5「动效判据」](../designs/frontend-design-charter.zh-CN.md)与 [Emil 技能集调研](20261024-02-tech-emil-skills-motion-audit.zh-CN.md)的审查方法，对 Focus 主路径（对话列 · 舞台与查看器 · 输入区与浮层 · 外壳）做一次只读审查，产出一份**可复核、可点选、可转计划**的清单。本文只记录发现与定位，不改代码、不引依赖、不启动实现。

范围：`frontend/src/components/focus/`、`frontend/src/viewer/`、`frontend/src/components/agent/`（主路径组件）+ `frontend/src/styles/global.css`、`tokens.css` 中对应规则。Workbench、Atlas、导入流程、设置的全量页面不在本轮。

## 1. 结论

**动效预算本身没有越界，违规集中在两类地方：同时挂着键盘快捷键的高频路径，以及舞台（读影区）内的循环与惯性。数据面最痛的一条不是渲染而是可读性——会话标题被截断，而唯一的全文位在 Focus 里被 `display:none` 掉。**

三条支撑判断：

1. **红线仍在**：舞台工具条有 0.9s 无限循环指示器，WSI 双击缩放被 400ms 弹簧包住——M4 明文的「禁止任何持续循环动画」「直接操纵不许有惯性」各踩一条。
2. **最高频的那条最隐蔽**：拖分隔条时每个 `pointermove` 都经过 store → 外壳重渲染 → 根节点改 CSS 变量 → 整棵子树重算，且改的是 `width`。判据⑦ 的四条诊断同时命中，只有读代码能发现。
3. **数据健壮缺的是「最坏值下的可用性」而非「正确性」**：会话全量挂载无分页、时间绝对到秒无相对阈值、标题无全文途径、`·` 硬编码在翻译串外——都是 [G14](../designs/frontend-design-charter.zh-CN.md) 那一类问题，不影响正确渲染，影响被读懂。

分布：**HIGH 5 · MEDIUM 18 · LOW 9**（共 32 条）。

## 2. 方法

- **判据**：纲领 §5 的「动效判据」（频率否决 / 缓动选择序 / 物理性 / 可中断性 / 编排 / 无障碍 / 掉帧诊断序）+ 技能集的 `AUDIT.md`、`STANDARDS.md`、`CATALOG.md` 三张清单。
- **执行**：四路只读子代理并行（对话流与消息卡 / 输入区与浮层 / 舞台与查看器 / 外壳与最坏数据），各自按八类判据扫，返回带 `file:line` 的发现表。
- **复核**：所有发现由主线**回到 `file:line` 读原文**后才入表；"没复核过的发现不许上报"是技能的硬规则。复核后**撤回 1 条**（见 §7）。
- **取证**：读代码 + 真实渲染截图 + grep 量化（见 §4）。观感类一律标「需实机确认」，不与已确认结论混排。
- **不报已修项**：交互动效基线、`:active` 按压、`transition: all`（0 处）、`will-change`（0 处）、reduced-motion 按属性降级（2026-10-24 已修）——重复上报是噪音。

## 3. 发现

编号连续，供后续计划引用（如「报告 §3.1 #1」）。

### 3.1 性能与渲染

| # | 严重度 | 位置 | 现象 | 修法 |
| --- | --- | --- | --- | --- |
| 1 | **HIGH** | `PaneResizer.tsx:37-42`、`FocusShell.tsx:92-102`、`global.css:2908` | 拖分隔条每个 `pointermove` 写 store → 外壳重渲染 → 根节点改 `--focus-rail-w`/`--focus-side-w` → 整棵子树（对话 + 舞台）重算样式；改的是 `width`（布局属性）。`AgentPanel`/`AgentConversation` 无 `memo`，拖拽路径无 rAF。判据⑦ ①②③④ 同时命中 | 拖拽期直接写元素 `style` + rAF 合并，松手才提交 store；变量作用域收到栏自身 |
| 2 | MEDIUM | `PyramidViewer.tsx:136-137`、`343-351` | OSD 每帧同时发 `update-viewport` 与 `animation`，两个 handler 都 `redraw` → 每帧两次 `drawOverlay` + 两次 `setViewportEpoch`，整棵 SVG 标注树重渲染，每顶点再算一次 `toScreen` | 合成单一每帧入口 + rAF 合并；标注投影不要走 React 每帧渲染 |
| 3 | MEDIUM | `SessionDrawer.tsx:345-351`、`380-383` | 会话全量进 store、渲染体内 `filter`、`shown.map` 全量挂载；全仓无虚拟列表。1,284 条 = 1,284 个 `.session-item`，搜索每敲一键全量重算；与 #1 叠加时展开栏每帧重排全部行 | 首批分页（如 50）或虚拟化，暴露 `Showing 40 of 1,284`；搜索 debounce、过滤移出渲染体 |
| 4 | LOW | `AgentConversation.tsx:766`、`592` | 列表 `key` 掺入增长中的正文（`` `${role}-${index}-${text.slice(0,24)}` ``）→ 流式前 24 字符内每 token 换 key，整条消息子树（含 Markdown 全量重解析）卸载重建 | key 用稳定身份，正文不参与 |
| 5 | LOW | `TurnActivity.tsx:145-157` | 每秒 `setNow` 驱动计时显示，长会话里是否可感停顿**需实机** | 若可感，改 `requestAnimationFrame` 或降频 |
| 6 | MEDIUM | `FrameStackViewer.tsx:609-613` | 滚轮每滚一层先 `removeAllAnnotations()` 再 HTTP 重拉（`bridge.ts:18`），快速赶层标注层反复闪没 | 翻层不清层：同图标注一次拉全、按帧过滤；请求按 index 去抖 |

### 3.2 M4 医学画布红线

| # | 严重度 | 位置 | 现象 | 修法 |
| --- | --- | --- | --- | --- |
| 7 | **HIGH** | `StagePanel.tsx:72` + `global.css:3386-3388` | 舞台工具条运行指示是 `.spin` 的 **0.9s 无限循环**，任务跑多久就在审读面旁转多久——M4「禁止任何持续循环动画」 | 舞台内改静态色点或一次性脉冲；循环只留非审读面（会话栏、Atlas、连接配置） |
| 8 | **HIGH** | `viewer/openseadragon.ts:13-15` | 双击缩放 `dblClickToZoom: true` + `animationTime: 0.4` + `springStiffness: 8`：直接操纵带惯性，且 400ms 越过 300ms 上限——M4「直接操纵的对象不许有惯性」 | `animationTime: 0`（或 `immediately`）即时到位；弹簧只留给「定位到标注」这类偶发跳转 |
| 9 | MEDIUM | `global.css:3898`、`3119-3122`、`4120` | 右栏每次打开都跑 `.focus-side { animation: stagein }`（`translateX(14px)` + opacity，keyframes），整块含画布的栏横移，画布每帧被 ResizeObserver 重测重绘；`4120` 又把舞台自身的 `stagein` 关掉，使那条规则成死代码 | 删面板级位移（或仅保留真正罕见的首次入口）；清掉 `3117` 的死规则与 `3322` 的对应 reduced-motion 条目 |
| 10 | LOW | `ReadoutBar.tsx:9` | 无度量时 `return null`，首次出结果画面高度瞬时削约 33px → 视口与构图跳变，切图后反向跳 | 舞台态常驻读数行（无度量时占位） |

### 3.3 可中断性与动效纪律

| # | 严重度 | 位置 | 现象 | 修法 |
| --- | --- | --- | --- | --- |
| 11 | **HIGH** | `global.css:1614`、`1620` + `TurnActivity.tsx:138` | `.turn-activity-text { animation: turn-activity-in … }` 配 `key={text}`：每次工具切换换文案即重挂，140ms 淡入从 `opacity:0` 重放；单轮 5–30 次工具调用 | 删这条 animation；若要首次可感，用 `@starting-style` 只在挂载那次生效 |
| 12 | MEDIUM | `global.css:2908` + `keys/globalKeys.ts:118` | 会话栏开合 `transition: width`（布局属性），且由 **⌘B 键盘**触发；240ms 内容被 `overflow:hidden` 逐帧裁切、搜索框与整列会话行逐帧重排 | 键盘路径零动效；宽度一次性设定或改 `transform` |
| 13 | MEDIUM | `global.css:2819-2826` + `FocusShell.tsx:114` | 模式切换名为 crossfade 实为只有入场：`key` 换树 → 旧树瞬时卸载、新树从 `opacity:0` 淡入，先露一帧底色；keyframes 不可中断，连按 ⌘⇧M 每次从全透明重来（320ms 时长本身合规，不打时长） | 改 `transition` + `@starting-style`，或双树同时在位做对称交接；键盘路径可直接瞬时 |
| 14 | MEDIUM | `global.css:1794-1804` + `ComposerPopover.tsx:132-138` | 胶囊浮层用 keyframes 入场、无退场、`transform-origin` 未设（全仓 0 处）；条件渲染立即卸载 | `transition` + `@starting-style`（可反转）；origin 指 `bottom right` |
| 15 | MEDIUM | `global.css:3022-3038` | 输入卡聚焦光晕过渡 `box-shadow`（paint 属性）+ `:focus-within`，是 100+/日 的动作，每次重绘约 720px 卡片 | 只留 `border-color` 过渡，光晕瞬时切换 |
| 16 | MEDIUM | `AgentConversation.tsx:919-929`、`684-688` | 权限/提问卡在回执后整卡卸载、换成一行 `.interaction-resolved`，下方内容瞬移约一整卡高度，且发生在用户刚做完决定处 | 120–160ms opacity 交叉（`@starting-style`），不动 height |
| 17 | LOW | `global.css:200`、`1705`、`3713` | 19 处 `transition` 里 10 处绕过 token（手写 `0.1s`/`0.12s`/`120ms`）；且过渡 `background` 简写而非 `background-color` | 统一走 `--motion-fast` |
| 18 | LOW | `global.css:1498-1503`（同类 `2067`、`3580`、`3806`） | `.tool-steps-head`/`.tool-item-head`/`.think-item-head`/`.project-chip`/`.atlas-ref-item`/`.interaction-btn` 不在交互动效基线组，同类元素中有的 140ms 渐显、有的瞬变 | 只补类名进基线组 |
| 19 | LOW | `global.css` 全量（84 处 `:hover`） | 全仓 `@media (hover: hover) and (pointer: fine)` **0 处**；`.mode-switch:hover` 还用 `filter: brightness()`（不在合成器允许集，整块重绘） | 出触屏/WebView 形态前统一门控；`filter` 换品色变量 |
| 20 | LOW | `SessionDrawer.tsx:64-88` | 「⋯」菜单锚点只在打开那一帧算一次，无 `resize`、无容器滚动监听 → 列表滚动后按钮移走、fixed 菜单留原地，删除/归档仍可点 | 补 `resize` + 容器 `scroll` 关闭；或改行内 `absolute` |

### 3.4 键盘与焦点（G10）

| # | 严重度 | 位置 | 现象 | 修法 |
| --- | --- | --- | --- | --- |
| 21 | MEDIUM | `global.css:1834-1844`、`3713-3720` | `permission-menu button` / `interaction-option` / `.session-menu button` 均 `outline: none`，`:focus-visible` 只给 `--hover`/`--agent-dim` 底色（6–14%）→ 焦点环实质不可见；且焦点出现也走 120ms 渐变，而数字键 1–9 逐项作答正靠键盘移动 | 删 `outline: none` 恢复全局焦点环；`:focus-visible` 的 `transition: none` |
| 22 | MEDIUM | `FolderPicker.tsx:78-85` | `aria-modal="true"` 但全组件无 `focus()`/`autoFocus`/`inert`/焦点归还 → 打开后焦点留在遮罩背后，Tab 走进背景列表 | 打开聚焦输入框，关闭归还给「打开文件夹」；背景 `inert` |
| 23 | MEDIUM | `ConversationComposer.tsx:264-267`、`227-237` | `/` 菜单把 **Tab 当确认**（`preventDefault` 后提交），键盘用户无法 Tab 离开；listbox 无 `aria-activedescendant`、`role="option"` 不可聚焦 → 读屏不播报 | Tab 不确认，只 Enter/点击提交；补 `aria-activedescendant` 与稳定 id |

### 3.5 数据健壮（G14）

| # | 严重度 | 位置 | 现象 | 修法 |
| --- | --- | --- | --- | --- |
| 24 | **HIGH** | `SessionDrawer.tsx:219-222`、`global.css:2522-2528`、`2945` | 会话标题 `nowrap + ellipsis` 且行上无 `title`；**全仓唯一的全文位** `title={view?.title}`（`AgentConversation.tsx:834`）被 Focus 的 `.agent-toolbar { display: none }` 隐藏；栏收起时全壳没有当前会话标题。最坏值：`IMG_20250914_183022_HDR_portrait_edited_edited.HEIC`、中文长标题、UUID 在 236px 里只剩约 16 字符，同前缀会话不可区分 | 行补全文途径（`title` 或详情浮层）；Focus 内保留一处当前会话标题的可见位 |
| 25 | MEDIUM | `SessionDrawer.tsx:221`、`global.css:2530-2533` | `new Date(...).toLocaleString()`：绝对时间到秒、无相对阈值、`.session-text small` 无 `tabular-nums`/`nowrap`/`ellipsis`；en-US 串约 130px@9px，窄窗 rail 可缩到约 112px → 换行或裁切（**需实机**）；行间数字宽度不一致致整列抖动 | `Intl.RelativeTimeFormat`/`DateTimeFormat` + 相对阈值；补 `tabular-nums`、`nowrap` |
| 26 | LOW | `SessionRail.tsx:182-190`、`SessionDrawer.tsx:371-372` | 收起即卸载 drawer，而 `tab`/`pickerOpen` 是组件本地 state → 每次收起都退回「进行中」并关掉文件夹选择器；与 ⌘B 高频开合叠加等于每次都丢上下文 | 状态提到 store，或收起只折叠不卸载 |
| 27 | LOW | `FocusTopBar.tsx:15-16`、`global.css:2851-2853`、`4245-4247` | 定高 35px 栏里 `· ` 硬编码在翻译串之外（空 tagline 会留一个孤儿 `·`）；`.focus-tagline` 无 `min-width: 0`、无省略号；chat 版 ≤640px 隐藏 tagline，Focus 版无对应规则 | 分隔符并入 i18n 或改伪元素；补省略与窄窗隐藏 |
| 28 | LOW | `global.css:2912` vs `FocusShell.tsx:104`、`134` | `.focus-rail.open { max-width: 30% }` 实际会夹窄，但 `railCur` 仍按 236 参与上界算术与 `aria-valuenow`；窗口 <约 787px 时拖宽会话栏在夹取区间内无可见响应、无障碍读数与实际不符（**需实机**） | 以实测宽度参与边界与 `aria-valuenow` |
| 29 | LOW（范围外旁证） | `usageFormat.ts:28` | 用 `toLocaleString("en-US")` 硬编码 locale；全仓无 `Intl.PluralRules`。主路径组件本轮不渲染计数，故「1 items / 无千分位」类问题在主路径不可触发 | 统一 locale 取自 `lang`；计数类文案走 `Intl` |

### 3.6 视觉与 token

| # | 严重度 | 位置 | 现象 | 修法 |
| --- | --- | --- | --- | --- |
| 30 | MEDIUM | `global.css` 全量 | **半像素字号 105 处**：`11.5`(42) / `10.5`(38) / `12.5`(18) / `9.5`(5) / `13.5`(2)，而 token 只有 `--font-xs/sm/base` 三档（11/12/13）→ 亚像素发虚、层级不齐。G11「秩序之美」最直接的缺口 | 收敛到三档（大标题另立），一次性清掉半像素值 |
| 31 | MEDIUM | `global.css` 全量 | 硬编码 `px` 1512 处；`gap` 209 处仅 15 用 token、`padding` 244 处仅 9 用 → 2026-08-18 定的 `--space-*` 基本没被消费 | 先消费 `--space-*`/`--radius-*`，其余渐进 |
| 32 | LOW | `global.css` 全量（25 处 `box-shadow`） | 阴影无 token：浮层阴影、焦点环、卡片阴影全手写，且深浅两档各写一遍（如 `1795`/`1799`、`2674`/`2677` 的双层阴影）→ 改主题必漏一档 | 立 `--shadow-pop`/`--shadow-card` 两档，深浅各一份 |

## 4. 量化基线（可复测）

供后续复测，命令都在仓库根执行。

| 指标 | 当前值 | 复测命令 |
| --- | --- | --- |
| `global.css` 行数 | 4,394 | `wc -l frontend/src/styles/global.css` |
| 硬编码 `px` | 1,512 | `grep -oE '(^|[^a-zA-Z-])[0-9]+px' frontend/src/styles/global.css \| wc -l` |
| 裸 hex（CSS / 主路径 TSX） | 18 / 12 | `grep -oE '#[0-9a-fA-F]{3,8}' …` |
| `gap` 总数 / 用 token | 209 / 15 | 同上模式 |
| `padding` 总数 / 用 token | 244 / 9 | 同上模式 |
| `transition` 总数 / 用 `--motion-*` | 19 / 9 | 同上模式 |
| `:hover` 总数 / 被能力门控 | 84 / 0 | `grep -c '@media[^{]*hover:[[:space:]]*hover'` |
| `@keyframes` 块 | 7 | `grep -c '@keyframes'` |
| `box-shadow` 声明 / shadow token | 25 / 0 | 同上模式 |
| 半像素字号 | 105 | `font-size` 取值去重计数 |
| `transform-origin` / `@starting-style` | 0 / 0 | 全仓 grep |
| 装饰性渐变 | 1（色板，功能性） | `grep -oE '(linear\|radial)-gradient'` |

后四项里 `transform-origin`、`@starting-style` 为 0，正是 #9/#13/#14 的技术根因；装饰性渐变只有 1 处且是色板取色器，**G11「零装饰」目前守住了**。

## 5. 已对齐（防回退清单）

- 交互动效基线存在（`global.css:49` 起的集中 `transition` 组，覆盖 24 类交互态），`:active` 按压覆盖十类控件。
- `transition: all` 0 处、`will-change` 0 处——两条最高频的性能坑本仓没有。
- `prefers-reduced-motion` 已按属性降级（2026-10-24 修，见 `6bab372`）：保留颜色/透明度，关位移与循环。
- 动效时长基本落在预算内：`--motion-fast` 140ms、`--motion-base` 240ms、模式切换 320ms（M2 明文例外）。
- 无 `scale(0)` 入场；spinner 0.9s 线性（非舞台处）；骨架 shimmer 只动 opacity。
- `.focus-resizer` 拖拽期用 `body.resizing` 显式关过渡，写法正确。
- `useFollowTail` 的自动滚动已用 rAF 合并，不是抖动源。

## 6. 被否掉的候选（避免动效许愿单）

| 候选 | 否掉依据 |
| --- | --- |
| 舞台工具按钮加按压缩放/选中弹跳 | 100+/日 + 直接操纵，频率否决 + M4 零惯性 |
| 把 OSD 换成更顺滑的弹簧/惯性 | 方向性错误：画布是直接操纵，弹簧即延迟 |
| 读数条数值 count-up / 闪烁提示 | 数字滚动会被误读成量值变化，且高频；G7 要求读数稳定 |
| `.session-dot.running` 的 1.4s shimmer | 表「会话在跑」，只动 opacity，reduced-motion 已关，不在判据适用面 |
| `/` 菜单给零动效 | 击键级动作本就该静默，现状正确 |
| `FolderPicker` 复用 `.notice-enter` | 240ms、居中豁免 origin，在区间内；只是类名借用的可读性问题 |
| 用量条 `width` / 扇形角度补过渡 | M6 禁布局属性；且会与 `tabular-nums` 读数不同步 |
| 工具输出/过程折叠加展开动效 | 每轮多次开合 + 唯一顺手实现是 `height`（M6 禁） |
| Atlas 缩略图骨架 | 槽位固定 88×66，加载完无位移，三问答不全，属装饰 |
| 给 `.focus-resizer`（4px 命中区）加 hover 门控 | 无位移无缩放；#19 是仓库级约定，不按单点处理 |

## 7. 复核过程中撤回的一条

初判「空舞台是纯空白，无引导」——真实渲染截图上右侧确有大片留白。复核后撤回：`StagePanel.tsx:45` 有完整 `focus-stage-empty` 占位（图标 + 「在『文件』标签选一个」），留白是「右栏关闭 + 对话列在剩余宽度内居中」的正常布局，不是缺陷。**记此条以说明观感截图必须回到代码复核。**

## 8. 需实机确认

- 400ms 弹簧在实机滚轮聚合下的跟手度（#8）。
- `.focus-side` 14px 横移的肉眼可感度（#9）。
- 上百标注时顶点拖动的实际帧率（#2）。
- 1,284 条会话时 ⌘B 展开栏的帧率（#1 × #3）。
- 会话时间串在窄栏的溢出形态（#25）。
- `max-width: 30%` 触发宽度与「拖宽无响应」是否可感（#28）。
- 焦点底色在暖纸底上的可辨度（#21）。
- 权限卡卸载后下方瞬移是否打断阅读（#16）。

## 9. 建议

按技能流程，发现表交回后**由人选**，选中的才写自包含计划（写死曲线/时长/`file:line`/边界 + 机械验收 + 慢放手感验收），落 `docs/plans/`。

- **第一批（5 条）**：#1 拖拽性能 · #7 舞台循环 · #8 OSD 惯性 · #11 turn-activity 重放 · #24 会话标题全文。四条 HIGH 加一条用户直接可感的数据缺陷，均不新增依赖、不碰领域逻辑。
- **第二批**：#21/#22/#23 键盘与焦点一组（同属 G10，宜一次改完）· #12/#13/#14 可中断性一组 · #30 半像素字号 · #25 时间格式。
- **暂缓**：#19 hover 门控（桌面形态下不触发）· #32 阴影 token（等主题再扩一档时一并做）。

## 10. 参考

- [前端视觉交互设计纲领 §5 动效规范与「动效判据」](../designs/frontend-design-charter.zh-CN.md)
- [Emil Kowalski 前端交互技能集调研](20261024-02-tech-emil-skills-motion-audit.zh-CN.md)（审查方法与数值来源）
- [前端品质提升路线图](../roadmaps/20260818-frontend-quality-roadmap.zh-CN.md)（P0–P2 已交付项，本轮不重复上报）
- 外部：[emilkowalski/skills](https://github.com/emilkowalski/skills)（`AUDIT.md` / `STANDARDS.md` / `CATALOG.md`）
