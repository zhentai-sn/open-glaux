# v0.1.0 发布阻断修复设计

## 背景

Glaux `v0.1.0` 在执行全仓发布门禁时发现三类阻断：Agent Runtime 与 Frontend 的 TypeScript 类型检查失败，Backend 的 Starlette `TestClient` 在当前依赖组合下挂起。已有业务测试本身未暴露生产行为错误。

本轮修复测试夹具、类型声明、Backend 开发依赖及既有 Ruff 静态质量债务，
不改变生产运行时行为。

## 目标

- 让测试代码遵循当前生产契约，不通过放宽生产类型消除错误。
- 消除 Frontend 中仅由类型推断过窄或可空值检查不足造成的阻断。
- 使用 Starlette 当前支持的测试客户端依赖恢复 Backend 全量测试。
- 通过四组件完整发布门禁后，继续 `v0.1.0` 发布流程。

## 非目标

- 不改变 Agent Runtime 工具执行签名、模型生命周期或业务逻辑。
- 不改变 Frontend 注解状态、数据流或界面交互。
- 不替换 Backend 运行时 HTTP 客户端，不调整 API 契约。
- 不跳过、降级或删除现有发布门禁。
- 不通过修改 Ruff 规则、增加全局忽略或排除文件来消除检查结果。

## 方案比较

### 方案 A：测试契约对齐 + 精确类型声明 + 官方开发依赖（采用）

- Agent Runtime 测试显式传入完整五参数调用；测试运行时夹具实现无副作用的 `disposeCredential()`；边界框辅助函数显式返回二元组。
- Frontend 测试夹具显式声明 `Annotation`，补齐字面量与可空元数据类型处理；翻译键映射显式声明为 `I18nKey`。
- Backend 保留运行时 `httpx`，仅在 `dev` 可选依赖中增加 `httpx2`，并由 `uv` 重新生成锁文件。

该方案不触碰生产控制流，且让测试与当前真实契约保持一致。

### 方案 B：放宽生产类型或提供旧签名兼容层

让工具执行函数接受旧三参数调用、将运行时释放方法改为可选，或扩大前端类型。修改较少，但会削弱生产契约并掩盖测试夹具漂移，因此不采用。

### 方案 C：跳过失败门禁

从发布流程移除 TypeScript 类型检查或 Backend `TestClient` 测试。能够暂时打标签，但无法证明版本可发布，违反版本治理规范，因此不采用。

## 变更设计

### Agent Runtime

- 仅修改阻断测试文件。
- 相关测试按仓库既有惯例显式调用 `execute(toolCallId, params, signal, onUpdate, context)`；未使用的后三项传入 `undefined`。
- `VisionRuntime` 测试夹具补充空实现 `disposeCredential()`，使其满足工具工厂要求的 `ModelRuntime`。
- `bboxOf` 显式返回 `[number, number]`，避免数组解构项被推断为可能缺失。

### Frontend

- 测试数据构造器显式返回 `Annotation`，允许合法的状态和来源联合类型。
- 多边形测试对象通过精确类型注解保留 `closed: true` 字面量。
- 对可选 metadata 使用显式存在性断言或可选访问。
- `SuggestionCard` 的状态到翻译键映射声明为 `Record<..., I18nKey>`；生成的 JavaScript 与当前实现一致。

### Backend

- 在 `[project.optional-dependencies].dev` 中增加 `httpx2`。
- 保留 `[project.dependencies]` 中的 `httpx`，因为生产代码仍使用该包。
- 使用 `uv lock` 更新 `uv.lock`，不手工编辑生成文件。
- 清理发布基线已有的 Ruff 错误；仅排序 import、移除未使用 import、删除多余
  `f` 前缀、拆分语句与超长行。
- 格式清理不得改变表达式、字符串值、控制流、接口或测试断言。

## 验证策略

1. Agent Runtime：`npm test`、`npm run typecheck`、`npm run build`。
2. Frontend：`npm test`、`npm run lint`、`npm run build`。
3. Backend：全量 `pytest` 与 `ruff check`。
4. science-core：全量 `pytest`。
5. 仓库级：`make version-check`，并确认版本矩阵仍全部为 `0.1.0`。
6. 检查实际 diff，确认没有为本次修复引入生产运行时行为变更。

## 发布衔接

全部门禁通过后，按既有发布治理规范更新根 `CHANGELOG.md` 的 `0.1.0` 发布节和组件版本矩阵，先推送 `main`，再创建并推送 annotated tag `v0.1.0`。任何门禁失败时都不创建标签。
