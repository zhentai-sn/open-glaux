# AGENTS.md

本文件面向在本仓库工作的编码智能体，只写从代码推不出的规则。

## 先读

- [纲领](docs/roadmaps/charter.zh-CN.md)：定位、领域、边界。
- [仓库骨架总览](docs/architecture.zh-CN.md)：目录与运行时。
- [SDD 索引](docs/sdd/README.md)：Feature 清单与状态；再读任务对应的 Feature SDD。

## 文档规则

- 文档分活文档（`kind: living`）和记录（`kind: record`），完整规则见 [docs/README.md](docs/README.md)「文档类型：活文档与记录」。
- 判断现状只看活文档；记录只用于追溯。
- 改了行为、接口、路径或配置，在同一提交里更新对应的活文档：SDD、操作手册（runbook）、仓库骨架总览、组件 README。
- 活文档只写最新结论，不加变更记录或修订历史。
- 记录进入终态后不改正文，只改 frontmatter 的 `status`、`superseded_by`。
- 在 `docs/` 下新建 Markdown 文档时写 frontmatter（`kind`、`status`，例外见 [docs/README.md](docs/README.md)），命名遵循同一文件的规约。
- `.qoder/` 等本地自动生成的知识库不是事实来源。
- 写作言简意赅，不用比喻和类比，用业界通行术语。
