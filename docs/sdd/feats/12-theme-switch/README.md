---
kind: living
status: implemented
---

# 主题切换（深色 / 浅色）

## 0. 文档状态

| 字段 | 内容 |
| --- | --- |
| 状态 | implemented |
| 当前阶段 | 已实现并通过开发验证（主题 store 4 项单测；Focus 模式浏览器走查深浅往返）；Workbench 浏览器走查与业务验收待补 |
| 关联主 SDD | [前端设计纲领 G11 · §6](../../../designs/frontend-design-charter.zh-CN.md) · [SDD 01 双模式外壳](../01-dual-mode-shell/README.md) · [SDD 06 统一图标系统](../06-icon-system/README.md) |
| 负责人 | Glaux 项目维护者 |
| 最后更新 | 2026-09-25 |

> 状态合法值仅四个：`draft` → `ready` → `implemented` → `accepted`。

## 1. 本 SDD 负责什么

- 前端提供深色、浅色两档主题，用户可随时切换。
- 切换结果按浏览器持久化，刷新后保持。
- 影像视口在两档主题下都保持深色底。

## 2. 本 SDD 不负责什么

- 跟随系统（`prefers-color-scheme`）的第三档；需要时另立决策。
- 高对比度主题、自定义主色。
- 画布内绘制色（叠加线、标注、刻度）按主题换色；它们画在深色视口里，与主题无关。
- 终端视图（`TerminalView`）配色；终端恒为深色。
- 偏好的云端同步或多设备一致性。

## 3. 当前阶段目标

- 两档主题的颜色全部由 `frontend/src/styles/tokens.css` 声明，组件不按主题写分支。
- 深色主题的视觉与引入本 SDD 前一致。

## 4. 输入来源

- 用户点击主题切换按钮。
- `localStorage` 键 `glaux.theme.v1`。

## 5. 输出结果

- `<html data-theme="dark|light">`。
- `localStorage["glaux.theme.v1"]` 写入 `dark` 或 `light`。
- Workbench 的 dockview 主题对象随之切换（`themeAbyss` / `themeLight`）。

## 6. 核心流程

1. `main.tsx` 在首帧渲染前 import `store/theme.ts`；模块加载时读取 `glaux.theme.v1` 并写 `data-theme`。
2. 用户点击切换按钮 → `toggleTheme()` → 写 `localStorage`、写 `data-theme`、更新 store。
3. CSS 变量随 `data-theme` 重新求值，界面即时换色，无刷新、无请求。

## 7. 交互规则（可直接转验收）

- 缺省主题为深色（纲领 G11）。
- 切换按钮位置：
  - Focus 模式：顶栏，连接配置按钮左侧。
  - Workbench 模式：状态栏，语言切换按钮右侧。
- 按钮图标表示点击后的目标主题：深色下显示太阳，浅色下显示月亮。
- 按钮 `title` 与 `aria-label` 为「切换到浅色主题」/「切换到深色主题」（随界面语言）。
- 影像视口（带 `data-viewer-surface` 属性的元素）内部始终使用深色 token，包括浮在影像上的工具条、元信息标签。
- Tooltip 在两档主题下都是深色底白字。

## 8. 涉及页面和组件

| 文件 | 改动 |
| --- | --- |
| `frontend/src/store/theme.ts` | 主题 store：读取、持久化、写 `data-theme` |
| `frontend/src/components/ThemeToggle.tsx` | 切换按钮，样式类由所在栏位传入 |
| `frontend/src/components/focus/FocusTopBar.tsx` | 挂载切换按钮 |
| `frontend/src/components/StatusBar.tsx` | 挂载切换按钮 |
| `frontend/src/components/Shell.tsx` | dockview 主题对象随主题切换 |
| `frontend/src/styles/tokens.css` | 深色 token 声明在 `:root, [data-viewer-surface]`；浅色 token 覆盖 `:root[data-theme="light"]` |
| `frontend/src/styles/global.css` | 结构性硬编码颜色改为 token；dockview 变量覆盖同时作用于 `.dockview-theme-abyss` 与 `.dockview-theme-light` |
| `frontend/src/components/iconMap.ts` | 新增 `themeLight`（Sun）、`themeDark`（Moon） |
| `frontend/src/i18n/{en,zh}.ts` | 新增 `theme_to_light`、`theme_to_dark` |

## 9. 入参、状态和展示字段

### 9.1 Store

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `theme` | `"dark" \| "light"` | 当前主题 |
| `setTheme(theme)` | 函数 | 写 store、`localStorage`、`data-theme` |
| `toggleTheme()` | 函数 | 在两档之间切换 |

### 9.2 持久化

| 键 | 合法值 | 非法值 / 缺失 / 读取抛错 |
| --- | --- | --- |
| `glaux.theme.v1` | `dark`、`light` | 回退 `dark`，不抛错 |

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

## 10. 重复执行规则

- 连续切换幂等：每次切换只写一个键和一个属性。
- 多个标签页各自读取启动时的持久值，不做跨标签页同步。

## 11. 页面状态生命周期

- 页面加载：模块初始化时一次性读取并落属性。
- 运行期：仅响应按钮点击。
- 卸载：无清理动作。

## 12. 审计或事件规则

- 不埋点、不上报。

## 13. 空状态、异常状态和权限处理

- `localStorage` 不可用（隐私模式等）：读取回退深色；写入失败时仅切换当前页面，不提示。
- Chat 发行包（`VITE_GLAUX_EDITION=chat`）同样显示 Focus 顶栏的切换按钮。

## 14. 与其他 SDD 的调用关系

- SDD 01：Focus 顶栏与 Workbench 状态栏新增一个按钮；布局规则不变。
- SDD 06：切换按钮使用 `Icon` 与 `ICONS` 映射。

## 15. 验收标准

- [x] 无持久化键时为深色；`glaux.theme.v1=light` 时恢复浅色；非法值回退深色（`store/theme.test.ts`）。
- [x] 切换往返写 `localStorage` 与 `data-theme`（`store/theme.test.ts`）。
- [x] Focus 模式浅色下：外壳白底，会话栏、对话、舞台工具条、图谱视图可读；影像视口保持深色，视口内 `--ink` 取深色值。
- [x] 深色主题与改动前视觉一致。
- [x] typecheck 通过；既有前端测试不回退。
- [ ] Workbench 模式浅色下 dockview 标签栏、分隔条、侧栏可读。
- [ ] 业务验收。

## 16. 决策记录

| 编号 | 决策 | 备选 | 选择理由 | 时间 |
| --- | --- | --- | --- | --- |
| D-1 | 只做深色、浅色两档，缺省深色 | 增加「跟随系统」 | 维护者需求为两档；缺省深色沿用纲领 G11 的影像审读理由 | 2026-09-25 |
| D-2 | 用 `<html data-theme>` + CSS 变量覆盖实现 | React Context 下发调色板；CSS-in-JS | token 体系已存在，组件零改动即可换色 | 2026-09-25 |
| D-3 | 影像视口恒为深色：`[data-viewer-surface]` 重新声明深色 token | 视口随主题变浅 | 灰度影像在深色底上动态范围与叠加对比最大；视口内浮层控件不必逐个适配 | 2026-09-25 |
| D-4 | 状态栏 `--status` 两档共用 `#6a3fb0` | 浅色下换蓝 | 与智能体紫同系，白字在两档下对比度都足够；关闭纲领 §6 遗留项 | 2026-09-25 |

## 17. 待确认问题

- 无。
