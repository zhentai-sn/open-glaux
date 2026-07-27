# 参考 Agent 会话运行手册

> 适用范围：Glaux 第一阶段内置参考 Agent（Pi AgentHarness + 本地会话管理）。
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
| Vite | `http://localhost:5173` | Glaux UI；代理 `/api` 与 `/agent-api` |
| FastAPI | `http://127.0.0.1:8000` | 现有影像与领域任务 API |
| Agent Runtime | `http://127.0.0.1:8010` | Pi Session、Harness、REST/SSE |

Runtime 健康检查：

```bash
curl http://127.0.0.1:8010/agent-api/v1/health
```

正常响应包含 `status: "ok"`、`pi: "ok"` 与 `storage: "ok"`。只调试对话时可以仅启动
`make agent-runtime frontend`；影像工作区能力仍需要 FastAPI。

## 3. 本地数据与配置

默认数据目录为仓库根的 `.glaux/agent/`：

| 文件 | 所有者 | 内容 |
| --- | --- | --- |
| `pi-sessions.sqlite` | Pi | transcript、活动消息树、模型变化、compaction 与命令 receipt |
| `glaux-meta.sqlite` | Glaux | 标题、归档状态、权限模式与时间字段 |

可在启动 Runtime 前设置 `GLAUX_AGENT_DATA_DIR` 改用其他目录，设置
`GLAUX_AGENT_PORT` 改用其他端口。若更改端口，也要同步修改 `frontend/vite.config.ts` 的开发代理。

API Key 仍沿用前端连接配置，随单次命令临时传给 Runtime，不写入上述数据库。共享机器使用后应在
连接设置中清除 Key。

## 4. Provider 与模型

在右侧 Agent Dock 的“连接设置”中配置：

- Anthropic：填写模型和 API Key；Base URL 使用 Provider 默认值。
- OpenAI-compatible：填写 Base URL、模型和 API Key；Ollama 与 LM Studio 可使用快填。
- 自定义 OpenAI-compatible 模型还必须填写 Context Window 和 Max Output Tokens；
  `context_window >= 1024`，`max_tokens >= 1` 且 `max_tokens < context_window`。

第一阶段权限模式只持久化与展示，不执行领域工具。默认是“受控自治”。

## 5. 会话管理

- 新建、搜索、切换、重命名、归档、恢复和删除均在右侧栏内完成。
- 归档会话只读，恢复后可继续对话。
- 切换会话不会停止其他会话正在进行的生成；只有“停止”按钮会调用 Pi `abort()`。
- 删除会同时删除 Pi transcript 与 Glaux 元数据，确认后不可恢复。
- 重新生成只作用于活动路径上最近一条 assistant 回答；UI 不提供分支浏览或历史消息编辑。

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

Runtime 异常退出时，只恢复 Pi 已提交的 entry；未提交的流式 token 允许丢失，命令不会自动重放。

## 8. 验证

```bash
make test
cd agent-runtime && npm run build
cd frontend && npm run build
```

安全验证使用假凭据并扫描数据库、Pi custom entries、SSE/HTTP 快照和脱敏日志。不要在自动测试中使用
真实 API Key。
