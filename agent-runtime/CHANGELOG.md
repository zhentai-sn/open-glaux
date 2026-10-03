# Agent Runtime Changelog

本文件只记录 Agent Runtime 独立发布；Glaux 整体发布见根目录 `CHANGELOG.md`。

## [Unreleased]

### Added

- 工具按插件登记，每个工具声明副作用等级 `effect`；插件钩子经组合器每种只注册一个 handler（SDD 15）。
- 交互请求表与回复端点 `POST /agent-api/v1/sessions/{id}/interactions/{request_id}`；新工具 `ask_user`；SSE 新增 `interaction.request`、`interaction.resolved`，快照 `pending_interactions` 给出待决请求（SDD 15 §7.6、§7.7）。
- 权限引擎：工具按 effect 与权限模式挂载、放行或审批；支持用户级与项目级 `settings.json` 的 allow / deny / ask 规则、「本会话允许」「总是允许」与审计记录；快照 `warnings` 给出设置文件告警（SDD 15 §7.4、§7.5）。
- 基础文件工具 `read`、`write`、`edit`（pi 内置实现）：绑定项目的会话以项目目录为工作目录，未归属会话有自己的工作区（删除会话时一并删除）；工作目录外与隐藏路径的读写需审批；写入结果带 `glaux.file_changed`（SDD 16）。
- Skills 与提示词资源（SDD 17）：每个命令加载内置、用户级（`~/.glaux/skills/`）、项目级（`<项目>/.glaux/skills/`）三层 Skills，同名取高优先级；用户级与项目级 `GLAUX.md` 与 Skills 目录写入系统提示词；模型 `read` Skills 目录下的文件不审批；`prompt` 命令新增 `skill` / `template` 字段用于显式调用。
- 资源管理接口：Skills、模板、说明的读写删与 Skills 启停（写用户级 `skills.disabled`），以及当前会话的系统提示词预览（SDD 17 §9.2）。
- `bash` 工具：只在「完全自治」下挂载，环境变量白名单（关闭对 `process.env` 的继承），缺省超时 120 秒、上限 600 秒，规则按命令前缀匹配（SDD 16 §7.5）。
- 运行预算：每个命令默认 50 回合、20 分钟（设置文件或 `GLAUX_AGENT_MAX_TURNS` / `GLAUX_AGENT_MAX_MINUTES` 可改），用尽后拦截工具调用要求模型收尾，宽限用尽中止并记结局 `budget_exceeded`；每次模型请求只保留最近 4 个工具结果中的图像（SDD 15 §7.8、§7.9）。
- 内置 Skill `skill-creator`：引导智能体按需求起草、保存、测试与改进 Skill；系统提示词的 Skills 目录段末尾列出各层 Skills 目录（SDD 17 D-6）。
- 子智能体（SDD 18）：`agent` 工具（effect `delegate`）把子任务交给子智能体，只交回最终回复；定义文件 `<name>.md` 分内置（`agents/general.md`）、用户级（`~/.glaux/agents/`）、项目级（`<项目>/.glaux/agents/`）三层；子智能体在内存会话中运行，共用主会话的权限状态，独立计回合（定义的 `max_turns`，缺省 20），同一命令内并发不超过 3 个；结果 `details` 为 `glaux.subagent_run` 并进入快照；交互请求新增 `origin` 与 `tool_call_id`（主对话中关联的工具调用）；资源清单新增 `agents`；SSE 新增 `subagent.progress` 推送子智能体回合数与当前工具。

### Changed

- `read_file` 删除，由 `read` 取代；读取卡片 `glaux.file_read` 不变，并按 SDD 14 §12 进入会话快照（此前遗漏）。
- SSE 不再发送 `pi.event`，改为 Glaux 事件：`message.delta`、`message.end`、`tool.start`、`tool.end`、`context.compacted`、`run.settled`；快照消息改为 `TranscriptMessage`，并新增 `pending_interactions`、`warnings` 字段（SDD 15 §9.5～§9.7）。
- `observe` 模式由「只挂视频工具」放宽为「只挂只读工具」；`suggest` 模式下 `run_task`、`locate_roi`、`segment_region` 需逐次审批（SDD 15 D-10、§7.4）。
- 项目越界守卫由工具包装改为权限插件的 `tool_call` 判定，越界调用以拦截理由返回模型。

### Fixed

- 首条命令被中止或失败时会话停留在「New conversation」：标题改为在调用模型前写入。
- 多个会话并发写入 Pi 会话存储时报「Failed to append SQLite session entry」：pi 的 SQLite 适配器以同步驱动执行异步事务，跨连接争锁时同步忙等堵住事件循环。会话存储改用串行化写入的 SQLite 工厂（`storage/serialized-sqlite.ts`）。
- 事件脱敏改为逐字符串执行；原实现对整段 JSON 替换，含 `Bearer` 文本的事件会产出非法 JSON 并使运行失败。

## [0.2.0] - 2026-08-31

### Added

- 智能体可读取查看器当前打开的图像（`view_image` 工具与查看器上下文）。

### Changed

- 建议态标注的工具结果实时写回查看器，并随会话快照持久化。
- 结果写回不再抢占 Focus 右侧栏的标签：舞台自 SDD 01 v1.4 起常驻，展开即可见。
