# Glaux SDD 索引

> SDD（Specification-Driven Development）用于在实现前冻结范围、契约、状态机与验收标准。实现计划和代码必须以状态为 `ready` 的 SDD 为输入。

## 生命周期

```mermaid
stateDiagram-v2
    [*] --> draft
    draft --> ready: 边界、契约、验收完整且无开放问题
    ready --> implemented: 实现完成并通过开发侧验证
    implemented --> accepted: 验收标准全部通过
    ready --> draft: 范围或契约发生实质变化
    implemented --> draft: 实现暴露出规范缺口
```

| 状态 | 含义 | 进入条件 |
| --- | --- | --- |
| `draft` | 规范编写中 | 仍有未决边界、契约或验收项 |
| `ready` | 可进入实现规划 | 范围、输入输出、状态机、错误处理与验收完整，开放问题为零 |
| `implemented` | 已按规范实现 | 实现完成并通过自动化与人工开发验证 |
| `accepted` | 已完成业务验收 | 第 15 节验收标准全部通过 |

## Feature SDD

| 编号 | Feature | 状态 | 负责人 | 更新时间 |
| --- | --- | --- | --- | --- |
| 00 | [内置参考智能体与本地会话管理](feats/00-reference-agent-conversations/README.md) | `implemented` | Glaux 项目维护者 | 2026-07-27 |
| 01 | [双模式外壳 Focus / Workbench](feats/01-dual-mode-shell/README.md) | `accepted` | Glaux 项目维护者 | 2026-08-13 |

## 维护约定

- Feature 文档路径固定为 `feats/<NN>-<name>/README.md`。
- 每份 Feature SDD 使用第 0～17 节的统一结构。
- 状态变化、契约变化和非兼容决策必须同步更新 Feature 文档及本索引。
- `ready` 文档不得保留未关闭的开放问题；无法当场确定的事项应降级为 `draft`。
- 实现计划引用 SDD 的稳定章节与决策编号，不另行发明产品边界。
