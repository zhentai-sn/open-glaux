---
kind: record
status: active
---

# SDD 17 智能体 Skills 与提示词管理 · 实施计划

依据：[SDD 17](../sdd/feats/17-agent-skills-prompts/README.md) §7、§9、§15、D-1～D-8。

## 现状要点

- **pi 资源**：`AgentHarness` 构造参数 `resources: {skills, promptTemplates}`；`harness.skill(name, extra)` 把 `<skill name location>全文</skill>` 作为用户消息发出；`harness.promptFromTemplate(name, args)` 按 `substituteArgs` 展开。`loadSourcedSkills` / `loadSourcedPromptTemplates` 需要 `ExecutionEnv`；`formatSkillsForSystemPrompt` 已排除 `disableModelInvocation`。`loadSkills` 会把根目录下直接的 `.md` 也当 Skill，内置目录不能放 README。
- **系统提示词**：`systemPromptFor(viewer, tools, context, video)` 拼「基础段 + 插件片段」后接查看器上下文；`system-prompt.test.ts` 有迁移前快照。
- **项目目录**：`permission/load.ts` 的 `defaultLoadSettings` 已返回 `projectDir`；`projectDirOf` 未导出。
- **路径范围**：`files.ts` 的 `read` 用 `pathScope(args, cwd)`；权限插件按 `sensitive` 判定。
- **命令**：`routes.ts` 的 `parseCommand` 解析 `prompt`；`command-service.ts` 调 `harness.prompt`；`commandDigest` 计算摘要。
- **前端侧栏**：Focus 由 `store/session.ts` 的 `FocusSideView`（`stage` / `atlas` / `settings`）与 `SessionRail` 的 `WORKSPACE_ENTRIES` 驱动，`FocusSidePanel` 按 `sideView` 渲染；Workbench 由 `View`（`explorer` / `market` / `atlas`）、`ActivityBar`、`SideBar` 驱动。
- **工作区**：SDD 00 README 与 `frontend/src/styles/global.css` 有与本计划无关的未提交改动，提交时只暂存本计划的变更块。

## 波次

| 波次 | 内容 | 依赖 | 波末状态 |
| --- | --- | --- | --- |
| W1 | runtime：资源路径、加载与合并；系统提示词说明段与目录段；Skills 根目录只读放行；`skill` / `template` 命令 | — | runtime 测试通过 |
| W2 | runtime：管理接口与系统提示词预览 | W1 | 契约测试通过 |
| W3 | 前端：客户端、「技能」「提示词」页、侧栏入口 | W2 | 前端测试、lint、build 通过 |
| W4 | 前端：输入框 `/` 菜单与 Skill 消息紧凑显示 | W2 | 同上 |
| W5 | 活文档、§15 自查 | W1～W4 | SDD 17 转 `implemented` |

## W1 · 资源装配

- `src/resources/paths.ts`：内置根（相对 `agent-runtime` 包根）、用户级与项目级的 Skills、模板、说明路径；名称校验。
- `src/resources/load.ts`：`loadResources({projectDir, env})` → `{skills: SkillItem[], harnessSkills, templates, harnessTemplates, instructions: {user?, project?}, diagnostics}`；同名覆盖、停用过滤、32 KiB 截断。
- `src/permission/settings.ts`：解析 `skills.disabled`（字符串数组，非法时整份文件按 SDD 15 规则忽略）。
- `pi/harness-registry.ts`：`preparePermission` 后加载资源；`AgentHarness` 传 `resources`；`systemPromptFor` 增加说明段与目录段参数；权限状态增加 `readableRoots`。
- `plugins/files.ts` / `permission/plugin.ts`：`read` 的路径在 `readableRoots` 之下时 `sensitive = false`。
- `contracts.ts`、`routes.ts`、`command-service.ts`：`skill` / `template` 字段的解析、互斥与图像校验、`422 unknown_resource`；摘要纳入两字段；标题取 `/名称 附加内容`。
- 测试：`resources-load` 单测（覆盖、停用、截断、告警）；系统提示词快照（无资源时不变，另加有资源的快照）；`skills-flow` 集成（目录可见、`read` 不审批、`write` 审批、`skill` / `template` 命令、`unknown_resource`、图像拒绝）。

## W2 · 管理接口

- `src/resources/store.ts`：读写删 Skill、模板、说明；写入先临时文件再 rename；Skill 写后用 pi 加载器校验；启停写用户级设置。
- `src/transport/resource-routes.ts`：§9.2 全部接口；`project_id` 经 backend 取项目目录（导出 `projectDirOf` 并可注入）。
- 预览：`HarnessRegistry.previewSystemPrompt(sessionId, connection, viewer)` 复用 `start()` 的装配逻辑但不建 harness。
- 测试：`resources-api` 契约测试（读写删、启停、错误码、写内置拒绝、预览与真实命令一致）。

## W3 · 管理页面

- 客户端与类型：资源接口。
- `components/resources/SkillsView.tsx`、`PromptsView.tsx`，样式加在 `global.css` 末尾。
- `FocusSideView` 增加 `skills`、`prompts`；`SessionRail` 增加两个入口；`FocusSidePanel` 渲染；`View` 增加两项，`ActivityBar`、`SideBar` 渲染。
- i18n 中英文。
- 测试：两页的组件测试；竖条与活动栏入口测试。

## W4 · 输入框与消息显示

- `ConversationComposer`：`/` 菜单（数据取自 `GET /resources`）；发送时识别 `/名称`。
- `useConversation` / `agentSessions.sendPrompt`：传 `skill` / `template`。
- `AgentConversation`：用户消息以 `<skill name="` 开头时显示「技能：名称」与附加说明。
- 测试：菜单过滤、补全、发送；紧凑显示。

## W5 · 活文档与验收

- 仓库骨架总览、操作手册（资源位置与管理页）、SDD 00（命令字段）、SDD 15（设置文件字段、系统提示词组成）、SDD 16（只读放行）、两份 CHANGELOG。
- §15 自查；SDD 17 转 `implemented`；本计划改为 `done`。

## 风险

| 风险 | 应对 |
| --- | --- |
| 资源加载拖慢命令启动 | 只读三四个目录；目录不存在直接跳过 |
| 管理接口写用户主目录与项目目录 | 只在回环地址；路径只由来源与校验过的名称拼出 |
| 系统提示词随说明变长 | 单份说明 32 KiB 上限；预览可见 |

## 实施偏差

- W1：资源加载放在 `preparePermission` 内，与设置文件、项目目录一次取得；加载函数作为 `PermissionDeps.loadResources` 可注入，测试夹具指向数据目录。
- W1：`SettingsFile.skillsDisabled` 设为可选字段，避免改动既有测试中手写的设置对象。
- W1：显式调用的资源检查放在 `HarnessRegistry.start`（资源加载之后、建 harness 之前），未命中时同步抛 `422 unknown_resource`，命令不进入运行。
- W1：SDD 00、SDD 15、SDD 16 的文档修订按计划放在 W5 一并完成。
