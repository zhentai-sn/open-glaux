# Glaux Changelog

本文件只记录 Glaux 整体产品发布。组件独立发布记录在各组件自己的 `CHANGELOG.md`。

格式参考 Keep a Changelog，版本号遵循 Semantic Versioning。

## [Unreleased]

## [0.1.0] - 2026-08-26

### Added

- 首个 Glaux 整体版本，集成 Frontend、Backend、Agent Runtime 与 science-core。
- 建立整体版本与组件独立版本并行的版本事实源、发布日志和检查入口。

### Fixed

- 对齐 Agent Runtime 与 Frontend 测试类型契约，恢复完整类型检查和生产构建。
- 为 Starlette TestClient 增加 Backend 开发依赖，并清理既有 Ruff 发布基线。

### 组件版本矩阵

| 组件 | 发布版本 |
| --- | --- |
| Frontend | `0.1.0` |
| Backend | `0.1.0` |
| Agent Runtime | `0.1.0` |
| science-core | `0.1.0` |
