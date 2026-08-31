# Glaux Changelog

本文件只记录 Glaux 整体产品发布。组件独立发布记录在各组件自己的 `CHANGELOG.md`。

格式参考 Keep a Changelog，版本号遵循 Semantic Versioning。

## [Unreleased]

## [0.2.0] - 2026-08-31

### Added

- 文件栏改为导入优先：无数据源时首屏是导入引导而非演示数据集，支持浏览器拖拽/选择上传 JPEG/PNG（`POST /uploads/images`）、打开服务端文件夹、显式「加载示例数据」（`POST /datasources/samples`）与「最近使用」。见 [SDD 08](docs/sdd/feats/08-data-import-first-explorer/README.md)。
- 通用图像（`natural_image`）从固定演示白名单扩展为「内置示例 + 用户导入源」，并支持 PNG。
- Focus 右侧栏舞台常驻，与文件/图谱浏览器列左右分栏，可拖拽调宽；窄屏自动降级为整栏互斥。见 [SDD 01](docs/sdd/feats/01-dual-mode-shell/README.md) v1.4。
- 自然图像 SAM 演示集合与 `segment_region` 走查链路（[SDD 07](docs/sdd/feats/07-natural-image-sam-demo/README.md)）。
- 智能体可读取查看器当前打开的图像；建议态标注实时写回查看器并随会话快照持久化（[SDD 02](docs/sdd/feats/02-agent-image-annotation/README.md) D-12）。

### Changed

- **不兼容（0.x 破坏性变更）**：`GLAUX_DEV_MODE` 缺省由 `1` 翻为 `0`。默认不再提供内置示例数据源，新用户首屏为空态引导；开发环境需显式 `GLAUX_DEV_MODE=1`（仓库内四处启动入口已内置该默认）。
- 模态切换器的可见性来源由任务注册表（`/tasks`）改为数据源注册表（`/datasources`）：只列出真正有数据的模态；标签仍取自任务注册表。
- 模态切换器在窄容器下改为纵向单列，阈值为「候选数 × 120px」。
- IMT 壁线编辑从 `polygon` 工具拆出为独立的 `wall` 工具位，`polygon` 在所有模态一律是自由多边形。

### Fixed

- 上传图像的越界标注不再被静默接受：标注层的尺寸解析补上 `nat-` 前缀，此前落入「未知对象跳过校验」的降级分支。
- 「最近使用」不再在启动期把尚未加载的对象误判为失效并永久剔除。
- 移除导入数据源时明示「不会删除磁盘上的文件」。
- `make test-backend` 恢复可用：测试装配先导入 `app.config` 完成 science-core 的 `sys.path` 注入。

### 组件版本矩阵

| 组件 | 发布版本 |
| --- | --- |
| Frontend | `0.2.0` |
| Backend | `0.2.0` |
| Agent Runtime | `0.2.0` |
| science-core | `0.2.0` |

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
