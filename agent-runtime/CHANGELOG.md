# Agent Runtime Changelog

本文件只记录 Agent Runtime 独立发布；Glaux 整体发布见根目录 `CHANGELOG.md`。

## [Unreleased]

### Added

- 工具按插件登记，每个工具声明副作用等级 `effect`；插件钩子经组合器每种只注册一个 handler（SDD 15）。
- 交互请求表与回复端点 `POST /agent-api/v1/sessions/{id}/interactions/{request_id}`；新工具 `ask_user`；SSE 新增 `interaction.request`、`interaction.resolved`，快照 `pending_interactions` 给出待决请求（SDD 15 §7.6、§7.7）。
- 权限引擎：工具按 effect 与权限模式挂载、放行或审批；支持用户级与项目级 `settings.json` 的 allow / deny / ask 规则、「本会话允许」「总是允许」与审计记录；快照 `warnings` 给出设置文件告警（SDD 15 §7.4、§7.5）。
- 运行预算：每个命令默认 50 回合、20 分钟（设置文件或 `GLAUX_AGENT_MAX_TURNS` / `GLAUX_AGENT_MAX_MINUTES` 可改），用尽后拦截工具调用要求模型收尾，宽限用尽中止并记结局 `budget_exceeded`；每次模型请求只保留最近 4 个工具结果中的图像（SDD 15 §7.8、§7.9）。

### Changed

- SSE 不再发送 `pi.event`，改为 Glaux 事件：`message.delta`、`message.end`、`tool.start`、`tool.end`、`context.compacted`、`run.settled`；快照消息改为 `TranscriptMessage`，并新增 `pending_interactions`、`warnings` 字段（SDD 15 §9.5～§9.7）。
- `observe` 模式由「只挂视频工具」放宽为「只挂只读工具」；`suggest` 模式下 `run_task`、`locate_roi`、`segment_region` 需逐次审批（SDD 15 D-10、§7.4）。
- 项目越界守卫由工具包装改为权限插件的 `tool_call` 判定，越界调用以拦截理由返回模型。

### Fixed

- 事件脱敏改为逐字符串执行；原实现对整段 JSON 替换，含 `Bearer` 文本的事件会产出非法 JSON 并使运行失败。

## [0.2.0] - 2026-08-31

### Added

- 智能体可读取查看器当前打开的图像（`view_image` 工具与查看器上下文）。

### Changed

- 建议态标注的工具结果实时写回查看器，并随会话快照持久化。
- 结果写回不再抢占 Focus 右侧栏的标签：舞台自 SDD 01 v1.4 起常驻，展开即可见。
