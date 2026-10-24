---
kind: record
status: active
title: "实施计划：对话输入区（上下文统计 · 模型与推理档位 · 控件统一）"
date: 2026-10-24
---

# 实施计划：对话输入区

- 需求来源：用户提供 DSH 桌面端三张截图（上下文已用 / 会话统计、模型选择、推理等级滑块），要求 Glaux 对话框具备同等能力，并要求输入区逻辑更清晰、简洁、统一。
- 参照对象：DSH 桌面端对话输入区的三处控件。只借信息结构与交互形态，不复用其实现。
- 上位约束：[前端视觉交互设计纲领](../designs/frontend-design-charter.zh-CN.md) G7（数字带单位）、G11（不占位噪音）、G12（不装饰循环）、M2、M4、M5、M6。
- 相关 SDD：[00 内置参考智能体与本地会话管理](../sdd/feats/00-reference-agent-conversations/README.md)、[19 上下文管理](../sdd/feats/19-context-management/README.md)、[21 运行轨迹](../sdd/feats/21-run-trajectory/README.md)。

## 0 现状

| 部位 | 现状 | 问题 |
| --- | --- | --- |
| 上下文用量 | `AgentConversation.tsx` 内联 `ContextRing`：14px 圆环 + 原生 `title` 式 tooltip | 只能看到消息估算 tokens，看不到系统提示词/工具定义；窗口未知时只有一个灰环；无累计用量 |
| 模型 | `composer-model` 按钮只显示 `connection.model`，点击直接进连接设置 | 已连接后换模型必须开设置面板；不显示推理档位 |
| 推理档位 | 无。runtime 仅在音画适配器里硬编码 `reasoning_effort: "low"` | `AgentHarness` 的 `thinkingLevel` 恒为 `off`，pi 的 thinking 预算与 `reasoning_effort` 从未生效 |
| 权限 | `PermissionMenu` 自带弹层、宽度 300、右对齐 | 与其余控件形态不一致 |
| 底栏 | 三个控件三种视觉（环 + 两种按钮），字号 12、色值 `--mid` | 同一行里三种高度与间距，读起来散 |

## 1 设计决策

- **D1 两个胶囊替代三个视觉**：`上下文` 与 `模型` 都是「图标 + 文本 + 点击弹层」的同构胶囊，与 `权限` 共用同一套按钮与弹层样式。上下文胶囊直接显示百分比，模型胶囊显示模型名与档位后缀。
- **D2 信息结构照抄 DSH，数值与口径按 Glaux**：上下文面板分三段（系统提示词 / 工具定义 / 对话消息）+ 一条三色分段条 + 精确 `已用 / 窗口`；会话统计分「模型用时、工具调用用时、首 token 平均、输出速度」，Token 用量分「费用、缓存命中、未缓存输入、缓存读取、输出」。
- **D3 统计口径**（runtime 计算，前端只格式化）：
  - `模型用时` = 各次模型调用 `duration_ms` 之和；
  - `工具调用用时` = 工具耗时之和，扣掉等待用户回复（审批、`ask_user`）的时间；
  - `首 token 平均` = 有 `first_token_ms` 的调用取平均；
  - `输出速度` = 输出 tokens / Σ(时长 − 首 token 时间)；
  - `缓存命中` = 缓存读 / (未缓存输入 + 缓存读)；
  - `费用` = pi 各次调用 `usage.cost.total` 之和；端点未定价时显示「未定价」而不是 0。
- **D4 上下文总量包含系统提示词与工具定义**：`context_usage.tokens` 目前只估算消息。面板用最近一次请求头（`glaux.request.header` 的 `est_tokens`）与最近一次模型调用的 `est_tokens.messages` 相加得总量；胶囊百分比在统计到达前回退到消息估算，避免首帧空白。
- **D5 推理档位是连接级偏好**：`Connection.thinkingLevel` 随连接持久化（`glaux.connection`），发送时以 `thinking_level` 进入 `ConnectionInput`，runtime 传给 `AgentHarness` 的 `thinkingLevel`。四档：关闭 / 低 / 中 / 高，对应 pi 的 `off` / `low` / `medium` / `high`；缺省 `off`，与非内置目录模型的现状一致。
- **D6 非目录模型按需开启 reasoning**：pi 只在 `model.reasoning` 为真时下发 thinking 参数。自定义模型（OpenCode、兼容端点）在用户选了非关闭档位时置为真，否则保持假——用户不碰档位就不会给未知端点多发参数。
- **D7 换模型落到会话**：已连接后选模型 = 写 `connection.model`（含窗口与输出上限的元数据）+ 当前会话 `PATCH provider/model`（会话空闲时），后者在轨迹里留一条 `model_change`。未拿到模型列表时面板提供「获取模型列表」，复用 `connection/models`。
- **D8 弹层统一由 `ComposerPopover` 提供**：向上弹出、右对齐、点外关闭、Esc 关闭、焦点回到触发按钮。权限菜单改为复用该壳，三处弹层只有内容不同。

## 2 任务

| 编号 | 任务 | 落点 |
| --- | --- | --- |
| R1 | 契约：`ConnectionInput.thinking_level`、`SessionStats`、`TrajectoryUsage.cost` | `agent-runtime/src/contracts.ts` |
| R2 | 统计：`SessionService.stats()` 直接扫分支条目（模型调用、工具耗时、请求头），不经轨迹投影 | `agent-runtime/src/pi/session-service.ts` |
| R3 | 推理档位传入 harness，并对自定义模型按需置 `reasoning` | `harness-registry.ts`、`model-runtime.ts` |
| R4 | 路由 `GET /sessions/:id/stats` | `transport/routes.ts` |
| R5 | 单测：统计聚合、档位校验、reasoning 标志 | `agent-runtime/tests/` |
| F1 | `Connection.thinkingLevel` 持久化 + 探针/发送通路 | `store/session.ts`、`agent/useConversation.ts`、`types.ts`、`client.ts` |
| F2 | `agentSessions` 增加 `stats` 缓存与 `refreshStats` | `store/agentSessions.ts` |
| F3 | `ComposerPopover` 共用弹层壳 | `components/agent/ComposerPopover.tsx` |
| F4 | `ContextUsagePanel`（百分比 + 分段条 + 明细） | `components/agent/ContextUsagePanel.tsx` |
| F5 | `ModelMenu`（模型列表 + 推理档位 + 更多模型） | `components/agent/ModelMenu.tsx` |
| F6 | `AgentConversation` 底栏改用两个胶囊；删除内联 `ContextRing` | `components/agent/AgentConversation.tsx` |
| F7 | 样式统一：`.composer-pill` / `.composer-pop`；删掉环 tooltip 规则 | `styles/global.css` |
| F8 | 中英文案 | `i18n/zh.ts`、`i18n/en.ts` |
| F9 | 测试：面板渲染、档位切换、换模型写回、弹层键盘 | 各组件 `.test.tsx` |
| D1 | 活文档：SDD 00（连接输入的推理档位）、SDD 19（上下文用量口径）、SDD 21（会话统计） | 同提交更新 |

## 3 验收

- 输入区同一行只有三类胶囊，高度与间距一致；弹层向上弹出且样式同源。
- 上下文面板显示三色分段条、三行明细与 `已用 / 窗口`；数值带单位；窗口未知时不显示百分比而显示 tokens。
- 会话统计在至少跑过一轮后与轨迹页合计一致（模型用时、工具用时、tokens）。
- 模型面板列出已获取的模型并标出当前项；选择后胶囊立即更新，下一次发送使用新模型。
- 推理档位四档可切换，刷新后保持；档位进入请求 body（`reasoning_effort`），非关闭档位下自定义模型才带 thinking 参数。
- 键盘：Tab 可达三个胶囊，Enter/Space 打开，Esc 关闭并回到触发按钮，方向键在菜单/档位内移动。
- 门禁：`agent-runtime` lint/test、`frontend` lint/test 通过；浏览器走查输入区两种模式。

## 4 开放问题

1. `费用`：非 Anthropic 目录模型（OpenCode、兼容端点）pi 未提供单价，只能显示「未定价」。是否给连接加「输入/输出/缓存读 单价（每百万 token）」由用户填写？——待定，本期不做。
2. 上下文「已用」是否包含本轮尚未发送的草稿？本期不含（与请求头一致）。
3. 推理档位默认值：本期 `关闭`（保持既有行为）。若默认改为「高」（对齐 DSH），未知端点可能因多发的 `reasoning_effort` 报 400。

## 5 执行结果（2026-10-24）

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| R1 契约 | 完成 | `contracts.ts`：`THINKING_LEVELS`、`ConnectionInput.thinking_level`、`SessionStats`、`TrajectoryUsage.cost` |
| R2 统计 | 完成 | `trajectory/stats.ts` 纯函数聚合；`SessionService.stats()`；`tests/unit/session-stats.test.ts`（3 项） |
| R3 推理档位 | 完成 | `harnessThinkingLevel()` 传入 `AgentHarness.thinkingLevel`，子智能体沿用；`model-runtime.ts` 按需置 `reasoning` |
| R4 路由 | 完成 | `GET /sessions/:id/stats`；`tests/integration/trajectory.test.ts` 增一条统计断言 |
| R5 单测 | 完成 | `tests/integration/thinking-level.test.ts`（4 项：下发、未选档位不发、关闭不发、拒绝未知值） |
| F1–F2 前端通路 | 完成 | `Connection.thinkingLevel` 持久化；`toConnectionInput` 带 `thinking_level`；store 增 `stats`/`refreshStats`/`setModel` |
| F3–F5 组件 | 完成 | `ComposerPopover`、`ContextUsagePanel`、`ModelMenu`；权限菜单改用同一外壳 |
| F6–F7 接入与样式 | 完成 | 输入区三胶囊；`.composer-pill`/`.composer-pop`/`.usage-*`/`.model-*`/`.reason-*`；删除旧的环形 tooltip 样式 |
| F8 文案 | 完成 | 中英文案 34 条 |
| F9 测试 | 完成 | `ComposerPopover`（3）、`ContextUsagePanel`（3）、`ModelMenu`（7）、`usageFormat`（5） |
| D1 活文档 | 完成 | SDD 00 §4.1/§4.3/§5.1/§6.4/§9.3/§15.2；SDD 19 §7.4 规则 6；SDD 21 §7.5 用量与新增 §9.5；仓库骨架端点表 |

门禁：`agent-runtime` lint + 562 项测试、`frontend` lint + 534 项测试通过。

人工走查（浏览器，opencode-go + deepseek-v4.1-flash）：

- 上下文面板：`~1.1K / 200K`、三段估算（468 / 667 / 3）、模型用时 0.4 秒、153 tok/s、未缓存输入 2,251、输出 55、费用「未定价」。
- 模型面板：拉取到 40+ 个模型；换档到「高」后胶囊显示「高」，`glaux.connection.thinkingLevel` 落盘；随后发一条消息成功返回（端点接受 `reasoning_effort: high`，未出现 400）。
- 验证用的临时会话已删除。

### 5.1 视觉返工（2026-10-24 第二轮）

- 弹层内容溢出：`.composer-pop` 原为内联 320px 宽 + 内层固定 312px，右列数值被挤到边框外；改为弹层
  340px、内层 `width: 100%`，实测最右元素距内容右边 1px。
- 指示图标：环形弧改为饼图；先做成「三段构成」三色饼，评审发现 1.2% 用量配满格三色饼语义违和，
  改回**两色饼**（高亮扇形 = 已用占窗口的比例，其余为 22% 中性底盘），高用量档仍按 70%/90% 换 warn/crit；
  极低用量下同色描边 0.6px 保证几度的扇形仍读得出是一块，不改变角度。
- 滚动条：模型列表的自定义 `::-webkit-scrollbar` 原先被标准 `scrollbar-width/color` 覆盖，退化成带箭头
  的原生条；改为只用伪元素（thin 6px、圆角、悬停加深），列表底部加 12px 渐隐，避免切在行中间。
- 节奏统一：弹层内距 14px、区块间距 10px、圆角 12px；行高与数值字号上调半档；当前模型行改用强调底。
- 弹层挂载位置：`ComposerPopover` 改用 portal 挂到 `document.body` + fixed 定位（按触发按钮实测贴右缘、
  向上 10px），脱离 `.agent-conversation` 的 `overflow: hidden` 与对话滚动的合成层；视口变化即收起。

未做（§4 开放问题仍开放）：费用单价、草稿是否计入上下文、档位默认值。
