---
kind: record
status: implemented
---

# Glaux 多组件版本与发布治理设计

## 背景

Glaux 是一个包含 Frontend、Backend、Agent Runtime 与 science-core 的 monorepo。当前四个组件都声明为 `0.1.0`，但 Backend、Agent Runtime 与 science-core 在运行时代码中重复硬编码版本；仓库没有整体版本、Git 标签和发布日志契约。

本设计建立“整体产品版本 + 组件独立版本”的双层模型，并把每个版本收束到一个可编辑的事实源。

## 设计目标

- 保留 Glaux 整体版本，表示一套经过集成验证、可复现的组件组合。
- Frontend、Backend、Agent Runtime 与 science-core 分别管理自己的版本。
- 允许组件独立发布，不强制提升整体版本。
- 每个范围只保留一个可编辑的版本事实源，运行时不得再次硬编码。
- 整体和组件都具备明确的标签、日志、验证和失败处理规则。

## 非目标

- 本轮不实现自动发布流水线或包仓库发布。
- 本轮不依据提交信息自动决定版本递增类型。
- 整体版本不替代组件版本，也不要求五个版本长期保持一致。

## 方案比较

### 方案 A：各组件原生事实源 + 整体独立版本（采用）

整体版本放在根 `VERSION`；组件版本分别使用其语言生态的原生清单。运行时从清单或安装包元数据读取版本。

优点是生态兼容、规则直观且无需同步生成器。代价是查看完整矩阵时需要读取五个文件，可由轻量检查命令统一输出。

### 方案 B：根目录集中 `versions.toml`

所有版本集中到一个文件，再同步到各语言清单。虽然便于总览，但包管理器仍要求原生清单包含版本，因而会产生副本和同步漂移风险。

### 方案 C：完全由 Git 标签推导

构建时通过 `git describe` 注入版本。文件较少，但浅克隆、源码压缩包和无 `.git` 的部署环境无法可靠取得版本，不适合当前本地运行方式。

## 版本事实源

| 范围 | 唯一事实源 | 初始版本 |
| --- | --- | --- |
| Glaux 整体 | `/VERSION` | `0.1.0` |
| Frontend | `/frontend/package.json` | `0.1.0` |
| Backend | `/backend/pyproject.toml` | `0.1.0` |
| Agent Runtime | `/agent-runtime/package.json` | `0.1.0` |
| science-core | `/science-core/pyproject.toml` | `0.1.0` |

Backend 与 science-core 的 `__version__` 从安装包元数据读取；Agent Runtime 健康检查从自身 `package.json` 读取；Frontend 当前没有运行时版本消费者。

## 标签与发布关系

- 整体标签：`v<version>`。
- 组件标签：`frontend/v<version>`、`backend/v<version>`、`agent-runtime/v<version>`、`science-core/v<version>`。
- 标签为 annotated tag，只从 `main` 创建，不移动、不复用。
- 组件可独立发布；独立发布不修改根 `VERSION`。
- 整体发布记录当时验证过的四组件版本矩阵，但不要求组件版本相同。

## 发布日志

- 根 `CHANGELOG.md` 只记录整体发布和组件版本矩阵。
- 每个组件目录的 `CHANGELOG.md` 只记录该组件的独立发布。
- 日志使用 `Unreleased`、新增、变更、修复、安全、移除和破坏性变更等稳定分类。
- 发布时必须把目标版本从 `Unreleased` 固化为带日期的版本节。

## 发布门槛

1. 工作区干净，发布提交已经进入 `main`。
2. 目标范围的事实源版本与目标标签一致。
3. 对应 CHANGELOG 已存在该版本和发布日期。
4. 受影响组件的测试、lint 与构建通过。
5. 整体发布额外运行全仓验证，并记录组件版本矩阵。
6. 先推送 `main`，再推送标签。

## 错误处理

- 版本为空、不是 SemVer 或与目标标签不一致时，发布检查失败。
- 运行时无法读取组件元数据时，不回退到硬编码版本；明确返回 `unknown` 或在发布检查中失败。
- 已发布标签有误时创建新 patch 版本，不改写既有标签。

## 验证策略

- 增加轻量版本检查入口，读取五个事实源、验证 SemVer 并输出版本矩阵。
- Agent Runtime 测试断言健康检查版本来自组件事实源。
- Backend 测试断言健康接口版本与安装包元数据一致。
- science-core 测试断言 `__version__` 与安装包元数据一致。
- 使用搜索检查运行时代码不再硬编码组件发布版本。

## 实施范围

1. 建立跨组件版本发布 SDD 与索引。
2. 新增根 `VERSION` 和五份 CHANGELOG。
3. 收束三个组件的重复运行时版本来源。
4. 增加版本矩阵检查和相关测试。
5. 本轮保持五个版本均为 `0.1.0`，不创建或推送正式标签。

