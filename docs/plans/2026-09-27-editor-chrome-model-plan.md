---
kind: record
status: active
---

# SDD 04 v1.1 编辑区四类模型 · 实施计划

依据：[SDD 04](../sdd/feats/04-unified-annotation-toolbox/README.md) §6.4、§7.1、§7.5、§9.3、§15 v1.1、D-20～D-27；相邻修订见 [SDD 01](../sdd/feats/01-dual-mode-shell/README.md) §8「改动(SDD 04 v1.1)」、[SDD 05](../sdd/feats/05-keyboard-shortcuts-a11y/README.md) R4 与 D-9、[SDD 10](../sdd/feats/10-object-convergence/README.md) §9.3 / §9.4。

## 现状要点

- **工具声明**：`science-core/glaux_core/tasks.py` 的 `TaskPlugin.tools` 是 `ToolDef` 元组，四个 `REGISTRY` 行各写一份标签；`plugin_to_view` 下发 `tools`。`ToolDef` 只在 `tasks.py` 与其测试中使用。
- **能力位**：CT 行含 `voi`、`z_scroll`，WSI 行含 `verify`；`backend/app/sources/base.py` 的 `DEFAULT_CAPABILITIES` 中 volume 含 `z_scroll`、video 含 `timeline`。前端只消费 `voi`（`components/Viewer.tsx:76`）和 `timeline`（`CHROME_SEGMENTS`）；`z_scroll`、`verify` 没有消费方。
- **工具装配**：`viewer/useTaskTools.ts` 的 `taskToolsFor` 以 `ALWAYS = {cursor, reset}` 加能力位过滤；无任务时用前端 `GENERIC_TOOLS`。
  - 调用方：`ViewerChrome`、`StagePanel`、`Viewer`、`StatusBar`、`keys/globalKeys.ts`。
  - `ViewerChrome` 与 `StagePanel` 各自重复计算 `CHROME_SEGMENTS` 过滤、`classes`、`frameAxisFor`。
- **reset**：
  - `Editor.onTool` 与 `StagePanel.onTool` 各写一份 `reset` 分支（回光标并调 `reRunActiveModel`）；`runTask` 在无 `TaskView` 时直接 `return false`。
  - `globalKeys.ts:89` 的 `Esc` 执行 `setTool("reset")`，只改 store 值；速查面板的 `Esc` 行只在声明了 `reset` 时出现（`globalKeys.ts:48`）。
- **复现验证**：`PyramidViewer.tsx` 组件内状态 `verify` / `verifying`，按钮与结果渲染在画布右上角，样式为 `styles/global.css:3388` 起的 `.pyramid-verify*`。
- **显示元数据**：`components/iconMap.ts` 的 `TOOL_ICON`、`components/toolHint.ts` 的 `TOOL_HINT`、i18n 的 `tl_*` 键（`tl_cursor` 为「选择」，`StatusBar` 在无工具声明时回退用它）。
- **帧轴**：`frameAxisFor` 已统一 z / t；`TimelineSeg` 对非 `t` 轴返回 `null`，CT 只能用滚轮翻层。
- **i18n**：`t(key, vars)` 支持插值。
- **工作区**：`styles/global.css` 与 SDD 00 等文件有与本计划无关的未提交改动，本计划的提交只暂存自己的变更块。

## 波次

| 波次 | 内容 | 依赖 | 波末状态 |
| --- | --- | --- | --- |
| W1 | science-core + backend：注册表与能力位契约 | — | `GET /tasks`、`GET /datasources` 符合 SDD 04 §9.3，后端与 science-core 测试通过 |
| W2 | frontend：目录、装配 hook、store、i18n | 契约（SDD 04 §9.3），不依赖 W1 代码 | `useEditorChrome` 与目录单测通过 |
| W3 | frontend：外壳、段组件、引擎、快捷键 | W2 | 前端单测、lint、build 通过 |
| W4 | 活文档、§15 自查、浏览器走查 | W1～W3 | SDD 04 转 `implemented` |

W1 与 W2 改动分属不同目录，可并行；W3 在 W2 之后。W1～W3 同一次提交合入（前后端同步更新、不保留旧字段，SDD 04 §9.3）。

## W1 · science-core + backend

- `science-core/glaux_core/tasks.py`：
  - 删除 `ToolDef` 与 `TaskPlugin.tools`；新增 `actions: tuple[str, ...] = ("rerun",)`。
  - 类 docstring 改为：`capabilities` 只含模式工具 `bbox` / `polygon` / `brush` / `wall`；`actions` 取值 `rerun` / `verify`。
  - `REGISTRY` 四行按 SDD 04 §9.3 注册表取值：CT 行 `capabilities=("bbox", "polygon", "brush")`；WSI 行 `capabilities=("bbox", "polygon")`、`actions=("rerun", "verify")`；IMT、HC 行只删 `tools`。
  - `plugin_to_view`：删 `tools`，增 `"actions": list(plugin.actions)`。
- `science-core/tests/test_tasks.py`：
  - 删 `test_task_tool_keys_are_declared_on_registry_tools`（键位移到前端，SDD 05 D-9）。
  - 各任务行断言改为：视图不含 `tools`；`capabilities` 与 `actions` 等于 §9.3 取值。
  - 新增：全部 `REGISTRY` 行的 `capabilities` ⊆ `{bbox, polygon, brush, wall}`，`actions` ⊆ `{rerun, verify}`。
- `science-core/tests/test_object_convergence_w2.py`：CT、WSI 能力位断言按新取值改；`test_plugin_to_view_new_keys_and_legacy_keys` 的键集合去掉 `tools`、加入 `actions`。
- `backend/app/sources/base.py`：`DEFAULT_CAPABILITIES` 改为 image / volume / slide 为 `("bbox", "polygon")`，video 为 `("bbox", "polygon", "brush")`；注释同步。
- `backend/tests/test_api.py`：IMT 行断言去掉 `tools`，改断言 `actions == ["rerun"]`；逐行循环里的 `tools` 断言改为 `"tools" not in r` 且 `r["actions"]` 非空。
- `backend/tests/test_objects.py`：
  - 第 65～66 行改为：CT 行 `capabilities` 不含 `voi` / `z_scroll`，WSI 行 `actions` 含 `verify`。
  - `test_default_capabilities_only_for_modalities_without_task` 的 video 期望改为 `["bbox", "polygon", "brush"]`。
- CHANGELOG（`Unreleased`）：
  - `science-core/CHANGELOG.md`：Removed `ToolDef`、`TaskPlugin.tools`；Added `TaskPlugin.actions`；Changed 能力位取值收窄。
  - `backend/CHANGELOG.md`：Changed `GET /tasks` 删除 `tools`、新增 `actions`，`capabilities` 只含模式工具；`GET /datasources` 的 `default_capabilities` 去掉 `z_scroll`、`timeline`。
- 门禁：science-core 与 backend 各跑 `uv run pytest -q`、`uv run ruff check`；`scripts/ci/check-modality-literals.sh --strict`。

## W2 · frontend 数据层

- `api/types.ts`：删 `TaskToolDef` 与 `TaskView.tools`；新增 `TaskView.actions: TaskAction[]`，`type TaskAction = "rerun" | "verify"`；`capabilities` 注释改为模式工具。
- `viewer/toolCatalog.ts`（新）：
  - `TOOL_CATALOG: readonly ToolEntry[]`，顺序即展示序：`cursor`、`bbox`、`polygon`、`brush`、`wall`。
  - `ToolEntry = { id: Tool; icon: LucideIcon; label: I18nKey; key?: string; hint?: I18nKey }`；键位 `v` / `r` / `p` / `b` / `w`。
  - `icon` 取自现 `TOOL_ICON`，`hint` 取自现 `TOOL_HINT`；两张旧表删除，`iconMap.ts` 不再导出 `TOOL_ICON`。
- `viewer/actionCatalog.ts`（新）：
  - `ACTION_CATALOG: Record<TaskAction, ActionEntry>`，`ActionEntry = { icon; label: I18nKey; run(): Promise<void>; disabledReason(ctx): I18nKey | null }`。
  - `rerun`：`run` 调 `reRunActiveModel()`，不改 `tool`；`disabledReason` 在 `task.trigger === "on_region"` 且 `focus.region` 为空时返回 `act_rerun_need_region`，`loading` 为真时返回 `running`。
  - `verify`：`run` 调新的 `verifyActiveObject()`。
- `data/actions.ts`：新增 `verifyActiveObject()`：`api.wsiVerify(object.id)` → 结果回来时焦点对象未变才写 `setVerification`；异常时 `notify("crit", t("wsi_verify_unavailable"))` 并置 `null`。
- `store/session.ts`：
  - 新增 `verification: { f1: number; count_pred: number; count_ref: number } | null` 与 `setVerification`。
  - `setFocus` 在 `object_id` 变化时同时清空 `verification`（与既有清 `document` 同一分支，覆盖 SDD 04 §7.5 规则 10 的全部入口）。
- `viewer/editorChrome.ts`（新，替代 `useTaskTools.ts`）：
  - 纯函数 `modeToolsFor(object, tasks, datasources) → { task, capabilities, tools }`：`tools` = `TOOL_CATALOG` 中 `cursor` 加 `capabilities` 命中者；供 `globalKeys` 与引擎使用。
  - hook `useEditorChrome()` 返回：
    - `modes`：同上 `tools`；
    - `hint`：当前工具的 `hint`，若 `task.on_commit[tool]?.action === "run_task"` 追加 `chrome_hint_run_on_commit`（插值任务标签）；
    - `modeOptions`：当前工具为 `brush` 且启用时的 `BrushSeg`；
    - `view`：`{ voi: object.kind === "volume", axis: frameAxisFor(...) }`；
    - `actions`：`task?.actions` 映射到 `ACTION_CATALOG`，无任务为空数组；
    - `readout`：`task.metrics` 与 store `metrics` 的交集、`source`、`verification`；
    - `classes`：`volume_mask` 原语的类别表（从两处外壳收拢）。
  - `useTaskTools.ts` 删除；`Viewer.tsx`、`StatusBar.tsx` 改用 `modeToolsFor` / `useEditorChrome`。
- i18n（`zh.ts`、`en.ts` 同步）：
  - `tl_cursor` 改「选择 / 平移」/「Select / Pan」；删 `tl_reset`。
  - 新增 `act_rerun`「重新运行」/「Re-run」、`act_rerun_need_region`「先框选区域」/「Select a region first」、`act_verify`（沿用 `wsi_verify` 文案后删除 `wsi_verify` 键）、`chrome_layer`「层」/「Slice」、`chrome_hint_run_on_commit`「松手后运行 {task}」/「Runs {task} on release」、`readout_verify`「复现 F1 {f1}（{pred}/{ref}）」、`sc_esc_cursor`「回到选择」/「Back to select」。
- 测试：
  - `viewer/editorChrome.test.ts`（由 `useTaskTools.test.ts` 改写）：有任务 / 无任务的模式集合；六类对象 `bbox` 标签同为 `tl_bbox`；无任务 `actions` 为空；WSI `bbox` 提示含 on_commit 追加；`voi` 仅 volume；`verification` 在切换对象后为 `null`。
  - 更新 fixtures：`test/fixtures.ts`、`SideBar.test.tsx`、`store/objectFocus.test.ts`、`agent/toolBridge.test.ts`、`data/actions.test.ts`、`viewer/imtWallTool.test.ts` 中的 `TaskView` 去 `tools`、补 `actions`。

## W3 · frontend 外壳与引擎

- `viewer/chromeSegments.tsx`：
  - 拆为 `BrushSeg`（模式选项）与 `VoiSeg`、`FrameAxisSeg`（视图）；删除按能力位登记的 `CHROME_SEGMENTS` 数组，由 `useEditorChrome` 直接给出要渲染的段。
  - `FrameAxisSeg` 取代 `TimelineSeg`：`z` 显示「层 i/n」，`t` 显示「帧 i/n」与秒数；`axis.kind === "none"` 不渲染。
- `components/EditorActions.tsx`（新）：渲染动作段；普通按钮，无 `aria-pressed`；执行中与 `disabledReason` 非空时禁用，`title` 给原因。
- `components/focus/ReadoutBar.tsx`（新）：由 `StagePanel` 现有度量条抽出，末尾追加复现结果（F1 分档配色沿用 `good` / `warn` / `bad`），再接来源角标。
- `components/ViewerChrome.tsx`（Workbench）与 `components/focus/StagePanel.tsx`（Focus）：
  - 只调 `useEditorChrome()`，按 SDD 04 §6.4 顺序渲染：模式 → 提示 → 模式选项 → 视图 → 弹性占位 → 动作 → 运行中指示。
  - 删除两处 `onTool` 的 `reset` 分支，按钮直接 `setTool`；`Editor.tsx` 的 `onTool` 同样简化。
  - `StagePanel` 在工具条下渲染 `ReadoutBar`；`ViewerChrome` 不渲染读数条（D-27）。
  - `useCompactToolbar` 的判据不变；动作段按钮按 `.focus-tool` 计入宽度，紧凑态只留图标。
- `components/Viewer.tsx`：`voi` 改为 `object.kind === "volume" ? toolOptions.voi : null`。
- `viewer/PyramidViewer.tsx`：删除 `verify` / `verifying` 状态、`onVerify` 与 `.pyramid-verify` 渲染；`styles/global.css` 删除 `.pyramid-verify*` 规则，新增动作段与复现结果样式（沿用现有 token）。
- `viewer/csTools.ts`：兜底注释「cursor / reset / 能力位外」改为「cursor / 能力位外」，行为不变。
- `keys/globalKeys.ts`：
  - 工具键与速查面板行改读 `modeToolsFor`：行来自 `TOOL_CATALOG` 中带 `key` 的工具，未启用者 `disabled`。
  - `Esc` 改为 `setTool("cursor")`；速查面板的 `Esc` 行常驻，标签 `sc_esc_cursor`。
- 测试：
  - `ViewerChrome.test.tsx`：通用图像无动作段；WSI 动作段含「重新运行」「复现验证」，无 region 时「重新运行」禁用；CT 出现层滑块与窗宽窗位；视频出现帧滑块，2D 图像无视图段。
  - `PyramidViewer.test.tsx`：画布内无复现验证按钮。
  - `keys/globalKeys.test.ts`：`Esc` 后 `tool === "cursor"` 且未调用 `runTask`；速查面板 `Esc` 行在无任务对象上也存在；键位行来自目录。
  - `components/viewerEngines.smoke.test.tsx`：`TaskView` 构造去 `tools`、补 `actions`，CT 不再加 `voi` 能力位。
  - 新增 `StagePanel` 用例：`verification` 写入后读数条显示 F1，切换对象后消失。
- 门禁：`npm run lint`、`npm test`、`npm run build`（按 WSL 构建约定经 `wsl.exe` 执行）。

## W4 · 活文档与验收

- 活文档：
  - `docs/runbooks/datasource-registry.md` 第 166 行：时间轴改为「对象 `axes` 含 `t` 时显示」。
  - `docs/architecture.zh-CN.md` 查看器一行：补 `useEditorChrome` 与四类段，删能力位驱动选项段的描述。
  - 其余活文档中涉及 `useTaskTools`、`CHROME_SEGMENTS`、`tools[]`、`z_scroll`、`timeline` 能力位的描述逐处更新（实现时在 `docs/` 与各组件 README 中 `grep` 确认；frontend 目前无 README）。
- 浏览器走查（dev server，Focus 与 Workbench 各一遍），对象：通用图像、视频、CT、WSI、IMT、HC。逐条对照 SDD 04 §15 v1.1，截图留证。
- SDD 收尾：
  - SDD 04 §0 转 `implemented`，§15 v1.1 勾选并按「已完成 / 未完成 / 无法验证」写自查。
  - SDD 01、SDD 05 §0 中「随 SDD 04 v1.1 实现、不计入 `implemented` 范围」的说明删除。
  - 更新 `docs/sdd/README.md` 与 `docs/README.md` 的状态行。
- 本计划 `status` 改为 `done`。

## 风险

| 风险 | 处理 |
| --- | --- |
| 仍有调用方读取 `TaskView.tools`（agent-runtime、脚本） | 2026-09-27 全仓盘点：`ToolDef` / `TaskToolDef` 只在 `tasks.py`、前端 `api/types.ts` 与 `useTaskTools.ts`；agent-runtime 无引用；`.claude/worktrees/` 下的旧工作树副本不在范围内 |
| 删除 `TOOL_ICON` 影响其他图标引用 | 以 `tsc -b` 报错为准逐处改读 `TOOL_CATALOG` |
| 紧凑模式在动作段加入后更早触发 | 走查时在 Focus 默认栏宽下检查 CT（选项最多）是否只留图标；若回归，按 SDD 01 §8 的截断顺序先截提示 |
| `global.css` 有无关未提交改动 | 提交时按变更块暂存，只带本计划的样式改动 |
