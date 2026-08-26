# 多组件版本与发布治理实施计划

约束来源：[多组件版本与发布治理 SDD](../sdd/01-version-release-governance.md)（`ready`）。

## 1. 建立版本与日志骨架

- 新增根 `VERSION`，内容为 `0.1.0`。
- 新增根与四组件 `CHANGELOG.md`，保留 `Unreleased`，说明各自记录边界；未发布节不重复当前候选版本。
- 根日志提供整体版本节的组件矩阵模板，但在正式打标签前不伪造发布日期。

验证：五个版本事实源均为 `0.1.0`；五份日志路径与 SDD §9 一致。

## 2. 收束组件运行时版本来源

- Agent Runtime 新增版本读取模块，从相邻 `package.json` 解析和校验版本；健康检查引用该模块。
- Backend 使用 `importlib.metadata.version("glaux-backend")` 暴露 `__version__`，缺失时返回 `unknown`。
- science-core 使用 `importlib.metadata.version("glaux-core")` 暴露 `__version__`，缺失时返回 `unknown`。
- Frontend 无重复运行时版本，不增加第二来源。

验证：搜索运行时代码不再出现发布版本硬编码；健康接口和包属性与原生清单一致。

## 3. 增加版本矩阵检查

- 新增无第三方依赖的 `scripts/version_matrix.py`。
- 读取根文本、两个 JSON 清单与两个 TOML 清单。
- 校验两个 `package-lock.json` 和两个 `uv.lock` 的生成版本镜像与事实源一致，但不把锁文件作为事实源。
- 用完整 SemVer 规则校验五项，按稳定顺序输出矩阵。
- 任一来源缺失、字段缺失或格式非法时，以非零状态退出并指出范围和来源路径。
- Makefile 增加 `version` 与 `version-check` 入口。

验证：正常执行两次输出一致且不修改工作区；用脚本单元测试覆盖非法值。

## 4. 补运行时与检查测试

- Agent Runtime 增加版本模块测试，并调整健康检查测试以使用事实源版本。
- Backend 增加包元数据与 `/health.version` 一致性断言。
- science-core 强化 smoke test，断言包属性与安装包元数据一致。
- 根版本脚本增加 stdlib 单元测试，覆盖五项读取、SemVer 与错误消息。

验证：目标测试、类型检查与版本检查通过。

## 5. SDD 收口

- 对照 SDD §15 逐项记录已完成、未完成、无法验证。
- 实现与设计如有偏差，先反补 SDD。
- 开发侧验收通过后，将公共规范从 `ready` 推进到 `implemented`，同步 SDD 索引。
- 当前工作区仍有其他功能改动，因此本计划不创建或推送正式 `v0.1.0` 标签。
