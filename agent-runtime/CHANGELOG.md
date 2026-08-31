# Agent Runtime Changelog

本文件只记录 Agent Runtime 独立发布；Glaux 整体发布见根目录 `CHANGELOG.md`。

## [Unreleased]

## [0.2.0] - 2026-08-31

### Added

- 智能体可读取查看器当前打开的图像（`view_image` 工具与查看器上下文）。

### Changed

- 建议态标注的工具结果实时写回查看器，并随会话快照持久化。
- 结果写回不再抢占 Focus 右侧栏的标签：舞台自 SDD 01 v1.4 起常驻，展开即可见。
