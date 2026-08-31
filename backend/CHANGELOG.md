# Backend Changelog

本文件只记录 Backend 独立发布；Glaux 整体发布见根目录 `CHANGELOG.md`。

## [Unreleased]

## [0.2.0] - 2026-08-31

### Added

- `POST /uploads/images`：浏览器上传 JPEG/PNG 为通用图像数据源，逐文件校验扩展名与文件头魔数，落盘名与图像 ID 均由服务端确定性派生（客户端文件名不进入文件系统路径）。
- `POST /datasources/samples`：显式加载仓库自带示例数据源，幂等。
- `natural_image` 进入数据源注册表；通用图像列图/取图从固定白名单扩展为「内置示例 + 导入源」，并支持 PNG。
- 上传上限环境变量 `GLAUX_UPLOAD_MAX_BYTES`（32 MiB）与 `GLAUX_UPLOAD_MAX_FILES`（20）。

### Changed

- **不兼容（0.x 破坏性变更）**：`GLAUX_DEV_MODE` 缺省由 `1` 翻为 `0`，默认不再提供内置数据源；开发环境需显式置 `1`。
- 通用图像数据源不因缺标定而标记 `needs_calibration`——它本就没有标定这回事。

### Fixed

- 上传图像的越界标注不再被静默接受：`_dims_for` 补上 `nat-` 前缀，此前落入「未知对象跳过范围校验」的降级分支。
- `make test-backend` 恢复可用：测试装配先导入 `app.config` 完成 science-core 的 `sys.path` 注入。
