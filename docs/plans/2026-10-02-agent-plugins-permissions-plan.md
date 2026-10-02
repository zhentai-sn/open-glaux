---
kind: record
status: active
---

# SDD 15 智能体插件契约与权限引擎 · 实施计划

依据：[SDD 15](../sdd/feats/15-agent-plugins-permissions/README.md) §7、§9、§15、D-1～D-16；相邻修订见 [SDD 00](../sdd/feats/00-reference-agent-conversations/README.md)（transport、命令结局）、[SDD 02](../sdd/feats/02-agent-image-annotation/README.md) §7.3（权限表）、[SDD 13](../sdd/feats/13-project-folder-sessions/README.md) §7.8 规则 4（越界守卫）。

## 现状要点

- **工具装配**：`agent-runtime/src/pi/harness-registry.ts` 的 `TOOL_PROVIDERS` 登记 12 个工具，`availableProviders` 按 `requires` / `supports` 过滤，`defaultToolFactory` 在 `observe` 下只保留两个视频工具，并对 `PROJECT_GUARDED_TOOL_NAMES` 套 `withProjectGuard`。`systemPromptFor` 按已挂工具拼接提示词片段。
- **测试注入点**：`HarnessRegistry` 构造参数 `toolFactory`；`defaultToolFactory` 被 `consult-atlas-tool`、`view-image-tool`、`segment-region-tool`、`chat-edition` 四个测试直接调用。`segment-region-tool.test.ts:213` 断言 `observe` 下工具为空，W4 后该断言改变。
- **越界守卫**：`src/pi/tools/project-guard.ts` 的 `ProjectScope` 在一个命令内缓存查询；`project-tools.test.ts` 直接测试 `withProjectGuard`。
- **事件**：`HarnessRegistry.emitPiEvent` 把 harness 全部订阅事件脱敏后作为 `pi.event` 下发。runtime 测试中 `multi-session-stream`、`consult-atlas-tool`、`run-task-tool`、`compaction`、`project-tools` 按 `pi.event` 断言。
- **前端事件消费**：`agent/runtime/events.ts` 订阅 `pi.event`；`store/agentSessions.ts` 的 `applyPiEvent` 按 `tool_execution_end`、`message_update`、`message_end` / `agent_end` / `session_compact` 分发；`agent/toolBridge.ts` 只认 `tool_execution_end`。消息解析在 `agent/runtime/types.ts`（`messageText`、`messageToolCalls`、`messageToolResultDetails`）。
- **快照消息**：`session-service.ts` 的 `visibleMessage` 保留 user / assistant，以及 `details.kind` 在 `VIEWABLE_DETAILS_KINDS` 内的 toolResult（剥掉 content）。
- **权限菜单**：`components/agent/AgentConversation.tsx` 的下拉菜单直接 PATCH `permission_mode`，i18n 键 `agent_permission_<mode>`。
- **pi 钩子行为**（0.82.1 源码核对）：`tool_call` / `tool_result` / `context` 取最后一个非空结果；钩子抛错使运行失败；`beforeToolCall` 可 `await`；`prepareNextTurn` 每回合重建上下文。
- **工作区**：`docs/sdd/feats/00-reference-agent-conversations/README.md` 与 `frontend/src/styles/global.css` 有与本计划无关的未提交改动。W7 要修订 SDD 00，提交时只暂存本计划的变更块。

## 波次

| 波次 | 内容 | 依赖 | 波末状态 |
| --- | --- | --- | --- |
| W1 | runtime：插件契约、钩子组合器、12 个工具迁入插件 | — | 行为不变，runtime 测试通过 |
| W2 | runtime + 前端：自有事件结构与 `TranscriptMessage` | W1 | 前端不再出现 pi 事件名，两端测试通过 |
| W3 | runtime：交互请求表、回复端点、`ask_user` | W2 | 契约测试覆盖请求生命周期 |
| W4 | runtime：权限引擎（effect、模式、规则、会话授权、越界并入、审计） | W1、W3 | 权限判定单测与集成测试通过 |
| W5 | runtime：运行预算与图像裁剪 | W1、W2 | 预算与裁剪单测通过 |
| W6 | 前端：交互卡片、权限菜单说明、`autonomous` 确认、告警与预算提示 | W2～W5 | 前端单测、lint、build 通过 |
| W7 | 活文档、§15 自查、浏览器走查 | W1～W6 | SDD 15 转 `implemented` |

- W2 放在 W3～W5 之前：后续波次新增的事件直接按新结构下发，不必二次迁移。
- W4 与 W5 都只依赖 W1～W3 的产物，可并行。
- 每个波次单独提交；W2 的 runtime 与前端改动在同一提交里，保证每个提交两端都能通过测试。

## W1 · 插件契约与迁移

- 新建 `agent-runtime/src/plugins/`：
  - `types.ts`：`ToolEffect`、`PluginTool`、`GlauxPlugin`、`RunContext`（SDD 15 §9.1）。本波 `RunContext` 只含会话 id、命令 id、项目 id、`viewer`。
  - `compose.ts`：钩子组合器。`installHooks(harness, plugins, ctx)` 对每种钩子类型只调用一次 `harness.on`；`tool_call` 短路、`tool_result` 补丁合并、`context` 串联；插件异常按 SDD 15 §7.2 规则 5 处理并记日志。
  - `registry.ts`：`PLUGINS` 数组与 `assemble(ctx)`，返回 `{tools, promptFragments, plugins}`。启动时校验每个工具声明了 `effect`、工具名不重复。
  - 领域插件：`imaging.ts`、`atlas.ts`、`annotation.ts`、`project.ts`、`video.ts`。各工具的 `requires` / `supports` / `create` / `promptFragment` 从 `TOOL_PROVIDERS` 原样搬入；`effect` 按 SDD 15 §7.3 填写。
- `harness-registry.ts`：
  - 删除 `TOOL_PROVIDERS`、`availableProviders`；`defaultToolFactory` 改为调用 `assemble`，签名不变，保住测试注入点。
  - `systemPromptFor` 改为按 `assemble` 返回的片段拼接，输出文本与迁移前逐字一致。
  - `start()` 创建 harness 后调用 `installHooks`。本波不登记任何钩子，组合器只做空转。
  - 本波暂保留 `observe` 只挂视频工具与 `withProjectGuard` 包装，W4 再替换。
- 测试：
  - 新增 `tests/unit/plugins-compose.test.ts`：短路、补丁合并、串联、插件异常不中断运行。
  - 新增 `tests/unit/plugins-registry.test.ts`：缺 `effect` 报错；重名报错；`systemPromptFor` 对 3 组典型上下文（无焦点、图像焦点 + 项目、视频焦点）的输出与迁移前快照一致。
  - 现有测试不改即通过。
- 门禁：`agent-runtime` 下 `npm test`、`npm run lint`。

## W2 · 自有事件结构

- runtime：
  - `contracts.ts`：新增 `TranscriptBlock`、`TranscriptMessage`、SDD 15 §9.5 的事件联合类型；删除 `pi.event`；`SessionView.messages` 改为 `TranscriptMessage[]`，新增 `pending_interactions: []`、`warnings: []`（本波恒为空数组）。
  - 新建 `src/transport/event-map.ts`：`mapPiEvent(event) → TransportEvent | null`。只映射 `message_update`（assistant）、`message_end`、`tool_execution_start`、`tool_execution_end`、`session_compact`，其余返回 `null`；映射后对 `args`、`details`、消息文本执行 `redactText`。
  - 新建 `src/transport/transcript.ts`：`toTranscript(message)`，丢弃 thinking 等未声明的块；`visibleMessage` 的过滤规则不变，输出改为 `TranscriptMessage`。
  - `HarnessRegistry.emitPiEvent` 改为调用 `mapPiEvent`；命令结束时发 `run.settled`（`outcome` 取现有 `settle` 的结局，`budget` 字段本波填 `{turns, elapsed_ms, exhausted: false}`，回合数由 `turn_start` 计数）。
- 前端：
  - `agent/runtime/types.ts`：`TransportEvent` 按新结构重写；`SessionView.messages` 改为 `TranscriptMessage[]`；删除 `piEventType`。
  - `agent/runtime/events.ts`：按新事件名订阅；`EventHandlers` 改为 `onMessageDelta`、`onMessageEnd`、`onToolStart`、`onToolEnd`、`onContextCompacted`、`onRunSettled` 等。
  - `store/agentSessions.ts`：`applyPiEvent` 拆为对应的 handler；`tool.end` 走原 `applyToolExecutionEvent` 的逻辑；`message.end`、`run.settled`、`context.compacted` 触发重新拉取快照。
  - `agent/toolBridge.ts`：输入由 pi 事件改为 `tool.end` 的 data。
- 测试：
  - runtime：上述 5 个测试中的 `pi.event` 断言改为新事件名；新增 `tests/unit/event-map.test.ts`，覆盖每个映射与 `null` 分支、脱敏、thinking 块丢弃。
  - 前端：`agentSessions.test.ts`、`toolBridge.test.ts`、`objectFocus.test.ts` 改用新事件；新增流式回复与后台会话未读标记的回归用例。
  - `rg -n "pi\.event|tool_execution_end|message_update|piEventType" frontend/src` 无结果。
- 门禁：两端 `npm test`、`npm run lint`；前端 `npm run build`。

## W3 · 交互请求

- 新建 `agent-runtime/src/interaction/`：
  - `table.ts`：`InteractionTable`，按会话登记请求；`create(kind, payload, {commandId, timeoutMs}) → Promise<InteractionResolution>`；`reply(requestId, reply)` 校验类型与幂等；`cancelCommand(commandId)`；`pending(sessionId)`。超时默认 30 分钟，可由构造参数覆盖（测试用）。
  - 请求创建、结束时发 `interaction.request`、`interaction.resolved`；结束时写 `glaux.interaction` 审计记录。
  - 等待时长通过回调上报给预算（W5 接入，本波留接口）。
  - `ask-user.ts`：`ask_user` 工具，参数按 SDD 15 §7.7 用 typebox 声明并校验；归入新插件 `interaction`，effect 为 `read`。
- transport：
  - `routes.ts` 新增 `POST /agent-api/v1/sessions/:sessionId/interactions/:requestId`，错误码按 SDD 15 §9.4。
  - `getSession` 的 `pending_interactions` 取自 `InteractionTable.pending`。
  - 中止命令时调用 `cancelCommand`。
- 测试：
  - 新增 `tests/contract/interactions-api.test.ts`：200 / 幂等 200 / 409 / 404 / 422；快照中可见待决请求；中止后转为 `cancelled`。
  - 新增 `tests/integration/ask-user-tool.test.ts`：用脚本化模型调用 `ask_user`，回复后工具结果为所选内容；超时后结果为「用户未回复」。
- 门禁：`agent-runtime` 下 `npm test`、`npm run lint`。

## W4 · 权限引擎

- 新建 `agent-runtime/src/permission/`：
  - `settings.ts`：读取用户级与项目级 `settings.json`（项目路径经 backend `GET /projects` 取得）；结构校验失败时忽略整个文件并产出告警；`appendAllowRule(scope, tool)` 先写临时文件再 rename，保留未知字段，规则已存在则跳过。
  - `rules.ts`：规则匹配（`tool` 精确或 `*`；`pattern` 经工具的 `permissionSubject` 匹配，本波无工具声明，带 `pattern` 的规则不命中）。
  - `decide.ts`：纯函数 `decide({tool, effect, mode, rules, grants, args}) → allow | deny | ask`，按 SDD 15 §7.5 第 2～5 步。
  - `grants.ts`：会话授权的读写，存为 `glaux.permission.grant` 自定义记录。
- 新插件 `permission`（登记在 `budget` 之后、领域插件之前）：
  - `tool_call` 钩子：越界判定（`ProjectScope` 逻辑移入）→ `decide` → ask 时经 `InteractionTable.create` 等待回复 → 写 `glaux.permission.decision`。
  - 每次判定通过 `RunContext.getMode()` 读取会话当前模式（读 companion 表，命令内不缓存）。
- 挂载规则：`assemble` 按命令开始时的模式过滤「不挂载」的 effect（SDD 15 §7.4），替换原 `observe` 只挂视频工具的逻辑。
- 删除 `withProjectGuard` 与 `PROJECT_GUARDED_TOOL_NAMES` 的包装用法；越界工具集合改为插件工具上的布尔字段 `projectScoped`。
- `SessionView.warnings` 接入设置文件告警。
- 测试：
  - 新增 `tests/unit/permission-decide.test.ts`：四种模式 × 七种 effect 的默认结果表；deny 压过 allow 与会话授权；ask 规则时 `grant_options` 只有 `once`。
  - 新增 `tests/unit/permission-settings.test.ts`：缺文件、坏 JSON、结构不符、写入保留未知字段、重复规则不写入。
  - 新增 `tests/integration/permission-flow.test.ts`：`suggest` 下 `run_task` 产生审批，允许后执行、拒绝后模型收到理由；「本会话允许」后不再审批；命令中途降级立即生效。
  - `project-tools.test.ts` 的越界用例改为经 `permission` 插件断言，判定依据为越界。
  - `segment-region-tool.test.ts:213` 改为：`observe` 下只挂 `read` 工具，不含 `segment_region`。
- 门禁：`agent-runtime` 下 `npm test`、`npm run lint`。

## W5 · 预算与图像裁剪

- 新插件 `budget`（登记在最前）：
  - 预算取值按 SDD 15 §7.8 规则 4 的优先级（项目级设置、用户级设置、环境变量 `GLAUX_AGENT_MAX_TURNS` / `GLAUX_AGENT_MAX_MINUTES`、默认 50 / 20），越界值逐级回退。
  - 订阅 `turn_start` 计数；计时扣除 `InteractionTable` 上报的等待时长。
  - 达到上限进入收尾：`tool_call` 返回 `{block: true, reason}`；宽限 3 回合或 2 分钟后调用 `HarnessRegistry.abort`，结局记为 `budget_exceeded`。
  - 命令结束时写 `glaux.budget` 审计记录，并填写 `run.settled.budget`。
- `command-service.ts`：`settle` 的结局枚举增加 `budget_exceeded`；`mapRuntimeError` 区分预算中止与用户中止。
- 新插件 `context-pruning`：`context` 钩子按 SDD 15 §7.9，保留最近 4 个含图像的 toolResult，更早的图像块替换为文字占位；用户消息不动。
- 测试：
  - 新增 `tests/unit/budget.test.ts`：优先级与越界回退；等待时长扣除；收尾拦截文案；宽限中止。用假时钟。
  - 新增 `tests/integration/budget-flow.test.ts`：`max_turns=3` 时第 4 回合起拦截，收尾回复后结局 `completed`；模型无视拦截时结局 `budget_exceeded`。
  - 新增 `tests/unit/context-pruning.test.ts`：6 次图像工具结果只保留最近 4 次；用户附件不受影响；会话存储不变。
- 门禁：`agent-runtime` 下 `npm test`、`npm run lint`。

## W6 · 前端界面

- 新组件 `components/agent/InteractionCard.tsx`：
  - `permission` 形态：工具名、effect 标签、参数摘要；按钮按 `grant_options` 显示「允许本次」「本会话允许」「总是允许」，另有「拒绝」与可选理由。
  - `question` 形态：问题、选项按钮、自由输入框。
  - 结束后折叠为一行结论（已允许 / 已拒绝 / 已回答 / 已过期 / 已取消）。
- `store/agentSessions.ts`：处理 `interaction.request` / `interaction.resolved`；快照恢复 `pending_interactions`；新增 `replyInteraction(sessionId, requestId, reply)`，409 时提示「请求已过期或已处理」。
- `AgentConversation.tsx`：
  - 待决卡片插在对话流末尾。
  - 权限下拉菜单每项附一句说明（新增 i18n 键 `agent_permission_<mode>_hint`）。
  - 选择 `autonomous` 时弹出确认对话框，取消则不 PATCH。
  - 快照 `warnings` 非空时在对话区顶部显示告警条。
  - `run.settled.budget.exhausted` 为真时，在最终回复前显示预算提示行。
- 工具卡片：被拦截的工具调用显示「已拒绝」与理由（来自 `tool.end` 的 `is_error` 与结果文本）。
- i18n：中英双语补全新增键。
- 测试：`InteractionCard.test.tsx`（两种形态、按钮随 `grant_options` 变化、回复后折叠）；`AgentConversation.test.tsx` 增加确认对话框与告警条用例；`agentSessions.test.ts` 增加交互事件用例。
- 门禁：前端 `npm test`、`npm run lint`、`npm run build`。

## W7 · 活文档与验收

- 活文档同步：
  - [仓库骨架总览](../architecture.zh-CN.md)：agent-runtime 源码分区增加 `plugins/`、`permission/`、`interaction/`；工具表增加 effect 列与 `ask_user`；越界守卫段落改为权限判定第 1 步；事件描述改为 Glaux 事件。
  - SDD 00：transport 事件与快照消息结构、命令结局 `budget_exceeded`。
  - SDD 02 §7.3：权限表改为引用 SDD 15 §7.4。
  - SDD 13 §7.8 规则 4：实现位置改为权限插件。
  - agent-runtime 与 frontend 的 CHANGELOG（`Unreleased`）。
- 按 SDD 15 §15 逐条自查，结果写入 SDD 15 §0 当前阶段。
- 浏览器走查（Focus 与 Workbench）：`suggest` 审批、`ask_user` 提问、刷新恢复待决卡片、中止取消、`autonomous` 确认、坏设置文件告警、`max_turns=3` 收尾。
- SDD 15 转 `implemented`，更新 SDD 索引；本计划状态改为 `done`。

## 风险

| 风险 | 应对 |
| --- | --- |
| W2 一次改动两端事件处理，回归面大 | 先补回归用例（流式、`run_task` 写回、后台未读）再迁移；前后端同一提交 |
| pi 并行执行多个工具调用时多个审批同时挂起 | 交互请求表按请求独立管理；集成测试覆盖两个并发审批 |
| 钩子组合器的异常吞没掩盖真实缺陷 | 每次吞没都记带 `trace_id` 的错误日志；单测断言日志被写出 |
| 「总是允许」写入用户项目目录下的 `.glaux/settings.json` | 卡片文案注明写入位置；写入失败按「本会话允许」处理 |
| 命令内实时读取权限模式增加 companion 表读取 | 单次查询为主键读；必要时加 1 秒内存缓存，不影响「降级立即生效」的语义 |
| pi 升级改变钩子语义 | `tests/compatibility/pi-public-api.test.ts` 增加钩子取值行为的断言 |

## 实施偏差

- W1：`locate_roi` 归入 `annotation` 插件而非 `imaging`。插件按登记顺序拼接提示词片段，这样排列才能与迁移前的片段顺序逐字一致；SDD 15 §7.1 表格已同步。
- W2：`tool.end` 增加 `error_text`（仅出错时，前 2000 字符）。现有集成测试断言工具错误文本，W6 的「已拒绝」理由也需要它；SDD 15 §9.5 已同步。
- W2：脱敏改为逐字符串执行（新增 `redactStrings`）。原实现对整段 JSON 执行 `redactText`，`Bearer` 规则会吞掉结束引号导致 `JSON.parse` 抛错，进而从订阅回调中让运行失败；这是迁移前就存在的缺陷。
- W3：交互请求表由 `HarnessRegistry` 持有（`registry.interactions`），审计经 `registry.appendAudit` 写入当前命令的 Pi 会话；回复端点的契约用例与 `ask_user` 集成用例合并在 `tests/integration/ask-user-tool.test.ts`，未另建 `tests/contract/interactions-api.test.ts`。`ask_user` 本波已加入 `observe` 模式的工具白名单。
- W4：权限依赖（越界作用域、设置加载）作为 `HarnessRegistry` 的第 5 个构造参数注入；测试夹具缺省注入「越界一律放行、无设置文件」，避免注入同名工具的既有测试访问真实 backend 与用户目录。
- W4：审计记录在命令运行中入队、命令结束时顺序写入。运行中直接写会话，会与交互请求结束时的审计或 harness 自身写入并发，SQLite 会话存储拒绝写入（实测）。代价是 runtime 在命令中途崩溃时丢失该命令的审计记录。命令结束时同时取消该命令残留的待决请求。
- W4：快照 `warnings` 来自最近一次命令加载设置时的结果；会话尚未运行过命令时为空。
- W4：未在 `tests/compatibility/pi-public-api.test.ts` 增加钩子取值语义断言，钩子组合由 `plugins-compose` 单测覆盖，pi 行为由 `permission-flow` 集成测试间接覆盖。
