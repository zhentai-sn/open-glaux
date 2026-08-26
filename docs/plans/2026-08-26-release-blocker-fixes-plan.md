# v0.1.0 发布阻断修复实施计划

约束来源：[v0.1.0 发布阻断修复设计](./2026-08-26-release-blocker-fixes-design.md)与[版本发布治理 SDD](../sdd/01-version-release-governance.md)。

## 1. 对齐 Agent Runtime 测试契约

- 为 locate ROI、propose annotation 与 segment region 测试按生产契约传入五个参数。
- 为 locate ROI 的模型运行时夹具补充空 `disposeCredential()`。
- 将 mask-to-polygon 的边界框返回类型明确为二元组。

验证：运行目标测试和 `npm run typecheck`，确认没有修改 `agent-runtime/src` 下的生产逻辑。

## 2. 收紧 Frontend 测试与翻译键类型

- 为注解构造器和多边形测试对象补充领域类型声明。
- 显式处理可选 metadata。
- 将建议状态到翻译键的映射声明为 `I18nKey`。

验证：运行目标测试和 `npm run lint`；检查 `SuggestionCard` 生成逻辑未变化。

## 3. 修复 Backend 测试客户端依赖

- 在 Backend `dev` 可选依赖中加入 `httpx2`，保留运行时 `httpx`。
- 通过 `uv lock` 重新生成锁文件。
- 先运行首个曾挂起的 CRUD 测试，再运行 Backend 全量测试。

验证：测试不再出现 Starlette 的旧 httpx 回退警告且能够正常结束。

## 4. 完整发布验证

- 清理 Backend 干净 `HEAD` 已存在的 Ruff 基线错误，只做无行为变化的机械修复。
- 不修改 Ruff 规则、忽略列表或文件扫描范围。

- Agent Runtime：`npm test`、`npm run typecheck`、`npm run build`。
- Frontend：`npm test`、`npm run lint`、`npm run build`。
- Backend：全量 `pytest`、`ruff check`。
- science-core：全量 `pytest`。
- 仓库：`make version-check`。

验证：所有命令以零状态结束；版本矩阵仍为整体及四组件 `0.1.0`。

## 5. 审查与提交

- 按代码质量审查清单检查正确性、设计、可维护性、性能与安全。
- 只暂存本计划涉及的路径或精确变更块，避免带入工作区已有的其他功能修改。
- 使用 Conventional Commits 中文提交信息提交修复。

验证：提交内容没有无关改动，也没有生产运行时行为变化。

## 6. 完成整体 v0.1.0 发布

- 在干净、可复现的 `main` 上更新根 `CHANGELOG.md`，固化 `0.1.0`、发布日期与组件矩阵。
- 重新执行发布检查并提交发布日志。
- 先推送 `main`，再创建 annotated tag `v0.1.0` 并推送标签。

验证：远端 `main` 指向发布提交，远端 `v0.1.0` 指向同一提交；本地用户未提交改动保持不变。
