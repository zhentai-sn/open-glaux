---
kind: record
status: active
---

# SDD 16 智能体基础工具与会话工作区 · 实施计划

依据：[SDD 16](../sdd/feats/16-agent-basic-tools/README.md) §7、§9、§15、D-1～D-10；相邻修订见 [SDD 14](../sdd/feats/14-project-text-preview/README.md) §7.4、[SDD 15](../sdd/feats/15-agent-plugins-permissions/README.md) §7.5。

## 现状要点

- **pi 内置工具**（`@earendil-works/pi-agent-core` 0.82.1）：`createReadTool` / `createWriteTool` / `createEditTool` / `createBashTool` 的 `execute` 第 5 个参数是 `{env: ExecutionEnv}`。Glaux 的 harness 不带 `toolContext`，需要适配器把 `env` 闭包进去。
  - `read`：按 UTF-8 解码，二进制不拒绝；图像按魔数识别后返回图像块；截断后提示 `offset` 续读。
  - `write`：自动创建父目录；经文件修改队列串行。
  - `bash`：无缺省超时；`inheritEnv: true` 继承 `NodeExecutionEnv` 的 `shellEnv`；超长输出写临时文件。
- **项目目录**：`permission/load.ts` 的 `projectDirOf` 已经经 backend `GET /projects` 取项目目录，可复用。
- **权限判定**：`permission/decide.ts` 的 `decide` 已有 `outsideCwd` 入参（只对 `write` 生效），`permission/plugin.ts` 用 `permissionSubject` 取规则 subject。
- **`read_file`**：`src/pi/tools/read-file.ts` 经 backend `/projects/{id}/text` 读取，`details` 为 `glaux.file_read`，前端 `FileCard` 渲染；`project-tools.test.ts` 覆盖其行为。
- **前端刷新入口**：`ProjectTree` 以 `key={reload}` 重新挂载目录；`DocumentView` 在 `document` 对象变化时重新请求正文。
- **会话删除**：`SessionService.deleteSession` 只删 Pi 会话与 companion 行；前端 `SessionDrawer` 用 `window.confirm`。
- **工作区**：`docs/sdd/feats/00-reference-agent-conversations/README.md` 与 `frontend/src/styles/global.css` 有与本计划无关的未提交改动，提交时只暂存本计划的变更块。

## 波次

| 波次 | 内容 | 依赖 | 波末状态 |
| --- | --- | --- | --- |
| W1 | runtime：执行环境、会话工作区、路径范围、敏感路径判定、`bash` 环境变量白名单 | — | 单元与集成测试通过；尚无新工具挂载 |
| W2 | runtime + 前端：`read` / `write` / `edit`；删除 `read_file`；写入通知与前端刷新；删除会话连带工作区 | W1 | 两端测试通过 |
| W3 | runtime：`bash` | W1 | runtime 测试通过 |
| W4 | 活文档、§15 自查、浏览器走查 | W1～W3 | SDD 16 转 `implemented` |

## W1 · 执行环境与路径范围

- 新建 `src/workspace/`：
  - `cwd.ts`：`workspaceDir(sessionId, env)`（`<GLAUX_HOME>/workspaces/<session_id>`）；`resolveCwd({projectId, projectDir, sessionId})`：绑定项目且有目录 → 项目目录；绑定项目无目录 → `undefined`；未归属 → 创建工作区并返回；创建失败返回 `undefined` 并记日志。`removeWorkspace(sessionId)`。
  - `path-scope.ts`：`pathScope(cwd, rawPath) → {absolute, subject, sensitive}`。外部判定取最深已存在祖先的 `realpath`；隐藏判定按相对段。
  - `shell-env.ts`：白名单构造 `shellEnv`，附 `GLAUX_CWD`。
- `permission/load.ts`：`defaultLoadSettings` 同时返回 `projectDir`，供 `cwd` 复用，不重复请求 backend。
- `permission/decide.ts`：`outsideCwd` 改为 `sensitive`；`read` / `write` 在敏感路径且非 `autonomous` 时为 ask；敏感路径跳过会话授权与不带 `pattern` 的 allow 规则；`Verdict` 增加 `sensitive`。
- `permission/plugin.ts`：工具有 `pathScope` 时用其 `subject` 与 `sensitive`；有 `patternMatch` 时规则用它匹配；敏感路径的 `grant_options` 只有 `once`；审计附 `sensitive`、`subject`。
- `plugins/types.ts`：`PluginTool` 增加 `pathScope?`、`patternMatch?`；`HarnessToolContext` 增加 `cwd?`、`execEnv?`。
- `pi/harness-registry.ts`：命令开始时确定 `cwd`，构造 `NodeExecutionEnv({cwd, shellEnv})`，放进工具上下文与权限状态（`permission.cwd`）。
- `pi/session-service.ts`：删除会话后调用 `removeWorkspace`，失败只记日志。
- 测试：
  - `tests/unit/path-scope.test.ts`：相对、绝对、`..`、隐藏段、指向外部的符号链接、不存在的深层路径。
  - `tests/unit/shell-env.test.ts`：白名单外变量不出现；`GLAUX_CWD`。
  - `tests/unit/permission-decide.test.ts`：敏感路径表（SDD 16 §7.2 规则 4）；会话授权与无 `pattern` allow 规则不覆盖敏感路径；带 `pattern` 的 allow 规则覆盖。
  - `tests/integration/workspace.test.ts`：未归属会话命令开始后工作区存在；删除会话后不存在；归档保留。
- 门禁：`agent-runtime` 下 `npm test`、`npm run lint`。

## W2 · 读写工具与前端刷新

- 新建 `src/plugins/files.ts`（`files` 插件，`applies: ctx => !!ctx.cwd && !!ctx.execEnv`）：
  - 适配器 `bindEnv(tool, env)`：把 pi 工具转成无上下文的 `HarnessTool`。
  - `read`（effect `read`，`pathScope`）：前 8 KiB 含 NUL 且非支持的图像 → `binary file` 错误；无视觉连接的图像 → 文字说明；项目内文本附 `glaux.file_read`（由 `offset`、`limit` 与截断信息算 `start_line` / `end_line` / `eof` / `total_lines`）。
  - `write` / `edit`（effect `write`，`pathScope`）：成功后附 `glaux.file_changed`。
  - 提示词片段：说明 `cwd`（项目根或会话工作区）、路径写法与敏感路径会审批。
- `plugins/project.ts`：删除 `read_file`；`src/pi/tools/read-file.ts` 删除，`FILE_READ_DETAILS_KIND` 等常量移到 `files.ts`；`session-service.ts` 的 `VIEWABLE_DETAILS_KINDS` 改为引用新位置。
- 前端：
  - `store/projects.ts`：`fileChanges: Record<projectId, number>` 与 `bumpFileChange(projectId)`。
  - `store/agentSessions.ts`：`tool.end` 且 `details.kind === "glaux.file_changed"` → `bumpFileChange`；当前预览路径相同 → `setDocument({...doc})`。
  - `components/ProjectTree.tsx`：`key` 合并 `reload` 与 `fileChanges[projectId]`。
  - `components/agent/SessionDrawer.tsx`：未归属会话删除确认用新文案。
- 测试：
  - runtime：`tests/integration/files-tools.test.ts`（真实临时目录）：读文本附卡片 `details`、二进制错误、无视觉图像说明、`write` 新建与 `details`、`edit` 替换、`controlled` 下写 `.env` 出审批卡片且只有 `once`、`autonomous` 不审批、`suggest` 下写入审批。
  - runtime：`project-tools.test.ts` 中 `read_file` 用例迁移或删除；`plugins-registry`、系统提示词快照按新工具集更新。
  - 前端：`agentSessions.test.ts` 增加文件变化用例；`SessionDrawer.test.tsx` 增加确认文案用例。
- 门禁：两端 `npm test`、`npm run lint`，前端 `npm run build`。

## W3 · `bash`

- `files.ts` 增加 `bash`（effect `exec`，`patternMatch` 前缀匹配，subject 为命令）：参数缺省超时 120 秒，大于 600 秒截到 600 并在结果首行注明。
- 提示词片段：`bash` 数值为非标定结果。
- 测试：`tests/integration/bash-tool.test.ts`：只在 `autonomous` 挂载；`env` 不含白名单外变量、`GLAUX_CWD` 正确；超时上限；前缀规则匹配。
- 门禁：`agent-runtime` 下 `npm test`、`npm run lint`。

## W4 · 活文档与验收

- 仓库骨架总览：工具表增加四个工具、删除 `read_file`；`REGISTRY` 不变量改为「标定能力的唯一来源」；源码分区增加 `workspace/`。
- SDD 14 §7.4：智能体读取改为引用 SDD 16 的 `read`。
- 操作手册：会话工作区位置与删除行为；`bash` 只在完全自治下可用。
- 两份 CHANGELOG（`Unreleased`）。
- §15 逐条自查；浏览器走查：项目会话中 `write` 新建文件后文件树出现、`edit` 后预览刷新、写 `.env` 出审批卡片。
- SDD 16 转 `implemented`，更新索引；本计划改为 `done`。

## 风险

| 风险 | 应对 |
| --- | --- |
| `bash` 以用户身份执行任意命令 | 只在 `autonomous` 挂载，切换需确认；环境变量白名单；deny 规则生效 |
| 符号链接绕过工作目录判定 | 对最深已存在祖先取 `realpath` 后判定；单测覆盖 |
| 删除会话误删用户文件 | 只删 `<GLAUX_HOME>/workspaces/<session_id>`，路径由 runtime 生成，不接受外部输入；绑定项目的会话不删任何目录 |
| 原生 `read` 不识别编码，GBK 文本乱码 | 已拍板（D-4）；操作手册注明 |

## 实施偏差

- W1：`workspacesRoot` 放在 `PermissionDeps` 与 `SessionServiceOptions` 中注入；测试夹具指向数据目录，避免测试在用户主目录建工作区。
- W1：`NodeExecutionEnv` 在 `inheritEnv` 为真时会先合并整个 `process.env`，`bash` 内置工具缺省 `inheritEnv: true`；只设 `shellEnv` 挡不住凭据。W3 须在 `bash` 的 `prepare` 钩子里设 `inheritEnv = false` 并显式传入白名单环境。
- W1：命令启动多了几次异步等待后，`multi-session-stream` 测试约三分之一概率失败，根因是 Pi 会话存储的并发写缺陷（pi 的 SQLite 适配器以同步驱动执行异步事务，跨连接争锁时同步忙等堵住事件循环）。新增 `storage/serialized-sqlite.ts` 串行化写入，并加 `concurrent-session-writes` 回归测试（在修复前的提交上复现失败）。SDD 15 W4 的审计入队仍保留。
- W1：`credential-scan` 测试改为递归扫描数据目录，覆盖会话工作区。
- W2：发现 SDD 14 实现遗漏——`glaux.file_read` 未进入快照保留白名单，卡片在快照刷新后消失；本波加入 `VIEWABLE_DETAILS_KINDS`。
- W2：`read` 的无视觉图像与二进制用例合并在 `files-tools.test.ts`；`project-tools.test.ts` 删除 `read_file` 三组用例，`list_files` 说明改为提示 `read`。
- W2：运行手册第 113 行仍写「工具经 `TOOL_PROVIDERS` 装配」（SDD 15 W1 漏改），本波改为插件登记表。
