---
kind: record
status: done
---

# SDD 18 子智能体 · 实施计划

依据：[SDD 18](../sdd/feats/18-agent-subagents/README.md) §7、§9、§15、D-1～D-8。

## 现状要点

- **装配**：`HarnessRegistry.assemble` 产出运行时、工具上下文、工具、系统提示词、权限状态与资源；`installHooks` 按插件组合钩子，`RunContext` 携带权限、预算。
- **pi**：`InMemorySessionRepo.create()` 得内存会话；`AgentHarness` 构造参数同主智能体。
- **资源**：`resources/load.ts` 的 `loadResources` 返回 Skills、模板、说明；`resourceDirs` 给出三层目录。
- **交互请求**：`InteractionTable.create` 的输入为 `InteractionInput`；权限插件与 `ask_user` 构造请求。
- **快照**：`session-service.ts` 的 `VIEWABLE_DETAILS_KINDS` 决定哪些工具结果进快照。
- **前端**：`AgentConversation` 按 `details.kind` 渲染卡片；`InteractionCard` 渲染审批与提问；`SkillsView` 按来源列 Skills。
- **工作区**：SDD 00 README 与 `global.css` 有与本计划无关的未提交改动，提交时只暂存本计划的变更块。

## 波次

| 波次 | 内容 | 依赖 | 波末状态 |
| --- | --- | --- | --- |
| W1 | runtime：定义加载、`agent` 工具、子智能体运行、交互请求 `origin`、快照保留 | — | runtime 测试通过 |
| W2 | 前端：子智能体卡片、审批来源、「技能」页定义列表 | W1 | 前端测试、lint、build 通过 |
| W3 | 活文档、§15 自查 | W1、W2 | SDD 18 转 `implemented` |

## W1 · runtime

- `agents/general.md`：通用定义。
- `src/resources/agents.ts`：frontmatter 最小解析（`name`、`description`、`tools`、`max_turns`），三层覆盖，告警。
- `src/resources/load.ts`：`agents`、`harnessAgents` 字段；`resourceDirs` 增加 `agents`。
- `src/subagents/run.ts`：`runSubagent(request, deps)`——内存会话、子 harness、钩子、预算、中止、过程记录；`createSlots(3)` 并发槽位。
- `src/plugins/subagents.ts`：`agent` 工具（effect `delegate`），`applies: ctx => !!ctx.spawnSubagent && !ctx.subagent`。
- `pi/harness-registry.ts`：`assemble` 在构造工具前为工具上下文提供 `spawnSubagent`；子工具集由 `toolFactory({...ctx, subagent: true})` 生成后按定义过滤。
- `interaction/table.ts`、`contracts.ts`、`plugins/types.ts`：`origin`；权限插件与 `ask_user` 透传 `RunContext.origin`。
- `session-service.ts`：`glaux.subagent_run` 进快照。
- 测试：`agents-load` 单测；`subagents` 集成（只收到 prompt、工具交集、最终回复与 details、审批 origin、`max_turns`、中止）；槽位单测；挂载单测。

## W2 · 前端

- 类型：`AgentItem`、`ResourceList.agents`、`InteractionRequest.origin`。
- `SubagentCard`：标题、结局、回合数、最终回复（Markdown）、可展开过程。
- `AgentConversation`：`glaux.subagent_run` 渲染卡片。
- `InteractionCard`：显示来源。
- `SkillsView`：「子智能体」分组只读列表。
- 测试：卡片、来源、列表。

## W3 · 活文档与验收

- 仓库骨架总览、操作手册、SDD 15（`origin`）、SDD 17（资源清单 `agents`）、两份 CHANGELOG。
- §15 自查；SDD 18 转 `implemented`；本计划改为 `done`；脑暴改为 `promoted`。

## 风险

| 风险 | 应对 |
| --- | --- |
| 子智能体放大模型调用成本 | 并发上限 3、每个默认 20 回合；时长受主命令预算约束 |
| 子智能体与主智能体并发写主会话 | 审计已入队写入（SDD 15 W4）；子会话在内存，不写数据库 |
| 过程记录过大 | 图像替换为占位、文本块截断、最多 200 条 |

## 实施偏差

- W1：子智能体失败时由 `subagents` 插件的 `tool_result` 钩子把结果标为错误；pi 工具结果不能直接声明 `isError`，抛错又会丢掉 `details`。
- W1：快照与前端原本丢弃全部失败的工具结果，`glaux.subagent_run` 作为例外保留，满足 SDD 18 §7.3 规则 4。
- W1：子智能体的时长预算扣除其开始后等待用户回复的时间，与主命令的计法一致。
- W1：子智能体内 `ask_user` 收到中止信号时取消整个主命令的待决请求，沿用 SDD 15 的实现；只在主命令中止时出现，结果一致。
- W2：「技能」页的子智能体分组只读，不提供编辑入口；定义文件在磁盘上修改。
- W3：按脑暴 P3「事件转发」补做进度推送：SSE `subagent.progress`（回合数与当前工具），SDD 18 D-5 相应修订。
