---
kind: record
status: open
title: "review: 前端品质提升阶段（P0–P2 + 图标系统）代码评审与阶段总结"
type: review
created: 2026-08-19
scope: frontend 品质提升阶段（提交 6722007..93549fd，46 文件 / +1615 −172）
---

# 前端品质提升阶段 · 代码评审与阶段总结

> **用途**：对"前端品质提升"这一阶段（[路线图](../roadmaps/20260818-frontend-quality-roadmap.zh-CN.md) P0–P2 + [SDD 06](../sdd/feats/06-icon-system/README.md) 图标系统）的一次收口——记录交付了什么、验证到什么程度、代码质量如何、遗留哪些技术债与未处理项。
> **日期**：2026-08-19。
> **触发**：维护者确认视觉观感达标后，回顾整段工作的代码质量并归档。
> **方法**：作者自审 + 一次独立评审代理（中途停止，其结论并入下方作者自审）；逐文件核查风险逻辑（全局键分发守卫、通知队列、错误边界），并跑全套自动化验证。
> **半衰期提醒**：下方 file:line 定位于 `93549fd`；后续提交可能漂移，动手前先确认现状。

## 一页纸

维护者最初的诉求是"界面粗糙、不像商业级"。诊断结论是**工程内核已达商业级（竞态守卫、错误回滚、三态分支、无障碍角色都在），粗糙感全在打磨层欠账**。本阶段按"先文档后代码"的纪律，分四批把打磨层补齐：

1. **P0 动效/尺度 token** — 落地纲领 §5，交互过渡从"硬切"变平滑；补齐 `--space/radius/font/icon` 尺度阶。
2. **P1 错误边界 + 通知队列** — 消除崩溃黑屏（`spike-error`），提示不再互相顶掉。
3. **P2 键盘可达 + 全局快捷键**（[SDD 05](../sdd/feats/05-keyboard-shortcuts-a11y/README.md)）— 文件树语义化、单一 keydown 分发器、`?` 速查面板。
4. **图标系统**（[SDD 06](../sdd/feats/06-icon-system/README.md)）— 全站 Unicode 符号 + emoji 统一到 lucide 线性图标，这是静态质感提升的最大杠杆。

**整体质量判断：扎实、可交付。** 无 Critical / High 级问题；发现集中在 1 个中等技术债（工具元数据平行双写）与几处低级一致性/边界，均不阻塞、可后续顺带处理。66 前端测试全绿，lint/typecheck/构建净，包体 gzip 增量仅 +6.7KB。

## 一、交付与提交

| 批次 | 提交 | 关联规范 |
| --- | --- | --- |
| P0 动效/尺度 token | `6722007` | 纲领 §5 / G11 |
| P1 错误边界 + 通知队列 | `30318e1` | 纲领 G5 / G13 |
| 路线图立项 | `9d7862f` | — |
| P2 键盘可达 + 快捷键 | `f768bc5`(SDD) · `ba56bfe`(代码) | SDD 05 |
| 图标系统 | `17b1398`(SDD) · `93549fd`(代码) | SDD 06 |

新增模块：`Icon`/`iconMap`、`keys/globalKeys`、`ShortcutSheet`；重写 `ErrorBoundary`、`Notice`。

## 二、验证结论

- **自动化**：`npm run lint`（eslint + `tsc -b`）净；`npm test` **66 passed / 17 files**（新增 Icon 4、globalKeys 8、ErrorBoundary 3、notice 队列 4、SideBar 可达性 1 共 20 项）。
- **构建**：生产构建净；包体 gzip 增量 JS **+6.1KB** / CSS **+0.6KB**（lucide 约 35 图标按需打包，已核实无整包 import）。
- **视觉**：headless 截图确认 Focus 首屏动画走完态观感、图标全站一致（维护者已人工确认"观看还不错"）。
- **残留核查**：JSX 中 glyph/emoji grep **0 残留**（仅注释/终端日志内文本箭头保留）。
- **已知局限**：动效"平滑感"、快捷键手感、速查面板等**交互态**未做真实浏览器驱动截图（headless 难驱动按键），依赖单元测试覆盖分发逻辑；`prefers-reduced-motion` 降级靠全局 `*` 规则，未逐组件人工核。

## 三、做得好的地方（不变量层）

- **竞态与失败处理未被打磨改动破坏**：`CornerstoneViewer`/`VolumeViewer` 的 `editSeqRef` 序列号守卫 + 失败回滚 + `base_seq` 乐观并发原样保留。
- **动效纪律合规**：交互动效基线只过渡颜色与合成属性；`:active` 只动 `transform`（纲领 M6）；`prefers-reduced-motion` 下 `* { transition/animation: none }` 全局兜底（M5）。
- **图标抽象干净**：`Icon` 封装尺寸走 `--icon-*` token、`currentColor` 着色、装饰 `aria-hidden`/交互 `aria-label`；概念映射（`TOOL_ICON`/`KIND_ICON`/`TAB_ICON`/`ICONS`）集中，未知键回退 `FALLBACK_ICON`（`components/iconMap.ts`）。
- **快捷键守卫严谨**：输入焦点/IME 组合期放行、`Esc` 优先级明确、`preventDefault` 仅限接管的组合键、卸载移除监听（`keys/globalKeys.ts:55-121`）。
- **先文档后代码**：SDD 05/06 均 draft→ready（维护者拍板键位/依赖）→implemented，实施中据实回改 3 处规范（Workbench 侧栏延后、R3 焦点判定、Codicons→lucide 订正）。

## 四、发现的问题与技术债

### 中 · M1 工具元数据平行双写（可维护性）
`keys/globalKeys.ts:10` 的 `TOOL_KEYS`（键位→工具）与 `components/iconMap.ts:54` 的 `TOOL_ICON`（工具→图标），以及 `StatusBar` 的 `TOOL_LABEL`，是**三处按"工具"这一概念平行维护的常量**。SDD 05/06 称其"同源"，实为各写一份、无强约束——[SDD 04](../sdd/feats/04-unified-annotation-toolbox/README.md) 把工具集从 `cursor/editli/editma/roi` 换成 `cursor/bbox/polygon/brush` 时，三处需手动同步，漏一处不报错。
**建议**：04 落地时把工具元数据（`id + key + icon + label`）收敛为单一注册表，键位/图标/标签从中派生。当前工具集稳定，暂不阻塞。

### 低 · L1 工具单键不区分 Shift
`keys/globalKeys.ts:112` 用 `e.key.toLowerCase()` 匹配工具键，`Shift+V` 等大写也会触发切工具。语义上仍是"切工具"意图，无害，但不够精确。**建议**：如需严格，加 `!e.shiftKey` 守卫。

### 低 · L2 body 焦点即视为查看器上下文
`keys/globalKeys.ts:57` 的 `inViewerContext` 把 `activeElement === body` 视作查看器上下文（点击画布后的常态）。副作用：在无查看器的视图（如 Focus 空态）按工具键仍会 `setTool`，因无查看器而为无害 no-op。已在 SDD 05 §R3 记录为有意放宽。

### 低 · L3 工具按钮可访问名来源不一致
`StagePanel` 工具按钮有可见文字标签（`focus/StagePanel.tsx:66`）；`Editor` 工具按钮的名称来自 `.tip` tooltip span（`Editor.tsx:73`）——在 DOM 中存在故可读，但依赖 tooltip 进可访问性树。**建议**：统一为二者都带可访问名（现状可用，非缺陷）。

### 低 · L4 内联样式/裸 hex 仍未收敛
三个查看器的整段内联 `CSSProperties` 与裸 hex（如 `WsiViewer.tsx:260` `#4FB0FF`）本阶段仅顺带替换了其中的 glyph，**样式本身未走 token**——即路线图 P3。属已知遗留，见下节。

## 五、未处理项（维护者决定本阶段先不动）

- **P3**：查看器内联样式/裸 hex 收敛到 token（纯卫生，观感几乎不变）。
- **设计资产**：Radix / React Aria 无障碍原语（菜单/对话框/下拉），需另立小 SDD。
- **主题**：亮色主题 / `--accent`·`--status` 临时紫收敛，归未来主题 SDD（纲领 §6 标注 TBD）。
- **M1 技术债**：随 SDD 04 工具箱落地时一并收敛工具元数据注册表。

## 六、结论

本阶段把维护者感知的"粗糙"三大来源——硬切动效、崩溃黑屏、符号字符/emoji 图标——逐一消除，且未损伤既有的工程不变量。规范（SDD 05/06 + 路线图）与实现一致、可追溯。**判定：阶段完成，质量达标可归档；遗留项均为低风险、已记录、按维护者意愿延后。**

> 状态说明：本文件 `status: open` 仅表示第四节技术债与第五节未处理项尚在册；本阶段交付本身已完成验收。
