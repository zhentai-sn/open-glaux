---
kind: record
status: open
title: "对象收敛执行记录（SDD 10 · W0～W7）"
created: 2026-09-23
---

> **用途**：[SDD 10「视觉对象与数据源收敛」](../sdd/feats/10-object-convergence/README.md)各波次的过程证据，包括基线、准出门禁结果、零改清单、手工走查签字、执行中发现的问题。契约以 SDD 10 为准，本记录不重述契约。
> **上游**：[模态通用化技术债审计](2026-09-18-001-code-review-modality-generalization.zh-CN.md) §8 分波计划。
> **状态**：`open`，按波次追加；W7 准出后改为 `closed`。

## W0 · 安全网与契约冻结

执行日期 2026-09-23，基线 HEAD `ffcd93d`。

### 1. 基线（改动前）

| 项 | 结果 |
| --- | --- |
| agent-runtime | 30 文件 / 174 通过 |
| frontend | 33 文件 / 188 通过 |
| backend | 222 通过 |
| science-core | 169 通过 |
| `make lint` | 红：`backend/app/datasource_registry.py:9` E501，由 `2306a36` 引入；frontend、agent-runtime 干净 |

### 2. 准出门禁

| 门禁 | 结果 |
| --- | --- |
| `make test`（含 `test-version`） | 绿：agent-runtime 31 文件 / 205；frontend 35 文件 / 208 + 1 预期失败；backend 241 + 2 xfailed；science-core 169 |
| `make lint` | 绿 |
| 新增行为测试在当前代码上通过 | 是。唯一例外是 `activeModel` 跨模态泄漏，以 `it.fails` 固定，见 §5 F-1 |
| 后端 8 个测试文件、runtime 工具测试、science-core `test_tasks.py` 的旧断言改完 | 是，见 §3；`test_uploads_api.py` 的字面量描述的是固定为自然图像的上传通道，保留 |
| `check-modality-literals.sh` 可运行，基线入本记录 | 是，见 §4 |
| SDD 10 与本记录存在、frontmatter 合规、索引登记 | 是 |
| 引擎 smoke 可行性结论入本记录 | 是，可行，见 §4 |

W0 无界面行为变更，不需要手工走查。

### 3. 改动清单

产品代码（W0 允许的例外，均为注释、文档字符串或报错文案）：

| 文件 | 改动 |
| --- | --- |
| `agent-runtime/src/transport/routes.ts:350` | 报错文案 `[x, y, w, h]` 改为 `[x0, y0, x1, y1]`。审计称其为注释，实为返回给调用方的报错文案；校验逻辑本就按角点，未改 |
| `frontend/src/components/Viewer.tsx:13` | 注释 OrthographicViewport 改为 StackViewport：VolumeViewer 实际把 NIfTI 按 z 层作 stack，labelmap 画在 canvas 叠层 |
| `backend/app/datasource_registry.py:1,9` | 文档字符串「表征层」改为「观测空间」；折行修 E501 |
| `Makefile` | 新增独立目标 `check-literals`，不挂进 `make test` |

测试：

| 端 | 文件 | 要点 |
| --- | --- | --- |
| backend | `test_datasource_registry.py` | 去掉 `== set(MODALITIES)` 与 `== 5`；改为已知五模态 ⊆ `MODALITIES`、无重复、每模态至多一个内置源；按 `MODALITIES` 遍历的导入用例；`Modality` 仍为 `Literal` 时与 `MODALITIES` 同集 |
| backend | `test_datasource_samples.py` | 新增：全部内置根有数据时，加载示例得到每模态一个活动源 |
| backend | `test_datasources_api.py` | 由只检 `[0]` 改为逐项检字段、模态合法、id 唯一；数据集卡与 `/datasources` 一一对应 |
| backend | `test_datasource_detect.py` | 空目录探测按全部模态遍历：不抛异常、不编造标定 |
| backend | `test_natural_images.py` | 去掉 `center` 固定值断言；`cf` 以 `.get` 读取 |
| backend | `test_cache_invalidation.py` | 不再 monkeypatch `caches._CACHED`，改为让 WSI/CT 模块导入失败 |
| backend | `test_api.py` | 隐式默认模态改显式传参；`models[0]` 次序断言改存在性；`capabilities` 改超集；新增 `/tasks` 逐行检查；两条 strict xfail 与一条前置用例 |
| science-core | `tests/test_tasks.py` | `adapter_kind`、`viewer` 枚举断言改为非空字符串 |
| frontend | `src/store/objectFocus.test.ts`（新） | 5 条选择路径下活动对象与智能体上下文一致；切对象后拒收旧对象的工具结果；`activeModel` 跟随模态 |
| frontend | `src/components/viewerEngines.smoke.test.tsx`（新） | 两引擎各三步：渲染一帧、画一条多边形、提交一笔画笔 |
| agent-runtime | `tests/contract/viewer-context.test.ts`（新） | `parseViewer` 31 条：各模态合法形态、`roi_box` 角点语义、全部 400 分支 |
| agent-runtime | `tests/helpers/viewer-fixture.ts`（新） | `viewerOn`、`observedObjectId`、`targetObjectId`、`taskSpecOf`；预置 `ct_0001`／`slide_001`／`vid-0001` 与 `/objects/{id}/frame` 桩（尚未接入） |
| agent-runtime | 6 个工具集成测试 | 旧字段名断言改为经 helper 的行为断言 |

W3、W5 换取值方式时只改 helper：frontend 的 `currentObjectId()` 改为 `focus?.object_id`；runtime 的 `viewerOn()`、`observedObjectId()` 改指 `object`／`focus` 与 `/objects/{id}/frame`。

### 4. 开放问题的关闭证据

**SDD 10 Q1 引擎合并可行性：可行。**

- `viewerEngines.smoke.test.tsx` 6 条用例全绿，连跑 3 次稳定。
- 有效性以变异测试校验：在产品代码中故意改动 7 处接线，每处恰被一条用例捕获，改动随后还原，diff 为空。
- 替身：CS3D core 的 `RenderingEngine`（约 12 个 viewport 方法）与 `init`；tools 的 `ToolGroupManager` 三个函数；自有加载器；jsdom 缺失的 canvas 与 `ResizeObserver`；`fetch`。
- 真实：工具类、annotation 状态、事件总线、坐标换算、`csTools.activateTool`、标注桥、store。
- 限制：不经 CS3D 工具管线驱动真实鼠标事件（需 WebGL），改为触发工具会发出的 completed 事件；验接线，不验像素。
- 脆弱性：中低。`package.json` 为 `^3.33.5`，是范围而非精确版本；替身不带类型，CI 的类型检查不可关闭。
- 结论：D-21 降级不触发，W4 走完整合并。

**SDD 10 Q2 字面量基线：门禁范围内 40 处。**

| 字面量 | frontend | backend | 合计 |
| --- | --- | --- | --- |
| `carotid_imt` | 1 | 1 | 2 |
| `fetal_hc` | 2 | 2 | 4 |
| `ct_abdomen` | 8 | 3 | 11 |
| `pathology` | 7 | 3 | 10 |
| `natural_image` | 10 | 3 | 13 |
| `video` | 0 | 0 | 0 |
| 合计 | 28 | 12 | 40 |

- agent-runtime 为 0 处，仅报告，不计入门禁。40 处全部是 `===`／`!==`／`==` 比较，计数规则见脚本头部。
- 计划外的两处：`backend/app/config.py:126-145` 的五分支字面量链；`backend/app/datasource_registry.py:305` 在标定条件中混入 `modality == "natural_image"`。
- 门禁归零不等于删源用例能过：`ImportPanel.tsx` 的格式白名单、`actions.ts` 中 `setModality`／`noteRecent` 的实参、`config.py` 的 `_available("…")` 属写死的模态数据而非分支比较，不计入门禁，但 SDD 10 §15.1 J 组的删源用例要求一并清除。

### 5. 执行中发现的问题

| # | 问题 | 位置 | 影响 | 处置 |
| --- | --- | --- | --- | --- |
| F-1 | `activeModel` 跨模态泄漏：新模态无活动模型时沿用上一模态的值 | `frontend/src/data/actions.ts:111` | IMT／HC 切到 CT：`method=caroSegDeep` 经 `/task/run` 传到 `science-core/runners/segment_ts_headless.py:44`，该执行器只接受 `totalsegmentator_v2`，CT 分割失败。切到 WSI：method 被当作缓存键与溯源字段，结果标错、既有缓存失效。智能体上下文同样携带错误 method | 已以 `it.fails` 固定；修复方式待定 |
| F-2 | CT 的 `/task/measure` 携旧 `cf` 返回 500 而非 422 | `backend/app/routers/api.py`（只捕获 `ValueError`） | 请求丢失 primitive 的 `path`，science-core 抛出的 `RuntimeError` 未被捕获 | W2 重做测量接口时处理 |
| F-3 | CT 查看器挂载时若 labelmap 已在 store，「跳到器官所在层」被随后的体数据加载覆盖回中间层 | `frontend/src/components/VolumeViewer.tsx` | 初始定位错误，不影响数据 | W4 合并时修复 |
| F-4 | `parseViewer` 接受反向角点（x0 > x1） | `agent-runtime/src/transport/routes.ts:343-352` | 后端 `segment_wsi.py:69` 以「ROI 非正」拒绝，不产生错误结果 | 已以用例固定现状；W5 若加顺序校验需同步改该断言 |

### 6. 对审计 W0 计划的更正

- 第 5 步预期 W1 后 `/image/{ct_id}` 返回 404。W1 会让真实对象的 `/image/{id}` 返回第 0 帧，只有未知 id 在 W1 前后语义一致，因此 xfail 用例按未知 id `ct_999` 编写。SDD 10 未载此预期，无需修订。
- 第 7 步称 `routes.ts:350` 为纯注释，实为报错文案。
- 第 9～10 步已被取代：SDD 10 于 2026-09-22 建立；SDD 04 §7.4 不再先行 `ready`（SDD 10 D-6）；不另建 `docs/designs` 决策理由记录（SDD 10 D-20）。
- 「SDD 联动」中 `2026-08-27-001` 的 D6／D7 状态已在 `cef90e8` 改为由 SDD 10 承接。

### 7. 留给后续波次

| 事项 | 波次 |
| --- | --- |
| 两条 strict xfail 转绿后删除标记 | W1、W2 |
| `test_api.py` 仍依赖 mock 回退（`_a_demo_id()` 兜底 `tech_437`、wall_pair 无数据路径）；D-17 把 mock 改为 dev 模式下显式注册的 `synthetic-us` 后应保持可用，需验证 | W1 |
| 通用导入与缓存测试以 `pathology`／`carotid_imt` 作示例，妨碍删源用例；待 `SOURCES` 支持按能力挑选后改写 | W1 之后 |
| science-core 的 `adapter_kind` 断言升级为「∈ `DETECTORS` 键集合」 | W2 |
| `/objects/{id}/frame` 桩接入各工具测试的假后端 | W5 |
| `objectFocus.test.ts` 的 `it.fails` 翻为 `it` | F-1 修复时 |
