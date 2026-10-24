---
kind: record
status: done
title: "实施计划：品牌皮肤与小鸮吉祥物"
date: 2026-10-21
---

# 实施计划：品牌皮肤与小鸮吉祥物

- 设计依据：[品牌皮肤与小鸮吉祥物 · 设计](../designs/2026-10-21-001-brand-skin-and-mascot.zh-CN.md)
- 上位约束：[前端视觉交互设计纲领](../designs/frontend-design-charter.zh-CN.md)（本计划修订 G11 的缺省主题立场）
- 规模实测：样式集中在 3 个 CSS；含硬编码颜色的非测试文件 8 个；被引用的 token 69 个

## 执行结果（2026-10-21）

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| T1 token 重写 | 完成 | `tokens.css` 重写；`theme.ts` 缺省改浅色；`theme.test.ts` 期望同步 |
| T2 基础样式 | 完成 | `global.css` / `annotations.css` 语义色转 `color-mix`、冷黑转暖黑 |
| T3 硬编码颜色 | 完成 | `StatusBar` 改 `var(--on-agent)`；终端与画布颜色加豁免注释 |
| T4 圆角适配 | 完成 | 133 处写死圆角收敛到 `--radius-*` |
| T5 小鸮吉祥物 | 完成 | `Mascot.tsx` + 10 态帧图 + `Mascot.test.tsx`；接入 `ConversationComposer` |
| T6 品牌资产 | 完成 | `launcher/windows/glaux.ico` 替换；`build-icon.py` 加成品分支并更新断言；favicon；落地页配色；`OwlLogo` 改为像素 SVG（全部应用内标识统一） |
| T7 验收回归 | 完成 | `npm run lint` 通过；前端 71 文件 / 490 测试；字面量门禁 0 |

## 0 目标与边界

达成：暖纸浅色为默认主题、影像舞台仍深色、输入框上沿出现 10 态像素小鸮、图标与安装器跟随新配色。

不做：可拖拽桌宠、Live2D、像素化图标体系、皮肤切换机制、深色主题的新设计。

## 1 任务分解

### T1 · token 重写（根任务）

- 写域：`frontend/src/styles/tokens.css`
- 内容
  1. 浅色档改为暖纸：画布 `#FCFCFB`、侧栏 `#FAF9F5`、活动栏 `#F7F5EF`、描边 `#E8E6DC`/`#DEDCD2`、文本 `#141413`/`#6E6A60`/`#A6A094`
  2. 深色档同批改为暖夜：底 `#141413`、层 2 `#1C1B1A`、层 3 `#242320`、描边 `rgba(255,255,255,.09)`，避免两档冷暖冲突
  3. `--accent` 与 `--agent` 统一为 `#7C4DD6`
  4. 圆角阶上调：`--radius-sm` 6 / `--radius-md` 10 / `--radius-lg` 14
  5. 正文行高 1.6；新增 `--ease-spring: cubic-bezier(0.34, 1.4, 0.64, 1)`
  6. **保留** `[data-viewer-surface]` 的深色重声明
- 验收：`frontend/src` 内不再出现 `#0e70c0`、`#1e1e1e`、`#ffffff`；主题切换不闪烁；影像舞台在两种主题下仍是深色
- 依赖：无（后续全部依赖 T1）

### T2 · 基础样式与标注样式

- 写域：`frontend/src/styles/global.css`、`frontend/src/styles/annotations.css`
- 内容：滚动条、hover 洗色、focus 环改为 `--accent`；标注高亮色沿用 LI/MA/ROI 语义色，不改色相
- 验收：hover/focus 可见；标注叠加与实际区域对齐不变
- 依赖：T1

### T3 · 组件硬编码颜色清理

- 写域（4 个非测试文件）：
  - `components/StatusBar.tsx`
  - `components/TerminalView.tsx`
  - `components/focus/SettingsPanel.tsx`
  - `viewer/FrameStackViewer.tsx`、`viewer/PyramidViewer.tsx`
- 内容：把字面量颜色换成 token 引用；终端配色单独保留一套深色，不参与主题化
- 验收：上述文件 `rg -n "#[0-9a-fA-F]{6}"` 无输出（终端除外，需标注豁免注释）
- 依赖：T1

### T4 · 圆角与间距适配

- 写域：受 `--radius-*` 影响的组件，逐个核对
- 内容：卡片、按钮、输入区、面板头部统一到新圆角阶；不引入阴影堆叠（仅浮层一层柔阴影）
- 验收：无写死圆角（`border-radius: \d+px` 只允许出现在 tokens.css）；目测四个主界面无布局跳动
- 依赖：T1

### T5 · 小鸮吉祥物

- 写域：新增 `frontend/src/components/Mascot.tsx`、`frontend/src/styles/mascot.css`、`frontend/src/assets/mascot/*.png`
- 内容
  1. 按设计 §4 产出 10 态帧图（32 网格，每态 2–4 帧，8 列 strip）
  2. 组件：`background-position` 逐帧，`setTimeout` 驱动；每态声明 `frames`/`box`/`still`
  3. 状态接线：`turn.start`→thinking、流式输出/`tool.call`→typing、`turn.end`→happy、错误→error、交互请求挂起→notification、空闲 N 分钟→sleeping、点击→waking/poke
  4. 锚定输入框上沿；`aria-hidden`；`prefers-reduced-motion` 关闭循环
- 验收：10 态可触发；切换不跳位；32px 可辨认；reduced-motion 下无循环动画
- 依赖：T1（配色）

### T6 · 品牌资产替换

- 写域：`launcher/windows/`、`scripts/release/build-icon.py`、`docs/landing/assets/landing.css`、`frontend/index.html`
- 内容
  1. 用 `docs/designs/assets/2026-10-21-brand-skin/glaux-owl.ico` 替换桌面图标
  2. `build-icon.py` 增加一条"存在成品 ICO 则直接复制"的分支，保留原有从 `OwlLogo.tsx` 生成的回退路径
  3. favicon 用透明底变体
  4. 落地页配色与强调色对齐 token
- 验收：安装后桌面/开始菜单图标为新图标；`build-windows.ps1` 可重跑；落地页无旧色残留
- 依赖：无

### T7 · 验收与回归

- 内容：逐条对照设计 §8 的 8 项验收；跑 `make lint`、`make test`、前端 `vitest`
- 验收：全绿；新增 Mascot 组件有测试覆盖（状态映射与 reduced-motion）
- 依赖：T1–T6

## 2 执行顺序

```text
T1 ─┬─> T2 ─┐
    ├─> T3 ─┤
    ├─> T4 ─┼─> T7
    └─> T5 ─┤
T6 ─────────┘
```

T6 可与 T1 并行（写域不重叠）；T2/T3/T4 可并行但都依赖 T1 的 token；T5 依赖 T1 的配色与 T5 自己的帧图。

## 3 风险

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 圆角阶变化导致布局跳动 | 中 | T4 后逐界面目测；必要时只上调卡片与输入区 |
| 中文衬线字体未定 | 低 | 先行落 `serif` 回退栈，字体文件另立任务 |
| 深色档改暖夜影响影像舞台周边 | 中 | 舞台子树保深色；T1 后立刻目测舞台边界 |
| AI 图标与帧图造型不一致 | 中 | 帧图以 `glaux-owl-b-pixel-1024.png` 为基准重绘，不重新生成 |
| 帧图工作量被低估 | 高 | T5 先出 idle/blink/thinking/typing 四态，其余按同一网格补 |

## 4 未决

1. 中文衬线字体是否打包（思源宋体子集）或仅拉丁标题启用衬线
2. 深色主题是否作为可选项保留，或彻底移除
3. 吉祥物是否允许关闭（设置项），默认开还是关
