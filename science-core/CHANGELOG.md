# science-core Changelog

本文件只记录 science-core 独立发布；Glaux 整体发布见根目录 `CHANGELOG.md`。

## [Unreleased]

### Added

- `TaskPlugin.actions`：工具条动作段的一次性命令，取值 `rerun` / `verify`，缺省 `("rerun",)`；WSI 核检测行为 `("rerun", "verify")`（SDD 04 §9.3）。

### Changed

- `TaskPlugin.capabilities` 只含模式工具 `bbox` / `polygon` / `brush` / `wall`；CT 行不再含 `voi`、`z_scroll`，WSI 行不再含 `verify`（SDD 04 D-23）。

### Removed

- **不兼容（0.x 破坏性变更）**：删除 `ToolDef` 与 `TaskPlugin.tools`，`plugin_to_view` 不再输出 `tools`；工具标签、图标、键位归前端工具目录（SDD 04 D-21）。

## [0.2.0] - 2026-08-31

### Added

- 任务注册表新增 `wall` 工具位与同名引擎能力位（IMT 壁线形变自成一个工具）。

### Changed

- `polygon` 在所有模态一律为自由多边形，语义不再随模态变化。
