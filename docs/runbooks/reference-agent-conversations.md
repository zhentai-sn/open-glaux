---
kind: living
status: living
---

# 参考 Agent 会话运行手册

> 适用范围：Glaux 内置参考 Agent（Pi AgentHarness + 本地会话管理），完整版与对话预览版通用；发行包的安装与分发见 [chat-distribution.md](chat-distribution.md)。
> Runtime 只监听 `127.0.0.1`，浏览器通过 Vite 的同源 `/agent-api/v1` 代理访问。

## 1. 环境与安装

- Node.js `>= 22.19.0`
- Python `3.12` 与 `uv`
- 三个独立依赖目录：`backend/`、`frontend/`、`agent-runtime/`

首次安装：

```bash
make install
```

CI 或需要严格复现锁文件时，分别在 `frontend/` 与 `agent-runtime/` 使用 `npm ci`。
Runtime 的 Pi 依赖由 `agent-runtime/package-lock.json` 精确锁定；不要单独升级其中一个 Pi 包。

## 2. 启动与健康检查

在仓库根目录并行启动三个进程：

```bash
make -j3 dev
```

| 进程 | 默认地址 | 用途 |
| --- | --- | --- |
| Vite | `http://127.0.0.1:5173` | Glaux UI；代理 `/api` 与 `/agent-api` |
| FastAPI | `http://127.0.0.1:8000` | 现有影像与领域任务 API |
| Agent Runtime | `http://127.0.0.1:8010` | Pi Session、Harness、REST/SSE |

- dev 期访问 `localhost:5173` 的页面导航会被 307 到 `127.0.0.1:5173`（`vite.config.ts` 的 `glaux-loopback-ipv4`）。
  原因：Windows 先把 localhost 解析为 `::1`，WSL mirrored 网络不转发 `::1`，每次建连多等约 200 ms，WSI 瓦片加载明显变慢。
- 浏览器本地存储按源隔离：首次改用 `127.0.0.1` 时，模型连接配置、「最近使用」等本地设置需重新填写。

Runtime 健康检查：

```bash
curl http://127.0.0.1:8010/agent-api/v1/health
```

正常响应包含 `status: "ok"`、`pi: "ok"` 与 `storage: "ok"`。只调试对话时可以仅启动
`make agent-runtime frontend`；影像工作区能力仍需要 FastAPI。

也可以用 [`scripts/dev/`](../../scripts/dev/) 下的脚本单独起进程：`run-backend.sh`、`run-agent-runtime.sh`，
`health.sh` 一次探活三个端口。

## 3. 本地数据与配置

默认数据目录为仓库根的 `.glaux/agent/`：

| 文件 | 所有者 | 内容 |
| --- | --- | --- |
| `pi-sessions.sqlite` | Pi | transcript、活动消息树、模型变化、compaction 与命令 receipt |
| `glaux-meta.sqlite` | Glaux | 标题、归档状态、权限模式与时间字段 |

会话所属项目存在 Pi 会话 `metadata.glaux_project_id`（位于 `pi-sessions.sqlite`），创建时写入、不可改；`glaux-meta.sqlite` 不存项目。项目登记本身由 backend 存在 `sources.json` 的 `projects` 键（见 [datasource-registry.md](datasource-registry.md)）。

可在启动 Runtime 前设置 `GLAUX_AGENT_DATA_DIR` 改用其他目录，设置
`GLAUX_AGENT_PORT` 改用其他端口；启动前端开发服务器时设置同一变量，Vite 的 `/agent-api` 代理随之指向该端口。

API Key 仍沿用前端连接配置，随单次命令临时传给 Runtime，不写入上述数据库。共享机器使用后应在
连接设置中清除 Key。

### 3.1 权限规则与运行预算

权限规则与预算写在设置文件中，每个命令开始时读取（[SDD 15](../sdd/feats/15-agent-plugins-permissions/README.md) §9.2）：

| 级别 | 位置 | 生效范围 |
| --- | --- | --- |
| 用户级 | `~/.glaux/settings.json`；设置 `GLAUX_HOME` 可改目录 | 所有会话 |
| 项目级 | `<项目目录>/.glaux/settings.json` | 绑定该项目的会话 |

```json
{
  "permissions": {
    "rules": [
      { "tool": "segment_region", "decision": "deny" },
      { "tool": "run_task", "decision": "allow" }
    ]
  },
  "budget": { "max_turns": 50, "max_minutes": 20 }
}
```

- `decision` 取 `allow`、`deny`、`ask`；`deny` 在任何权限模式下都生效。
- 审批卡片选「总是允许」时，Runtime 向项目级（会话绑定项目时）或用户级文件追加一条 `allow` 规则。
- 文件格式错误时整份忽略，对话区顶部显示告警，其余来源照常生效。
- 预算取值优先级：项目级 > 用户级 > 环境变量 `GLAUX_AGENT_MAX_TURNS` / `GLAUX_AGENT_MAX_MINUTES` > 默认 50 回合 / 20 分钟。等待用户回复的时间不计入时长。

### 3.2 工作目录与会话工作区

- 绑定项目的会话以项目目录为工作目录，智能体的 `read` / `write` / `edit` 相对它解析路径。
- 未归属会话的工作目录是 `~/.glaux/workspaces/<session_id>/`（随 `GLAUX_HOME` 变化），首个命令时创建；删除会话时一并删除，归档保留。
- 工作目录之外与隐藏路径（`.env`、`.git/…`）的读写需要审批，「完全自治」除外（[SDD 16](../sdd/feats/16-agent-basic-tools/README.md) §7.2）。
- `read` / `edit` 只按 UTF-8 处理，GBK 等编码的文本会乱码。
- 「完全自治」下另挂 `bash`：命令在工作目录内以运行 Runtime 的用户身份执行，环境变量只有 `PATH`、`HOME`、`LANG` 等白名单与 `GLAUX_CWD`，拿不到模型凭据与 `GLAUX_SEG_API_TOKEN`；缺省超时 120 秒，最长 600 秒。用 deny 规则可禁止特定命令前缀，例如 `{ "tool": "bash", "pattern": "rm ", "decision": "deny" }`。

### 3.3 Skills、模板与自定义说明

| 资源 | 个人（所有会话） | 本项目（绑定该项目的会话） |
| --- | --- | --- |
| Skills | `~/.glaux/skills/<name>/SKILL.md` | `<项目>/.glaux/skills/<name>/SKILL.md` |
| 提示词模板 | `~/.glaux/prompts/<name>.md` | `<项目>/.glaux/prompts/<name>.md` |
| 自定义说明 | `~/.glaux/GLAUX.md` | `<项目>/GLAUX.md` |
| 子智能体定义 | `~/.glaux/agents/<name>.md` | `<项目>/.glaux/agents/<name>.md` |

- 在左侧竖条（或 Workbench 活动栏）的「上下文」页管理，分区为系统提示词、提示词模板、工具、子智能体、技能；修改在下一条消息生效。
- 同名 Skill 按 本项目 > 个人 > 内置 取一份；停用的 Skill 记在 `~/.glaux/settings.json` 的 `skills.disabled`。
- 系统提示词只列 Skills 的名称与描述，智能体需要时用 `read` 读全文，不需要审批。
- 内置 `skill-creator`：让智能体把一段工作流程、测量口径或报告格式做成 Skill（例如「把刚才的测量流程做成技能」）。它先确认需求与存放层级，再写入个人或项目目录，写入时需要审批（「完全自治」除外）；新 Skill 从下一条消息起生效。不需要时可在「上下文 › 技能」停用。
- 输入框输入 `/` 可直接调用 Skill 或模板；「上下文 › 系统提示词」显示当前会话实际收到的系统提示词，按来源分段并估算 token；「上下文 › 工具」列出全部工具与当前会话的挂载状态。
- 子智能体定义的 frontmatter 只识别 `name`（与文件名一致）、`description`、`tools`（缺省为全部工具）、`max_turns`（1～50，缺省 20），正文是子智能体的工作说明；内置 `general`，同名按 本项目 > 个人 > 内置 取一份。
- 智能体用 `agent` 工具派发子任务：`observe` 不挂载，`suggest` 逐次审批；子智能体看不到当前对话，只交回最终回复；运行中工具行显示它的回合数与正在调用的工具；它触发的审批卡片标出来源；同一命令内最多 3 个并行。「上下文 › 子智能体」只读列出定义。

## 4. Provider 与模型

在右侧 Agent Dock 的“连接设置”中配置：

- Anthropic：填写模型和 API Key；Base URL 使用 Provider 默认值。
- OpenAI-compatible：填写 Base URL、模型和 API Key；Ollama 与 LM Studio 可使用快填。
- 自定义 OpenAI-compatible 模型的 Context Window 与 Max Output Tokens 在拉取模型时自动带入，上游未自报时落默认 `200000 / 32768`，仍可手改；校验规则不变：`context_window >= 1024`，`max_tokens >= 1` 且 `max_tokens < context_window`（详见 [agent-connection.md](agent-connection.md)）。

权限模式决定领域工具的可用性，缺省 `controlled`：

- `observe`：不挂任何工具，只能文字描述。
- `suggest` / `controlled` / `autonomous`：挂领域工具；逐次批准门控（`beforeToolCall`）尚未落地，`propose_annotation` 的产出恒为建议态，须人工确认。
- 对话预览版（chat）不挂领域工具，与 `observe` 同效。

完整版当前可挂的工具：`run_task`、`view_current_image`、`consult_atlas`、`locate_roi`（后三者要求连接声明视觉；其中看图和定位还需当前焦点）、`segment_region`（需焦点、`GLAUX_ANNOT_ALLOW_EGRESS` 放行且已配 `GLAUX_SEG_API_TOKEN`）、`propose_annotation` 与 `revise_annotation`（需焦点）；绑定项目的会话另挂 `list_files`（列项目内一层，最多 200 条）、`open_file`（打开项目内文件并看首帧，需视觉，不改用户舞台）。每个会话还有一个工作目录（绑定项目时为项目目录，否则为会话工作区，见 §3.2），可挂 `read`、`write`、`edit`（`observe` 只挂 `read`）。绑定项目的会话中，作用于当前对象的工具只接受本项目的对象，未归属会话只接受 `project_id` 为空的数据源对象，越界时模型收到工具错误。工具经插件登记表装配（`agent-runtime/src/plugins/`）；取图统一走 `/objects/{id}/frame` 并读取 `X-Glaux-Frame`，注册条件见 `agent-runtime/src/pi/harness-registry.ts`。

智能体看图可以像人一样放大复核（SDD 22）：`view_current_image` 传对象像素区域即放大，再次调用可平移或缩回；返回的图默认画出已有标注（建议态虚线，旁注 A1、A2…）。智能体提出框后会放大到框附近对照，偏差时用 `revise_annotation` 修正自己那条建议；人画的、已确认或已驳回的标注它改不了。看图需要连接真正支持图像输入，否则图会被丢弃。

## 5. 会话管理

### 5.1 基本操作

- 新建、搜索、切换、重命名、归档、恢复和删除均在会话栏内完成（Focus 左侧会话栏；Workbench 在智能体面板内）。
- 归档会话默认隐藏；会话栏底部「显示归档」打开后在各自组内显示。归档会话只读，恢复后可继续对话。
- 切换会话不会停止其他会话正在进行的生成；只有“停止”按钮会调用 Pi `abort()`。
- 删除会同时删除 Pi transcript 与 Glaux 元数据，确认后不可恢复。
- 重新生成只作用于活动路径上最近一条 assistant 回答；UI 不提供分支浏览或历史消息编辑。

### 5.2 打开项目文件夹

项目是 backend 所在文件系统上的一个目录。Glaux 对项目目录只读，打开时不扫描，文件被点击或被智能体打开时才识别。

1. 点会话栏顶部的文件夹按钮「打开文件夹」，或点输入区上方的项目胶囊 →「打开文件夹…」（仅空会话可用）。
2. 在目录选择器中从快捷根（主目录、`GLAUX_DATASETS_ROOT`、WSL 下的 `C:`、`D:` 等盘符）逐级进入，或在路径框粘贴绝对路径。
3. 点「打开」：backend 登记项目（同一目录重复打开得到同一项目），并在该项目下新建或复用一个空会话。
4. 文件栏切换为项目目录树：可识别文件带模态图标，不可识别文件置灰；根下虚拟节点「上传」列出在本项目会话中上传的文件（文件落在 `GLAUX_DATASETS_ROOT/uploads/`，不写入项目目录）。

路径框接受三种写法，backend 统一转换为自身文件系统的 POSIX 路径，同一目录的不同写法得到同一项目：

| 写法 | 示例 | 转换结果（backend 在 WSL 中运行） |
| --- | --- | --- |
| POSIX | `/home/me/cases/liver`、`~/cases` | 原样 |
| Windows 盘符 | `C:\cases\liver` | `/mnt/c/cases/liver` |
| WSL 网络共享 | `\\wsl.localhost\Ubuntu\home\me\cases`、`\\wsl$\Ubuntu\…` | `/home/me/cases`；发行版与 backend 所在发行版不一致时返回 422 |

- backend 不在 WSL 中运行时，后两种写法返回 422。
- `/mnt/<盘符>/` 下的项目在界面上显示为 `<盘符>:\…`。

项目中可打开的模态：

- 通用图像（`natural_image`）、视频（`video`）。
- CT（`ct_abdomen`）：`.nii`、`.nii.gz`（NIfTI-1 单文件）。
- WSI（`pathology`）：单文件 TIFF 族 `.svs`、`.tif`、`.tiff`、`.ndpi`、`.scn`、`.bif`，以 OpenSlide 能识别为准；多文件切片格式不接受。

CT、WSI 在界面中只经打开项目接入；导入面板只有浏览器上传与加载示例数据，医学卷不走浏览器上传。缺 mpp 的切片可以浏览，依赖标定的任务报 422。识别规则与对象 id 见 [datasource-registry.md](datasource-registry.md)「CT、WSI 的识别与对象 id」。

### 5.3 按项目组织会话

- 会话栏按项目分组，组内按更新时间倒序；升级前的会话与未绑定项目的会话在「未归属」组，组内可新建会话。
- 会话在创建时绑定项目，之后不可改。组头「＋」在该项目下新建会话；每个项目最多一个空会话，连点只得到同一个。
- 对话区顶部「新建会话」与 Focus 竖条的「＋」在当前会话所属项目下新建；竖条「＋」悬停显示目标项目名。
- 项目胶囊显示当前会话的项目。空会话点胶囊可切到另一项目的空会话，输入草稿、附件与视频随之带过去；会话发出消息后胶囊只读。
- 会话行状态点：运行中（强调色呼吸点）、已完成未读（强调色实心点，选中后消失，刷新后清空）、出错（`--crit` 色）。
- 每个会话各有自己的查看对象、任务结果与输入草稿；后台会话的工具结果不改前台舞台。刷新后每个会话的查看对象与模态从 localStorage `glaux.sessionWorkspace.v1` 恢复。
- 项目会话中，智能体可用 `list_files`、`open_file`、`read` 自行查看项目内文件，用 `write`、`edit` 修改；`open_file` 在对话内显示对象卡片，`read` 显示文件卡片，点「在舞台打开」后才切换舞台。

### 5.4 移除与恢复项目

- 组头「移除项目」：只注销项目及其数据源，不删除磁盘文件、不删除会话。项目下有运行中会话时拒绝移除。
- 移除后，该项目的会话进入「<项目名>（已移除）」只读组：可查看、可删除，不可发送。组头「重新打开」按原路径登记，会话回到原项目组。
- 项目目录被删除或不可读时，组头显示警示图标（悬停提示「项目目录不可用」），会话只读；项目状态在页面加载与打开、移除项目时刷新，目录恢复后刷新页面即恢复。
- 同一目录在项目中打开与经 `POST /datasources` 导入是两个数据源，对象 id 不同，标注不跨源跟随。

## 6. 备份与恢复

一致性备份需要同时保存两个 SQLite 文件：

1. 正常停止 Agent Runtime。
2. 复制整个 `.glaux/agent/` 目录到受控备份位置。
3. 恢复时确认 Runtime 仍使用 lockfile 中相同的 Pi 版本，再用备份目录替换目标数据目录。
4. 启动 Runtime 并调用健康检查；打开会话确认标题、权限、活动消息路径和归档状态。

不要只恢复其中一个数据库，也不要直接编辑或查询 Pi SQLite 的内部表。锁定版本恢复使用
`cd agent-runtime && npm ci`，随后运行 `npm test` 验证 migration/reopen 兼容性。

## 7. 常见故障

| 现象 / 错误码 | 处理 |
| --- | --- |
| `runtime_unavailable` | 确认 Runtime 在 `8010` 监听并检查健康接口；端口改动需同步 Vite 代理 |
| `provider_auth_failed` | 重新检查 API Key、Base URL 与 Provider；共享机器用完清除 Key |
| `model_not_found` | 拉取模型列表或填写服务实际暴露的模型 ID |
| `model_metadata_required` | 为自定义模型补齐 Context Window 与 Max Output Tokens |
| `session_busy` | 等待当前生成完成或点击停止；不要在生成中归档、删除或切模型 |
| `command_outcome_unknown` | Runtime 曾在命令 accepted 后异常退出；刷新会话，检查最后已提交消息后再决定重新发送 |
| `context_overflow` | 检查模型 context metadata；Pi 会先按锁定版本默认策略尝试 compaction |
| `storage_error` | 停止 Runtime，检查数据目录权限、剩余空间及两个 SQLite 文件是否成对存在 |
| 目录选择器或打开项目报 403「该端点只接受本机回环地址…」 | 见 §7.1 |
| 智能体 `list_files` / `open_file` 报 403 | Runtime 的 `GLAUX_BACKEND_URL` 指向了非回环地址；改为 `http://127.0.0.1:8000` 或 `http://localhost:8000` |
| 智能体工具报 `outside_project` | 路径含 `..`、是绝对路径或经符号链接指向项目外；或当前对象不属于本会话项目。改用项目内相对路径，或在本项目中打开对象 |
| 打开文件报 `unsupported_format` / `corrupt` | 前者为后缀不属于任何可识别模态；后者为文件内容与后缀不符或无法解码（含 OpenSlide 不认识的 TIFF） |

### 7.1 局域网访问时 `/fs` 与 `/projects` 返回 403

`/fs/*` 与 `/projects*` 能浏览和登记本机任意目录，不受 `GLAUX_DATASETS_ROOT` 白名单约束，因此 backend 只接受回环地址（`127.0.0.1`、`::1`）来源的请求。

- 以 `vite --host` 对局域网开放后，从其他设备打开 UI：Vite 代理开启了 `xfwd`，backend 按 `X-Forwarded-For` 与 `Forwarded` 头逐跳校验，局域网来源一律 403。
- 表现：目录选择器报错、无法打开项目；项目列表为空，项目会话显示在「（已移除）」只读组，不可发送。
- 处理：在 backend 所在机器上用 `http://127.0.0.1:5173` 打开 UI。局域网设备只能使用「未归属」会话。
- 其他 backend 端点不受此守卫影响。

Runtime 异常退出时，只恢复 Pi 已提交的 entry；未提交的流式 token 允许丢失，命令不会自动重放。

## 8. 验证

```bash
make test
cd agent-runtime && npm run build
cd frontend && npm run build
```

安全验证使用假凭据并扫描数据库、Pi custom entries、SSE/HTTP 快照和脱敏日志。不要在自动测试中使用
真实 API Key。
