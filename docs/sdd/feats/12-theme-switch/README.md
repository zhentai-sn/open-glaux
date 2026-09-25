---
kind: living
status: implemented
---

# 主题切换（深色 / 浅色）与强调色

## 0. 文档状态

| 字段 | 内容 |
| --- | --- |
| 状态 | implemented |
| 当前阶段 | 已实现并通过开发验证（主题 store 7 项单测、设置面板 4 项单测；Focus 模式浏览器走查深浅往返与强调色切换）；Workbench 浏览器走查与业务验收待补 |
| 关联主 SDD | [前端设计纲领 G11 · §6](../../../designs/frontend-design-charter.zh-CN.md) · [SDD 01 双模式外壳](../01-dual-mode-shell/README.md) · [SDD 06 统一图标系统](../06-icon-system/README.md) |
| 负责人 | Glaux 项目维护者 |
| 最后更新 | 2026-09-25 |

> 状态合法值仅四个：`draft` → `ready` → `implemented` → `accepted`。

## 1. 本 SDD 负责什么

- 前端提供深色、浅色两档主题，用户可随时切换。
- 切换结果按浏览器持久化，刷新后保持。
- 影像视口在两档主题下都保持深色底。
- 用户可自定义强调色（缺省为智能体紫），替换智能体紫一族 token；刷新后保持。

## 2. 本 SDD 不负责什么

- 跟随系统（`prefers-color-scheme`）的第三档；需要时另立决策。
- 高对比度主题。
- 自定义语义色（good/warn/crit）、交互蓝（`--accent`/`--accent2`）、边界叠加色（LI/MA/ROI）。
- 强调色在浅色主题下的对比度校正：用户选的浅色强调色作为文字色时可能对比不足，由用户自行调整。
- 画布内绘制色（叠加线、标注、刻度）按主题换色；它们画在深色视口里，与主题无关。
- 终端视图（`TerminalView`）配色；终端恒为深色。
- 偏好的云端同步或多设备一致性。

## 3. 当前阶段目标

- 两档主题的颜色全部由 `frontend/src/styles/tokens.css` 声明，组件不按主题写分支。
- 深色主题的视觉与引入本 SDD 前一致。

## 4. 输入来源

- 用户点击主题切换按钮。
- 用户在「外观」分区选择强调色。
- `localStorage` 键 `glaux.theme.v1`、`glaux.accent.v1`。

## 5. 输出结果

- `<html data-theme="dark|light">`。
- `localStorage["glaux.theme.v1"]` 写入 `dark` 或 `light`。
- 自定义强调色时：`<html>` 行内样式写 `--accent-user`、`--accent-on`、`--accent-status`，`localStorage["glaux.accent.v1"]` 写入小写 `#rrggbb`；恢复默认时两者都清除。
- Workbench 的 dockview 主题对象随之切换（`themeAbyss` / `themeLight`）。

## 6. 核心流程

1. `main.tsx` 在首帧渲染前 import `store/theme.ts`；模块加载时读取 `glaux.theme.v1` 并写 `data-theme`。
2. 用户在设置面板选择主题（`setTheme()`）或点击 Workbench 状态栏按钮（`toggleTheme()`）→ 写 `localStorage`、写 `data-theme`、更新 store。
3. CSS 变量随 `data-theme` 重新求值，界面即时换色，无刷新、无请求。

## 7. 交互规则（可直接转验收）

### 7.1 主题

- 缺省主题为深色（纲领 G11）。
- 切换入口：
  - Focus 模式（含 chat 发行包）：左侧栏底部「设置」→「外观」分区的「主题」行，深色 / 浅色分段单选（[SDD 01](../01-dual-mode-shell/README.md) D23）；顶栏不再有主题按钮。
  - Workbench 模式：状态栏按钮，语言切换按钮右侧。
- 状态栏按钮图标表示点击后的目标主题：深色下显示太阳，浅色下显示月亮；`title` 与 `aria-label` 为「切换到浅色主题」/「切换到深色主题」（随界面语言）。
- 影像视口（带 `data-viewer-surface` 属性的元素）内部始终使用深色 token，包括浮在影像上的工具条、元信息标签。
- Tooltip 在两档主题下都是深色底白字。

### 7.2 强调色

- 入口：「设置」→「外观」分区的「强调色」行，位于「主题」行之下。
- 控件：
  - 「默认」色块：显示当前主题的默认紫（深色 `#b58bf2`、浅色 `#7c4dd6`），选中即恢复默认。
  - 5 个预设色块：`#6366f1`、`#3b82f6`、`#06b6d4`、`#ec4899`、`#64748b`，避开语义色与边界叠加色。
  - 自定义色块：内嵌原生取色器（`<input type="color">`），可选任意颜色；拖动取色时实时生效。
  - 当前色 hex 文本；已自定义时显示「恢复默认」链接。
- 色块为单选（`role="radio"`），选中项加双环；取色器所选颜色不在预设中时，自定义色块显示该色并加双环。
- 生效范围：`--agent`、`--agent-dim`、`--agent-line`、`--on-agent`、`--status`，包括影像视口内部。
- Owl 标识（`OwlLogo`）：眼圈与嘴用 `currentColor`，取 `--agent`，随主题与强调色变化；瞳孔取 `--li`。
- 自定义色在两档主题下取同一值；默认紫随主题变化。
- 强调色底上的文字色（`--on-agent`）按 WCAG 对比度在 `#141414` 与 `#ffffff` 中取较高者。
- 状态栏底色（`--status`）取强调色各通道 ×0.6，保证白字可读。

## 8. 涉及页面和组件

| 文件 | 改动 |
| --- | --- |
| `frontend/src/store/theme.ts` | 主题 store：读取、持久化、写 `data-theme`；强调色校验、持久化、写行内变量 |
| `frontend/src/components/ThemeToggle.tsx` | Workbench 状态栏的切换按钮，样式类由所在栏位传入 |
| `frontend/src/components/focus/SettingsPanel.tsx` | Focus 设置面板「外观」分区的主题分段单选（SDD 01 D23）与强调色选择器 |
| `frontend/src/components/StatusBar.tsx` | 挂载切换按钮 |
| `frontend/src/components/Shell.tsx` | dockview 主题对象随主题切换 |
| `frontend/src/styles/tokens.css` | 深色 token 声明在 `:root, [data-viewer-surface]`；浅色 token 覆盖 `:root[data-theme="light"]`；智能体紫一族以 `--accent-*` 为首选值 |
| `frontend/src/styles/global.css` | 结构性硬编码颜色改为 token；dockview 变量覆盖同时作用于 `.dockview-theme-abyss` 与 `.dockview-theme-light` |
| `frontend/src/components/OwlLogo.tsx` | 颜色改走 `--agent` / `--li`；眼圈线宽 2.1、嘴线宽 1.9 |
| `frontend/src/components/iconMap.ts` | 新增 `themeLight`（Sun）、`themeDark`（Moon） |
| `frontend/src/i18n/{en,zh}.ts` | 新增 `theme_to_light`、`theme_to_dark` |

## 9. 入参、状态和展示字段

### 9.1 Store

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `theme` | `"dark" \| "light"` | 当前主题 |
| `setTheme(theme)` | 函数 | 写 store、`localStorage`、`data-theme` |
| `toggleTheme()` | 函数 | 在两档之间切换 |
| `accent` | `string \| null` | 小写 `#rrggbb`；`null` 表示主题默认紫 |
| `setAccent(accent)` | 函数 | 写 store、`localStorage`、`<html>` 行内变量；`null` 清除；非 `#rrggbb` 值忽略 |

### 9.2 持久化

| 键 | 合法值 | 非法值 / 缺失 / 读取抛错 |
| --- | --- | --- |
| `glaux.theme.v1` | `dark`、`light` | 回退 `dark`，不抛错 |
| `glaux.accent.v1` | `#rrggbb`（不区分大小写，读入转小写） | 回退 `null`（默认紫），不抛错 |

### 9.3 新增 token

两档主题都声明以下 token，浅色取值见 `tokens.css`。

| token | 用途 |
| --- | --- |
| `--on-agent` | 智能体紫底按钮上的文字 |
| `--on-good` | 绿底徽标上的文字 |
| `--edge` | 标题栏底边 |
| `--tab` | 非活动标签页底 |
| `--stage` | Focus 舞台底 |
| `--surface` | 对话内证据卡底 |
| `--file-icon` | 文件树图标 |
| `--scroll-thumb` | 滚动条滑块 |
| `--code-bg` / `--code-block` | Markdown 行内代码 / 代码块底 |

### 9.4 强调色变量

由 store 写在 `<html>` 行内，不在 `tokens.css` 中声明；未自定义时不存在。

| 变量 | 取值 | 被引用处 |
| --- | --- | --- |
| `--accent-user` | 用户所选 `#rrggbb` | `--agent`；`--agent-dim`、`--agent-line` 由 `--agent` 经 `color-mix` 派生 |
| `--accent-on` | `#141414` 或 `#ffffff` | `--on-agent` |
| `--accent-status` | 强调色各通道 ×0.6 | `--status` |

## 10. 重复执行规则

- 连续切换幂等：每次切换只写一个键和一个属性。
- 多个标签页各自读取启动时的持久值，不做跨标签页同步。

## 11. 页面状态生命周期

- 页面加载：模块初始化时一次性读取并落属性。
- 运行期：仅响应设置面板选择与状态栏按钮点击。
- 卸载：无清理动作。

## 12. 审计或事件规则

- 不埋点、不上报。

## 13. 空状态、异常状态和权限处理

- `localStorage` 不可用（隐私模式等）：读取回退深色；写入失败时仅切换当前页面，不提示。
- Chat 发行包（`VITE_GLAUX_EDITION=chat`）同样可在左侧栏底部「设置」→「外观」切换主题。

## 14. 与其他 SDD 的调用关系

- SDD 01：Focus 的主题入口在设置面板「外观」分区（D23）；Workbench 状态栏新增一个按钮。
- SDD 06：切换按钮使用 `Icon` 与 `ICONS` 映射。

## 15. 验收标准

- [x] 无持久化键时为深色；`glaux.theme.v1=light` 时恢复浅色；非法值回退深色（`store/theme.test.ts`）。
- [x] 切换往返写 `localStorage` 与 `data-theme`（`store/theme.test.ts`）。
- [x] Focus 设置面板「外观」分区选择浅色 / 深色即时生效并持久化（`SettingsPanel.test.tsx`；浏览器走查深浅往返）。
- [x] Focus 模式浅色下：外壳白底，会话栏、对话、舞台工具条、图谱视图可读；影像视口保持深色，视口内 `--ink` 取深色值。
- [x] 深色主题与改动前视觉一致。
- [x] typecheck 通过；既有前端测试不回退。
- [x] 强调色：缺省 `null`；合法 hex 恢复并写行内变量；非法值回退；`setAccent` 持久化、按对比度选文字色、`null` 清除（`store/theme.test.ts`）。
- [x] 「外观」分区选预设、用取色器选任意色、恢复默认即时生效（`SettingsPanel.test.tsx`；浏览器走查深浅两档下的预设与自定义色）。
- [ ] Workbench 模式浅色下 dockview 标签栏、分隔条、侧栏可读。
- [ ] 业务验收。

## 16. 决策记录

| 编号 | 决策 | 备选 | 选择理由 | 时间 |
| --- | --- | --- | --- | --- |
| D-1 | 只做深色、浅色两档，缺省深色 | 增加「跟随系统」 | 维护者需求为两档；缺省深色沿用纲领 G11 的影像审读理由 | 2026-09-25 |
| D-2 | 用 `<html data-theme>` + CSS 变量覆盖实现 | React Context 下发调色板；CSS-in-JS | token 体系已存在，组件零改动即可换色 | 2026-09-25 |
| D-3 | 影像视口恒为深色：`[data-viewer-surface]` 重新声明深色 token | 视口随主题变浅 | 灰度影像在深色底上动态范围与叠加对比最大；视口内浮层控件不必逐个适配 | 2026-09-25 |
| D-4 | 状态栏 `--status` 两档共用 `#6a3fb0`；自定义强调色时改取强调色压暗值 | 浅色下换蓝 | 与智能体紫同系，白字在两档下对比度都足够；关闭纲领 §6 遗留项 | 2026-09-25 |
| D-5 | 强调色只替换智能体紫一族，不开放语义色与交互蓝 | 全部颜色 token 可配 | 维护者需求为可配置默认紫；语义色承载置信/拒绝含义，改了会破坏纲领 G11「色彩即语义」 | 2026-09-25 |
| D-6 | 用 `<html>` 行内变量 `--accent-user` 作 token 首选值，而非直接覆盖 `--agent` | 行内直接写 `--agent` | `[data-viewer-surface]` 重新声明了 `--agent`，直接覆盖会让影像视口内仍是默认紫；中间变量只在 `<html>` 声明，全树继承 | 2026-09-25 |
| D-7 | 预设色块 + 原生取色器，不自绘调色盘 | 引入第三方取色组件；自绘 HSV 面板 | 原生取色器覆盖任意颜色、零依赖、各平台可访问 | 2026-09-25 |
| D-8 | Owl 标识跟随强调色，并加粗线条（1.7/1.4 → 2.1/1.9） | 品牌色固定为默认紫 | 维护者要求标识与强调色一致；原浅紫细线在浅色主题白底上对比度约 2.4，轮廓不清 | 2026-09-25 |

## 17. 待确认问题

- 无。
