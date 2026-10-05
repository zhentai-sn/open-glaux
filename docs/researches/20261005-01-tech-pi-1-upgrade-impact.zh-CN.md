---
kind: record
status: done
---

# Pi 1.0 升级影响评估

日期：2026-10-05。评估 agent-runtime 从 `@earendil-works/pi-*` 0.82.1 升级到 1.0.2 的影响。

## 结论

- 1.0 不是版本号意义上的升级，而是底座替换：`pi-agent-core` 1.0.0 删除了整个 `AgentHarness` 及其会话、存储、工具、技能、压缩、`NodeExecutionEnv`，只保留 `Agent` 与 agent loop。
- 替代品 `@earendil-works/pi-durable` 是全新设计的持久化 harness，README 标注 **Experimental, API changes without notice**，1.0.2 之后的 Unreleased 段已有新的破坏性变更。
- 决定（2026-10-05）：近期维持 0.82.1，不升级；等 `pi-durable` 去掉 Experimental 标注或出现必须依赖新版本的功能时，按「迁移到 pi-durable」方案单独立项（新 SDD）。

## 版本现状

| 包 | 本仓库 | npm latest | 备注 |
| --- | --- | --- | --- |
| `pi-ai` | 0.82.1 | 1.0.2（2026-10-04） | 对本仓库调用点源码兼容 |
| `pi-agent-core` | 0.82.1 | 1.0.2 | harness 全部移除 |
| `pi-storage-sqlite-node` | 0.82.1 | 0.83.0（2026-07-29） | 已停更，仓库中已删除该包；SQLite 存储并入 `pi-durable/storage/sqlite/node` |
| `pi-durable` | — | 1.0.2 | 1.0.0 首发，依赖 `@earendil-works/chord` |

## 破坏性变更时间线（与本仓库相关）

| 版本 | 包 | 变更 | 对本仓库 |
| --- | --- | --- | --- |
| 0.83.0 | ai | TypeBox 升到 1.3.7，删除 `Type.Base` 等弃用 API | 未使用被删 API |
| 0.84.0 | agent-core | 会话模型换成 v4 lane-based `Session` / `SessionStorage` / `SessionRepo`；删除旧 JSONL / 内存仓库；`FileSystem` 新增必需的 `renameFile()` | `SqliteSessionRepo` 与新 `Session` 不兼容，会话层全部失效 |
| 0.84.4 | agent-core | `prepareNextTurn` 只在确定开启下一轮时运行 | 预算收尾、上下文裁剪需复核时机 |
| 0.86.0 | ai | provider 流输入从 `Context` 改为 `TranscriptContext`；`ToolCall.arguments`、`ToolResultMessage.details` 限定为 JSON 值 | 编译未报错；工具 `details` 需逐个确认可 JSON 序列化 |
| 0.87.0 | agent-core | 删除 `shouldStopAfterTurn`，改用 `finishTurn` | 未使用 |
| 0.99.0 | ai | 图像生成模型并入 `Provider`/`Models`，删除 `ImagesModels` 系列 | 未使用 |
| 1.0.0 | agent-core | 删除 harness、会话与存储、durable runtime、harness 工具、压缩、技能、提示模板、`uuidv7` 再导出、`./node` 子路径 | 见下节 |

## 编译实测

在隔离 worktree 中替换依赖后运行 `tsc --noEmit`（`tsconfig.json`，仅 `src/`）：

| 依赖组合 | src 错误 | 说明 |
| --- | --- | --- |
| agent-core 1.0.2 + ai 1.0.2 | 143 处 / 31 个文件 | 全部来自 agent-core 缺失导出与 `./node` 子路径；纯 pi-ai 调用点（`model-runtime`、`connection-probe`、`vision`）零错误 |
| agent-core 0.99.2 + ai 0.99.2 | 128 处（含测试 329 处） | v4 `Session` 与 `SqliteSessionRepo` 类型不兼容、`AgentHarnessEvent` 等改名、工具回调签名变化；且 0.99 的 harness 在 1.0 被删，是死路 |
| agent-core 0.82.1 + ai 1.0.2 | 6 处 | node_modules 中并存两份 pi-ai，`Models`、`AssistantMessage` 类型不互通；运行时同样会有两份实现，不可行 |

1.0.2 下缺失的 agent-core 导出（括号内为引用次数）：

- harness 与事件：`AgentHarness`(5)、`AgentHarnessTool`(13)、`AgentHarnessEvent`(3)、`ToolCallEvent`(3)、`ToolCallResult`(3)、`ToolResultEvent`(2)、`ToolResultPatch`(2)、`ExecutionToolContext`(1)
- 会话：`Session`(7)、`SessionTreeEntry`(3)、`InMemorySessionRepo`(1)、`buildSessionContext`(1)
- 执行环境与内置工具：`ExecutionEnv`(2)、`NodeExecutionEnv`（`./node`，4 个文件）、`createReadTool` / `createWriteTool` / `createEditTool` / `createBashTool`
- 技能与提示模板：`loadSkills`、`loadSourcedSkills`、`loadSourcedPromptTemplates`、`formatSkillsForSystemPrompt`、`Skill`、`PromptTemplate`、`parseCommandArgs`
- 压缩与 token 估算：`shouldCompact`、`DEFAULT_COMPACTION_SETTINGS`、`estimateTokens`、`estimateContextTokens`
- 其他：`uuidv7`

## 拆分 pi-durable 的动机

上游没有单独说明拆分理由。以下依据 changelog、`pi-durable` README、设计文档 `packages/durable/docs/spec.md` 与 `pico-v5-handoff.md`，以及上游源码对 harness 的引用情况归纳。

### 隔离稳定核心与实验性 harness

- harness 在 `pi-agent-core` 内反复重做：0.84 把 v2 harness 升为默认入口并把会话换成 v4；handoff 文档记录了 pico、pico3、pico4 原型被删除，pico5 成为 `pi-durable`。
- 上游产品 `pi-coding-agent` 的正式代码不依赖 `AgentHarness`，只有 `experimental/` 下 2 个文件引用；它用自己的 `AgentSession` / `SessionManager`。
- harness 放在 `pi-agent-core` 内，每次重做都会破坏所有 `pi-agent-core` 使用者，本仓库在 0.84 的会话层失效即属此类。
- 拆分后 `pi-agent-core` 只含 `Agent`、agent loop、proxy stream，可给出 1.0 稳定承诺；harness 在独立包中保持 Experimental 并继续迭代。

### 新 harness 的设计目标

spec 的核心规则：Session 原子提交不可变条目、完整任务记录和 Chord 跟踪的文档，只有已提交状态可见。由此得到：

- 崩溃恢复：生成、工具调用、压缩都是带检查点的持久任务；进程在一轮中途退出后，重新打开存储从最后检查点继续；工具以 `replay: "safe"` 声明能否重跑。
- 幂等提交：相同 `requestId` 的重复提交返回同一个 submission。
- 可见状态等于持久状态：流式部分结果默认每 100 ms 提交一次，不存在仅在内存中的可见状态；多客户端订阅、迟到加入、断线重连都从当前视图开始，变更以 `@earendil-works/chord` 操作同步。
- 可移植：存储核心不依赖 Node API，可运行在 Bun、Cloudflare Durable Objects；执行环境可按会话分配（如每会话一个容器）。
- 统一所有权：子智能体、子任务归属父任务；中止自底向上传播，后台任务作为边界，父会话空闲判定有明确规则。

### 对本仓库的潜在收益

| 本仓库自研能力 | pi-durable 原生对应 |
| --- | --- |
| 重启恢复（SDD 00、13） | 任务检查点 + `resume()`，可从一轮中途恢复 |
| 运行轨迹采集（SDD 21） | 已提交状态本身可追溯；`pi.system` 记录 system prompt 变化，`pi.usage` 记录用量 |
| 事件映射到前端 | `viewState()` / `watch()`，支持迟到加入与重连 |
| 子智能体生命周期（SDD 18） | 所有权树与中止语义 |
| 自定义条目存交互状态 | `defineDoc()` 定义带类型的文档，与条目原子提交 |

收益成立的前提是 API 稳定；当前缺口见下节。

## 迁移到 pi-durable 的映射

| 本仓库能力（SDD） | 0.82.1 依赖 | pi-durable 1.0.2 对应 | 缺口 |
| --- | --- | --- | --- |
| 会话持久化与重启恢复（00、13） | `SqliteSessionRepo` + `AgentHarness` | `Harness.open(openNodeSqliteStorage())` + `resume()`；任务级 checkpoint | 存储格式不同，已有会话数据需迁移脚本或放弃 |
| 重新生成、分支（00） | `navigateTree`、`getBranch`、`SessionTreeEntry` | `conversation.fork(entryId)`，新会话而非同会话分支 | 会话 ID 与前端分支导航模型要重做 |
| 自定义条目（交互卡片、标注等） | `appendCustomEntry` | `submit({ type: "write", entry })` 或 `commit(tx.entry)`；`defineDoc` 存结构化状态 | 改写调用点 |
| 流式事件到前端（transport/event-map） | `AgentHarnessEvent` | `watchEvents()`（Experimental）或 `viewState()` / `watch()` | 事件映射层重写 |
| 自定义工具（16、22，Atlas、视频等 10+ 个） | `AgentHarnessTool` | `defineTool()`，每次调用是持久任务，需声明 `replay` | 全部改签名；评估各工具的 replay 语义 |
| 内置文件工具与 bash（16） | `createReadTool` 等 + `NodeExecutionEnv` | `pi-durable/tools` 的 `CodingTools` + `pi-durable/env/node` | 内置 `read` 不支持图片 |
| 权限（15） | 工具调用事件拦截 | `hook(ToolTask, { beforeTool })` | 改写 |
| 插件组合（15） | 自研 `plugins/compose` 包装 harness | `defineExtension` + registry | 插件模型改用 extension |
| 技能与提示模板（17） | `loadSkills` 等 | 无 | 自研加载与 system prompt section |
| 子智能体（18） | 自研 `subagents/run` | 任务所有权 + 子会话（README 示例 22、23） | 改写 |
| 上下文管理与压缩（19） | `shouldCompact`、自研裁剪插件 | 内置自动压缩 + `beforeRequest` hook | 裁剪插件改为 hook；token 估算自备 |
| 预算收尾（budget） | harness 事件 | `pi.usage` 文档 + `onYield` / `afterTools` hook | 改写 |
| 运行轨迹与请求重建（21） | `buildSessionContext`、`getBranch` | 条目与 `pi.system` 位置化系统条目 | 请求重建逻辑重写，SDD 21 刚合入 |

## 工作量估计

- 直接受影响：`src/` 31 个文件；会话、harness、命令、插件、轨迹核心约 3.3k 行，`src/` 共约 11.5k 行。
- 集成测试大面积依赖 `runtime-fixture` 与会话 API，需随之重写。
- 规模相当于重写 agent-runtime 的运行时核心，按新 SDD 立项，不宜作为依赖升级处理。

## 维持 0.82.1 的代价

- 拿不到 0.83～1.0.2 的 provider 修复与新功能，例如 `samplingParamsByThinkingLevel`、`onProviderStreamEvent`、per-conversation provider `sessionId`。
- 上游不再维护 0.82 分支；依赖越久，迁移面越大。

## 重新评估的触发条件

- `pi-durable` 去掉 Experimental 标注，或连续多个版本无破坏性变更。
- 需要只在新版 pi-ai 提供的能力（新 provider、全模态音视频块等）。
- 0.82.1 出现无法本地绕过的 provider 缺陷或安全问题。
