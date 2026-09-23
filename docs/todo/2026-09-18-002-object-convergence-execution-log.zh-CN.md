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
| 新增行为测试在当前代码上通过 | 是。唯一例外是 `activeModel` 跨模态泄漏，W0 准出时以 `it.fails` 固定，随后已修复，见 §5 F-1 |
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
| F-1 | `activeModel` 跨模态泄漏：新模态无活动模型时沿用上一模态的值 | `frontend/src/data/actions.ts:111` | IMT／HC 切到 CT：`method=caroSegDeep` 经 `/task/run` 传到 `science-core/runners/segment_ts_headless.py:44`，该执行器只接受 `totalsegmentator_v2`，CT 分割失败。切到 WSI：method 被当作缓存键与溯源字段，结果标错、既有缓存失效。智能体上下文同样携带错误 method；状态栏在 CT／病理下显示泄漏的 `caroSegDeep` | 已在 W0 后单独修复（`fix(frontend)` 提交）：无活动模型时置 `null`，`SessionState.activeModel` 类型改为 `string | null`；状态栏改为有活动模型才显示模型段，由此消去 `StatusBar.tsx:52` 一处字面量比较，门禁计数 40 → 39；`objectFocus.test.ts` 的 `it.fails` 改为覆盖 CT 与病理的回归用例 |
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

## W1 · 后端数据轴塌缩

执行日期 2026-09-23，基线 HEAD `02c4e1e`。状态：代码与门禁完成，待维护者审阅；§4 的五项待决偏差未经拍板前不回写 SDD 10 契约节。

### 1. 基线（改动前）

| 项 | 结果 |
| --- | --- |
| backend | 241 通过 + 2 xfailed |
| 字面量门禁 | 39（frontend 27、backend 12） |
| 本机数据 | CUBS、HC18 真实数据在；CT、WSI、natural 为仓库自带演示数据 |

### 2. 准出门禁

| 门禁 | 结果 |
| --- | --- |
| `make test`（含 `test-version`） | 绿：agent-runtime 31 文件 / 205；frontend 35 文件 / 210；backend 279 + 1 xfailed；science-core 169；version 5 |
| `make lint` | 绿 |
| strict xfail「未知 id → 404」 | 转绿，标记已删；剩余一条（CT `/task/measure` 携 voxel 标定）归 W2 |
| 新旧 meta 逐字段 diff | 空。旧代码与新代码各跑一遍 `/images`，逐对象比对旧响应的全部字段：真实数据 carotid 100、HC 999、CT 1、WSI 2、natural 4；无数据（CUBS / HC18 / CT / WSI / natural 根全空）下合成 carotid 40、HC 10。新增键：`kind`、`source_id`、`display_name`、`axes`、`calibration`、`resources`、`streams`、`meta` |
| 删一个 Source | 通过。改 `_MODULES` 去掉一行（video / natural / wsi 各一次）后后端正常启动，`/datasources`、`/capabilities`、`/tasks` 200，该模态从 `/datasources`、上传受理表消失；进程内等价用例 `test_dropping_a_source_removes_modality_everywhere` 另验 `/images` 与 `/capabilities` 数据集卡。ImportPanel 仍是前端白名单，W3 改读 `importable` 后才会同步消失 |
| 视频零改清单 | 通过。`datasource_registry.py`、`config.py`、`routers/annotations.py`、`upload_store.py`、`routers/uploads.py` 的新增行中无任何视频专属内容（grep `video/vid-/mp4/webm/av` 零命中）；视频相关改动只在 `dataset_video.py`、`sources/__init__.py` 一行登记、`schemas.py` 的 `Modality` 追加一值、`pyproject.toml` / `uv.lock`。说明：W1 是同一提交内先泛化核心、再接视频，没有单独的「只加视频」diff，结论以逐文件 grep 为据 |
| 不变量 | `MODALITIES == tuple(SOURCES)`；每个 Source 满足协议十个方法；`Modality` Literal 与 `SOURCES` 同集；受理表只由 `formats` 汇总（`test_sources.py`） |
| `check-modality-literals.sh` | 门禁总数 39 → 27；backend 12 → 0（含 `datasource_detect.py`、`config.py` 五分支、`datasource_registry.py:305`、`api.py` 四分支）；frontend 27 不变 |
| 前端与 agent-runtime 零改 | 是，`git diff --stat -- frontend agent-runtime science-core` 为空；`chatEdition.test.tsx`（1）与 `chat-edition.test.ts`（3）绿 |
| `test_api.py` 在无真实数据下可用 | 是。CUBS / HC18 根置空后跑全套 backend：`test_api.py` 经 `synthetic-us` / `synthetic-hc` 全绿，唯一失败 `test_models_include_both_modalities` 在旧代码同样失败（见 §5 F-9） |
| 性能 | `/images` 热请求：carotid 100 张 16 → 30 ms（新增逐张读 tiff 头取 `axes`）；HC18 999 张 5400 → 56 ms（旧路由每张经 `hc_dataset._route` 反复查注册表）；其余模态持平 |
| 视频与音频验收 | 测试内用 PyAV 合成两段 12 帧 / 10 fps / 64×48 的 mp4，一段带 16 kHz 单声道 AAC。有音轨 → `streams` 恰一条 audio（sample_rate 16000、channels 1、duration_ms≈1200、codec aac）且下发 `resources.audio`；无音轨 → `streams=[]`、无 `audio` 键；两者 `axes` 与 `calibration` 相同。逐帧解码 t=0/5/11 的灰度与合成值误差 ≤ 12；越界 t、对 video 传 z 均 ValueError；上传 mp4 推断为 video、魔数错按 corrupt、同批 png 按 unsupported_type 拒；缺 PyAV 时 probe 为 False、列表为空、其余模态不受影响（`test_video.py` 9 条） |
| 音轨不被消费 | `rg "resources\.audio|streams\[" frontend/src agent-runtime/src` 零命中 |

### 3. 改动清单

| 文件 | 改动 |
| --- | --- |
| `backend/app/sources/base.py`（新） | `Source` Protocol、`SourceBase`、`ObjectRef`、`resources_for`、`backfill_legacy`（过渡字段单向回填）、通用取帧（缺省索引、`check_index`、roi 裁剪、size 缩放、窗宽窗位、`ReferenceFrame`） |
| `backend/app/sources/__init__.py`（新） | 惰性 `SOURCES`；`_MODULES` 六行登记，某模块导入失败则跳过并 warning |
| `backend/app/dataset.py`、`hc_dataset.py`、`dataset_ct.py`、`dataset_wsi.py`、`dataset_natural.py` | 末尾追加 Source 实现与 `SOURCE = …`；既有函数体零改。CT / WSI 的标定探测由 `datasource_detect.py` 迁入 `detect_calibration` |
| `backend/app/dataset_video.py`（新） | VideoSource：PyAV 惰性导入、`vid-` id 派生、解复用探测（帧数、帧率、time_base、音轨）、按 t 解帧（LRU）、raw、帧率标定探测 |
| `backend/app/schemas.py` | `Axis` / `Calibration` / `Stream` / `Index` / `Region` / `ReferenceFrame` / `ObjectMeta`（含 `axis()`、`check_index()`）；`ImageMeta = ObjectMeta`；`Modality` 追加 `video`（仍为 Literal）；`DataSourceInfo` 增 `kind` / `label` / `label_key` / `importable` |
| `backend/app/datasource_registry.py` | `MODALITIES` 惰性等于 `tuple(SOURCES)`；内置源改由 `builtin_sample()`、状态由 `probe()`；开发者模式合成源；`active_sources`；`resolve_object` + 索引（`invalidate_index`）；`register_folder` 校验 `SOURCES` 键、`calibration_required` 取代 `natural_image` 字面量；`_invalidate_dataset_caches` 遍历 `Source.invalidate()` |
| `backend/app/caches.py` | 删除，并入 `Source.invalidate()` |
| `backend/app/config.py` | `root_has_data` 改为 `SOURCES[m].probe` 薄 alias，五分支删除 |
| `backend/app/datasource_detect.py` | 只剩按 `SOURCES` 分派 |
| `backend/app/upload_store.py` | 受理表由 `SOURCES[*].formats` 汇总并按 offset 校验魔数；`modality_of()`、`magic_prefix_len()`；`is_supported_file(path, modality=None)` |
| `backend/app/routers/api.py` | `/images` 改 `SOURCES` 一行、删 mock 回退；`/image/{id}` 改 `resolve_object → Source.frame(Index())`、删前缀判别与 `mock.synthetic_png`；`/volumes`、`/slides` 内部改走同一列表函数（守卫不变）；`/datasources` 系列下发 `info()` |
| `backend/app/routers/annotations.py` | `_dims_for` 改 `resolve_object` + `axes`；`_plugin_for` 改按 `resolve_object(id).modality` 查 `REGISTRY` |
| `backend/app/routers/uploads.py` | 模态由受理表推断；回执 id 由 `Source.derive_id` 派生 |
| `backend/app/mock.py` | 不再作隐式回退；`dataset()` 改返回 dict，供 `synthetic-us` |
| `backend/app/segment_ts.py` | 现算输入改 `dataset_ct.nifti_path`（审计 DEBT-26 的静默错误） |
| `backend/pyproject.toml`、`uv.lock`、`Makefile` | 可选 extra `video = ["av>=14.0"]`；`make install-backend` 装 `.[dev,video]` |
| `scripts/dev/health.sh`、`restart-backend.sh` | 健康判据改为 `/datasources` + `/capabilities` |
| 测试 | 新增 `test_sources.py`（25）、`test_video.py`（9）；`conftest.py` 增 `probe_only` fixture 与每用例作废索引；`test_annotations.py` 目标改为 tmp 下导入的 800×600 图（原用任意未知 id），新增未知目标 422 与 axes 边界两条；`test_cache_invalidation.py`、`test_datasource_registry.py`、`test_datasource_samples.py` 的打桩点由 `config.root_has_data` 改 `probe_only` |
| 文档 | SDD 08（数据轴入口冻结口径、§6.4「SOURCES 与 DataSource 的关系」、上传模态推断、规则 5/7/9/11、§9.3、§13、D-2）；runbook `datasource-registry.md`；`architecture.zh-CN.md`；`backend/README.md`；`backend/CHANGELOG.md`；SDD 10 §0 与索引状态 |

### 4. 待维护者决定的偏差

| # | 偏差 | 原因 | 建议 |
| --- | --- | --- | --- |
| P-1 | `ObjectMeta` 保留顶层 `center` 与 `methods: list[str]`，未按 §9.2 改为 `meta.center` 与 `methods: [{name, role}]`；§15.1 A 的「过渡期键集合」因此多 `center`、`streams` 两键 | 前端 `SideBar.tsx:200-201`、`TitleBar.tsx:11`、`Editor.tsx:20` 直读二者，W1 要求前端零改 | 两者列为过渡物，随 W3 前端改读 `meta` / `methods[].role` 时切换形状；§15.1 A 的过渡期键集合补 `center`、`streams`（`streams` 在 §9.2 本就是长期字段，A 组首条漏列） |
| P-2 | `SourceBase` 在 Protocol 之外多了 `synthetic_sample()`、`derive_id()`、`locate()`、`calibration_required`、`supports_window` / `default_window`、`label` | 合成源注册、上传回执 id、`is_mine` 兜底取数据源、`register_folder` 去 `natural_image` 字面量、CT 窗位，都需要一个挂点 | 在 §9.2 的 `SourceBase` 草图中补这几项；Protocol 本身不变 |
| P-3 | 合成源与真实源互斥：`synthetic-us` / `synthetic-hc` 只在同模态无其他 active 源时为 active | 合成颈动脉 id `tech_436`～`tech_475` 落在 CUBS 演示区间 `tech_401`～`tech_500` 内，同时 active 会让同一 id 指向两张图，违反 §10「resolve_object 恒等」。互斥在 `/datasources` 上可见（让位时为 `empty`），不是端点内的隐式回退 | 在 §4.1 / §11.2 写明互斥规则；或改为合成 id 换前缀（需同时处理 D-7「不规范化既有 id」） |
| P-4 | 登记方式是 `sources/__init__.py` 的 `_MODULES` 显式列表，不是模块导入时自登记 | 自登记需要有人先导入模块，且导入顺序决定 `MODALITIES` 顺序；显式列表同时就是「删一行」的删源用例 | §8.2「唯一写入者」改述为「各模块末尾定义 `SOURCE`，由 `_MODULES` 按序登记」；§15.1 J 的「新增 Source 改动文件数 ≤ 3」相应变为 `dataset_<m>.py` + `_MODULES` 一行 + 依赖文件（`pyproject.toml`、`uv.lock`），W7 放宽 `Modality` 前另加 `schemas.py` 一值 |
| P-5 | `scripts/version_matrix.py` 未改 | 该脚本只校验五个版本事实源及锁文件中的项目版本镜像，不感知依赖；新增 `av` 后 `uv.lock` 中 `glaux-backend` 版本不变，`make test-version` 绿。SDD 10 §14 与 §15.1 J 以为引入依赖须改它 | §14 公共规范 01 一条改为「须同提交更新 `uv.lock` 并通过 `make test-version`」，§15.1 J 的文件清单去掉 `version_matrix.py` |

### 5. 执行中发现的问题

| # | 问题 | 位置 | 影响 | 处置 |
| --- | --- | --- | --- | --- |
| F-5 | CT 标注范围校验把 NIfTI 形状 (X, Y, Z) 当 (Z, Y, X) 解包，宽度取成 Z | 原 `routers/annotations.py:89` | `ct_001` 为 122×101×112，x 上界被取成 112 | 已修：改读 `axes` 的 x / y |
| F-6 | 真实 HC18 在时，未列出的合成 id（如 `hc_001`）经 `/image` 仍返回合成图 | 原 `routers/api.py:375` | 列表与取图不一致 | 已随 `resolve_object` 消除：现 404 |
| F-7 | `/image/{id}` 行为随 W1 变化：CT 返回第 0 层轴状位 PNG（原 404）；slide 返回 422（需 level，取帧在 W2）；无数据时 `/images?modality=pathology` 返回 `[]`（原 503） | `routers/api.py` | 符合 SDD 10 §5.3 / §13；前端空态下不发这些请求 | 记录。CT 帧的方向（未做放射学翻转）需在 W2 与查看器对齐 |
| F-8 | `mock.synthetic_png` 用 `hash(image_id)` 取种子，受 `PYTHONHASHSEED` 影响，跨进程字节不同 | `app/mock.py` | 合成图非确定；不影响契约 | 未改（既有行为），W2 若需字节等价断言再换稳定哈希 |
| F-9 | 无 CUBS 数据时 `/models` 走 `mock.models()`，缺 HC 模型，`test_models_include_both_modalities` 失败 | `routers/api.py` `/models`、`kernel.models()` | 旧代码同样失败；CI 若无 CUBS 数据会红 | 归 W2（`models()` 由 `Detector.methods()` 汇总时一并去掉 mock） |
| F-10 | `DataSourceInfo.status` 没有 `unavailable` 取值，SDD 10 §12 / §13「`/datasources` 标 unavailable」无处落地 | `schemas.py` | 缺 PyAV 时：内置源显示 `empty`；已导入的 video 源因探不出帧率显示 `needs_calibration`，且不列对象 | 待定：增枚举值（前端 `DataSourceStatus` 同步）或把 §12 / §13 改述为「非 active」 |
| F-11 | `resources` 下发的 `/objects/{id}/*` 端点在 W2 才存在；前缀未定（`kernel.py` 的 labelmap `ref` 带 `/api`，SDD 10 §5.1 示例不带） | `sources/base.py` `resources_for` | W1 无消费者 | W2 建 `/objects` 时一并定前缀 |
| F-12 | 删 pathology 后 `/tasks` 仍含 `nuclei_detection` 行，`test_every_task_row_contract` 会因其 modality 不在 `MODALITIES` 而失败 | `REGISTRY` 与 `SOURCES` 相互独立 | 删源用例「与该模态无关的用例全绿」成立，但任务轴对数据轴无感知 | 归 W2：`/tasks` 是否过滤无数据源模态的任务行 |

### 6. 留给后续波次

| 事项 | 波次 |
| --- | --- |
| §4 的 P-1～P-5 拍板后回写 SDD 10 §4.1 / §8.2 / §9.2 / §14 / §15.1 | W1 审阅后 |
| `kernel.py` 仍有 wall_pair 无数据 mock 边界与 `hc_dataset` 真实优先路由；`/models` 仍回退 `mock.models()` | W2 |
| slide 取帧（level + roi + 64 Mpx 上限）与 `/objects` 端点族 | W2 |
| `/volumes`、`/slides` 的 503 守卫是否与 `/images` 的空列表语义对齐 | W2 |
| 前端 ImportPanel 改读 `importable`、模态标签改读 `label_key` → `label` | W3 |

### 7. W1 审阅结论

2026-09-23 维护者指示「继续」，未对 §4 提出异议，按建议处置并回写 SDD 10：P-1（`center` / 字符串 `methods` 列为过渡物，W3 切换；§15.1 A 过渡期键集合补 `center`、`streams`）写入 §11.3 与 §15.1 A；P-2 写入 §9.2 `SourceBase` 草图；P-3 写入 §4.1 与 §11.2；P-4 写入 §8.2 与 §15.1 J；P-5 写入 §14。F-10 按「非 active」改述 §4.1、§12、§13，不新增 `unavailable` 枚举值。

## W2 · 后端动作轴与表征面

执行日期 2026-09-23，基线 HEAD `d6cdbf9`（W1）。状态：代码与门禁完成，待维护者审阅。science-core 与标注库两部分由子智能体并行完成（文件互不相交），其余由主会话完成。

### 1. 准出门禁

| 门禁 | 结果 |
| --- | --- |
| `make test`（含 `test-version`） | 绿：agent-runtime 31 文件 / 205；frontend 35 文件 / 210；backend 332；science-core 213；version 5 |
| `make lint` | 绿 |
| strict xfail「`/task/measure` 携 voxel 标定成功」 | 转绿，标记已删。仓库内已无 SDD 10 的 strict xfail |
| 不变量 | `set(REGISTRY.adapter_kind) == set(DETECTORS)`；每个 Detector 具备协议八项；`GET /models` 等于按 REGISTRY 顺序汇总 `Detector.methods()`（`test_objects.py`）。science-core `test_tasks.py` 不能导入后端，DETECTORS 键集合断言放在 backend |
| 三信封回归 | 通过。以 W1 提交检出的 worktree 为基线，对真实数据逐字节比对：`/task/run` 四任务（IMT、IMT 带列窗、HC、CT、WSI 带 ROI）与 `/task/measure` 的 TaskOutput 完全相同；`Detection.roi_used` 字段名与取值未变；`Detection.region` 只进 `detection_to_dict`，不进 TaskOutput |
| 端点等价 | `/volume/ct_001` 与 `/objects/ct_001/raw`、`/wsi/slide_001/tile/…` 与 `/objects/slide_001/tiles/…`、`/volumes` / `/slides` 与 `/images?modality=` 字节相同；`/volume/ct_001/mask-edit` 与 `/objects/ct_001/edits` 对同一笔编辑响应相同。另与 W1 基线比对：`/volume/*`、`/wsi/*/tile`、`/wsi/*/verify`、`/image/*`、`/models`、`/capabilities` 字节未变 |
| `X-Glaux-Frame` 契约 | 四种 kind 各取一帧并断言 `object_id` / `index` / `origin` / `scale` / `width` / `height`：image（roi + size 缩放）、volume（z = 末层）、slide（最粗 level + roi，scale = 1/downsample）、video（t = 10 + roi，`test_video.py`）。slide 缺 level 422；level-0 roi 81 Mpx → 413；size > 4096 → 413 |
| 标注库迁移用例 | 通过（`test_annotation_store_migration.py` 8 条）：按旧 DDL 手建 v0 库，升级后老数据逐列相同、可写 `point`、索引存在、`user_version = 1`；重开不再迁移；中途失败时原库保持 v0 且可读 |
| 字面量门禁 | 放宽 `Modality` / `TaskType` 为 `str` 后仍为 backend 0、总数 27 |
| 前端与 agent-runtime 零改 | 是；两份 chat edition 测试在全量中绿 |
| 无真实数据环境 | CUBS / HC18 根置空后 backend 332 全绿，W1 的 F-9 随 `models()` 改由 `Detector.methods()` 汇总而消失 |

### 2. 改动清单

| 文件 | 改动 |
| --- | --- |
| `backend/app/detectors/`（新） | `base.py`：`Detector` Protocol、`DetectorBase`、`DetectorUnavailable`、`calibration_result`；`wall_pair.py` / `contour.py` / `volume.py` / `wsi.py`：由 `kernel.py` 四分支、`_enrich_gold`、`models()` 四段、`/volume/{id}/mask-edit` 与 `/wsi/{id}/verify` 的实现搬入；`__init__.py`：`DETECTORS` |
| `backend/app/kernel.py` | `run_task` 只留公共前缀 ①～④ 与信封组装；`measure_task` 收 `Calibration`；`models()` 汇总 `Detector.methods()`；`capabilities()` 的 `_DS_META` 删除，改读 `DataSource.provider/license/desc` |
| `backend/app/routers/objects.py`（新） | `/objects` 五端点；`resolve` / `raw_bytes` / `tile_bytes` / `apply_edit` 供 alias 复用 |
| `backend/app/routers/api.py` | `/volume/{id}`、`/volume/{id}/mask-edit`、`/wsi/{id}/tile` 改 alias；`/volume/{id}/labelmap` 改 `resolve_object`；`/wsi/{id}/verify` 改调 `Detector.verify`；`/task/run` 错误映射（404 / 422 / 503）；`/models` 删 mock 回退 |
| `backend/app/schemas.py` | `Modality` / `TaskType` 放宽为注册表校验的 `str`；`TaskSpec` 增 `calibration` / `region` 与 `_legacy` 映射（warn + `LEGACY_HITS` 计数）；`TaskMeasureRequest` 收 `calibration`（`cf` 过渡）；`Region` 形状校验；`EditRequest` / `EditOp` |
| `backend/app/dataset_wsi.py` | `WsiSource.frame`：OpenSlide level（强制）+ level-0 roi 读块；读出像素超 64 Mpx → `FrameTooLarge`（413） |
| `backend/app/sources/base.py` | `FrameTooLarge` |
| `backend/app/datasource_registry.py` 与四个数据模块 | `DataSource` 增 `provider` / `license` / `desc`（不落盘），由 `builtin_sample()` 提供 |
| `backend/app/mock.py` | 删除 `models()` |
| `backend/app/annotations/store.py`、`routers/annotations.py` | `_KINDS` 增 `point`，CHECK 由常量生成；`PRAGMA user_version` 0 → 1 事务迁移；`AnnotationIn.index`（`z` 别名）；`check_index` 校验第三轴；`GET` 的 `index_from` / `index_to`（SQL 内过滤）；响应行带 `index` |
| `backend/app/main.py` | 挂载 `objects` 路由 |
| `science-core/glaux_core/calibration/calibration.py` | `CFSource.TIME_BASE`、`resolve_video_calibration`、`calibration_from_dict`（未知 kind → `HardReject` 并记 warning）、`resolve_calibration_for` |
| `science-core/glaux_core/contracts.py` | 各 Primitive 增 `at`（为空不序列化）；`Detection.region` |
| `science-core/glaux_core/tasks.py` | `TaskPlugin` 增 `object_kinds` / `trigger` / `classes`，`viewer` 标 deprecated；CT 行 `classes` + `voi` / `z_scroll`，WSI 行 `on_region` + `classes` + `verify`；`plugin_to_view` 下发三键 |
| 测试 | 新增 backend `test_objects.py`（28）、`test_annotation_store_migration.py`（8），science-core `test_object_convergence_w2.py`（44）；`test_annotations.py` 增 index 相关用例；`test_video.py` 增 video 取帧；`test_api.py`、`test_wsi_segment.py`、`test_datasource_registry.py`、`test_sources.py` 按 404 / 422 新语义与放宽后的类型更新断言；science-core `test_tasks.py` 两处能力位期望 |
| 文档 | SDD 04 §2 / §4 / §7.3 / §7.4 / §9 / §13（§7.4 改为引用 SDD 10 的写契约，D-6）；`architecture.zh-CN.md`；`backend/README.md`；`backend/CHANGELOG.md`；SDD 10 §0 与索引状态 |

### 3. 待维护者决定的偏差

| # | 偏差 | 原因 | 建议 |
| --- | --- | --- | --- |
| P-6 | `DetectorBase` 在 Protocol 之外多 `enrich(out, ref, obj, spec, cal)` 与 `hydrate(primitives)`；`verify` 多关键字参数 `method` | `reference()` 只能给出参考 Detection，但 IMT 的 vs A1（µm、1 位小数）与 HC 的 vs GT（mm、2 位小数，参考值是标量）口径不同，泛化计算会改变 TaskOutput 字节；`/task/measure` 收到的 VolumeMask 只带 URL，需要补回本地路径才能重测（W0 的 F-2） | §9.2 的 Detector 草图补这两个挂点 |
| P-7 | 公共前缀④只做「显式 `calibration` 优先、缺省取 `obj.calibration`」并校验，`CalibrationResult` 仍由 Detector 构造；`mm_per_px` 保持收敛前的 `source=cubs`、空 provenance 形状 | 让 TaskOutput 逐字节不变；若直接用 `calibration_from_dict` 的结果，provenance 会多出 `cf` / `source` 两键 | §6.3 的④改述为「解析并校验标定，填入 spec」 |
| P-8 | §9.4「无 TaskView 模态的能力位默认集经 `GET /capabilities` 下发」未实现 | `GET /capabilities` 是能力市场卡片列表，没有承载「某模态的能力位」的位置；唯一消费方是 W3 的前端工具过滤 | 在 W3 定下发形状（例如 `/datasources` 元素增 `capabilities`，或 `GET /tasks` 之外的只读视图）后实现，§9.4 随之写明载体 |
| P-9 | `EditRequest.base_seq` 必填，但 alias `/volume/{id}/mask-edit` 的旧契约允许 `null`（不做乐观并发校验），alias 以 `model_construct` 绕过必填校验 | 保持旧端点行为不变 | W7 删 alias 时一并消失，无需改契约 |

### 4. 执行中发现的问题

| # | 问题 | 位置 | 影响 | 处置 |
| --- | --- | --- | --- | --- |
| F-13 | 合成颈动脉的 `/task/run` 标定由恒定 `CF_CANONICAL = 0.0559` 改为该合成对象自身的 cf（`0.0559 + 0.0004·sin(i)`） | `detectors/wall_pair.py` | 仅开发者模式无 CUBS 数据时；IMT 数值随 id 小幅变化 | 有意：列表下发的 cf 与任务所用标定一致。真实数据路径 TaskOutput 不变 |
| F-14 | `/task/run` 对「任务几何族与对象一致但数据集不符」（如 HC 任务 + 颈动脉图，两者都是 image）仍靠 `ContourDetector` 内的 `hc_dataset.is_hc` 拒绝（422） | `detectors/contour.py` | `object_kinds` 门控不足以区分同几何族的不同数据集 | 保留为 Detector 的取数前提（它确实取不到数）；若将来要在前缀里判定，需要任务声明可接受的数据集，属新契约 |
| F-15 | 未注册模态的 `GET /images?modality=` 由空列表变为 422 | `schemas.Modality` 放宽为注册表校验 | 删源用例中该模态查询返回 422 而非 `[]` | 符合 §13（非法输入 422）；`test_sources.py` 已按此断言 |
| F-16 | CT 取帧只做轴状位转置，未做放射学方向翻转 | `dataset_ct.CtSource.render` | agent 观测与查看器可能左右 / 上下相反 | W4 查看器合并时与 `VolumeViewer` 实测对齐 |
| F-17 | `glaux.annotation_proposed` 事件的 `z` → `index`（SDD 10 §12、SDD 02） | agent-runtime | 本波 runtime 零改 | 归 W5（`propose_annotation` 加 `index`） |

### 5. 留给后续波次

| 事项 | 波次 |
| --- | --- |
| P-6～P-9 拍板后回写 SDD 10 §6.3 / §9.2 / §9.4 | W2 审阅后 |
| 前端改读 `resources`、切到 `/objects/*` 与 `MaskSink` | W3、W4 |
| 能力位默认集的下发载体（P-8） | W3 |
| `/volumes`、`/slides` 的 503 守卫与 `/images` 空列表语义对齐 | W7 删 alias 时一并处理 |
| `hc_dataset` 真实优先路由函数仍被 `ContourDetector.detect` 的 `is_hc` 前提使用 | W3 之后，随 HC 数据源多源化 |

### 6. W2 审阅结论

2026-09-23 维护者授权按最合理方式处置 §3 四项：

| # | 处置 |
| --- | --- |
| P-6 | 接受。`enrich` / `hydrate` 作为 `DetectorBase` 挂点、`verify` 的 `method` 关键字参数写入 SDD 10 §9.2 |
| P-7 | 接受。SDD 10 §6.3 的④改述为「显式标定优先、缺省取对象标定，校验后填回 spec」，并写明 `mm_per_px` 保持收敛前形状的理由 |
| P-8 | 不再推迟，本波落地：载体为 `GET /datasources` 元素新增的 `default_capabilities`，由 `datasource_registry.default_capabilities(modality)` 唯一判定（有 TaskPlugin 为空，否则取 `Source.kind` 默认集，永不合并），用例 `test_default_capabilities_only_for_modalities_without_task`。回写 SDD 10 §5.3 / §9.1 / §9.3 / §9.4 与 SDD 08 §5.1 / §5.2。W3 前端据此过滤无任务模态的工具 |
| P-9 | 接受，不改契约。SDD 10 §5.3 的 mask-edit 行写明 alias 期保留 `base_seq = null` 的旧行为 |

处置后 backend 333 通过，ruff 绿；SDD 10 §0 改为 W0～W2 已准出。

## W3 · 前端状态与动作收敛

执行日期 2026-09-23，基线 HEAD `db84c51`（W2 审阅项落地后）。状态：代码与自动化门禁完成；手工走查待维护者签字（§3）。三拍分三个提交：`520b5d8`（只加不删）、`0356b61`（改消费点）、本节所在提交（删旧 + 文档）。

### 1. 准出门禁

| 门禁 | 结果 |
| --- | --- |
| `make test` / `make lint` | 绿：frontend 36 文件 / 221；agent-runtime 31 / 205；backend 333；science-core 213 |
| 三拍各自可编译、可测 | 是。第一拍后 frontend 210 全绿、消费方零改；第二拍后 221 全绿；第三拍后 221 全绿，`tsc -b` 与 eslint 均干净 |
| W0 行为测试不改断言语义 | 是。`objectFocus.test.ts` 16 条只改了取值方式（`currentObjectId()` 改读 `focus.object_id`）与动作名（`loadObjects` / `openObject`）；唯一调整是「activeModel 跟随模态」用例先显式进入颈动脉模态，因为 store 不再写死 `modality="carotid_imt"`、`activeModel="caroSegDeep"` 初值（DEBT-11） |
| 旧字段 grep | `activeImage|activeVolume|activeSlide|wsiRoi` 在 `frontend/src` 命中 0；`TaskView.viewer` 在 `frontend/src` 产品代码零读点 |
| 5 个测试文件的旧字段 | 已改完：`FocusSidePanel.test.tsx`、`actions.test.ts`（重写为三个动作的用例）、`FocusTopBar.test.tsx`、`SideBar.test.tsx`、`imtWallTool.test.ts`；另改 `SideBar.a11y.test.tsx`、`toolBridge.test.ts`、`viewerEngines.smoke.test.tsx`（只改挂载方式：引擎改从 props 收 object / focus，断言不变）、`annotationTools.test.ts`、`wsiAnno.test.ts`（删 `niftiTarget` 字符串解析用例） |
| `recent.ts` v1→v2 迁移单测 | 新增 `recent.test.ts`：空、旧（补 kind、推断不出丢弃、写 v2 删 v1、只迁一次）、脏（v1 非法 JSON、v2 结构不符） |
| 字面量门禁 | 门禁总数 27 → **0**（frontend 27 → 0，backend 0）；随后 `Modality` / `TaskType` 放宽为 `string`，门禁仍为 0（D-14 顺序满足） |
| chat 版 | `chatEdition.test.tsx` 与 `chat-edition.test.ts` 在全量中绿；ChatShell 路径未改 |
| 音轨不被消费 | `rg "resources\.audio|streams\[" frontend/src agent-runtime/src` 零命中 |

### 2. 改动要点

| 面 | 改动 |
| --- | --- |
| store | 四槽 + `wsiRoi` + 四份列表 + `imageMeta` 删除，收成 `focus` + `objects`（缺键 = 未加载，空数组 = 已加载为空）；写入口只有 `setFocus` / `setIndex` / `setRegion`；`activeObject()` / `objectsOf()` 派生；`modality` / `activeModel` 初值 `null`；`setModels` 取当前模态的 active 模型，不兜底 |
| actions | `loadObjects(modality, {open?})` / `openObject(id, modality?)` / `runTask(region?)`；触发 = `TaskView.trigger ?? "manual"`；`runTask` 下发对象 `calibration` 与 `region`，不再发 `cubs_cf` / `roi_box`；结果回来前已切走的对象丢弃结果 |
| 查看器 | `Viewer.tsx` 按 `ObjectKind` 查表、缺键渲染 i18n「查看器引擎尚未接入」，是查看器树中唯一读当前对象处；三个引擎改从 props 收 `object` / `focus`，渲染逻辑未动；`csAnno` 的 imageId 字符串解析删除，落库目标由焦点给出 |
| 标签与文案 | 模态标签改由 `/datasources` 的 `label_key` → `label` → `modality` 取（D-22），新增 `modality.*` 六个 i18n 键；示例卡与舞台空态改领域中立措辞 |
| 文件栏 | 目录改为「对象 / 方法」，方法按 `methods[].role` 标 gold / agent；去掉按模态写死的 `LIMA-Profiles` / `CF` / `Folds` 等目录名与数据集名回退 |
| 导入面板 | 上传受理后缀取 `/datasources` 的 `importable` 并集；文件夹导入候选取几何族为 volume / slide 的任务的模态 |
| 智能体 | `toViewerContext` 下发 `{collection, task, method, object, focus}`，另带过渡字段 `image_id` / `modality` / `cubs_cf` / `roi_box`（runtime 在 W5 前只读它们）；`toolBridge` 比对 `focus.object_id` |
| 后端（P-1） | `ObjectMeta.methods` 改 `[{name, role}]`，顶层 `center` 删除（只留 `meta.center`） |
| 类型 | 前端 `ObjectMeta` 不再声明 `cf` / `voxel_spacing_mm` / `mpp_um` / `dims`，读取即 `tsc` 失败——§7 规则 8 的「lint 禁读」以类型检查落地（`npm run lint` 含 `tsc -b`） |

### 3. 回归走查

自动化部分：在隔离端口（backend 18000、vite 15173；临时数据源清单与标注根，不触碰 `~/glaux_datasets/sources.json`）起真实前后端，用 Playwright 无头 Chromium 逐个模态切换，记录 `/task/run` 请求与控制台错误并截图（截图在会话 scratchpad，未入库）。

| # | 场景 | 自动化观察 | 维护者签字 |
| --- | --- | --- | --- |
| 1 | CUBS 2D | 打开 `tech_401` 即跑 `far_wall_cca_imt`，请求带 `calibration{mm_per_px}`、无旧字段；LI/MA 叠加与 IMT 度量渲染；标题 `tech_401 — CUBS-tech · carotid US`；方法目录 caroSegDeep 标 agent | 待签 |
| 2 | HC18 | 切换即跑 `fetal_hc`（`000_HC`），`calibration{mm_per_px}` | 待签 |
| 3 | CT 逐层 | 切换即跑 `totalseg_liver_kidney`，`calibration{voxel_mm}`；查看器挂载无错误。逐层滚动、画笔未自动化 | 待签 |
| 4 | WSI ROI | 打开 `slide_001` 不自动跑（`on_region`）。查看器挂载时 Annotorious 报 `unsafe-eval` 崩溃（F-18，W2 提交上同样复现，非 W3 回归）；框选 ROI 未能走到 | 待签（需真实浏览器） |
| 5 | 自然图像不自动跑 | 打开 `natural_cat` 无 `/task/run` 请求 | 待签 |
| 6 | video 对象 | 导入合成 mp4 后切到「视频」，舞台显示「查看器引擎尚未接入：video」，无未捕获错误 | 待签 |

### 4. 待维护者决定的偏差

| # | 偏差 | 原因 | 建议 |
| --- | --- | --- | --- |
| P-10 | `toViewerContext` 在新五字段之外继续下发 `image_id` / `modality` / `cubs_cf` / `roi_box` | runtime `parseViewer` 在 W5 之前只认旧字段，前端单发新字段会让智能体拿不到当前对象；runtime 忽略未知字段，双发安全 | 已回写 SDD 10 §11.3：该过渡物自 W3 起由前端双发，W5 runtime 切换，W7 删除 |
| P-11 | `imtWallTool` 的对象 id 取自 store 的 `focus`，不是审计所写的「工具配置」 | 工具配置的注入口是 W4 的 `registerTaskTool`；W3 只需去掉 `activeImage` 读点保证可编译 | W4 随 `registerTaskTool` 改为配置注入 |
| P-12 | `VolumeViewer` 仍持有组件本地 `z`，每次变化经 `setIndex({z})` 写入焦点 | 审计 W3 规定引擎「只换取值来源，不改渲染逻辑」；本地 z 并入 `Focus.index` 属 W4 引擎合并 | W4 删除本地 z（§7 规则 4） |
| P-13 | ImportPanel 在没有任何数据源时不知道受理表，只按大小预筛、类型交给后端判定 | 空态下 `/datasources` 为空，`importable` 无从取得；不在前端另存白名单 | 如需空态也预筛，可让后端在 `GET /datasources` 之外提供受理表（新端点，需改 SDD 10 D-5），当前不建议 |
| P-14 | 模态切换器与顶栏 chip 的标签由任务名（如「颈动脉远壁 IMT」）变为模态名（「颈动脉超声」） | D-22：标签属数据源展示属性，无任务的模态无法取任务名 | 接受；如需保留任务名，另议显示位置 |
| P-15 | 文件栏去掉按数据集写死的目录名（`LIMA-Profiles`、`CF`、`Folds`、`natural-images` 等），统一为「对象 / 方法」 | 这些目录名只对 CUBS 成立，是 DEBT-20 的一部分 | 接受 |

### 5. 执行中发现的问题

| # | 问题 | 位置 | 影响 | 处置 |
| --- | --- | --- | --- | --- |
| F-18 | WSI 查看器挂载时 Annotorious（pixi）因 CSP 禁 `unsafe-eval` 抛错，被 ErrorBoundary 接住，查看器区域不可用 | `frontend/vite.config.ts` 的 CSP（`c9b153b` 起）与 `@annotorious/openseadragon` | 无头 Chromium 下在 W2 提交同样复现，非 W3 引入；真实浏览器是否复现待确认 | 待维护者在真实浏览器确认；若复现，可在 WSI 路径引入 `@pixi/unsafe-eval` 或调整 CSP，属独立修复 |
| F-19 | P-8 下发的 `default_capabilities` 尚未被前端工具过滤消费，无任务模态（通用图像、视频）仍无标注工具按钮 | `ViewerChrome` / `StagePanel` 的工具列表来自 `TaskView.tools` | 与 W3 前行为一致 | W4 抽 `useTaskTools()` 时按 `ALWAYS ∪ capabilities` 接入 |
| F-20 | 前端 `Modality` 放宽为 `string` 后，后端下发的 `video` 等新模态无需前端改类型即可出现 | `api/types.ts` | 符合 §15.1 J「前端零专属代码」 | 记录 |

### 6. 留给后续波次

| 事项 | 波次 |
| --- | --- |
| P-10～P-15 审阅；F-18 真实浏览器确认 | W3 审阅 |
| `registerTaskTool` 注入壁线工具的对象 id（P-11）、本地 z 并入 `Focus.index`（P-12）、`useTaskTools()` 消费 `default_capabilities`（F-19）、前端改读 `resources` 与 `/objects/*` | W4 |
| runtime 改读 `object` / `focus` 后前端停发过渡字段（P-10） | W5 / W7 |

### 7. W3 审阅结论

2026-09-23 维护者授权按最佳实践处置 §4、§5：

| # | 处置 | 理由 |
| --- | --- | --- |
| P-10 | 接受 | 双发只存在于 W3～W4，runtime 忽略未知字段；已写入 SDD 10 §11.3，W5 切换、W7 删除 |
| P-11 | 接受，W4 实现 | 工具配置注入依赖 `registerTaskTool`，提前做会在 W4 返工 |
| P-12 | 接受，W4 实现 | 与审计「W3 引擎只换取值来源」一致；层号已同步进焦点，智能体上下文不受影响 |
| P-13 | 接受 | 受理表只在后端一处（§7 规则 19 同理），空态预筛交给后端权威判定；不为此新增端点 |
| P-14 | 接受 | D-22 的直接结果；任务名仍在 HUD 与度量面板显示 |
| P-15 | 接受 | 目录名属于 CUBS 数据集约定，留在核心即 DEBT-20 |
| F-18 | 另立待办 [2026-09-23-001](2026-09-23-001-wsi-annotorious-csp.zh-CN.md)，不阻塞 W3 准出 | 非 W3 引入（W2 提交同样复现）；根因是 Annotorious 内嵌 pixi 与 CSP 冲突，与对象收敛无关。先真实浏览器确认，再独立提交降级修复，根治随 W4 `PyramidViewer` |
| F-19 | W4 实现 | `useTaskTools()` 属 W4 范围（SDD 10 §8.3） |

W3 准出：自动化门禁全部通过；手工走查场景 1、2、5、6 已有自动化证据，场景 3（CT 逐层画笔）与场景 4（WSI ROI，受 F-18 阻塞）仍需维护者在真实浏览器签字，签字结果追加于此。SDD 10 §0 改为 W3 已准出（走查签字待补）。

## W4 · 查看器引擎收敛（进行中）

按 [W4 设计记录](../plans/2026-09-23-object-viewer-w4-design.md) 分段实施。起点 `6a58dc8`：`viewerEngines.smoke.test.tsx` 6/6 通过，前端 lint 通过。

| 段 | 已完成 | 验证 |
| --- | --- | --- |
| 共用接线 | 2D 与 CT 共用 mask PNG、画笔缓冲、CS3D 挂载生命周期和叠加画布监听 | 原有 smoke 6/6、前端 lint 通过 |
| 工具装配 | `useTaskTools()` 供 Workbench 与 Focus 共用；有任务只读任务能力位，无任务读数据源 `default_capabilities`；2D 引擎也消费同一能力位（F-19） | 工具装配与 Chrome 定向测试、原有 smoke、前端 lint 通过 |

待完成：`FrameSource` / `MaskSink`、`FrameStackViewer` 合并、`PyramidViewer` 替换 Annotorious、`registerTaskTool`、快捷键数据化与全量门禁。W4 尚未准出。
