---
title: "Glaux 前端品质提升路线图（纲领落地）"
type: roadmap
status: ready
created: 2026-08-18
scope: 把前端设计纲领已定、但实现欠账的"打磨层"补齐到位；不改业务逻辑与领域契约
---

# Glaux 前端品质提升路线图（纲领落地）

> **用途**：回答"前端为什么感觉粗糙、怎么补到商业级"。本文件是**执行路线**，不是新标准——标准早已在[前端设计纲领](../designs/frontend-design-charter.zh-CN.md)里立好（§5 动效、G10 无障碍、G13 反馈无空窗），这里只负责把纲领**落地**。
> **来源**：蒸馏自 2026-08-18 一次前端交互质量审计（两路独立审计 + token/CSS 量化核查）。
> **一句话**：工程内核已是商业级，粗糙感全部来自**打磨层欠账**——纲领定了动效/无障碍/反馈标准，组件层没接上。

---

## 0. 判断：粗糙感的根因不是能力，是欠账

审计（覆盖 Shell、SideBar、focus/\*、atlas/\*、三个查看器、Notice、ErrorBoundary、StatusBar、`global.css` 2414 行）两路独立得到同一结论：

- **工程内核已是商业级**：竞态守卫（`editSeqRef` 单调序列号 + 失败回滚 + `base_seq` 乐观并发 + 409 专门文案）教科书级；三态分支、i18n、无障碍角色基本齐全。
- **粗糙感全在表现层最后一公里**。且——本产品的"商业级"依纲领定义为**"科学仪器的秩序之美"**（G11），刻意对立于"消费软件的装饰之美"。**故本路线图不加装饰，只补精度与秩序。**

### 关键差距（带硬证据 · 均可复核）

| 差距 | 严重 | 证据 | 违反的纲领条款 |
| --- | --- | --- | --- |
| 动效未落地 | 🔴高 | 2414 行 CSS 仅 8 处 `transition`、0 处 `:active`；`--motion-*`/`--ease-*` 三档 token 基本未用 | §5 M1–M6、G12、G13 |
| 视觉尺度无 token | 🔴高 | 809 处硬编码 `px`、79 处硬编码圆角、查看器整段内联裸 hex（`#4FB0FF` 实为 `--li` 却未引用） | G11、tokens 分层约定 |
| 加载态无骨架/spinner | 🟠中高 | 全库零骨架屏、零真 spinner；`⟳` 为静态字形不旋转；后端未起时首屏静默空白 | G13、M3 过程感即信任感 |
| 错误边界仅护舞台 | 🟠中 | `ErrorBoundary` 只包 Focus 舞台一处，Workbench dockview 裸奔——**即 `spike-error.png` 黑屏成因** | G5 信任可见、G13 |
| 键盘不可达 | 🟠中 | 文件树用 `<div onClick>` 键盘展不开；全库 0 个快捷键（却自称 IDE） | G10、设计稿 R13 |
| 反馈丢失 | 🟠中 | `:active` 0 处（按下无反馈）；Notice 单槽覆盖，多条提示互相顶掉（医学失败提示会静默丢） | G5、G13 |
| fetch 无超时 | 🟢低 | `api/client.ts` 无 `timeout`/`AbortController`，大文件卡住只能干等 | M3 |

---

## 1. 与纲领的关系（本路线图落地哪些条款）

| 纲领条款 | 现状 | 本路线图交付 |
| --- | --- | --- |
| §5 M1–M6 动效规范 | token 已定，组件未接 | P0：hover/selected/tab/面板开合统一过渡 + `:active` 按压 + spinner |
| G13 反馈无空窗 | 加载态纯文本、通知会丢 | P0 骨架/spinner + P1 通知队列 |
| G5 信任可见 | 崩溃黑屏、提示丢失 | P1 错误边界全覆盖 + 通知队列 |
| G10 全键盘可达 | 文件树/快捷键缺失 | P2 语义化 + 全局快捷键 |
| G11 秩序之美 | 尺度硬编码不统一 | P0 尺度 token + P3 收敛内联样式 |

**原则**：本路线图只做"纲领已定、实现欠账"的项；任何需要**新立标准**的（如亮色主题、`--accent/--status` 临时紫的收敛）不在此列，归未来主题 SDD。

---

## 2. 分阶段执行（按投入产出比排序）

### P0 · 纲领动效与尺度落地（零业务风险，见效最猛）

纯 CSS/token 层，不碰任何业务逻辑与组件契约。

- **P0-1 尺度 token 三件套**：`tokens.css` 补 `--space-*`（4/8/12/16/20/24）、`--radius-*`（sm4/md6/lg8）、`--font-*`（xs11/sm12/base13）。这是视觉不统一的**结构性根因**——先有 scale，后续替换才有依据。
- **P0-2 落地 §5 动效**：给 hover / `.sel` / `.on` / tab 切换 / 面板开合统一加 `transition: <prop> var(--motion-fast) var(--ease-out)`；补 `:active` 按压反馈（依 M6 只动 `transform`/`opacity`）；`prefers-reduced-motion` 下降级为瞬时（M5，全局兜底已在，逐项复核）。
- **P0-3 一个会转的 spinner**：加 `@keyframes spin`，替换 `WsiViewer`/`Editor`/`VolumeViewer`/`StagePanel` 的静态 `⟳` 与 `…`；列表加载态从纯文本升级为骨架卡（`atlas-grid` 骨架）。落地 M3"过程感即信任感"。

**验收**：`global.css` transition 覆盖率从 8 → 覆盖全部 hover/选中/tab/面板开合；`:active` ≥ 主要可点元素；无骨架/静态 spinner 残留；`prefers-reduced-motion` 下无位移动效。

### P1 · 堵黑屏 + 提示可靠（信任可见）

- **P1-1 错误边界全覆盖**：Workbench dockview 每个面板（Editor/Viewer/Agent/BottomPanel）各包 `ErrorBoundary`；`App` 顶层兜底一层。直接消灭 `spike-error.png` 那类整屏黑。
- **P1-2 fallback 体面化**：`ErrorBoundary` 文案走 i18n（现为英文 `retry`），走 token 样式（去内联硬编码），加"复制堆栈/重载"引导；原始 `error.message` 折叠进"详情"，不直接把技术栈甩给 B 类用户。
- **P1-3 Notice 改队列**：`session.ts` 的 `notify` 从单槽覆盖改为队列（并发提示逐条呈现），Notice 加进入/退出过渡。医学测量失败提示不再被顶掉——落地 G5。

**验收**：任一面板手动抛错不再整屏崩；后端未起时首屏有"后端不可用"提示而非空白；连续两次失败两条提示都可见。

### P2 · 补 IDE 该有的键盘能力（G10 / R13）

- **P2-1 语义化可点元素**：文件树 `<div onClick>` → `<button>`（`SideBar.tsx` Dir 行、`ImageLeaf`、导入表单头），补 `role`/键盘触发/focus 环。
- **P2-2 全局快捷键**：工具切换（V/L/M/R，见 R13）、面板开合、模式切换（Focus↔Workbench）。集中一处 `keydown` 注册，避免散落。

**验收**：纯键盘可展开文件树并选图；R13 列出的工具快捷键可用；快捷键有可发现入口（tooltip/命令面板后续）。

### P3 · 收敛内联样式（渐进，随手做）

- 三个查看器整段内联 `CSSProperties` + 裸 hex → className + token（裸 `#4FB0FF`/`#FF8A5B`/`#6a3fb0` → `var(--li)`/`var(--ma)`/`var(--status)`）。改主题时查看器才会跟随。
- SideBar 树缩进魔法数 `depth*12+4` → 走 `--space-*`。

**验收**：查看器无绕过 token 的裸 hex；组件层内联样式数量显著下降。

---

## 3. 设计资产策略：借鉴 vs 自建

**依产品纲领"复用优先，不重复造轮子"与决策过滤器**——把设计资产按"是否是护城河"二分：

### 借鉴/采用（无差异化的结构层，一律复用成熟资产）

- **无障碍无头原语**：菜单/对话框/下拉/Tabs/Tooltip 用 **Radix UI** 或 **React Aria（Adobe）**——它们把键盘导航、focus 管理、`aria` 全解决了，正好补 P2 的 a11y 欠账，且无自带视觉、不与纲领"零装饰"冲突。**不要**引入 Material / Ant Design（自带消费级装饰观感，违反 G11，且交出视觉主权）。
- **图标集**：采用 **lucide-react**（MIT，SVG 组件，tree-shakeable）——**订正**：初稿曾建议 Codicons，但落到本仓现状后发现 `ActivityBar` 既有图标即 feather/lucide 线性风格，Codicons（16px 填充像素网格）反而会冲突；lucide 与现状自洽。详见 [SDD 06 · D-1](../sdd/feats/06-icon-system/README.md)。
- **视觉语言参照**：继续借 **VS Code Dark+** 的结构色与布局范式（已在做），这是"结构层"的合法复用。
- **动效缓动/时长**：已有 token，参照业界合成器路径最佳实践即可，无需引第三方动画库（P0 纯 CSS 足够；避免 framer-motion 之类重依赖，除非出现 CSS 表达不了的编排）。

### 自建（护城河的差异化层，别人给不了）

- **领域叠加视觉语言**：LI/MA/ROI 边界的虚实线型 + 标签（色觉障碍可辨，G10/R13）、修正手柄手感——这是动作层的一等公民，必须自建。
- **信任可见的状态语言**：三态守卫（绿/黄/红）、来源徽标（agent/human）、"示意渲染·非真实数据"标注（G5/G6）——是产品身份，成熟设计系统里没有。
- **动效即因果**（§5 M1）：舞台展开、存疑段一次性脉冲——语义绑定领域回路，自建。
- **仪器排版**：等宽 + `tabular-nums` 列对齐、单位常伴数值（G7）——规则已在纲领，落到组件是自己的活。

**一句话**：**结构层尽量借（Radix/React Aria + lucide + VS Code 语言），护城河层坚决自建（领域叠加 + 信任状态 + 因果动效 + 仪器排版）。** 这正是把产品纲领第六条决策过滤器套用到设计资产上的结论。

> 落地建议：图标系统已按此立 [SDD 06](../sdd/feats/06-icon-system/README.md) 并实现（lucide-react）；Radix/React Aria 的引入同理值得一份小 SDD，因为会引入依赖并改组件契约；P0/P1 属纯打磨，走本路线图 + 代码评审即可。

---

## 4. 里程碑与顺序

1. **P0**（纲领动效 + 尺度 token + spinner）— 最高杠杆、零业务风险，**建议首发**。
2. **P1**（错误边界 + 通知队列）— 消灭黑屏，信任可见。
3. **P2**（键盘可达 + 快捷键）— 兑现"IDE"定位；可与 Radix/React Aria 采用合并推进。
4. **P3**（收敛内联样式）— 渐进，随手清理。

依赖关系：P0-1 尺度 token 是 P3 的前置；P2 的 a11y 原语采用是"设计资产借鉴"的落点。

---

## 落地进度

- **P0 已落地**（2026-08-18）：`tokens.css` 补 12 个尺度 token（space/radius/font）；`global.css` 加交互动效基线（一条集中规则覆盖 24 个交互态）+ 12 处 `:active` 按压 + reduced-motion 关动画兜底；`@keyframes spin` + `.spin` 替换 3 处静态 ⟳；Atlas 列表加载态改 shimmer 骨架卡。lint/typecheck 净，46 测试通过。
- **P1 已落地**（2026-08-19）：`ErrorBoundary` 重写为 i18n + token 样式 + 可折叠堆栈 + 复制；覆盖 App 顶层（按 uiMode keying）、dockview 四面板、Focus 对话列/右侧栏；`Notice` 单槽改队列（`notices[]`，逐条呈现、上限 6、精确 dismiss）+ 进入过渡 + 剩余计数徽标。新增 ErrorBoundary（3）与 notice 队列（4）共 7 个测试，全套 53 通过；生产构建净。**黑屏隐患（spike-error）已消除。**
- **P2 已落地**（2026-08-19，另立 [SDD 05](../sdd/feats/05-keyboard-shortcuts-a11y/README.md) 先文档后实现）：文件树/导入头/能力卡/状态栏语义化（`div`→`button` / `role`+`tabIndex`，消除假按钮）；单一 `window` keydown 分发器 `useGlobalKeys`（工具键 V/L/M/R、`Cmd+B`/`Cmd+\` 面板、`Cmd+Shift+M` 模式、`?` 速查），输入/IME 放行、卸载移除；`ShortcutSheet` 速查面板。新增 9 项测试，全套 62 通过；lint/构建净。
- **图标系统已落地**（2026-08-19，[SDD 06](../sdd/feats/06-icon-system/README.md)）：全站 glyph/emoji 统一到 lucide-react 线性图标（含 ActivityBar 迁移、spinner/警告图标），`Icon` 封装 + 概念映射单一真相源，尺寸走 `--icon-*` token、`currentColor` 着色；包体 gzip +6.7KB。这是"静态质感"提升的最大杠杆。
- **待办**：P3（收敛查看器内联样式/裸 hex，随后续顺带）；设计资产采用（Radix/React Aria 无障碍原语）。

## 变更记录

- **2026-08-18**：v1（ready）。基于前端交互质量审计立项；分 P0–P3 四阶段落地设计纲领 §5/G10/G13；附设计资产借鉴 vs 自建策略。
- **2026-08-19**：P0、P1 落地并回填进度；黑屏兜底完成。
