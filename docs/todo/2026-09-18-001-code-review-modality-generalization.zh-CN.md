---
kind: record
status: open
title: "review: 模态通用化技术债审计（战略转向 · 视频接入前）"
type: review
created: 2026-09-18
scope: 全仓 frontend / backend / science-core / agent-runtime 中与模态相关的抽象
---

> **用途**：在接入第六个模态（视频）之前，定位「模态不是一等抽象」所派生的全部代码债，给出目标抽象与分波清理计划。本文件是记录（record），正文只写结论；执行过程中的 grep 基线、git diff 零改清单、手工回归签字表另落 `docs/todo/2026-09-18-002-object-convergence-execution-log.zh-CN.md`（第 0 波开工时建立）。
> **日期**：2026-09-18 执行，2026-09-20 归档。
> **基线**：HEAD = `96a1ef0`（docs(governance): 为 docs 下文档补齐 kind 与 status frontmatter）。
> **触发**：纲领 v2 战略转向（领域 = 图像与视频，身份 = harness）；视频是 2026-08-27 审计 D6/D7 等待的第六个模态。
> **方法**：Read/Grep/Glob 只读审计，不改代码、不跑测试；每条结论给 file:line 与原文引用；事实核验与价值核验两轮，再做归并与评分。
> **半衰期提醒**：本文件的债务明细与计划在第 7 波（过渡物清除）完成后即失效，届时以 SDD 10 为准。2026-12 前若未开工，行号需重新核对。

---

## 1. 一页纸

### 问题

同一个语义在三层各有多份并列副本。「当前打开的对象」在前端是三个互斥槽（`frontend/src/store/session.ts:226-229`），在后端是三套 ID 判别约定（前缀正则 / `is_*` 谓词 / mock 回退，`backend/app/routers/api.py:369-382`），在 agent-runtime 是两个摊平的领域字段（`agent-runtime/src/contracts.ts:94-101` 的 `cubs_cf` / `roi_box`）。2026-07-07 多模态架构设计本意是「注册表驱动、消灭 if 模态」，但 P6（CT）与 P7（WSI）两个楔子各自塞回了一套并行状态、端点与动作，注册表只落地了任务轴一根。

### 结论

34 条债务全部是楔子期复制粘贴的并列副本，没有一条需要引入新层。最小 diff 是**合并同类项**：把每处「N 份并列」收成「1 份 + 判别字段」。价值核验后，只有 3 条应当单列（DEBT-25 / DEBT-01 / DEBT-02），其余 31 条是目标抽象六个名词的落地清单或验收面，应随对应名词一并交付。

### 最要紧的三件事

| 序 | 事 | 为什么最要紧 |
| --- | --- | --- |
| 1 | 后端数据轴塌缩：`SOURCES[modality]` + `resolve_object(id)` + `ObjectMeta{axes, calibration, resources}` | 它是其余一切的容器；视频作为第六个 Source 落地即可反证协议是否真收敛 |
| 2 | 智能体观测通道：`/objects/{id}/frame`（带 `X-Glaux-Frame`）+ runtime `fetchObservation(focus)` | 今天 agent 对 CT/WSI 的观测空间为零或为假（`backend/app/routers/api.py:378` 返回合成 PNG），这是 harness 身份的第一要素 |
| 3 | 三端同名的 `Focus{object_id, kind, index, region}` | 三槽、四份列表、两份三分支投影、`VolumeViewer` 本地 `z`、`wsiRoi` 全部塌缩到它；视频的帧号也只有它能承载 |

### 健康的部分

science-core 的 `TaskPlugin`/`REGISTRY` 与三信封、后端 `/task/run` `/task/measure` `/tasks` 统一端点、前端 `BottomPanel`/`ViewerChrome` 的注册表泛型渲染、`annotation/bridge.ts` 唯一写桥、SDD 08 的数据轴/任务轴分离——这些方向已对，本次审计不动它们，只换内部分派。

---

## 2. 触发与范围

### 触发

- **战略转向**：`docs/roadmaps/charter.zh-CN.md`（纲领 v2）把领域定为「图像与视频，多模态多格式」，把身份定为 harness（观测空间 / 动作空间 / 验证器 / 回合与轨迹）。§七决策过滤器：更强模型会让它作废的就是负债；加深环境四要素的才值得投。
- **视频是第六个模态**：帧、时间、轨迹、事件也是分析对象。
- **`README.zh-CN.md:39`** 声明工作台、舞台、图谱、分割与测量工具「相关实现保留在源码中，后续以插件交付」——这决定了这些面的债务价值下调。

### 与 2026-08-27 审计 D6/D7 的关系

`docs/todo/2026-08-27-001-code-review-tech-debt-audit.zh-CN.md` 把 D6「datasource_registry 抽象只落地一半」与 D7「模态不是一等抽象，而是散落的 if 阶梯」标为「等第六个模态来了再做」。本审计是这两条的承接：

| 原债 | 关闭条件（本审计给出） |
| --- | --- |
| D6 | `resolve_object` 是唯一对象入口；每模态在 `SOURCES` 中只占一行；删一个 Source 后三端可启动且该模态从 `/datasources` `/capabilities` `ImportPanel` 同时消失 |
| D7 | `set(REGISTRY.adapter_kind) == set(DETECTORS)`；核心目录无模态字面量比较；视频落地时旧字段与 alias 全删 |

### 不做的事

- 不重复 `docs/todo/2026-09-17-001-doc-audit-after-pivot.zh-CN.md` 的文档摸排。文档层过时项已在那份清单里；本文件只在代码抽象需要联动改 SDD/runbook 时点名具体小节。
- 不处理与模态无关的既有债（net-guard SSRF、edition 门控、atlas 选择器、会话压缩）。

### 编号约定

本文件与后续计划使用两套前缀，不互相混用：

- **DEBT-01 … DEBT-35**：本审计的已核验债务条目（即下文表格与明细的 ID）。
- **DEC-1 … DEC-21**：第 7 节目标抽象的设计决策记录。
- **D6 / D7**：仅指 2026-08-27 审计的两条原始大债。

---

## 3. 评分方法

沿用 2026-08-27 审计的公式：

```
分数 = (影响 + 风险) × (6 − 成本)
```

| 维度 | 取值 | 含义 |
| --- | --- | --- |
| 影响 | 1–5 | 不修时，通用化（尤其接视频）要付出的重复劳动与错误面 |
| 风险 | 1–5 | 现状造成静默错误、跨端错位或回归漏网的可能 |
| 成本 | 1–5 | 修复的改动面与回归面（5 = 最贵；故公式中取 6−成本） |
| 视频影响 | blocks / complicates / neutral | 不修时视频接入是被阻断、被加重，还是无关 |

评分取事实核验与价值核验后的修正值。合并项（`merged_from` 有多条）取各分项中位数，两项时取均值向上取整。

---

## 4. 债务总览表

| ID | 债务 | 层 | 视频影响 | 影响 | 风险 | 成本 | 分数 | 核验处置 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DEBT-03 | store 三槽 `activeImage/activeVolume/activeSlide` 是 Focus 的冗余副本；8 处消费点各拼一次 `??` 链 | cross-cutting | complicates | 3 | 3 | 2 | 24 | 并入 Focus |
| DEBT-25 | 对象 ID 判别散落三套约定（前缀正则 / `is_*` 谓词 / mock 回退），缺注册表级解析入口 | backend | complicates | 4 | 3 | 3 | 21 | 单列 |
| DEBT-04 | 标注第三轴 `z` 语义钉死为 CT 层号；`_KINDS` 与 SQL CHECK 双重封闭 | cross-cutting | complicates | 3 | 2 | 2 | 20 | 并入 Focus.index |
| DEBT-09 | 四个 select + 两个 run 按模态分叉，触发策略写在 action 名字里 | frontend-state | complicates | 3 | 2 | 2 | 20 | 并入 openObject |
| DEBT-13 | 三个引擎各自订阅 store 互斥槽、各自重复 `tasks.find(modality)`，无 props 契约 | frontend-viewer | neutral | 2 | 3 | 2 | 20 | 并入 FrameStackViewer |
| DEBT-29 | science-core 无时间基与帧索引；上传魔数表无 mp4/webm；后端无视频解码依赖 | science-core | neutral | 2 | 2 | 1 | 20 | 并入 VideoSource |
| DEBT-30 | `locate_roi`/`propose_annotation` 的观测与回写缺参考帧，只认整幅 2D 位图 | agent-runtime | complicates | 3 | 2 | 2 | 20 | 并入 fetchObservation |
| DEBT-01 | `ViewerContext` 摊平 `cubs_cf`/`roi_box`；游标 `z` 在组件本地、区域是专属字段 | cross-cutting | complicates | 4 | 2 | 3 | 18 | 单列 |
| DEBT-02 | runtime 四个看图工具只会 `GET /image/{id}`；CT/WSI 观测为零或为假；视频无观测入口 | cross-cutting | blocks | 5 | 4 | 4 | 18 | 单列 |
| DEBT-08 | `Modality`/`TaskType` 字面量在三处手抄；前端 28 处 `===` 判等静默走 else | cross-cutting | neutral | 2 | 2 | 2 | 16 | 并入 SOURCES |
| DEBT-10 | 对象列表按模态分四个槽；`prunedRecent` 误删 fetal_hc 最近项；StatusBar 计数错 | frontend-state | complicates | 2 | 2 | 2 | 16 | 并入 loadObjects |
| DEBT-06 | `/volumes`、`/slides` 与 `/images?modality=` 同源；表征 URL 三种形状由前端拼 | cross-cutting | neutral | 2 | 1 | 1 | 15 | 并入 /objects 表征面 |
| DEBT-19 | `ViewerChrome` 选项段按模态字面量显隐；SDD 04 声明的 `voi/z_scroll` 能力位从未下发 | frontend-chrome | neutral | 2 | 1 | 1 | 15 | 并入 CHROME_SEGMENTS |
| DEBT-26 | 五个 dataset 模块靠约定互相镜像；`root_has_data`/`datasource_detect`/`_builtin_specs`/缓存四处按模态 if | backend | complicates | 3 | 2 | 3 | 15 | 并入 SOURCES |
| DEBT-32 | `defaultToolFactory` 是固定 if 序列，只看环境不看对象；提示词按布尔参数拼段 | agent-runtime | neutral | 2 | 1 | 1 | 15 | 并入 ToolProvider |
| DEBT-07 | CT mask-edit 端点绕过 `plugin.measure`、`task` 为单值 Literal、类表硬编码；前端两份画笔宿主 | cross-cutting | neutral | 2 | 2 | 3 | 12 | 并入 /objects/{id}/edits |
| DEBT-12 | `CornerstoneViewer` 与 `VolumeViewer` 的生命周期、overlay、画笔约 300 行同源重复 | frontend-viewer | complicates | 3 | 3 | 4 | 12 | 并入 FrameStackViewer |
| DEBT-14 | 三引擎各自实现投影与绘制；Primitive 的 kind 覆盖按引擎分摊，其余静默丢弃 | frontend-viewer | complicates | 2 | 2 | 3 | 12 | 并入 PAINTERS |
| DEBT-17 | `VolumeViewer` 与 `/volume/mask-edit` 前后端双重写死 `totalseg_liver_kidney` | frontend-viewer | neutral | 1 | 2 | 2 | 12 | 并入 FrameStackViewer |
| DEBT-27 | `_detect_for_spec` 四分支公共前缀未上提；`_plugin_for` 只认 WSI | backend | complicates | 2 | 2 | 3 | 12 | 并入 DETECTORS |
| DEBT-28 | mock 隐式回退让任意 id 都能拿到合成图，行为按模态不一致 | backend | neutral | 2 | 2 | 3 | 12 | 并入 resolve_object |
| DEBT-35 | 测试用例绑定楔子字段名与枚举字面量，重构时成批红灯却不提供回归保护 | tests | neutral | 1 | 2 | 2 | 12 | 降级 |
| DEBT-15 | 「当前对象与第几帧」编码进 `imageId` 字符串再用正则解回；壁线工具自拼 `web:` 前缀 | frontend-viewer | neutral | 1 | 1 | 1 | 10 | 并入 FrameSource |
| DEBT-20 | ExplorerTree/TitleBar 的工作区、目录名、方法名、扩展名按模态硬写特定数据集的值 | frontend-chrome | neutral | 1 | 1 | 1 | 10 | 并入 ObjectMeta |
| DEBT-21 | `ImportPanel` 的 `IMPORTABLE`/`OK_TYPES`/`accept` 是后端白名单的第二份副本 | frontend-chrome | neutral | 1 | 1 | 1 | 10 | 并入 Source.formats |
| DEBT-22 | 工具过滤白名单列举四个 id，新工具落到 `return true` 恒在；`onTool`/hint 三处复制 | frontend-chrome | neutral | 1 | 1 | 1 | 10 | 并入 registerTaskTool |
| DEBT-23 | 同一模态在顶栏显示 "Natural images"、在切换器显示 "General images" | frontend-chrome | neutral | 1 | 1 | 1 | 10 | 并入 Source 协议 |
| DEBT-24 | Focus 示例卡与空状态文案仍是超声/单图措辞 | frontend-chrome | neutral | 1 | 1 | 1 | 10 | 降级 |
| DEBT-31 | runtime 身份与提示词写死 `biomedical image insight`；只会说 "image" | agent-runtime | neutral | 1 | 1 | 1 | 10 | 并入 ToolProvider |
| DEBT-11 | store 的 `modality`/`activeModel` 初值与兜底写死颈动脉，切模态残留旧 method | frontend-state | neutral | 1 | 2 | 3 | 9 | 并入 Focus |
| DEBT-05 | `ImageMeta` 四并列可空标定字段、`TaskSpec` 三并列区域字段；`measure_task` 恒 CUBS | cross-cutting | complicates | 2 | 2 | 4 | 8 | 并入 ObjectMeta |
| DEBT-16 | `WsiViewer` 自带信息条、验证按钮、提示条，49 行内联样式、文案全中文不走 i18n | frontend-viewer | neutral | 1 | 1 | 2 | 8 | 并入 PyramidViewer |
| DEBT-18 | IMT 壁线工具注册与渲染写死在通用层，四处耦合抽不出来 | frontend-viewer | neutral | 1 | 1 | 2 | 8 | 并入 registerTaskTool |
| DEBT-33 | `segment-region` 的取图/过滤/摘要是模块私有函数，新增视觉工具时会被抄一遍 | agent-runtime | neutral | 1 | 1 | 3 | 6 | 并入 fetchObservation |

### 处置规则

- **事实核验决定存在与否**：行号、原文、是否已被近期提交修掉、是否有「通用化前提下仍成立的有意设计」。事实不成立的条目直接进第 6 节，不进本表。
- **价值核验决定处置**：按纲领 §七判断「值得修」，并判断它是独立债还是目标抽象某个名词的落地面。
- **「并入 X」不等于不修**。它的含义是：这条债不单独排期、不单独计分，而是随名词 X 所在的波次一起落地，并作为 X 的**验收面**。例如 DEBT-03 的 8 个消费点就是 Focus 的验收 checklist，DEBT-10 的四个列表槽就是 `loadObjects` 的验收 checklist。漏掉任何一条，对应名词就不算落地。
- **「降级」**指该条不作为架构债处理，改为顺手项或各重构条目的通用约束（DEBT-35 为验收约束，DEBT-24 为一次文案修订）。
- **「推迟」**指等触发条件出现再做。本表无推迟条目；推迟项集中在第 8 节 §8.6。
- 本轮**无「未核验」条目**：34 条全部完成两轮核验。
- **编号空缺**：归并后共 35 条，本表 34 行。DEBT-34（两个 `modality` 同名异义）被事实核验推翻，见第 6 节；该编号保留空缺不复用，以便与核验记录对齐。

---

## 5. 发现明细

### 5.1 cross-cutting

#### DEBT-03 · store 三槽是 Focus 的冗余副本（24 分 · 并入 Focus）

**证据**
- `frontend/src/store/session.ts:226` — `activeImage: string | null; // 2D 模态的当前图（CUBS / HC18 id）`
- `frontend/src/store/session.ts:242` — `imageMeta: ImageMeta | null; // 当前图元数据（cf/methods 或 voxel_spacing_mm）`
- `frontend/src/components/Editor.tsx:19` — `const image = activeImage ?? activeVolume ?? activeSlide;`
- `frontend/src/components/SideBar.tsx:208` — `const activeId = isCT ? activeVolume : isWSI ? activeSlide : activeImage;`
- `frontend/src/agent/toolBridge.ts:89` — `if (s.modality === "ct_abdomen") return s.activeVolume;`

**症状**：同一语义有三个槽，切换时要三处置空（`actions.ts:97-99`、`185-187`）；Editor/StagePanel/FocusTopBar/FocusSidePanel 各写一遍 `??` 链，SideBar 用三元选 `activeId`，toolBridge 与 useConversation 各写一份三分支。另有 `actions.ts:324-336` `reRunActiveModel` 三分支与 `actions.ts:61/69/77` 三处分别读槽。加视频要新增 `activeVideo` 并改 8+ 处；漏一处的后果是静默的：`??` 链把上一模态残留 id 当当前对象。

**为何是债**：三个字段是 P6/P7 楔子各自追加的（注释标 P6/P7）；`Editor.tsx:17-18` 的注释「否则 CT/WSI 因 activeImage 恒 null 永远卡在空状态」本身承认需要统一的「当前对象」概念，却用 `??` 链补丁实现。`FocusTopBar.test.tsx:65` 把该派生逻辑固化进测试。

**建议改法**：`session.ts` 收成 `focus: Focus | null`，提供 selector `activeObject()`；8 处消费点全部改读 selector；`setActiveVolume`/`setActiveSlide`/`setWsiRoi` 删除；`ExplorerTree` 与 `RecentList` 的 `onSelect` 统一调 `openObject(id)`。

**核验备注**
- 事实：11 处 evidence 全部存在且行号准确，近 8 次提交未修；`selectImage`/`selectVolume`/`selectSlide` 各自只设本槽不清他槽，靠调用约定而非结构保证。
- 价值：修法就是 `Focus{object_id, kind}` 的前端半边 + `openObject` 的消费面，单列会让同一名词重复计分；store 里早有事实上的单一槽 `imageMeta`（四条选择路径都写它），过渡期直接读 `imageMeta?.id` 即可去掉 `??` 链，故 cost 由 3 降为 2、video_impact 由 blocks 降为 complicates。**并入 Focus**，8 处消费点作为其验收 checklist。

#### DEBT-04 · 标注第三轴钉死为 CT 层号（20 分 · 并入 Focus.index）

**证据**
- `backend/app/routers/annotations.py:41` — `z: int | None = Field(default=None, ge=0, description="CT 逐切片层号；2D/WSI 为 null")`
- `backend/app/annotations/store.py:33` — `z              INTEGER,`
- `backend/app/annotations/store.py:47` — `CREATE INDEX IF NOT EXISTS idx_annotations_image ON annotations(image_id, z);`
- `science-core/glaux_core/contracts.py:24` — `未来模态（Keypoints / 视频帧掩膜）按需在此追加一个 dataclass +`
- `docs/sdd/feats/04-unified-annotation-toolbox/README.md:179` — `| `z` | INTEGER | 是 | NULL | — | 同上 | CT 逐切片层号；2D/WSI 为 NULL | 前端上下文 |`

**症状**：`Annotation` 只有 `z`，六种 Primitive 全无帧索引，`store._KINDS` 只有 bbox/polyline/mask 且 SQL CHECK 同样钉死。`_check_within_dims` 只校 (w,h)，第三轴越界（含 CT 的 z）静默接受。`VolumeViewer.tsx:309` 按 z 逐层拉标注，视频照抄就是每切一帧发一次请求。

**为何是债**：`z` 是为 P6 加的最小字段；纲领 v2 把「帧、时间、轨迹、事件」列为分析对象，`contracts.py:24` 自己也把视频帧掩膜写成待办。

**建议改法**：API 层 `z` → `index`（存储列保留 `z`，API 保留别名一版）；`_check_within_dims` 改读 `ObjectMeta.axes` 并校验 `index < size`；各 Primitive 加可选 `at: Index`；`GET /annotations` 增 `index_from`/`index_to`；`store._KINDS` 与 SQL CHECK 扩展需带 schema 版本号迁移。

**核验备注**
- 事实：八条 evidence 行号与原文全对；`store.py:34` 的内联 `CHECK(kind IN (...))` 是比 `_KINDS` 更硬的钉死，加 kind 必须改表。
- 价值：`z` 在存储层就是无语义 INTEGER，视频第一波把 `t` 写进它即可跑通，故 blocks 降为 complicates；`Track{keyframes}`/`Event{t0,t1}` 在没有任何 tracker Detector 之前定形属 YAGNI，与 `contracts.py:24` 的「按需追加」策略相悖。**并入 Focus.index**：第一波只做 `z`→`index` 改名与第三轴越界校验，Track/Event 推迟。

#### DEBT-05 · 标定与区域并列字段（8 分 · 并入 ObjectMeta）

**证据**
- `backend/app/schemas.py:64` — `voxel_spacing_mm: list[float] | None = None  # P6：CT 模态用（替代 cubs_cf）`
- `backend/app/schemas.py:27` — `roi_box: tuple[int, int, int, int] | None = None  # P7 WSI：框选 (x0, y0, x1, y1) level-0 px`
- `backend/app/kernel.py:282` — `meas = plugin.measure(det, CalibrationResult(cf=float(cf), source=CFSource.CUBS))`
- `science-core/glaux_core/measurement/ct.py:134` — `if cal.source is not CFSource.VOXEL_SPACING:`
- `backend/app/routers/api.py:268` — `cal = resolve_ct_calibration(dataset_ct.vox_spacing_mm(volume_id))`

**症状**：`ImageMeta` 上 `cf`/`voxel_spacing_mm`/`mpp_um`/`dims` 四个可空并列；`TaskSpec` 上 `cubs_cf`/`roi`/`roi_box` 并列，各只被一个 adapter_kind 分支读。`measure_task` 无论任务都构造 `CFSource.CUBS`，而 `measure_liver_kidney` 要求 VOXEL_SPACING、`measure_nuclei` 要求 MPP。前端 `cf` 是唯一被读取的标定，CT/WSI 下 `BottomPanel.tsx:73` 打印「calibrate → CF — mm/px」误导为未标定。

**为何是债**：science-core 的 `CalibrationResult` 已是通用 `value + source + provenance`，后端 schema 没跟进，仍「每来一个模态加一列」。

**建议改法**：`ObjectMeta.axes: Axis[]` 取代 dims/spacing 并列；`Calibration{kind, value, source, provenance}` 开放集取代四列；`TaskSpec` 改 `{calibration?, region?}`，`Region` 为判别联合；`measure_task` 收 `Calibration`；新增 `calibration_from_dict` 与 `resolve_calibration_for(obj)`。

**核验备注**
- 事实：18 处 evidence 行号与原文全准。`/task/measure` 对 CT/WSI 必 422 是硬失败不是静默错误；且该路径今天无客户端（`taskMeasure` 唯一调用方是 `imtWallTool.ts:126`，CT 编辑走 `/volume/mask-edit` 并在 `api.py:268` 正确解析标定）。
- 价值：并列字段确有，但视频真正需要的是**轴**（`Focus.index.t`、`Region{frame_range}`）而非标定；`Calibration{kind:"time_base"}` 对通用视频属过度设计。与 `ObjectMeta.axes/calibration` + `Focus.region` 1:1 重合。**并入 ObjectMeta**；保留一个可独立处理的小修：`measure_task` 按 `adapter_kind` 选 `resolve_*`（约 10 行）。

#### DEBT-06 · 冗余列表端点与前端拼路径（15 分 · 并入 /objects 表征面）

**证据**
- `backend/app/routers/api.py:152` — `"""P6：CT 体积列表——与 /images?modality=ct_abdomen 同源；分端点便于前端 discovery。"""`
- `backend/app/routers/api.py:304` — `"""P7：WSI slide 列表——与 /images?modality=pathology 同源；分端点便于前端 discovery。"""`
- `frontend/src/api/client.ts:124` — `// labelmap 字节流由后端在 VolumeMask.ref 里直接下发绝对 URL，前端不拼；分割统一走 taskRun。`
- `frontend/src/viewer/openseadragon.ts:27` — `getTileUrl: (level: number, x: number, y: number) => api.wsiTileUrl(slideId, level, x, y),`

**症状**：同一「列对象」有三个入口；同一「取表征」有三种 URL 形状；labelmap 是任务产物却挂在 `/volume` 下。前端因此有四个列表方法，`actions.ts` 的四分支正是被它们牵着走。

**为何是债**：docstring 自认「同源」，分端点只是给前端 discovery 省事；而 `/datasources` + `/tasks` 注册表已承担 discovery，且 `docs/sdd` 下无任何对这些端点的引用，它们不在 SDD 08 冻结面内。

**建议改法**：删 `/volumes`、`/slides`，前端统一走 `api.images(modality)`；新增 `/objects/{id}`、`/objects/{id}/frame|raw|tiles|edits` 作为表征面；资源 URL 由 `ObjectMeta.resources` 模板下发（沿用 `VolumeMask.ref` 已有范式），前端不再拼 `/volume` `/wsi` 路径。

**核验备注**
- 事实：九条 evidence 全准；`/volumes` 函数体与 `/images` 的 ct 分支逐字相同。
- 价值：fix 原文提议新增 `GET /objects` 统一列表，与 SDD 08「`/images?modality=` 是唯一列表端点」冲突，应撤回；瓦片与 NIfTI 原始流是几何 kind 的本质差异，改前缀只是换名，不加深观测空间。真正有价值的是带 `ReferenceFrame` 的 frame 端点（DEBT-02）。**并入 /objects 表征面**，范围收窄为「删两个冗余列表端点 + 资源 URL 由后端下发」。

#### DEBT-07 · CT mask-edit 端点与双画笔宿主（12 分 · 并入 /objects/{id}/edits）

**证据**
- `backend/app/routers/api.py:225` — `task: Literal["totalseg_liver_kidney"] = "totalseg_liver_kidney"`
- `backend/app/routers/api.py:260` — `# 重 measure：走 plugin.measure 与 run_task 同形`
- `backend/app/routers/api.py:280` — `meas = _measure_lk(det, cal)`
- `docs/sdd/feats/04-unified-annotation-toolbox/README.md:286` — `| D-13 | CT brush 不走 `/annotations`，仍走 `mask-edit` | 统一到 annotations | labelmap 是任务结果而非标注；成熟闭环不重写 |`

**症状**：同一「画笔」在 raster_2d 提交 `/annotations(kind=mask)`、在 volume_3d 提交 `/volume/{id}/mask-edit` 并自带 `editSeq`/`baseSeq`/409 回滚；两处都用 `activateTool(…'cursor'…)` 绕开 CS3D BrushTool。后端端点只对一个任务开放，注释说走 `plugin.measure` 实际直接 `import measure_liver_kidney`，`VolumeMask.classes` 硬绑 `LIVER_KIDNEY_CLASSES`。

**为何是债**：D-13「labelmap 是任务结果不是标注」在语义上成立，但它是后端落库目标的区别，不应决定前端有两份画笔宿主。

**建议改法**：前端定义 `MaskSink{commit}` 两实现（`annotationMaskSink` / `editMaskSink`），画笔宿主随 `FrameStackViewer` 合并只剩一份；后端改 `POST /objects/{id}/edits {task, method, base_seq, ops:[{index, class_id, mode, mask_png}]}`，派发 `DETECTORS[kind].apply_edit`，重测走 `plugin.measure`；`TaskPlugin` 增 `classes`，类表搬进 REGISTRY 行。

**核验备注**
- 事实：10 处 evidence 全准；注释与代码不一致属实（当前行为等价，因该任务的 `plugin.measure` 正是 `_measure_liver_kidney`）。
- 价值：人工画笔属 README 声明「后续以插件交付」的工作台面，视频第一波无「逐帧人工改掩膜并重测」需求，video_impact 降为 neutral；双路径在语义上是 SDD 04 既定决策，不是债。**并入 /objects/{id}/edits**，前端部分随 FrameStackViewer 合并自然消解；保留两个小修：端点改调 `plugin.measure`、类表搬进 REGISTRY。

#### DEBT-08 · 模态字面量三处手抄（16 分 · 并入 SOURCES）

**证据**
- `backend/app/schemas.py:17` — `Modality = Literal["carotid_imt", "fetal_hc", "ct_abdomen", "pathology", "natural_image"]`
- `backend/app/datasource_registry.py:32` — `MODALITIES = ("carotid_imt", "fetal_hc", "ct_abdomen", "pathology", "natural_image")`
- `backend/app/datasource_registry.py:281` — `if modality not in MODALITIES:`
- `frontend/src/data/recent.ts:16` — `function isItem(v: unknown): v is RecentItem {`

**症状**：加视频要改 `schemas.Modality`、`MODALITIES`、`types.ts`、`schemas.TaskType`（与 `glaux_core.tasks.TaskType` 又是一份）四到五处；`test_datasource_registry.py:36` 用 `set(reg.MODALITIES)` 反向锁死。前端 28 处 `===` 判等分布在 8 个非测试文件，加 "video" 后 TS 不会提示任何一处，只会静默走 else（通常是颈动脉路径）。

**为何是债**：注册表已在运行时下发模态集合，类型层再穷举一份是手工同步（`datasource_registry.py:31` 注释自认）。

**建议改法**：唯一真相源 = `SOURCES` 的键（数据轴）与 `REGISTRY.modality`（任务轴）；`schemas.Modality/TaskType` 改 `str` + 校验器查注册表；前端 `Modality = string`，「按模态分支」改为按 `ObjectMeta.kind` / `TaskView` 属性分支。**顺序不可颠倒**：先 grep 清零字面量，再放宽类型，否则 20+ 处 `===` 静默走 else。

**核验备注**
- 事实：10 处 evidence 全准；前端判等实测 28 处，与 symptom 吻合；`glaux_core/tasks.py:49` 另有第五份 `TaskType`。漏改会快速失败（pydantic 422 / `ImportError_` / 测试锁）。
- 价值：手抄本身成本低且失败显式，真正静默的是 `===` 判等走 else，其根因是按模态名分派；`scripts/gen-contracts.py` 代码生成对五六个字面量成本高于收益。**并入 SOURCES/REGISTRY 单一事实源**，作为其验收条目。

#### DEBT-01 · ViewerContext 摊平领域字段、游标与区域不在 store（18 分 · 单列）

**证据**
- `agent-runtime/src/contracts.ts:94-101` — `cubs_cf?: number; roi_box?: [number, number, number, number];`
- `agent-runtime/src/transport/routes.ts:350` — `throw new RuntimeError("invalid_request", "viewer.roi_box must be [x, y, w, h].", 400);`
- `backend/app/schemas.py:27` — `roi_box: tuple[int, int, int, int] | None = None  # P7 WSI：框选 (x0, y0, x1, y1) level-0 px`
- `frontend/src/components/VolumeViewer.tsx:51` — `const [z, setZ] = useState(0);`
- `frontend/src/agent/toolBridge.ts:87` — `function activeTargetId(): string | null {`
- `agent-runtime/src/pi/tools/propose-annotation.ts:47` — `z: Type.Optional(`
- `docs/sdd/feats/02-agent-image-annotation/README.md:445` — `留前端 `csAnno`；前端**不需要**向 runtime 暴露任何视口元数据。`

**症状**：「模型看到什么」在契约里被写成两个领域字段；CT 当前切片 `z` 是组件本地 state，agent 上下文拿不到；WSI 区域是 store 专属字段 `wsiRoi` 由查看器反向同步。`toViewerContext` 与 `activeTargetId` 对「当前目标」各写一份三分支，一处加视频另一处漏加则 run_task 结果被当过期静默丢弃。`routes.ts:350` 的错误文案写 `[x, y, w, h]` 而全链语义是 `(x0,y0,x1,y1)`。

**为何是债**：SDD 02 §4.1 原话是「image_id / 帧号」，帧号从未落地；纲领 §六把观测空间定义为带物理语义的通用描述。注意 `propose_annotation` 已有 `z` 入参，即契约已承认帧/层索引是标注的一部分，只是观测上下文缺它，模型只能猜。

**建议改法**：定义 `Focus{object_id, kind, index{z?,t?,level?}, region}`；前端 store 只存一个 focus，`VolumeViewer` 本地 z 与 `wsiRoi` 都进 focus；`toViewerContext` 只做 `{collection, task, method, object, focus}`；`toolBridge` 比对 `focus.object_id`（视频再比 `index.t`）；`parseViewer` 按 `object.kind` 做判别联合校验，旧字段仅在缺失时映射并 warn。`cubs_cf` 是冗余字段应直接删除（后端本就按 image_id 自解标定，`kernel.py:119`）。

**核验备注**
- 事实：10 处 evidence 全准；`roi_box` 数据链路两端一致，错的只是 runtime 的错误提示文案，故 risk 由 4 降为 2；`propose_annotation` 已有 z 入参这一点反而加强本条。
- 价值：成立且值得修——更强模型仍需知道用户此刻看哪一帧/哪一区域，属观测空间，不被 §七作废。**单列**，但需明确它包含「删 cubs_cf、修 routes.ts:350 文案、撤回 SDD 02 D-9 中『不需要视口元数据』的表述（D-9 的世界坐标变换留前端立场不变）」。

#### DEBT-02 · 智能体观测通道对 CT/WSI 为零或为假（18 分 · 单列）

**证据**
- `agent-runtime/src/pi/tools/view-image.ts:98` — `const res = await doFetch(`${base}/image/${encodeURIComponent(imageId)}`, { signal: combined });`
- `agent-runtime/src/pi/tools/locate-roi.ts:93` — `* 不另开 `/meta` 端点：backend 的 `/image/{id}` 恒返回 PNG，头部就有尺寸，`
- `backend/app/routers/api.py:381` — `return Response(content=mock.synthetic_png(image_id), media_type="image/png")`
- `agent-runtime/src/pi/harness-registry.ts:128` — `" You are not looking at the image by default. Call view_current_image to actually see what the user has open, "`
- `frontend/src/agent/useConversation.ts:28` — `if (s.activeVolume) out.image_id = s.activeVolume;`

**症状**：四个看图工具全部只会 `GET /image/{id}`。对 `ct_001`/`slide_001`：有 CUBS 数据时走 `dataset.image_png` 打开 `IMAGES_DIR/ct_001.tiff` → 404；无 CUBS 数据时返回合成 B 超，而系统提示词要求「Never describe an image you have not viewed」，模型会基于假图作答。`/volume/{id}` 只出 NIfTI、`/wsi/{id}/tile` 只出瓦片，runtime 没有任何路径能拿到「用户此刻看到的那一层/那一块」。视频的观测空间为空。

**为何是债**：纲领把 harness 身份定义为观测空间/动作空间/验证器；观测空间目前隐式等于「US 单帧 PNG」。`api.py:366-367` 的注释已自述 mock 回退掩盖失败的风险，但补丁只拦了 `natural_` 前缀。

**建议改法**：后端新增 `GET /objects/{id}/frame?z=&t=&level=&roi=&size=&window=`，返回 PNG + 响应头 `X-Glaux-Frame: JSON(ReferenceFrame)`；`/image/{id}` 保留为 frame 0 别名，未知 id 一律 404、删 mock 回退；runtime 把四处取图收成 `observation/fetch.ts` 的 `fetchObservation(focus)` 单一实现，返回 `{bytes, mime, frame}`。

**核验备注**
- 事实：九条 evidence 全准；`grep "/image/" agent-runtime/src` 证实 runtime 无其他取图路径；`config.py:167` 的 `data_available()` 只查颈动脉，故 CT/WSI id 是否被 mock 吞掉取决于颈动脉数据是否就绪。
- 价值：观测空间是 harness 四要素之首，更强模型只会更依赖它，方向不被 §七作废。cost 上调为 4（NIfTI 切片加窗渲染、WSI level+region 取块、视频解帧依赖，加三层 Focus 贯通）。**单列**；其前置是 DEBT-01 的 Focus（没有 Focus 就无法寻址「哪一层/哪一帧」），故两条必须同波或相邻波交付。

---

### 5.2 frontend-state

#### DEBT-09 · select/run 按模态分叉（20 分 · 并入 openObject）

**证据**
- `frontend/src/data/actions.ts:149` — `const res = await api.taskRun({ task, image_id: imageId, cubs_cf: cf, method });`
- `frontend/src/data/actions.ts:227` — `const res = await api.taskRun({ task, image_id: slideId, roi_box: roiBox, method });`
- `frontend/src/data/actions.ts:204` — `/** P7：选 WSI slide——设元数据（含 mpp/dims）+ 清叠加/ROI。**不自动跑**（核检测要先框 ROI）。 */`
- `frontend/src/components/SideBar.tsx:69` — `if (modality === "natural_image") return selectNaturalImage(id);`

**症状**：四个 select 主体相同（noteRecent → 找 meta → 设 active → 设 meta → clearOverlays），差异只有是否自动跑与跑时带哪种 region。`runCurrentTask` 与 `runWsiTask` 是同一段代码复制两份只换一个字段。`loadImages`/`switchModality` 各四分支，`RecentList.open` 再四支，`ExplorerTree` 用三元阶梯再派生一次。

**为何是债**：「选中即跑」还是「框选后跑」是任务的触发策略，不应是前端 action 名字的差异；`natural_image` 的「不跑」也是同一策略的一个值（无任务）。

**建议改法**：收成 `loadObjects(modality)` / `openObject(id)` / `runTask(region?)` 三个动作；触发规则显式写为 `trigger = task?.trigger ?? "manual"`（无任务模态写成显式 no-task 契约，不为其造 REGISTRY 空行）。

**核验备注**
- 事实：五条 evidence 全准；`runWsiTask` 在 `actions.ts` 外无调用方；「框选后跑」已走注册表的 `on_commit` 通道（`WsiViewer.tsx:24` 注释「前端不再自持框选逻辑」），故前端残留的触发策略只有「选中时是否自动跑」一项。
- 价值：差异来自三槽与四份列表，是派生症状；把 UI 触发时机下沉到 science-core 的 `TaskPlugin` 不加深四要素中任何一项。**并入 openObject**（前置 Focus 与 loadObjects），验收条为「`actions.ts` 不再出现 `modality ===` 分支，select/run 各只剩一个」。

#### DEBT-10 · 对象列表按模态分四槽（16 分 · 并入 loadObjects）

**证据**
- `frontend/src/store/session.ts:238` — `images: ImageMeta[]; // 数据集列表（Explorer）`
- `frontend/src/data/actions.ts:24` — `carotid_imt: s.images.map((m) => m.id),`
- `frontend/src/data/actions.ts:25` — `fetal_hc: s.images.map((m) => m.id),`
- `frontend/src/components/StatusBar.tsx:18` — `const shownImages = modality === "natural_image" ? naturalImages : images;`
- `frontend/src/components/StatusBar.tsx:32` — `<span className="mono">{image ?? "—"} · {idx}/{shownImages.length}</span>`

**症状**：四个列表都是 `ImageMeta[]`，区别只在装载时机与来源端点；`images` 被两个模态共用，切模态互相覆盖。CT/WSI 下 `activeImage` 恒 null，StatusBar 显示「— · 0/N」且 N 是上次颈动脉残留的 `images.length`（CT 分支只 `setVolumes` 不清 `images`）。更实在的后果：停在 fetal_hc 时 `images` 是 HC 列表，`prunedRecent` 会判定颈动脉最近项「不在列表中」并永久删除——这正是 `actions.ts:21` 注释想防的事。

**为何是债**：SDD 08 已把数据轴定义为 datasources；`ImageMeta.modality` 字段本身已足以分组。

**建议改法**：改为 `objects: Record<modality, ObjectMeta[]>` + selector `objectsOf()`；`prunedRecent` 改按 id 查找；StatusBar 改读 selector 与 `activeObject()`；模型按钮显示条件改 `models.some(m => m.modality === modality)`。

**核验备注**
- 事实：证据成立，但 StatusBar 四个行号在原稿中错位（实际 14/18/32/52）；CT/WSI 不清 `images` 属实。
- 价值：视频按现有模式加一槽是样板代码而非阻塞，blocks 降为 complicates；列表合并本身不加深四要素，价值附着在 `loadObjects` 上。**并入 loadObjects**，误删最近项一条作为其回归用例。

#### DEBT-11 · store 初值与兜底写死颈动脉（9 分 · 并入 Focus）

**证据**
- `frontend/src/store/session.ts:319` — `modality: "carotid_imt",`
- `frontend/src/store/session.ts:397` — `setModels: (m) => set({ models: m, activeModel: m.find((x) => x.active)?.id ?? "caroSegDeep" }),`
- `frontend/src/data/actions.ts:111` — `if (pick) useSession.setState({ activeModel: pick.id });`
- `frontend/src/agent/useConversation.ts:29` — `if (s.activeModel) out.method = s.activeModel;`

**症状**：后端未起或 `/models` 失败时 `activeModel` 停在 `"caroSegDeep"`，`toViewerContext` 会把它连同伪造的 `modality` 发给 agent；`switchModality` 在 `pick` 不存在时保留旧 `activeModel`，跨模态泄漏方法名。启动路径没有把 `modality` 对齐到 `activeModalities()[0]`，而 `loadSamples` 却做了 `mods.includes(cur)` 校验，两处不一致。

**为何是债**：默认值来自单模态时期；SDD 08 规定「有没有数据」以 `/datasources` 为唯一依据，`null` 才是诚实状态。

**建议改法**：`modality`/`activeModel` 改 `string | null`；`setModels` 不再兜底字符串；`switchModality` 在 `pick` 不存在时置 null；`toViewerContext` 对 null 不下发 method。

**核验备注**
- 事实：六条 evidence 全准，近期未修；`SideBar.tsx:239` 的 agentMethod 按模态硬编码属 DEBT-20 同类，只作旁证。
- 价值：`ResearchApp` 在无 active 源时直接 return，UI 不展示伪造状态，泄漏的只是 modality+method 且无 image_id 时 run_task 本就跑不起来；独立改要碰 `Modality` 的全部消费点，而这些点在 Focus 重构里本来就要重写。**并入 Focus**，作为其验收项（初值为 null、切模态不残留 method、`setModels` 不兜底）。

---

### 5.3 frontend-viewer

#### DEBT-13 · 引擎自读 store、无 props 契约（20 分 · 并入 FrameStackViewer）

**证据**
- `frontend/src/components/CornerstoneViewer.tsx:103` — `toTarget: () => ({ image_id: useSession.getState().activeImage ?? "" }),`
- `frontend/src/components/WsiViewer.tsx:145` — `useSession.getState().setWsiRoi([b.x0, b.y0, b.x1, b.y1]);`
- `frontend/src/components/Viewer.tsx:20` — `const viewer = useSession((s) => s.tasks.find((t) => t.modality === modality)?.viewer ?? "raster_2d");`

**症状**：三个引擎各自订阅互斥的 `active*` 并各自重复 `tasks.find(modality)`（`CornerstoneViewer.tsx:78`、`VolumeViewer.tsx:64`、`WsiViewer.tsx:52`，加 `Viewer.tsx:20` 共四处）；组件签名不带参数（`ENGINES: Record<string, ComponentType>`），无 props 契约，无法以 props 驱动测试。`WsiViewer` 还会反向写 `setWsiRoi`。

**为何是债**：2026-07-07 设计 §4.2 规定 `ViewerProps{imageSource, primitives, activeTool, editable, onEdit}`，`Viewer.tsx:8-9` 头注释也称「中部展示区只认 viewer 字符串」；引擎自读 store 是赶楔子省掉的接缝。

**建议改法**：`Viewer.tsx` 成为唯一读 store 的地方，由 `activeObject()` + focus + tasks 组装 `ViewerProps` 下传；`attachCsAnnoBridge` 的 `toTarget` 改从 props 给 `{image_id, index}`。

**核验备注**
- 事实：八条 evidence 全准；提交 `8c41e92` 明确「落库目标改用 store activeImage」，是修 bug 时的局部选择而非架构决策。
- 价值：被判 blocks 的部分全部来自三槽（DEBT-03），Focus 落地后视频引擎只需一行订阅；目标抽象已规定 `FrameStackViewer` 吃掉两个引擎、`PyramidViewer` 去私有 UI，届时顺手改边际成本近零，先单独 props 化是「先改再扔」。**并入 FrameStackViewer**，验收条为「引擎只读 focus 与 taskView，不读模态专属槽」。

#### DEBT-12 · 两引擎约 300 行同源重复（12 分 · 并入 FrameStackViewer）

**证据**
- `frontend/src/components/CornerstoneViewer.tsx:37` — `function maskToPng(mask: Uint8Array, columns: number, rows: number): string {`
- `frontend/src/components/VolumeViewer.tsx:491` — `function _maskToPng(mask: Uint8Array, columns: number, rows: number): string {`
- `frontend/src/components/VolumeViewer.tsx:191` — `(el as unknown as { _glauxOnCam?: () => void })._glauxOnCam = onCam;`
- `frontend/src/components/Viewer.tsx:13` — `volume_3d: VolumeViewer,      // P6：CS3D OrthographicViewport（CT 体积 + labelmap 叠加 + 画笔）`

**症状**：`maskToPng` 逐字相同；一次性 init（RenderingEngine + enableElement STACK + ToolGroup + attachCsAnnoBridge + destroy）约 85% 相同；ResizeObserver 100%；相机事件同义但 VolumeViewer 用挂 DOM 属性的 hack；paintAt 圆形笔刷约 90%。`WsiViewer` 也复制了 overlay 尺寸/resize/标注同步五段。`Viewer.tsx:13` 注释说 VolumeViewer 是 OrthographicViewport，实现是 STACK。

**为何是债**：两文件头注释自称「P6 楔子」「spike3 退化方案」；2026-07-07 设计把 `raster_2d` 标为「2D + 视频（StackViewport）」，即视频原本就该由帧栈引擎承载。

**建议改法**：抽 `useCsStackEngine` / `useOverlayCanvas` / `useBrushBuffer` 三个 hooks 与 `viewer/maskPng.ts`；在此之上建 `FrameStackViewer`，`ENGINES` 的 image/volume/video 三键都指向它，仅 axis 与 source 不同。

**核验备注**
- 事实：15 条证据中 14 条行号原文精确，1 条差一行；无注释表明重复是有意设计。
- 价值：README 已把查看器划为插件交付面；智能体接视频靠 `/objects/{id}/frame` 而非 CS3D 去重，video_impact 由 blocks 降为 complicates；长视频逐帧 imageId 的 StackViewport 在内存与解码上未必成立，合并对视频的收益被高估。cost 上调为 4。**并入 FrameStackViewer**；若 CS3D mock smoke 测试做不出，降级为「只抽纯函数 + 共用 hooks + 手工回归清单」，合并顺延独立立项（DEC-21）。立即可做的两处小修：`maskToPng` 移到 `viewer/maskPng.ts`、改正 `Viewer.tsx:13` 注释并去掉 `_glauxOnCam` hack。

#### DEBT-14 · 三引擎各自投影与绘制（12 分 · 并入 PAINTERS）

**证据**
- `frontend/src/components/CornerstoneViewer.tsx:151` — `const proj = (x: number, y: number): [number, number] => {`
- `frontend/src/components/CornerstoneViewer.tsx:208` — `if (p.kind === "volume_mask") continue; // VolumeViewer 渲染`
- `frontend/src/components/WsiViewer.tsx:23` — `// bbox/polygon 绘制与顶点编辑由 Annotorious 承担；产物经 annotationBridge 落 /annotations，`
- `frontend/src/components/VolumeViewer.tsx:126` — `const tl = vp.worldToCanvas([0, 0, 0] as Types.Point3);`

**症状**：polyline/ellipse/比例尺只有 CornerstoneViewer 会画，volume_mask 只有 VolumeViewer 会画，point_set 只有 WSI 会画；每个引擎自己实现 `proj` 后再各写一遍 canvas 绘制。`CornerstoneViewer.tsx:161-176` 的「壁线淡带」是 IMT 私有几何塞在通用引擎里，且按「前两条 polyline」的隐式约定触发。

**为何是债**：设计 §4.2 要求「读 primitives 泛型渲染；谁都不认模态」。

**建议改法**：新建 `viewer/overlay/painters.ts`，`PAINTERS: Record<kind, Painter>` + `drawPrimitives` 按 `focus.index` 过滤；引擎只提供 proj 与 canvas；壁线淡带迁 IMT 任务 painter；比例尺按 calibration 通用画。

**核验备注**
- 事实：七条 evidence 全准。需修正两处表述：CornerstoneViewer 画的 mask 是 annotations 通道的已保存标注而非 Detection primitive；WSI 的 bbox 由 Annotorious 渲染并同步 `wsiRoi`，真正被丢的是任务输出中 kind=bbox 的 primitive。
- 价值：`FrameStackViewer` 合并后 2D 与体数据的 proj/绘制天然只剩一份；overlay 是给人看的 UI 层，不加深智能体四要素；`volume_mask` 的逐切片离屏上色与 `point_set` 的视口裁剪塞不进统一签名，cost 维持 3。**并入 PAINTERS**。

#### DEBT-17 · 前后端双重写死 totalseg_liver_kidney（12 分 · 并入 FrameStackViewer）

**证据**
- `frontend/src/components/VolumeViewer.tsx:429` — `task: "totalseg_liver_kidney",`
- `backend/app/routers/api.py:225` — `task: Literal["totalseg_liver_kidney"] = "totalseg_liver_kidney"`
- `science-core/glaux_core/tasks.py:277` — `viewer="volume_3d",`
- `frontend/src/viewer/nifti.ts:169` — `if (type === "voiLutModule") return { windowCenter: 40, windowWidth: 400 }; // CT 软组织窗`

**症状**：引擎已拿到 taskView，提交 mask-edit 仍写死 task/method；nifti loader 把 modality 与默认窗写死为 CT；图例硬写 `label.zh` 不走 i18n；帧参考 UID 在两处不一致（`"GLAUX_CT"` vs `"GLAUX_NIFTI"`）。

**为何是债**：P6 只有一个 CT 任务时的捷径；注册表已下发 task 与 default_method。

**建议改法**：改 `task: taskView.task, method: taskView.default_method`；`nifti.ts` 的 modality 与默认窗由 `FrameSource` 注入；图例用 lang 取 `label[lang]`。**必须前后端联动**，否则第二个体数据任务会被后端 Literal 拒成 422。

**核验备注**
- 事实：六条 evidence 全准；当前 `viewer="volume_3d"` 的任务只有一个，故尚无运行时错误，impact 由 3 降为 2，cost 由 1 升为 2（含后端 Literal）。
- 价值：目标抽象已用 `FrameStackViewer` + `/objects/{id}/edits` + FrameSource 覆盖它。**并入 FrameStackViewer**，后端 Literal 一并随 edits 端点处理。

#### DEBT-15 · imageId 字符串当契约（10 分 · 并入 FrameSource）

**证据**
- `frontend/src/annotation/csAnno.ts:249` — `const target = (opts.toTarget ?? defaultTarget)(imageId);`
- `frontend/src/components/VolumeViewer.tsx:186` — `detach = attachCsAnnoBridge({ getImageId: () => zImageIdRef.current, toTarget: niftiTarget });`
- `frontend/src/viewer/cornerstone.ts:131` — `imageLoader.registerImageLoader("web", webImageLoader as unknown as ...);`
- `frontend/src/viewer/nifti.ts:228` — `imageLoader.registerImageLoader("nifti", niftiImageLoader as unknown as ...);`

**症状**：volume 的落库 `z` 靠 `nifti:...#z=N` 的片段解析回来（`csAnno.ts:324` 正则）；`imtWallTool.ts:47` 自拼 `web:` 前缀，使该工具绑死在 raster_2d 上；两个 loader 各自维护 dimCache/volCache 与 provider。

**为何是债**：imageId scheme 是 CS3D 内部路由键而非应用契约。

**建议改法**：落库目标由引擎 props 给 `{image_id, index}`，删 `defaultTarget`/`niftiTarget` 字符串解析；壁线工具从工具配置拿 objectId。

**核验备注**
- 事实：raster_2d 的落库目标已不靠解析字符串（`CornerstoneViewer.tsx:102-103` 注释明确「不从图片 URL 反推」），问题只对 volume 成立；两个 loader 按 scheme 注册本就是 CS3D 的扩展方式，dimCache 与 volCache 语义不同，不算复制。
- 价值：`toTarget` 已是注入式契约，接视频只需再注入一个或由 Focus 直接给出；额外包一层 `FrameSource/registerFrameLoader` 不减少视频要写的代码（CS3D VideoViewport 通常不经自定义 loader）。**并入 FrameSource**，作为 Focus 落地时的顺手删除项。

#### DEBT-16 · WsiViewer 私有 UI（8 分 · 并入 PyramidViewer）

**证据**
- `frontend/src/components/WsiViewer.tsx:254` — `{verifying ? "验证中…" : "复现验证"}`
- `frontend/src/components/WsiViewer.tsx:234` — `const density = metrics?.nuclei_density_mm2?.value;`
- `backend/app/routers/api.py:327` — `def wsi_verify(slide_id: str, method: str = "stardist_he") -> dict:`
- `backend/app/routers/api.py:295` — `# /volume/{id}/verify（P6 复现 Dice）已删（2026-08-16，前端从未接线）`

**症状**：引擎自带信息条、复现验证按钮、提示条三块 UI，49 行内联样式、文案全中文不走 i18n、metrics 按键名硬取、模型名写进提示、`taskView?.label.zh` 写死中文字段。`BottomPanel`/`ViewerChrome` 已按注册表泛型渲染，这里是第二套。

**为何是债**：SDD 04 §15 要求「范式仅一份」；README 说 WSI 工具后续以插件交付，引擎内嵌私有 UI 与之相反。

**建议改法**：删私有 UI 与内联样式，信息条走 `ViewerChrome` 泛型 metrics，提示文案迁 i18n，overlay 改 painters，改收 `ViewerProps`，ROI 框选写 `focus.region`。

**核验备注**
- 事实：九条 evidence 全准，内联样式正好 49 行。
- 价值：视频不读这段代码，video_impact 为 neutral；硬编码中文与内联样式是代码卫生而非抽象债；「复现验证属于验证器要素」有 harness 价值，但通用 verifier 接口（`TaskPlugin.verify` + `POST /task/verify` + capabilities 位）远超 cost 2，且目前只有一个实现（CT 的 verify 已于 2026-08-16 删除）。**并入 PyramidViewer** 只做去私有 UI；验证按钮搬家与公共验证器端点推迟（见 §8.6）。

#### DEBT-18 · IMT 壁线工具写死在通用层（8 分 · 并入 registerTaskTool）

**证据**
- `frontend/src/viewer/csTools.ts:133` — `} else if (tool === "wall" && capabilities.includes("wall")) {`
- `frontend/src/store/session.ts:186` — `export type Tool = "cursor" | "bbox" | "polygon" | "wall" | "brush" | "reset";`
- `frontend/src/keys/globalKeys.ts:13` — `const TOOL_KEYS: Record<string, Tool> = { v: "cursor", r: "bbox", p: "polygon", w: "wall", b: "brush" };`
- `frontend/src/components/ViewerChrome.tsx:37` — `if (tl.id === "bbox" || tl.id === "polygon" || tl.id === "brush" || tl.id === "wall") return caps.has(tl.id);`

**症状**：通用 `Tool` 联合含任务专属 `wall`；`csTools` 无条件注册 `ImtWallHandleTool`；CornerstoneViewer 画壁线手柄与淡带；`imtWallTool` 直接读 store 并调 `api.taskMeasure`。README 说测量工具后续以插件交付，但它与通用层四处耦合。

**为何是债**：SDD 04 D-12 把壁线做成 CS3D 自定义工具是对的（扩展框架），但注册与渲染写死在通用层是实现捷径。

**建议改法**：`Tool` 放宽为 string 并由 `TaskView.tools` 给出；`csTools` 提供 `registerTaskTool(name, ToolClass, activate)`；壁线 painter 走 PAINTERS 扩展点；工具从配置拿 objectId 而非读 store。**不做目录搬家**。

**核验备注**
- 事实：五条 evidence 全准；激活已由能力位门控，无条件注册只是注册一个类，对运行时无害，债在插件边界。
- 价值：视频不需要壁线；本条自己承认「更强模型会让手工壁线形变作废」，为它单独做插件化抽取是往负债上投资。**并入 registerTaskTool**，写作「wall 是第一个经 registerTaskTool 注册的任务工具」。

---

### 5.4 frontend-chrome

#### DEBT-19 · 选项段按模态显隐、能力位未下发（15 分 · 并入 CHROME_SEGMENTS）

**证据**
- `frontend/src/components/ViewerChrome.tsx:49` — `const isCt = modality === "ct_abdomen";`
- `frontend/src/components/ViewerChrome.tsx:2` — `// 全部真相源：注册表（tv.tools / tv.capabilities）+ store.tool/toolOptions；`
- `science-core/glaux_core/tasks.py:290` — `capabilities=("bbox", "polygon", "brush"),`
- `docs/sdd/feats/04-unified-annotation-toolbox/README.md:117` — `` `volume_3d` 同左 + `{z_scroll, voi}` ``

**症状**：文件头自称「全部真相源：注册表」，但 WW/WL 窗位条实际由 `modality === "ct_abdomen"` 决定；SDD 04 已写明 volume_3d 有 voi/z_scroll 能力位，`tasks.py` 从未下发，前端也没读——文档与代码双向脱节。WW/WL 是灰度帧栈通用能力（MRI、灰度视频、X 光）。

**为何是债**：SDD 04 自己定义了能力位机制，实现只做了一半（工具按钮走能力位、选项条走模态）。

**建议改法**：`tasks.py` 的 CT 行补 `voi`/`z_scroll`；选项条改 `CHROME_SEGMENTS: {cap, Seg}[]` 由 `caps.has()` 决定，`isCt` 删除；同步 SDD 04 能力位枚举。

**核验备注**
- 事实：成立，但原稿引用的 StatusBar 行号有误（实际 `StatusBar.tsx:40`）；brush 段的出现条件是 `tool === "brush"` 而 brush 本身已按能力位过滤，故真正按模态判别的只有 voi 段，impact 由 4 降为 3、再经价值核验降为 2。
- 价值：`CHROME_SEGMENTS` 已是目标抽象三注册面之一；视频的播放位置与帧号属 `Focus.index`，不应塞进 `toolOptions` 分槽（会造出第二份「当前帧」状态）。**并入 CHROME_SEGMENTS**，只保留「选项段出现条件改能力位 + tasks.py 补 voi/z_scroll + 同步 SDD 04」。

#### DEBT-20 · 展示标签按模态硬写数据集名（10 分 · 并入 ObjectMeta）

**证据**
- `frontend/src/components/SideBar.tsx:230` — `const dirName = isNatural ? "natural-images" : isCT || isWSI ? "slides" : "images";`
- `frontend/src/components/TitleBar.tsx:15` — `const ext = isNatural ? ".jpg" : isHC ? ".png" : ".tiff";`
- `frontend/src/App.tsx:8` — `return CHAT_EDITION ? <ChatShell /> : <Suspense fallback={null}><ResearchApp /></Suspense>;`

**症状**：`ws`/`dirName`/`methodsDir`/`goldMethod`/`agentMethod` 五个字段全是特定数据集的目录与方法名；CF、Folds 两个目录是磁盘布局且为空壳；TitleBar 扩展名是猜的（CT/WSI 落到 `.tiff`，视频会显示成 `xxx.tiff`），且 TitleBar 的 `ws` 回退没有 CT/Pathology 分支，`center` 为空时 CT/WSI 标题显示 `"CUBS-tech"`。

**为何是债**：回退值是特定数据集的目录名而非中性文案；`gold`/`agent` 方法名应来自注册表或数据源元数据，与 SDD 08「可见性来自数据源、标签来自任务注册表」相悖；`ImageMeta` 没有 `filename`/`display_name` 字段所以前端只能编。

**建议改法**：删按模态回退；`ws` 用当前 active 数据源的 name；方法角色由后端在 `ObjectMeta.methods[].role` 带；`ObjectMeta` 增 `display_name`；TitleBar 只渲染 `${display_name} — ${datasource.name}`。

**核验备注**
- 事实：全部属实；TitleBar 的问题比原稿更严重（无 CT/WSI 回退分支）。
- 价值：这些只出现在 `ResearchApp` 下，属 README 声明待插件化的工作台外壳，不加深四要素；修法用到的 `display_name` 与 `methods[].role` 就是 ObjectMeta 的字段。**并入 ObjectMeta**，作为附带清理。

#### DEBT-21 · ImportPanel 是后端白名单的第二份副本（10 分 · 并入 Source.formats）

**证据**
- `backend/app/upload_store.py:20` — `_MAGIC: dict[str, bytes] = {`
- `backend/app/upload_store.py:77` — `if ext not in _MAGIC:`
- `frontend/src/components/ImportPanel.tsx:26` — `/** 前端预筛：类型/大小不合格的直接本地拒，不发请求（与后端同一套判据，后端仍是权威）。 */`
- `frontend/src/components/ImportPanel.tsx:14` — `// v0 只放开端到端可用的 WSI/CT（SDD 08 D-5）；carotid/HC 数据结构复杂，导入后续。`

**症状**：服务端文件夹导入只能选 pathology/ct_abdomen（后端 `register_folder` 本就接受全部 MODALITIES）；MP4 在拖拽入口被前端拒；后端支持哪些模态、上传接受哪些 MIME，前端各有一份副本要手工同步；`imp_drop_hint` 里还有第三份。文案「医学数据」与通用定位冲突。

**为何是债**：阶段性限制表放在前端常量而非由 `/datasources` 下发，每开放一个模态要改前后端两处。

**建议改法**：后端 `/datasources` 增 `importable:{modality, label, accept[]}`（由 `Source.formats` 生成）；`ImportPanel` 全部改读该字段；文案去掉「医学」。

**核验备注**
- 事实：五条 evidence 全准。需修正：挡住 MP4 的根因在后端 `_MAGIC` 与 `/uploads/images` 端点，不是前端预筛，故 blocks 降为 complicates。
- 价值：fix 自己写着「由 Source.formats 生成」，是数据轴在前端的消费端；服务端文件夹导入的两项限制是 SDD 08 D-5 有意设的产品闸门。**并入 Source.formats**，前端只剩约 10 行。

#### DEBT-22 · 工具过滤白名单与 onTool 三处复制（10 分 · 并入 registerTaskTool）

**证据**
- `frontend/src/components/ViewerChrome.tsx:37` — `if (tl.id === "bbox" || tl.id === "polygon" || tl.id === "brush" || tl.id === "wall") return caps.has(tl.id);`
- `frontend/src/components/focus/StagePanel.tsx:38` — `tl.id === "bbox" || tl.id === "polygon" || tl.id === "brush" || tl.id === "wall" ? caps.has(tl.id) : true,`
- `frontend/src/components/focus/StagePanel.tsx:43` — `const onTool = (id: Tool) => {`
- `frontend/src/components/Editor.tsx:31` — `const onTool = (id: Tool) => {`
- `frontend/src/components/iconMap.ts:57` — `export const TOOL_ICON: Record<Tool, LucideIcon> = {`

**症状**：过滤谓词、`reset → cursor + reRunActiveModel`、hint 读取在两种外壳各写一份（StagePanel 注释承认「与 ViewerChrome 同一规则」）。过滤表白名单封闭——任何新工具 id 不在四个字面量里就落到 `return true`「恒在」，会在没有能力位的模态里出现并静默失效，正是 SDD 04 D-17 要消灭的症状。

**为何是债**：StagePanel 是第二外壳，复制而非抽取；规则应是「除 cursor/reset 外一律按能力位」。

**建议改法**：抽 `useTaskTools()`；规则改 `const ALWAYS = new Set(["cursor","reset"]); tools.filter(t => ALWAYS.has(t.id) || caps.has(t.id))`；`Tool` 放宽 string，`TOOL_ICON` 改 `Partial`（渲染点已有 FALLBACK_ICON）。

**核验备注**
- 事实：证据成立但 ViewerChrome 行号在原稿中错记为 129（实际 37）；`TOOL_HINT` 已抽到 `toolHint.ts:7` 共用，重复的只是一行查表；被强制登记的只有 `Tool` 联合与 `TOOL_ICON` 两处。
- 价值：复制量约 15 行；加视频工具必先改 `Tool` 与 `TOOL_ICON`，做这一步的人自然会看到过滤表。**并入 registerTaskTool**，过滤规则一行改为 ALWAYS 集合。

#### DEBT-23 · 通用图像模态标签两处不一致（10 分 · 并入 Source 协议）

**证据**
- `frontend/src/components/focus/FocusTopBar.tsx:22` — `const modalityLabel = modality === "natural_image" ? t("natural_images") : tasks.find((tk) => tk.modality === modality)?.label[lang];`
- `frontend/src/components/SideBar.tsx:45` — `m === "natural_image" ? t("mod_general_images") : tasks.find((tk) => tk.modality === m)?.label[lang] ?? m;`
- `frontend/src/api/types.ts:61` — `export interface DataSource { id; name; modality; root; origin; calibration; status }`
- `frontend/src/i18n/zh.ts:120` — `natural_images: "自然图像",`

**症状**：同一模态在顶栏显示「自然图像 / Natural images」、在切换器显示「通用图像 / General images」；两处都以 `natural_image` 为特例，因为「模态标签来自任务注册表」而通用图像/视频没有 TaskPlugin。`SideBar.tsx:43` 的注释直接写明了这个根因。

**为何是债**：SDD 08 D-3 已把 UI 标签统一为「通用图像 / General images」，FocusTopBar 是没改到的残留，已违反 SDD；根因是模态标签挂在任务轴而非数据轴。

**建议改法**：**DataSource 下发 `label_key`（i18n 键名）+ `label`（兜底单语），前端 `useModalityLabel` 优先查 i18n 键**；删 `natural_images` 键，两处共用。不可直接下发单语 label，否则丢 en 语种（i18n 是 `I18nKey` 强类型双语表）。

**核验备注**
- 事实：两条判断与两组 i18n 键全部核对无误；FocusTopBar 已与 SDD 08 D-3 冲突。
- 价值：视频没有 TaskPlugin 时最坏是再加一个分支，neutral；外壳文案不加深四要素。根因归属数据轴。**并入 Source 协议**（`DataSource.label_key`），文案一致性作为顺手修。

#### DEBT-24 · 示例卡与空状态文案（10 分 · 降级）

**证据**
- `frontend/src/i18n/en.ts:163` — `focus_example_1_meta: "carotid_imt · CUBS",`
- `frontend/src/components/focus/FocusShell.tsx:58` — `if (canSend) void send(t(ex.prompt));`
- `docs/sdd/feats/08-data-import-first-explorer/README.md:69` — `| `GLAUX_DEV_MODE` | `1` | `0` | `1` 时内置示例源自动可见（今天的行为）；`0` 时须显式加载示例 |`

**症状**：hero 副标题已改为「图像与视频」，但三张示例卡两张是颈动脉/胎儿超声，点击即发送超声提示词；`focus_stage`/`focus_pick_image`/`focus_stage_empty`/`empty_editor` 均写「image」。

**为何是债**：示例内容随当时三个演示任务写死在 i18n。

**建议改法**：**只改 i18n 文案**——三组示例改领域中立措辞（描述照片、逐帧找事件、对比两张图），`image` 措辞改为「对象」。不改为动态生成。

**核验备注**
- 事实：五条 evidence 全准；最近提交 `0d24b65` 只改了 hero 副标题，示例卡与 image 措辞未动。
- 价值：示例卡点击只发一段文本，不读模态/store/引擎，不产生 `=== "video"` 分支，video_impact 为 neutral；动态生成与 SDD 08 冲突（`GLAUX_DEV_MODE` 缺省 0 时首屏本就无数据源），且 chat 发行包无后端会得到空示例卡。**降级**为一次文案修订。

---

### 5.5 backend

#### DEBT-25 · 对象 ID 判别散落三套约定（21 分 · 单列）

**证据**
- `backend/app/routers/api.py:369` — `if image_id.startswith(("natural_", "nat-")):`
- `backend/app/routers/api.py:375` — `if KERNEL_OK and hc_dataset.is_hc(image_id):  # 合成 HC 图（无需外部数据）`
- `backend/app/routers/api.py:378` — `return Response(content=mock.synthetic_png(image_id), media_type="image/png")`
- `backend/app/routers/annotations.py:71` — `if image_id.startswith(("natural_", "nat-")):`
- `backend/app/dataset_ct.py:22` — `_ID_RE = re.compile(r"^ct_\d{3}$")`
- `backend/app/dataset_wsi.py:27` — `_ID_RE = re.compile(r"^slide_\d{3}$")`

**症状**：`/image/{id}` 靠「前缀 → `is_hc` → mock 回退」三层判别；`annotations._dims_for` 按「前缀 → `is_wsi` → `is_ct` → glob」顺序猜；`_plugin_for` 只认 `is_wsi`。静默错误：无 CUBS 数据时 `GET /image/ct_001` 不走 404 而返回 mock 合成颈动脉 PNG。加视频要在 `/image` 加第四层判别、`_dims_for`/`_plugin_for` 各加一段、再发明一条 ID 正则。

**为何是债**：`api.py:366-368` 的注释自述前缀截住是为了防 mock 吞掉未知 ID，只是对更早的债打补丁；2026-07-07 设计要求注册表驱动，而 ID 语义散落在六个以上模块。

**建议改法**：注册表提供唯一解析入口 `resolve_object(id) -> ObjectRef{source, datasource, object_id, kind, modality}`；**采用索引方案而非改 ID 格式**——注册/seed/invalidate 时由 `Source.list_ids` 建 `id → ObjectRef` 索引，未命中再遍历 `Source.is_mine` 兜底（供 hc_synth 等惰性 id 使用）；所有端点先 resolve 再由 Source 取数；未知 id 一律 404。

**核验备注**
- 事实：九条 evidence 行号与原文全准；静默错误推演成立（`/image/ct_001` 不命中 natural 前缀也不命中 `is_hc`，落到 mock）；现有注释把它当补丁而非设计。
- 价值：按 id 判定数据源是 harness 自身的观测与动作寻址基础设施，更强模型不会让它作废，值得修。两处修正：`/images?modality=` 是数据轴的列表过滤，不算四套约定之一（四套改为三套）；fix 中「ID 规范化为 `<source_id>:<rel>`」会波及标注存储、Recent、Atlas 引用卡，应撤回，只用索引方案（cost 3）。**单列**——它是 DEBT-28（mock 回退）与后端表征面的共同前置。

#### DEBT-26 · 五个数据模块靠约定镜像（15 分 · 并入 SOURCES）

**证据**
- `backend/app/segment_ts.py:57` — `in_path = config.CT_ROOT / f"{volume_id}.nii.gz"`
- `backend/app/dataset_ct.py:65` — `return reg.resolve_root("ct_abdomen")`
- `backend/app/dataset_ct.py:99` — `def nifti_path(volume_id: str) -> str:`
- `backend/app/config.py:119` — `def root_has_data(modality: str, root: Path) -> bool:`
- `backend/app/caches.py:21` — `_CACHED: tuple[tuple[str, str], ...] = (`
- `backend/app/datasource_registry.py:92` — `def _builtin_specs() -> list[tuple]:`

**症状**：五个模块各自实现 `list_ids`/`image_meta`/`is_*`/尺寸/标定，名字与返回形状不一致，调用方按模块名硬引用；缓存失效要在 `caches._CACHED` 手工登记；`root_has_data` 五分支、`datasource_detect.detect` 按模态 if、`_builtin_specs` 五条硬编码，四处都要为视频各加一条。`dataset_ct.py:3` 与 `dataset_wsi.py:3` 的 docstring 自称「镜像」另一模块的形态。

**静默错误**：`dataset_ct.nifti_path` 走注册表 `resolve_root`，而 `segment_ts._run_live` 直接拼 `config.CT_ROOT`——经 `/datasources` 导入的 CT 源在缓存未命中时，子进程去 `data/ct` 找文件并报「CT 体积不存在」。

**为何是债**：D6 在 2026-08-27 审计中标为「等第六个模态来了再做」，视频就是第六个。

**建议改法**：定义 `Source` Protocol（modality/kind/formats/probe/list_ids/is_mine/meta/frame/raw/tile/detect_calibration/builtin_sample/invalidate）与 `SourceBase`（旧字段回填）；五个模块各追加一个 Source 类，**模块内函数体零改**；`MODALITIES = tuple(SOURCES)`；`root_has_data`/`datasource_detect`/`_builtin_specs`/`caches` 全部改为遍历 `SOURCES`；`config.py` 只剩路径与隔离环境常量。**同波收编 `backend/app/datasource_detect.py`**（`:57` `if modality == "pathology"` / `:59` `if modality == "ct_abdomen"`），否则后端字面量清零不可达。`segment_ts._run_live` 改用 `dataset_ct.nifti_path`。

**核验备注**
- 事实：12 条 evidence 全准；静默错误调用链核对成立。两处修正：`*_data_available` 实为四个且都是 `_available(modality)` 的薄封装，可用性已委托注册表，不存在「两个主人」，risk 由 4 降为 3；真正的双轨只有「按模态的探针/标定探测仍在 config/detect」与「segment_ts 绕过注册表」两处。
- 价值：Source 协议已在目标抽象中；fix 原文把 `frame/raw/tile/meta` 塞进同一个 Decoder，越界到表征轴（那属 `/objects` 端点族与 `resolve_object`），数据轴 Source 只需 probe/list/detect_calibration/builtin_sample/invalidate。视频只需机械接线，不构成阻塞，blocks 降为 complicates。**并入 SOURCES**；`segment_ts` 的 bug 拆为独立小修（cost 1），不必等重构。

#### DEBT-27 · run_task 公共前缀未上提（12 分 · 并入 DETECTORS）

**证据**
- `backend/app/kernel.py:113` — `if plugin.adapter_kind == "wall_pair":`
- `backend/app/routers/annotations.py:139` — `if dataset_wsi.is_wsi(image_id):`
- `science-core/glaux_core/segmentation/base.py:72` — `class Adapter(ABC):`

**症状**：`_detect_for_spec` 四分支各自内联「ID 谓词校验 + 数据可用性检查 + method 缺省 + 标定构造 + Primitive 组装」；`_enrich_gold` 再按两分支取金标准；`annotations._plugin_for` 只硬编码 WSI → NUCLEI_DETECTION。`models()` 四段各自 new ModelInfo，以「数据就绪」而非「方法可用」为门控；`capabilities()` 的 `_DS_META` 四条硬编码 provider/license。视频的 track 适配器 = 第五分支 + 第三分支 + 第二分支 + 第五段 + 第五条。

**为何是债**：docstring 称这是「唯一保留的分派」，理由是数据源天然不同，但四个分支骨架完全同形，差异正是注册表该承载的内容；`capabilities` 注释写「加一个数据源 = 多一张卡，不改本函数」而 `_DS_META` 就在本函数内（对导入源有回退，内建源仍硬编码）。

**建议改法**：定义 `Detector` Protocol（kind/accepted_regions/available/methods/detect/reference/apply_edit/verify）；四分支拆成四个 Detector 入 `DETECTORS`；`run_task` 上提公共前缀（resolve_object → `kind ∈ plugin.object_kinds` → available → `region.kind ∈ accepted_regions` → 标定解析），detector 只做取数；`_plugin_for` 改按 `resolve_object(id).modality` 查 REGISTRY；不变量测试 `set(REGISTRY.adapter_kind) == set(DETECTORS)`。

**核验备注**
- 事实：12 条 evidence 全准。三处修正：science-core 的 `Adapter` 已被 `hc_synth.py:37` 实例化，问题是 kernel 不按 `Adapter.kind` 分派，且该 ABC 只覆盖 2D 灰度、接不住 CT 体数据与 WSI roi_box；`capabilities` 对导入源有回退，问题是元数据没下沉到 `DataSource`；`models()` 的 wall_pair 段不受门控。risk 由 4 降为 2。
- 价值：`DETECTORS` + `resolve_object` 已在目标抽象中，`apply_edit` 与 DEBT-07 重叠，单列会重复计分；视频加第五个 if 分支不被阻断，blocks 降为 complicates。`methods()/MethodSpec/available` 属模型适配层，按 §七是负债层，不值得加厚。**并入 DETECTORS**，只保留「公共前缀上提 + `_plugin_for` 改 resolve_object」；`models()`/`_DS_META` 降为不占关键路径的顺手小 PR。

#### DEBT-28 · mock 隐式回退（12 分 · 并入 resolve_object）

**证据**
- `backend/app/routers/api.py:377` — `if not _has_data():`
- `backend/app/routers/api.py:378` — `return Response(content=mock.synthetic_png(image_id), media_type="image/png")`
- `backend/app/kernel.py:123` — `else:  # 无 CUBS 数据 → mock 合成边界（形状即契约）`
- `backend/tests/test_api.py:3` — `数据可用时测真实接入；不可用时测 mock 回退——两条路径的契约形状一致。`
- `backend/app/hc_dataset.py:34` — `return (_real_available() and hc_real.is_hc(image_id)) or hc_synth.is_hc(image_id)`

**症状**：`GET /images` 无数据时返回 40 条 mock；`/task/run` 对 wall_pair 无数据时用 mock 合成边界出「IMT 0.918mm」；`/image/{任意 id}` 兜底返回合成 PNG（DEBT-02 中 agent 看到假图的直接原因）；`/models` 同样回退。这些回退只对 US 存在——CT 缺数据返回空列表、WSI 返 503、natural 用前缀拦截返 404，行为按模态各不相同。`mock.py:30` 伪造的 ImageMeta 还带 `center="CUBS-tech"`，列表层面看不出是合成数据。

**为何是债**：mock 初衷是 CI/无数据环境能起（`api.py:3` 自述），但 science-core 已真实接入，测试隔离应靠显式合成数据源而非端点内隐式分支。

**建议改法**：mock 与 hc_synth 改为 `dev_mode()` 下显式注册的 `synthetic-us`/`synthetic-hc` 两个 Source；端点删除 `_has_data()` 分支，无源即 404/空列表；测试改为注册合成源 fixture。

**核验备注**
- 事实：四条 evidence 全准，另发现两处未列出的回退（`/image/{id}`、`/models`）；「CT/WSI 走 503」不准确，应改为「各模态行为不一致」。
- 价值：修复路径就是 `resolve_object` 的直接副产物；hc_synth 有白名单、不对任意 id 出图，更接近一个本就该存在的内置合成源；`test_api.py` 依赖 mock 路径，cost 至少 3；视频不写 mock 分支就不受影响，neutral。**并入 resolve_object**，验收条为「未知 id 返回 404，不出合成图」。

---

### 5.6 science-core

#### DEBT-29 · 无时间基、无帧索引、无视频解码面（20 分 · 并入 VideoSource）

**证据**
- `backend/app/upload_store.py:20` — `_MAGIC: dict[str, bytes] = {`
- `science-core/glaux_core/contracts.py:24` — `未来模态（Keypoints / 视频帧掩膜）按需在此追加一个 dataclass +`
- `science-core/glaux_core/contracts.py:203` — `roi_used: tuple[int, int] | None = None`
- `science-core/glaux_core/calibration/calibration.py:34` — `MPP = "mpp"  # P7：WSI 像素物理尺寸（µm/px，2 元 tuple (mpp_x, mpp_y)）`

**症状**：contracts 只有空间原语，`CFSource` 没有时间基；`Detection.roi_used` 是一维列窗装不下帧区间；`tasks.py:132` 的 `"video"` 只是注释；`_MAGIC` 只有 jpg/jpeg/png 且按文件头前缀比对（mp4 的 `ftyp` 在 offset 4，需改按偏移校验）；后端依赖清单无任何视频解码库；`config.root_has_data` 无 video 分支。

**为何是债**：contracts docstring 已把「视频帧掩膜按需追加」写成待办；纲领把帧、时间、轨迹、事件列为分析对象。

**建议改法**：拆三部分——(a) 帧索引与 `Detection.region` 随 `Focus.index` 与 DETECTORS 一起做；(b) 视频解码与上传魔数随 `VideoSource` 一起做（`_MAGIC` 由 `SOURCES[*].formats` 汇总，增 mp4 `ftyp@4`、webm `0x1A45DFA3`；`pyproject` 增 `av`，惰性 import，缺库 `probe` 返 False）；(c) Track/Event 与 `resolve_video_calibration` 推迟到第一个 tracker Detector 落地。

**核验备注**
- 事实：六条 evidence 全准；项目源码中 grep `FrameRef`/`Track`/`Event`/`mp4`/`ftyp` 零命中；无注释表明有意不支持视频。这更接近能力缺口而非副本债，risk 由 5 降为 3。
- 价值：是「功能未实现」而非「已有实现的结构负债」，记成 impact 5 会抬高排序；三块内容分别与 DEBT-04、DEBT-05、DEBT-26 重复，去重后只剩上传魔数（约 10 行）与依赖；在没有第一个视频任务前先定 `Track{keyframes}`/`Event{t0,t1}` 属投机建模；`fps` 是时间轴元数据（属 `axes` 的 t 轴），塞进 `CFSource` 是语义错位。**并入 VideoSource 第 1 波验收清单**。

---

### 5.7 agent-runtime

#### DEBT-30 · 观测与标注契约缺参考帧（20 分 · 并入 fetchObservation）

**证据**
- `agent-runtime/src/pi/tools/locate-roi.ts:103` — `const res = await doFetch(`${base}/image/${encodeURIComponent(imageId)}`, { signal });`
- `agent-runtime/src/pi/vision.ts:293` — `const scaled = looksNormalized ? [nums[0]! * width, nums[1]! * height, nums[2]! * width, nums[3]! * height] : nums;`
- `agent-runtime/src/pi/tools/propose-annotation.ts:47` — `z: Type.Optional(`
- `backend/app/routers/api.py:380` — `return Response(content=dataset.image_png(image_id), media_type="image/png")`

**症状**：`locate_roi` 把归一化框乘回「取到的 PNG 尺寸」，再交给 `propose_annotation` 当「图像像素坐标」写库；backend `_dims_for` 却按 WSI level-0 / CT 单层校验。`propose_annotation` 只有 `z`，没有 `t`/`level`/`offset`，视频帧标注与时间区间无法表达。`readImageSize` 只认 PNG/JPEG。

**为何是债**：SDD 02 D-8/D-9 把「模型答归一化、runtime 乘回像素、前端做世界坐标」定为契约，只在「2D 位图 = 对象本身」时成立；`README.md:282` 的「runtime 不碰视口，也不需要前端暴露任何视口元数据」在 CT/WSI/视频下不再成立——观测本身就是视口的函数。

**建议改法**：引入 `ReferenceFrame{object_id, index, origin, scale, width, height}`，由 `/objects/{id}/frame` 随图返回（响应头）；`locateInImage` 输出附 frame；`propose_annotation` 加 `index` 并由 runtime 用 `toObjectCoords` 换算后再写库。

**核验备注**
- 事实：七条 evidence 全准。需修正 symptom：现状不是「坐标静默落错坐标系」，而是「CT/WSI 根本拿不到观测」——`/image/{id}` 只认 natural/hc/CUBS，CT/WSI 走到 `dataset.image_png` 后 404，`locate_roi` 显式抛 `image_unavailable`；唯一会静默出错的是无数据时返回 mock 图。risk 由 4 降为 2（改为「未来风险」）。
- 价值：`Focus` + `/objects/{id}/frame` 带 `X-Glaux-Frame` + `fetchObservation(focus)` 已在目标抽象中，fix 与之逐字重合；视频第一步可按「取某一帧当 2D 图」接入（`origin=0, scale=1`），缺的只是透传 `t`。**并入 fetchObservation**，作为其验收用例。

#### DEBT-32 · 工具工厂是固定 if 序列（15 分 · 并入 ToolProvider）

**证据**
- `agent-runtime/src/pi/harness-registry.ts:107` — `if (segmentationEgressAllowed() && process.env.GLAUX_SEG_API_TOKEN?.trim()) {`
- `agent-runtime/src/pi/harness-registry.ts:147` — `function systemPromptFor(`
- `agent-runtime/src/pi/harness-registry.ts:236` — `tools.some((tool) => tool.name === CONSULT_ATLAS_TOOL_NAME),`

**症状**：工具挂载条件只看 permissionMode / vision / egress 环境变量：CT/WSI 下照样挂 `segment_region`（拿到的是假图）；视频需要的抽帧/跟踪类工具没有登记位；`systemPromptFor` 用 5 个布尔参数逐个拼段落，每加一个工具都要改签名，且要靠 `tools.some(name===…)` 反推。

**为何是债**：注释「挂一个必然失败的工具只会让模型反复重试」原则正确，但按对象类型的门控从未实现；工厂是 P3 过渡期一次性写法，不是插件面。

**建议改法**：`ToolProvider{name, requires, supports(focus), create, promptFragment}` + `TOOL_PROVIDERS`；六个现有工具包成 provider；`defaultToolFactory` 改遍历过滤；系统提示词 = 基础句 + 按 `object.kind` 生成当前对象句 + `promptFragment` 拼接。

**核验备注**
- 事实：证据成立（`:234` 一条是 234-241 的压行）；runtime 全域 grep 不到对 `TaskPlugin.capabilities` 的读取；`9a90d6b` 只加了 chat 短路，未改门控结构。
- 价值：`ToolProvider` 已在目标抽象中；加一个工具现状代价约 10 行，是线性增长不是结构性阻塞，video_impact 降为 neutral；「CT/WSI 下拿假图」的根因在取图（DEBT-02），按 `supports(focus)` 门控也要先有 Focus；`capabilities` 是前端画笔能力位，不能当 supports 判据。**并入 ToolProvider**，随 Focus 落地时一并完成。

#### DEBT-31 · 提示词写死 biomedical / image（10 分 · 并入 ToolProvider）

**证据**
- `agent-runtime/src/pi/harness-registry.ts:117` — `"You are Glaux's built-in reference assistant for biomedical image insight. " +`
- `agent-runtime/src/pi/harness-registry.ts:162` — `if (!viewer?.image_id) return `${head} No image is currently open in the viewer.`;`
- `agent-runtime/src/pi/tools/run-task.ts:34` — `Type.String({`
- `agent-runtime/src/pi/tools/run-task.ts:114` — `const task = params.task?.trim() || viewer.task;`

**症状**：纲领 v2 的领域是「图像与视频，通用场景」，runtime 在 5 处把身份写死为 biomedical（`harness-registry.ts:117`、`consult-atlas.ts:124`、`vision.ts:40/55/220`）；`systemPromptFor` 只会说 "image"/"No image is currently open"，视频对象打开时提示词语义错误。

**为何是债**：纲领 §七第一问：更强模型会让硬编码提示词链作废——这些字符串正是负债。

**建议改法**：系统提示词改「visual analysis harness」并按 `object.kind` 生成当前对象句；三条 vision system 改领域无关措辞，领域偏好由 atlas collection / task 标签注入。

**核验备注**
- 事实：九条 evidence 全准，但两处夸大需修正：biomedical 只出现 5 行不是 8 处（`locate-roi.ts:163`、`segment-region.ts:142` 是工具分工提示，属有意路由区分）；`run-task.ts:32-37` 的 `task` 是自由 `Type.String`，四个 id 只在描述的 "e.g." 举例里，加视频任务不必改，与 DEBT-08 的手抄模式不同。
- 价值：措辞属提示词文案，改掉就是几处字符串替换，按 §七反向判据它会随模型变强自然失去意义，不值得排进架构治理；「视频打开时说 image」是真问题，但被 `ViewerContext → object+focus` 与 `ToolProvider.promptFragment` 覆盖。**并入 ToolProvider**（image 语义部分），措辞部分随战略转向文案清扫。

#### DEBT-33 · 取图/过滤/摘要是模块私有函数（6 分 · 并入 fetchObservation）

**证据**
- `agent-runtime/src/pi/tools/segment-region.ts:96` — `async function fetchImageBytes(`
- `agent-runtime/src/pi/tools/segment-region.ts:108` — `function summarize(region: SegmentedRegion, index: number): string {`
- `agent-runtime/src/pi/tools/segment-region.ts:171` — `const raw: SegmentResult[] = await clientOf().segment({`
- `agent-runtime/src/annotation/segmentation-client.ts:8` — `* 2026-08-24 实测记录（决定了本文件的几处写法，换后端时须重新核对）：`

**症状**：`SegmentInput` 只有 image/prompt，`SegmentResult` 只有单帧多边形；取图写死 `/image/{id}` 且只认 `viewer.image_id`；过滤、排序、摘要内联在 `execute` 里且模块私有，新增视觉工具只能复制。

**为何是债**：文件头明确记录这是「首个后端 Gitee sam3」的实测适配，接口形状按供应商契约而非按动作空间抽象。

**建议改法**：`SegmenterPort{segment, track?}`，`SegmentationClient` 为首个实现，`segment-region.ts` 依赖 Port；取图改调 `fetchObservation`，过滤/摘要随之可复用。

**核验备注**
- 事实：三条 evidence 核实（`:41-42` 一条是压行）；依赖具体类比描述更硬（`SegmentationClient` 带 private 字段，TS 按名义类型处理，结构相同的另一实现也注入不进来）；取图与 summarize 实际在 `segment-region.ts` 而非 client 内。
- 价值：真正会被复制的三段全在 `segment-region.ts`，抽 Port 一行都阻止不了，能阻止的是 `fetchObservation` + `ToolProvider`；该文件通篇是供应商实测适配（端点、payload、RLE 语义、配额报错映射），换模型时整体重写，按 §七投在它的接口形状上就是投在负债上；视频第一刀可逐帧调现有 `segment()`，neutral。**并入 fetchObservation/ToolProvider**，`SegmenterPort` 只立 `segment` 单方法，`track?` 等真有第二个后端时再谈。

---

### 5.8 tests

#### DEBT-35 · 用例绑定楔子字段名与枚举字面量（12 分 · 降级）

**证据**
- `backend/tests/test_datasource_registry.py:43` — `assert len(builtins) == len(reg.MODALITIES) == 5`
- `science-core/tests/test_tasks.py:63` — `assert plugin.adapter_kind in {"wall_pair", "contour", "volume", "wsi"}`
- `backend/tests/test_api.py:100` — `assert len(imgs) > 0 and imgs[0]["center"] == "CUBS-tech"`
- `frontend/src/data/actions.test.ts:24` — `activeVolume: "ct_001",`
- `frontend/src/agent/toolBridge.test.ts:202` — `cubs_cf: 0.06,`
- `agent-runtime/src/transport/routes.ts:325` — `function parseViewer(value: unknown): ViewerContext | undefined {`

**症状**：前端只测 `selectNaturalImage` 且断言「三个互斥槽被置空」，`toolBridge.test.ts` 用 `toEqual` 字面锁死 ViewerContext 摊平形状；三个查看器组件零测试；`parseViewer` 零用例；后端 `==5` 与 `adapter_kind` 枚举断言加视频必改；无用例覆盖「`/image/{ct_id}` 应 404 而非 mock 图」与「`/task/measure` 对 CT/WSI 任务」。

**为何是债**：用例绑定实现细节（字段名、枚举成员）而非行为/不变量。

**建议改法**：重构前先补行为/不变量测试——`openObject` 后 `activeObject().id` 与 `toViewerContext().focus.object_id` 一致；切对象后拒绝旧 id；`set(REGISTRY.adapter_kind) == set(DETECTORS)`；每个 `SOURCES` 键有 `builtin_sample`；补 `parseViewer` 契约用例与两条回归。

**核验备注**
- 事实：16 条 evidence 全准。两处修正：`annotationTools.test.ts:39` 已是一条真正的不变量测试（三模态轮转复位），故不能说「全部绑定字面量」；`actions.test.ts:14` 的模态字面量只是 setup 而非被锁死的断言。另实测：前端旧字段共 33 处（FocusSidePanel 11、actions 9、FocusTopBar 9、SideBar 3、imtWallTool 1），**`toolBridge.test.ts` 对这四个字段 0 命中**，原估算有误。
- 价值：fix 的主体（painters/useBrushBuffer/FrameSource/MaskSink 的测试）被测对象今天还不存在，为尚未存在的模块立测试债等于复制 FrameStackViewer 的验收条件；单元测试不加深四要素，断言重写正是「更强模型会顺手改掉」的工作量；加视频时各处只需改一个字面量，实质 neutral。**降级**为各重构条目的通用验收约束：每个重构提交把它触及的测试从字面量断言改为 selector/不变量断言。两条回归用例（`/image/{ct_id}` 404、`/task/measure` 携 voxel 标定）归到 DEBT-02/DEBT-05 名下。

---

## 6. 被事实核验推翻的项 + 归并阶段剔除的项

| 项 | 类型 | 原主张 | 剔除理由 |
| --- | --- | --- | --- |
| DEBT-34 | 事实推翻 | `ViewerContext.modality`（数据集键）与 `AtlasDescription.modality`（成像方法）同名异义，接视频时两边都会被迫塞不对的值 | 两个字段在代码里从不相遇：`consult-atlas.ts:79` 只取 `{summary, findings}`，`AtlasDescription.modality`（`vision.ts:28`）根本不回到会话；`DESCRIBE_SYSTEM`（`vision.ts:38-50`）是独立视觉调用，不带 ViewerContext。`MODALITIES` 是可扩充的数据源键，视频加一个新键即可；`AtlasDescription.modality` 是自由文本，视频帧照样有成像方法。`harness-registry.ts:167-168` 已刻意注释「措辞强调目录标签」，是有意设计且理由仍成立。fix 落点 `frontend runtime/types.ts:104` 不存在（仓库无该目录）。实为命名卫生，且已被 Focus 改造完全覆盖 |
| FC-12 | 归并剔除 | `TerminalView` 是工作台里无归属的自绘起壳 | video_impact neutral，与通用化/接视频无关；不加深也不阻碍四要素。属工作台插件化时的删减项，随 `README.zh-CN.md:39` 的插件交付一并处理 |
| AR-9 | 归并剔除 | SDD 02/04/07/08 把模态专属 ViewerContext 形状与三引擎能力位写成验收条款 | 纯文档层发现，与 `docs/todo/2026-09-17-001` 文档摸排范围重叠；本次审计不重复文档摸排。其 SDD 联动要求已分散写入 DEBT-01（SDD 02 §4.1/§9/D-9）、DEBT-04（SDD 04 §8.2/§9.1）、DEBT-07（SDD 04 §7.4）、DEBT-19（SDD 04 能力位枚举）、DEBT-05（SDD 08）等条目的 fix；「新建 SDD 10」的建议保留为 DEBT-01/02/30 的共同落点 |

### 合并说明（原始发现 → 本表 ID）

| 目标 | 来源 |
| --- | --- |
| DEBT-01 | FS-7、AR-1、FS-8 |
| DEBT-02 | BE-3、AR-2 |
| DEBT-03 | FS-1、FC-9、FC-2 |
| DEBT-04 | FV-8、BE-11 |
| DEBT-05 | FS-4、BE-6、AR-6、FC-11 |
| DEBT-06 | FS-9、BE-2 |
| DEBT-07 | FV-6、BE-9 |
| DEBT-08 | FS-6、BE-12 |
| DEBT-10 | FS-2、FC-4 |
| DEBT-12 | FV-1、FV-2 |
| DEBT-19 | FV-11、FC-5、FC-13（FC-5 原引用 ViewerChrome 行号 141/156/202 经核对为 49/64/110，已用核对后的行号） |
| DEBT-20 | FC-1、FC-3 |
| DEBT-26 | BE-4、BE-5 |
| DEBT-27 | BE-7、BE-8 |
| DEBT-35 | FS-10、FV-12、TEST-1、AR-10 |

合并项评分取各分项中位数，两项时取均值向上取整。

---

## 7. 目标抽象

**名称**：对象收敛 —— 一个 Focus · 一张对象表 · Source/Detector 两张后端表 · `/objects` 表征面 · 帧栈引擎 · 最小 ToolProvider

### 7.1 一页纸

骨架取「增量收敛」：不引入新层，把每处「N 份并列」收成「1 份 + 判别字段」。

现有骨架（`TaskPlugin`/`REGISTRY`、`/task/run`、`ENGINES`、`bridge.ts`、`datasource_registry`）方向已对，债务全是楔子时期的并列副本，最小 diff 是合并同类项。新增的 `axes`/`Focus`/`resources`/`ToolProvider` 都是「让第七个模态也不必再改核心」的最小补丁，不是新层。

对纲领 §七：`Focus` + `ReferenceFrame` + `/objects/{id}/frame` 加深**观测空间**；`openObject`/`runTask`/`edits`/`annotations` 加深**动作空间**；`Detector.verify` 与未来的 Track/Event 加深**验证器与轨迹**。更强模型作废的是 `DETECTORS` 里的模型适配，不是这些。

**六个名词，三张表，两个动作：**

| 名词 | 定义 | 取代 |
| --- | --- | --- |
| `ObjectMeta` | `{id, kind, modality, source_id, display_name, axes[], calibration, resources, methods[]}` | `cf`/`voxel_spacing_mm`/`mpp_um`/`dims` 四并列可空 |
| `Focus` | `{object_id, kind, index{z?,t?,level?}, region}` | 三槽 + `wsiRoi` + 组件本地 `z` + 两份三分支投影 |
| `Calibration` | `{kind, value, source, provenance}`，kind 为开放集 | 三种分立标定构造无派发入口 |
| `Region` | 判别联合 `box`/`column_window`/`slice`/`frame_range` | `roi`/`roi_box` 并列 |
| `ReferenceFrame` | `{object_id, index, origin, scale, width, height}` | 「观测 = 整幅 2D 位图」的隐含假设 |
| `Index` | `{z?, t?, level?}` | `Annotation.z` 的 CT 层号语义 |

| 表 | 键 | 职责 |
| --- | --- | --- |
| `SOURCES` | modality | 数据轴：probe / list_ids / meta / frame / raw / tile / detect_calibration / builtin_sample |
| `DETECTORS` | adapter_kind | 动作轴：detect / reference / apply_edit / verify / methods |
| `REGISTRY` | task | 任务轴（不变，只加 `object_kinds`/`trigger`/`classes`） |

| 动作 | 语义 |
| --- | --- |
| `openObject(id)` | noteRecent → setFocus → clearOverlays → `(task?.trigger ?? "manual") === "on_open" && runTask()` |
| `runTask(region?)` | calibration 取自 `activeObject()`，region 取自参数或 `focus.region` |

### 7.2 核心类型草图

#### TypeScript（`frontend/src/api/types.ts`；`agent-runtime/src/contracts.ts` 逐字镜像 ObjectMeta/Focus/Region/Calibration/ReferenceFrame）

```ts
/** kind = 几何族（引擎/解码/校验的分派键）。modality = 数据集路由键。
 *  AtlasDescription.modality = 成像方法。三者不互换（DEC-3）。 */
export type ObjectKind = "image" | "volume" | "slide" | "video";
export type AxisName = "x" | "y" | "z" | "t" | "level";
export interface Axis { name: AxisName; size: number; spacing?: number; unit?: "px" | "mm" | "um" | "ms" | "factor" }

/** 开放集：kind 为 string，前端按已知 kind 渲染、未知 kind 只显示 source。 */
export interface Calibration { kind: "mm_per_px" | "voxel_mm" | "mpp_um" | "time_base" | (string & {}); value: unknown; source: string; provenance?: Record<string, unknown> }

export interface ObjectMeta {
  id: string;                       // 原样保留 tech_/hc_/ct_/slide_/natural_/nat-；新源服务端派生（DEC-7）
  kind: ObjectKind;
  modality: string;                 // 放宽为 string；核心目录禁止 === 字面量（DEC-14 门禁）
  source_id: string;
  display_name: string;
  axes: Axis[];                     // image:[x,y] volume:[x,y,z] slide:[x,y,level] video:[x,y,t]
  calibration: Calibration | null;
  resources: { frame: string; raw?: string; tiles?: string };   // 后端下发 URL 模板，前端不拼路径
  methods: { name: string; role: "gold" | "agent" | "reference" }[];
  meta: Record<string, unknown>;    // 原 center 等自由元数据（不再必填）
  /** 过渡一版（第 7 波删）：cf / voxel_spacing_mm / mpp_um / dims，由 SourceBase 从 axes/calibration 回填，前端 lint 禁读 */
}
export type ImageMeta = ObjectMeta;  // 过渡别名一版

export interface Index { z?: number; t?: number; level?: number }
export type Region =
  | { kind: "box"; x0: number; y0: number; x1: number; y1: number }          // level-0 / 帧像素（DEC-9）
  | { kind: "column_window"; x0: number; x1: number }
  | { kind: "slice"; z: number }
  | { kind: "frame_range"; t0: number; t1: number; seed?: { t: number; box: [number, number, number, number] } };
export interface Focus { object_id: string; kind: ObjectKind; index: Index; region: Region | null }
export interface ReferenceFrame { object_id: string; index: Index; origin: [number, number]; scale: number; width: number; height: number }

export interface TaskView {
  task: string; modality: string; object_kinds: ObjectKind[]; tools: ToolDef[];
  capabilities: string[];           // 开放集：bbox|polygon|brush|wall|voi|z_scroll|timeline|verify
  trigger: "on_open" | "on_region" | "manual"; classes?: ClassSpec[];
  metrics: MetricDef[]; overlays: OverlaySpec[]; /* viewer 保留但 Viewer.tsx 不再读（DEC-11） */
}
export interface TaskSpec { task: string; image_id: string; method?: string; calibration?: Calibration; region?: Region }   // 字段名 image_id 保留（DEC-8）

// ---- store ----
interface SessionState {
  modality: string | null; activeModel: string | null;
  objects: Record<string, ObjectMeta[]>;   // key = modality；缺键 = 未加载，空数组 = 已加载为空
  focus: Focus | null;                     // 取代三槽 + wsiRoi + VolumeViewer 本地 z
  coords: { x: number; y: number } & Index;
  toolOptions: Record<string, Record<string, unknown>>;   // 按能力位分槽：brush / voi / playback
  setFocus(f: Focus | null): void; setIndex(p: Index): void; setRegion(r: Region | null): void;
  setObjects(modality: string, list: ObjectMeta[]): void;
}
export const activeObject = (s: SessionState): ObjectMeta | null =>
  s.focus ? objectsOf(s, s.modality).find(o => o.id === s.focus!.object_id) ?? null : null;

// ---- actions ----
export async function loadObjects(modality: string): Promise<void>;   // GET /images?modality=
export async function openObject(id: string): Promise<void>;
export async function runTask(region?: Region): Promise<boolean>;

// ---- 查看器契约（frontend/src/viewer/contract.ts）----
export type FrameAxis = { kind: "none" } | { kind: "z" | "t"; index: number; count: number; fps?: number; onIndex(i: number): void };
export interface FrameSource { objectId: string; imageIds(): Promise<string[]>; dims(): Promise<{ columns: number; rows: number; frames: number }>; defaultVoi?: { ww: number; wl: number } }
export interface MaskSink { commit(mask: Uint8Array, dims: { columns: number; rows: number }, index: Index): Promise<void> }   // annotationMaskSink / editMaskSink（DEC-6）
export type Painter = (ctx: CanvasRenderingContext2D, p: Primitive, proj: (x: number, y: number) => [number, number], o: { color: string; index: Index; classes?: ClassSpec[] }) => void;
export interface ViewerProps { object: ObjectMeta; focus: Focus; task: TaskView | null; source: FrameSource; axis: FrameAxis; voi: { ww: number; wl: number } | null;
  primitives: Primitive[]; annotations: Annotation[]; tool: string; toolOptions: Record<string, unknown>; maskSink: MaskSink; painters: Record<string, Painter>; onCoords(c: SessionState["coords"]): void }
export const ENGINES: Record<ObjectKind, ComponentType<ViewerProps>> = { image: FrameStackViewer, volume: FrameStackViewer, video: FrameStackViewer, slide: PyramidViewer };
export const axisFor = (o: ObjectMeta): "z" | "t" | null => o.axes.find(a => a.name === "z" || a.name === "t")?.name ?? null;
export const PAINTERS: Record<string, Painter>;
export const CHROME_SEGMENTS: { cap: string; Seg: ComponentType }[];              // voi→VoiSeg, timeline→TimelineSeg, brush→BrushSeg
export function registerTaskTool(name: string, ToolClass: unknown, activate: (tg: unknown) => void): void;

// ---- agent-runtime ----
export interface ViewerContext {           // 名字不改，字段收敛
  collection?: string;                     // 原 modality（数据集键）
  task?: string; method?: string;
  object?: Pick<ObjectMeta, "id" | "kind" | "axes" | "calibration">;
  focus?: Focus;
  /** 过渡一版：image_id / modality / cubs_cf / roi_box；object/focus 优先，旧字段仅在缺失时映射并 warn（DEC-9） */
}
export interface Observation { bytes: Uint8Array; mime: string; frame: ReferenceFrame }
export function fetchObservation(base: string, focus: Focus, opts?: { size?: number; signal?: AbortSignal }): Promise<Observation>;   // 唯一取图处
export function toObjectCoords(box: [number, number, number, number], frame: ReferenceFrame): Region;
export interface ToolProvider { name: string; requires: { vision?: boolean; egress?: boolean; runtime?: boolean };
  supports(focus: Focus | undefined): boolean; create(ctx: HarnessToolContext): HarnessTool; promptFragment(ctx: HarnessToolContext): string }
export const TOOL_PROVIDERS: ToolProvider[];
export interface SegmenterPort { segment(req: SegmentRequest): Promise<SegmentResult> }   // track? 推迟
```

#### Python（`backend/app/sources/base.py` · `detectors/base.py` · `schemas.py` · science-core）

```python
class Source(Protocol):
    """一个模态一个实现；把现有 dataset_*.py 的函数装进对象，模块内部函数零改。"""
    modality: str
    kind: str                                          # ObjectKind
    formats: tuple[tuple[str, bytes, int], ...]        # (后缀, 魔数, offset)，供 upload_store 与 /datasources.importable
    def probe(self, root: Path) -> bool: ...           # 取代 config.root_has_data 的 if 分支
    def list_ids(self, source: DataSource) -> list[str]: ...
    def is_mine(self, object_id: str) -> bool: ...     # 仅作 resolve_object 索引未命中时的兜底（DEC-7）
    def meta(self, source: DataSource, object_id: str) -> ObjectMeta: ...
    def frame(self, source: DataSource, object_id: str, index: Index, *, roi: Region | None = None,
              size: int | None = None, window: tuple[float, float] | None = None) -> tuple[bytes, str, ReferenceFrame]: ...
    def raw(self, source: DataSource, object_id: str) -> tuple[Path | bytes, str] | None: ...
    def tile(self, source: DataSource, object_id: str, level: int, col: int, row: int) -> bytes | None: ...
    def detect_calibration(self, root: Path) -> dict: ...   # 取代 datasource_detect.detect 的模态 if
    def builtin_sample(self) -> DataSource | None: ...      # 取代 _builtin_specs 硬编码；provider/license 在此
    def invalidate(self) -> None: ...                       # 取代 caches._CACHED

class SourceBase:
    """缺省实现基类：meta() 后统一从 axes/calibration 回填过渡期旧字段——服务端只有一套真相（DEC-10）。"""

SOURCES: dict[str, Source] = {}                        # datasource_registry.MODALITIES = tuple(SOURCES)

@dataclass(frozen=True)
class ObjectRef:
    source: Source; datasource: DataSource; object_id: str; kind: str; modality: str

def resolve_object(object_id: str) -> ObjectRef:
    """唯一 id 解析入口。先查注册表索引（id→ObjectRef，register/seed/invalidate 时由 list_ids 重建），
    未命中再遍历 SOURCES.is_mine 兜底。未知 → LookupError → 404，无 mock 回退。"""

class Axis(BaseModel):        name: Literal["x","y","z","t","level"]; size: int; spacing: float | None = None; unit: str = "px"
class Calibration(BaseModel): kind: str; value: object; source: str; provenance: dict = {}
class Index(BaseModel):       z: int | None = None; t: int | None = None; level: int | None = None
class Region(BaseModel):      kind: Literal["box","column_window","slice","frame_range"]; x0: int | None = None; y0: int | None = None; x1: int | None = None; y1: int | None = None; z: int | None = None; t0: int | None = None; t1: int | None = None; seed: dict | None = None
class ReferenceFrame(BaseModel): object_id: str; index: Index; origin: tuple[float, float]; scale: float; width: int; height: int

class ObjectMeta(BaseModel):
    id: str; kind: str; modality: str; source_id: str; display_name: str = ""
    axes: list[Axis]; calibration: Calibration | None = None
    resources: dict[str, str]; methods: list[dict] = []; meta: dict = {}
    cf: float | None = None; voxel_spacing_mm: list[float] | None = None
    mpp_um: list[float] | None = None; dims: list[int] | None = None   # 过渡一版
    def axis(self, name: str) -> Axis | None: ...
    def check_index(self, index: Index) -> None: ...   # 越界 → ValueError；取代 _dims_for + _check_within_dims 阶梯
ImageMeta = ObjectMeta                                  # 过渡别名一版

class TaskSpec(BaseModel):
    task: str; image_id: str; method: str | None = None
    calibration: Calibration | None = None; region: Region | None = None
    cubs_cf: float | None = None; roi: tuple[int, int] | None = None; roi_box: tuple[int, int, int, int] | None = None   # 过渡一版
    @model_validator(mode="after")
    def _legacy(self): ...   # cubs_cf→calibration{mm_per_px}; roi→region{column_window}; roi_box→region{box,(x0,y0,x1,y1)}

class EditRequest(BaseModel): task: str; method: str; base_seq: int; ops: list[EditOp]   # EditOp{index, class_id, mode, mask_png}

# backend/app/detectors/base.py —— 动作轴（与 science-core Adapter.kind 同名字空间，但不继承；见 §7.8）
class Detector(Protocol):
    kind: str                                                       # == TaskPlugin.adapter_kind
    accepted_regions: tuple[str, ...]
    def available(self) -> bool: ...
    def methods(self) -> list[MethodSpec]: ...
    def detect(self, ref: ObjectRef, obj: ObjectMeta, spec: TaskSpec) -> tuple[Detection, CalibrationResult]: ...
    def reference(self, ref: ObjectRef, obj: ObjectMeta) -> Detection | None: ...     # _enrich_gold 归位
    def apply_edit(self, ref: ObjectRef, obj: ObjectMeta, req: EditRequest) -> EditResult | None: ...
    def verify(self, ref: ObjectRef, obj: ObjectMeta, output: TaskOutput) -> VerifyReport | None: ...

DETECTORS: dict[str, Detector] = {}

def run_task(spec: TaskSpec) -> dict:
    plugin = REGISTRY[TaskType(spec.task)]
    ref = resolve_object(spec.image_id); obj = ref.source.meta(ref.datasource, spec.image_id)
    if ref.kind not in plugin.object_kinds: raise ValueError("对象几何族与任务不符")          # 公共前缀①
    det_impl = DETECTORS[plugin.adapter_kind]
    if not det_impl.available(): raise RuntimeError(...)                                   # 公共前缀②（503）
    if spec.region and spec.region.kind not in det_impl.accepted_regions: raise ValueError(...)   # 公共前缀③（422）
    cal = calibration_from_dict(spec.calibration.model_dump()) if spec.calibration else resolve_calibration_for(obj)   # 公共前缀④
    det, cal = det_impl.detect(ref, obj, spec)
    ...  # 信封组装不变

# science-core：只追加
# contracts.py  —— 各 Primitive 加 at: Index | None = None；Detection 增 region（roi_used 保留一版）
# calibration.py —— CFSource.TIME_BASE；resolve_calibration_for(obj) 按 kind 派发；calibration_from_dict（未知 kind → HardReject）
# tasks.py      —— TaskPlugin 增 object_kinds / trigger / classes；capabilities 开放集并下发 voi/z_scroll/timeline/verify；viewer 标 deprecated
```

### 7.3 接缝表

| 接缝 | 归属 | 契约 | 取代 |
| --- | --- | --- | --- |
| **S1 ObjectMeta** | backend `schemas.py` 定义 → frontend/runtime 镜像 | `/images?modality=` 与 `/objects/{id}` 只返回 ObjectMeta；`axes` 决定引擎轴与 `check_index`，`calibration.kind` 决定标定构造（开放集），`resources` 决定表征 URL；旧字段由 SourceBase 回填，前端 lint 禁读，第 7 波删 | `schemas.py:58-66` 四并列可空与 `:60 center` 必填；`client.ts` 的 `volumeUrl`/`wsiTileUrl` 前端拼路径 |
| **S2 Focus** | frontend store（唯一写入者）→ runtime `ViewerContext.focus`（只读）→ backend `TaskSpec.region`/`Index` | store 只存 focus；`activeObject()` 反查 objects；`toViewerContext` 只做 `{collection, task, method, object, focus}`；`toolBridge` 比对 `focus.object_id`（+`index.t`）；`parseViewer` 按 `object.kind` 判别校验，旧字段仅在缺失时映射并 warn | `session.ts:226-229` 三槽 + wsiRoi；`toolBridge.ts:87-91`；`useConversation.ts:20-36`；`contracts.ts:94-101`；`routes.ts:350`；`VolumeViewer.tsx:51` 本地 z |
| **S3 SOURCES + resolve_object** | backend `sources/` + `datasource_registry.py` | 每个 `dataset_*.py` 末尾追加一个 Source 类并注册（模块内函数零改）；`MODALITIES = tuple(SOURCES)`；`root_has_data`/`datasource_detect`/`_builtin_specs`/`caches`/上传魔数全部改遍历 SOURCES；`resolve_object` 先查索引再 `is_mine` 兜底；未知 id 404；mock/hc_synth 改 dev_mode 显式注册 | `datasource_registry.py:32, 92`；`api.py:131-147, 369-382`；`annotations.py:66-96`；`config.py:119`；`caches.py:21`；`upload_store.py:20-24`；`uploads.py:35`；`hc_dataset.py:24-30` |
| **S4 /objects 表征面** | backend `routers/objects.py`（新）；`api.py` 旧端点退 alias | `GET /objects/{id}`、`/frame`（`X-Glaux-Frame` 头；slide 强制 level，roi 超限 413）、`/raw`、`/tiles/{l}/{c}/{r}`、`POST /edits`；列表仍是 `/images?modality=`；`/image`、`/volume/*`、`/wsi/tile`、`/volumes`、`/slides` 保留一版 alias，内部全走 resolve_object | `api.py:150-160, 304-306`（同源分端点）；`api.py:225, 233`（task Literal 与 mask-edit）；`client.ts` 四个列表方法与逐模态资源方法；`view-image.ts:98`、`locate-roi.ts:102` 直连 `/image/{id}` |
| **S5 DETECTORS + run_task 公共前缀** | backend `detectors/` + `kernel.py`；science-core `TaskPlugin.object_kinds` 门控 | Detector 协议七件；run_task 统一做 resolve → kind 门控 → available → region.kind → 标定，detector 只做取数；`models()` 汇总 `Detector.methods()`；不变量 `set(REGISTRY.adapter_kind) == set(DETECTORS)` | `kernel.py:115-203` 四分支；`kernel.py:123` mock 合成边界；`kernel.py:277-282` 恒 CUBS；`models()` 四段与 `_DS_META` |
| **S6 标定** | science-core `calibration.py`（解析）；backend（调用）；frontend（展示） | `CFSource` 增 TIME_BASE；`resolve_calibration_for(obj)` 按 kind 派发到既有三个 `resolve_*`；`calibration_from_dict` 未知 kind → HardReject；`TaskMeasureRequest.cf` → `calibration` | `calibration.py:73/103/121` 三个分立 `resolve_*` 无派发入口；`schemas.py:52` `cf: float = Field(gt=0)`（对 CT/WSI 必错）；`kernel.py:132/144` 绕过 resolve 直接构造 |
| **S7 原语索引维** | science-core `contracts.py`（真相源）→ backend annotations（校验）→ frontend types/painters | 每个 Primitive 可选 `at: Index`；`AnnotationIn` 增 `index`（z 别名一版）；`_check_within_dims` 改 `resolve_object → meta.check_index`；`GET /annotations` 增 `index_from`/`index_to`；`Detection` 增 `region` | `contracts.py:181` 六原语与 `:24` 待办注释；`contracts.py:203` `roi_used`；`annotations.py:41` z 描述；`types.ts:227`；`csAnno.ts:313-330` 字符串解析 |
| **S8 ENGINES 按 kind + 三注册面** | frontend `Viewer.tsx`（接缝）+ `viewer/`（实现） | `ENGINES: Record<ObjectKind, Component<ViewerProps>>`；`axisFor(meta)` 从 axes 找 z\|t；`Viewer.tsx` 独占读 store；引擎不 `useSession`；两引擎合并为 FrameStackViewer；WsiViewer 去私有 UI；`ViewerChrome` 选项条改 `CHROME_SEGMENTS`；IMT 壁线经 `registerTaskTool` 注册；`TaskPlugin.viewer` 不再被读 | `Viewer.tsx:11-16, 19`（引擎挂在任务轴）；`CornerstoneViewer.tsx:37` 与 `VolumeViewer.tsx:491`；`VolumeViewer.tsx:429-430`；`ViewerChrome.tsx:49`；`WsiViewer.tsx:254` 私有 UI |
| **S9 前端动作收敛** | frontend `data/actions.ts` + 外壳组件 | 三个动作；`openObject` 的 `trigger = task?.trigger ?? "manual"`；ExplorerTree/RecentList/toolBridge 统一 `openObject`；TitleBar 读 `display_name` + DataSource.name，方法角色读 `methods[].role`；`ImportPanel.importable` 由 `/datasources` 下发；示例卡领域中立 | `actions.ts:23-29, 56-85, 93-138, 164-239`；`SideBar.tsx:217-222`；`ImportPanel` IMPORTABLE；i18n 双键与超声示例 |
| **S10 runtime 观测与工具面** | agent-runtime `observation/` + `pi/tools/registry.ts` + `annotation/segmenter-port.ts` | 四个看图工具改调 `fetchObservation`；`locate_roi` 输出附 ReferenceFrame，`propose_annotation` 用 `toObjectCoords` 换算并带 index；`defaultToolFactory = TOOL_PROVIDERS.filter(requires && supports(focus))`；系统提示词 = 基础句 + 按 kind 生成的当前对象句 + promptFragment；`run_task` 描述从 `/tasks` 动态拼 | `harness-registry.ts:78-113, 117`；`run-task.ts:36`；`locate-roi.ts:120` 只认 PNG/JPEG；`segmentation-client.ts` 单图 multipart 直连 |

### 7.4 变更清单

| 目标 | 变更 |
| --- | --- |
| `frontend/src/store/session.ts:225-241, 272-286, 319-333` | `modality`/`activeModel` 改 `string\|null`；三槽 + wsiRoi → `focus`；四列表 → `objects`；`setActive*`/`setWsiRoi`/`setImages`… 删，增 `setFocus`/`setIndex`/`setRegion`/`setObjects`；selectors `activeObject`/`objectsOf`；coords 扩 Index；toolOptions 按能力位分槽 |
| `frontend/src/data/actions.ts:19-37, 56-138, 164-239` | `prunedRecent` 改 `objectsOf`；`loadImages`/`switchModality` → `loadObjects(modality)`；四个 select + `runWsiTask` → `openObject(id)`；`runCurrentTask` → `runTask(region?)` |
| `frontend/src/api/client.ts:111-139, 188-190`、`types.ts` | 四个列表方法 → `objects(modality)`；`volumeUrl`/`wsiTileUrl` 删，改用 `resources` 模板；`volumeMaskEdit` → `objectEdits`；`taskMeasure(cf)` → `taskMeasure(calibration)`；`Modality = string`；ObjectMeta 新字段；`Annotation.z` → `index` |
| `frontend/src/components/Viewer.tsx:11-30` | 成为唯一读 store 处；`ENGINES` 按 ObjectKind 键；`axisFor` 从 axes 派生；不再读 `TaskView.viewer`；缺键渲染「查看器引擎尚未接入」空态 |
| `CornerstoneViewer.tsx` + `VolumeViewer.tsx` → `viewer/FrameStackViewer.tsx` + `hooks/` + `overlay/painters.ts` + `maskPng.ts` | 分三步合并（VV 用 hooks → CV 用 hooks → 合并）；`maskToPng` 一份；Primitive 绘制进 PAINTERS 并按 `focus.index` 过滤；VOI 由 capabilities 决定；画笔提交经 MaskSink |
| `WsiViewer.tsx` → `viewer/PyramidViewer.tsx` | 删私有 UI 与内联中文；信息条走 ViewerChrome 泛型 metrics；overlay 改 painters；改收 ViewerProps；ROI 写 `focus.region` |
| `ViewerChrome.tsx:37, 49, 64, 110` 与 `StagePanel`/`Editor`/`toolHint`/`iconMap` | `isCt` 删，选项条改 `CHROME_SEGMENTS`；工具过滤改 `ALWAYS ∪ caps`；抽 `useTaskTools()`；`Tool` 放宽 string，`TOOL_ICON` 改 Partial |
| `SideBar.tsx:200-240` 与 `focus/*` 的 `??` 链 | 四布尔与 ws/dirName/methodsDir/goldMethod/agentMethod/CF/Folds 删，读 DataSource 与 ObjectMeta；`onSelect`/`RecentList.open` 统一 `openObject`；`ImportPanel` 读 `/datasources.importable` |
| `useConversation.ts:13-38`、`toolBridge.ts:87-91` | `toViewerContext` 只做 `{collection, task, method, object, focus}`（保持 chat 短路）；`activeTargetId` 删，比对改 `focus.object_id` |
| `frontend/src/keys/globalKeys.ts:13` | `TOOL_KEYS` 随 `Tool` 放宽为 string；wall 键位由任务声明；`SHORTCUT_ROWS` 按当前 `TaskView.tools` 生成 |
| `frontend/src/data/recent.ts`、`i18n/{en,zh}.ts` | RecentItem 增 kind、modality 放宽，v1→v2 迁移；删 `natural_images` 键、抽 `useModalityLabel`；`focus_example_*` 改领域中立措辞（静态） |
| `backend/app/sources/`（新）+ 五个 dataset 模块末尾 | Source Protocol + SourceBase + SOURCES；五个模块各追加一个 Source 类（方法体调既有函数）；hc_real/hc_synth 改两个 DataSource；mock/hc_synth 改 dev_mode 合成源；新增 `dataset_video.py` VideoSource |
| `backend/app/datasource_registry.py:32, 92-137, 229-282` | `MODALITIES = tuple(SOURCES)`；`_builtin_specs` 由 `builtin_sample` 提供；新增 `resolve_object` 与索引；DataSource 增 kind/label/label_key/importable；`register_folder` 校验 `modality in SOURCES` |
| `backend/app/config.py:119-200`、`caches.py:21`、`datasource_detect.py:54-59` | `root_has_data` → `SOURCES[m].probe`；`*_data_available` 改薄 alias；`_CACHED` 删；`detect` 的两条模态 if 迁入 `Source.detect_calibration` |
| `backend/app/routers/objects.py`（新）+ `api.py:131-160, 225-240, 304-306, 369-382` | 新增 `/objects/{id}` 与 frame/raw/tiles/edits；`/images` 改 SOURCES 一行；`/image/{id}` 改 resolve_object 并删 mock；`/volumes` `/slides` `/volume/*` `/wsi/tile` 改内部 alias；`VolumeMaskEditRequest` → `EditRequest` |
| `backend/app/routers/annotations.py:41, 66-96, 136-145` | `AnnotationIn` 增 index（z 别名）；`_dims_for`/`_plugin_for` 改 resolve_object；`GET` 增 `index_from`/`index_to`；`store._KINDS` 扩展需带 `PRAGMA user_version` 迁移 |
| `backend/app/detectors/`（新）+ `kernel.py:106-203, 275-290` | Detector Protocol；四支拆四类；run_task 公共前缀上提；`_enrich_gold` → `reference`；`measure_task` 收 Calibration；`models()` 汇总；`_DS_META` 删；`segment_ts.py:57` 改走 `dataset_ct.nifti_path` |
| `backend/app/schemas.py:16-17, 20-28, 44-52, 58-66` | Modality/TaskType 改 str + validator；新增 Axis/Calibration/Index/Region/ReferenceFrame/ObjectMeta/EditRequest；TaskSpec 增 calibration/region + 旧字段 validator |
| `backend/app/upload_store.py:20-27, 77`、`routers/uploads.py:35` | `_MAGIC` 由 `SOURCES[*].formats` 汇总（含 mp4 `ftyp@4`、webm），classify 按 offset 校验；上传模态由 probe/formats 推断；新源 id 服务端派生 |
| science-core `contracts.py` / `calibration.py` / `tasks.py` | 各原语加 `at`；Detection 增 region；CFSource.TIME_BASE + `resolve_calibration_for` + `calibration_from_dict`；TaskPlugin 增 object_kinds/trigger/classes；类表搬进 REGISTRY 行；CT 行补 voi/z_scroll，WSI 行补 verify |
| agent-runtime `contracts.ts` / `routes.ts` / `observation/`（新） / `pi/tools/` / `harness-registry.ts` / `segmenter-port.ts`（新） | ViewerContext 增 collection/object/focus 并映射旧字段；parseViewer 判别校验；`fetchObservation` + `toObjectCoords`，四工具改调；run-task 描述动态拼；propose_annotation 加 index；ToolProvider 注册表；提示词领域无关；SegmenterPort |
| 测试 + CI 门禁 | 先补行为/不变量测试（后端 8 文件、前端 5 文件 33 处、runtime 4 个工具 + parseViewer）；CI grep 门禁：`frontend/src`（除 plugins/）与 `backend/app`（除 sources/、detectors/）禁止模态字面量比较 |

### 7.5 保留清单（不动）

- `tasks.py:115-136` TaskPlugin 与 `:188` REGISTRY —— 任务轴单一事实源，只加三个字段与 video 行；REGISTRY 仍在一个文件里，不由包合并。
- `contracts.py` 的 Detection/Measurement/TaskOutput 三信封与带 kind 的 `primitive_to_dict`/`from_dict` —— 只追加原语与 `at`；Detection 只加 `region`（`roi_used` 保留一版）。
- `calibration.py:28` CFSource、`:73/103/121` 三个 `resolve_*` 与 CalibrationResult、HardReject —— 作为 `resolve_calibration_for` 的实现保留。
- `segmentation/base.py:72-92` Adapter ABC —— 进程内像素层契约不动。
- `measurement/{pdm,hc,ct,nuclei}.py` 纯函数 —— 零改。
- `api.py` 的 `/tasks`、`/task/run`、`/task/measure`、`/datasources*` 与 `/images?modality=` —— 保留，只换内部分派。
- `kernel.py:251-274` 信封组装与 `_round_metric_values` —— 保留。
- `datasource_registry.py:68 dev_mode()`、`:229 resolve_root`、`:265 register_folder` 白名单/确定性 id/sources.json —— 保留。
- 五个 dataset 模块的现有函数体与对象 id 拼写 —— 零改，仅被 Source 类包装。
- `dataset_ct.guarded_patch_labelmap` 的锁与 base_seq 乐观并发、`dataset_wsi` 瓦片缓存与三套坐标系、`segment_proc`/`segment_ts`/`segment_wsi` 的缓存优先 + 隔离子进程模板 —— 保留为各 Detector/Source 的实现。
- `annotations/store.py` 的 base_seq/status/source/mask 落盘与 `AnnotationIn.image_id` 字段名 —— 只扩 `_KINDS` 与 index 列。
- `upload_store.py` 哈希派生落盘名与 ID、文件名不进路径 —— 只扩魔数表来源。
- `annotation/bridge.ts` 唯一写桥（editSeq 守卫/乐观草稿/409、422 回滚）—— 不改，仅参数改名。
- `csAnno.ts:51-183` 与 `wsiAnno.ts` —— 保留，仅删 `:313-330` 字符串解析。
- `viewer/csTools.ts:57-93, 102-144`、`viewer/nifti.ts:63-126`、`viewer/openseadragon.ts`、`wallGeom.ts` —— 保留。
- `CornerstoneViewer.tsx:142-244` 的绘制算法 —— 迁入 painters 不重写。
- `BottomPanel.tsx` 的泛型渲染、`ViewerChrome` 工具按钮部分、`SideBar` 的 ModalitySwitch/ExplorerView/MarketplaceView、`focus/` 四个纯布局壳 —— 不改。
- `session.ts:20-72` Connection 与 `:76-177` uiMode/focusLayout —— 不动。
- `actions.ts:245-262` refreshDataSources/activeModalities 与 dsState —— SDD 08 数据轴不动。
- `toolBridge.ts:24-84` 的严格校验与 seq 幂等、`propose-annotation.ts:158-181`、`vision.ts:283-305 toPixelBox`、`harness-registry.ts:215-270`、`routes.ts:247-288 parsePromptImages`、`mask-to-polygon.ts`、`atlas/select.ts`、`security/net-guard.ts`、`edition.ts` —— 不动。
- SDD 04 冻结的 Tool 五枚语义、capabilities 语义、on_commit、`/annotations` 写契约 —— 只追加 index 别名与新 kind，不改已有字段语义；D-13「labelmap 是任务结果非标注」立场不变。
- SDD 08 数据轴/任务轴分离 —— `/objects/{id}/*` 挂在数据轴之下。
- **三条架构不变量**：只有 agent-runtime 与模型说话；`glaux_core.tasks.REGISTRY` 是能力清单单一事实源（SOURCES/DETECTORS 只管数据轴与取数）；前端只有一条对话路径。

### 7.6 视频落地路径

视频 = `kind="video"`、`axes=[x, y, t(size=frames, spacing=1000/fps, unit="ms")]`、`calibration={kind:"time_base", value:{fps}}`，与 CT 的 `[x,y,z]` 类型同构，不写任何 `=== "video"`。落地顺序刻意前置：VideoSource 在第 1 波就注册（只做数据轴，作为 Source 协议的验收），表征与任务在第 6 波。

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| 第 1 波（数据轴） | `dataset_video.py` VideoSource：`formats=(("mp4", b"ftyp", 4), ("webm", b"\x1a\x45\xdf\xa3", 0), ("mkv", …))`；PyAV 惰性 import，缺库 probe 返 False 并在 `/datasources` 标 unavailable；list_ids 服务端派生 id（前缀 `vid-`）；meta 出 axes/calibration/resources；frame 做 seek+decode 一帧 PNG + ReferenceFrame，LRU 按 `(id, t, size)`；raw 流原文件；tile 返 None；builtin_sample 指向 `data/video-demo`（dev_mode）；`detect_calibration` 做 fps 探测 | `GET /images?modality=video` 与 `GET /objects/{vid}/frame?t=10` 通过；**零改清单**：resolve_object、annotations、config、caches、register_folder、upload_store、uploads 一行未改 |
| 第 1–3 波期间 | 切换器出现 video，但 `ENGINES` 缺键 → 渲染「查看器引擎尚未接入」空态（需在第 3 波显式实现该分支与两个 i18n 键；现状 `Viewer.tsx:19` 的 `?? "raster_2d"` 兜底不会命中缺键） | 数据轴与表征轴确实解耦 |
| 第 4 波结束 | 具备「能看」的条件：`FrameStackViewer` + `axisFor` 从 axes 找 t 轴，与 CT z 轴同构，零新引擎 | — |
| 第 6 波（表征、标注、观测） | `videoFrameSource`（imageIds 生成 `glaux-frame:${id}#t=${i}`，loader 走 `resources.frame`）；`Viewer.tsx` 由 `axisFor(meta)==="t"` 组装 axis；`TimelineSeg`（播放位置/逐帧/跳转）由 capabilities 含 timeline 出现；`coords.t` 角标；`formatCalibration` 支持 time_base；帧级原语带 `at:{t}` 并按 `focus.index.t` 过滤；画笔 `annotationMaskSink.commit(mask, dims, {t})` 与 `bridge.ts` 零改；runtime 增 `sample_frames` provider；ImportPanel 的 video 项由 `/datasources.importable` 自动出现 | 端到端：导入 mp4 → 切换器 → 逐帧滚动 → 某帧画 bbox 落库（index.t 正确）→ 重开回灌 → agent 调 `view_current_image`/`sample_frames`/`propose_annotation`；CI grep 对 `"video"` 字面量零命中 |

**新增 vs 零改**：新增 = `dataset_video.py`、`videoFrameSource` + frame loader、`TimelineSeg`、`Primitive.at`、`sample_frames` provider、`pyproject` 加 `av`；零改 = store 字段、actions、端点、annotations 路由、`Viewer.tsx` 之外的所有组件、runtime 工具工厂与 parseViewer、`bridge.ts`。

**本版不做**：自动跟踪（TrackDetector、`segment_video.py`、`track_objects` REGISTRY 行、`track_region` 工具、`SegmenterPort.track`）与 Track/Event 两个新原语整体推迟。它们是新增分析能力而非清债，D6/D7 的关闭条件不依赖它们——视频作为「无 TaskView 的模态」与 natural_image 同形走完 Source → 表征 → 观测全链路，已完整检验协议。

### 7.7 插件演进路径

`README.zh-CN.md:39` 承诺「相关实现保留在源码中，后续以插件交付」。本方案不建插件框架、不建四端同名 pack 目录、不做目录迁移，但每处收敛都落成「注册表 + 一行」，插件化就是把这一行从 in-tree 字典搬到包外。

1. **收敛完成时，一个模态/任务的全部接线是五张表各一行**：science-core `REGISTRY[task]`、backend `SOURCES[modality]` + `DETECTORS[adapter_kind]`、frontend `ENGINES[kind]` + `PAINTERS[kind]` + `CHROME_SEGMENTS[cap]` + `registerTaskTool(name)`、runtime `TOOL_PROVIDERS[name]`。宿主契约只有七个类型：ObjectMeta / Focus / Index / Region / Calibration / ReferenceFrame / Primitive。插件永不 `useSession`、永不拼端点路径。
2. **插件包 = 把这几行 export 出来**：Python 包 `glaux_plugin_<x>` 提供 `TASKS`/`SOURCES`/`DETECTORS`，经 entry_points 合并进三张表（REGISTRY 仍是单一事实源，插件只是 register）；前端包 export `{engines?, painters?, tools?, chromeSegments?, i18n?}`，先静态 import 合并；runtime 包 export `{providers}`。
3. **顺序**：IMT（壁线工具 + 淡带 painter + wallGeom）是第一个经 `registerTaskTool` 注册的任务工具（文件不搬家）；CT/WSI/HC 随后（只需 REGISTRY 行 + Source + Detector，前端零专属代码）；视频是第一个「生来就是注册表形态」的模态。
4. **非模态插件**（工作台/舞台/图谱/分割测量工具）不在本设计范围。它们的落点已存在——舞台/工作台是 uiMode 外壳（`edition.ts` 已按发行版门控），图谱是 runtime 的 `consult_atlas` provider + backend atlas 路由，分割/测量是 DETECTORS + SegmenterPort；插件化复用同一 ToolProvider/CHROME_SEGMENTS/edition 三个开关，另立设计。
5. **与纲领的关系**：插件包只承载领域知识（数据格式、模型适配、专属工具）；harness 四要素（观测端点 + ReferenceFrame、动作 openObject/runTask/edits/annotations、验证器 Detector.verify、回合上下文 Focus）留在核心。更强模型作废的是插件里的 Detector 模型适配，不是核心。

### 7.8 决策记录

| ID | 决策 | 备选 | 为什么 |
| --- | --- | --- | --- |
| DEC-1 | 以「增量收敛」为骨架：不引入新层，每处「N 份并列」收成「1 份 + 判别字段」；每波「新入口 → 旧入口 alias → 改断言 → 删旧」四拍独立合入 | 模态包（四端同名目录 + 六注册表）；VisualObject-first（三层同名契约同时改名） | 现有骨架方向已对，债务全是楔子复制粘贴的并列，合并同类项是最小 diff；纲领 §七：加深环境要素而非造基础设施 |
| DEC-2 | `ObjectMeta` 用 `axes: Axis[]` 表达几何，保留 `kind` 作分派键 | `Geometry{depth?, frames?, levels?}`；纯 axes 无 kind | 并列可空正是 `schemas.py:64-66` 的翻版，第七个模态（4D CT z+t、多光谱 c 轴）再加可空字段；axes 让 `axisFor` 与 `check_index` 从「找非空间轴」派生；保留 kind 是因为 slide 的 level 是缩放不是采样，引擎仍需显式分派键 |
| DEC-3 | 三概念显式分界并写进 SDD 10：`kind` = 几何族；`modality` = 数据集路由键；`AtlasDescription.modality` = 成像方法（runtime 用 `collection` 承接前者避撞名） | 只在 runtime 侧用 collection 避撞名 | `objects: Record<modality, …>` 与 `ENGINES[kind]` 两把钥匙并存，不写清就会重演「拿 modality 当 kind 用」 |
| DEC-4 | `Focus{object_id, kind, index, region}` 作为三端同名的当前观测焦点；`Index` 是唯一索引类型 | active + cursor + region 三字段；Annotation.index 语义靠 kind 隐式约定 | 前端 selector 返回物与 runtime ViewerContext 本就是同一物，三端统一名词省一层映射；`z` → `index` 时直接用 Index，volume=z/video=t 不再隐式 |
| DEC-5 | 表征与观测走新端点族 `/objects/{id}/…`；列表端点保留 `/images?modality=`；旧端点退 alias 一版 | `/image/{id}` 叠五个参数升格为观测端点；`/objects` 全家包括列表 | `/image` 承载 volume/slide/video 全部表征语义过载，且与纲领「对象」措辞相反；但不动列表端点——它是 SDD 08 数据轴冻结面，返回的本就是 ObjectMeta |
| DEC-6 | 画笔提交 `MaskSink` 两实现，端点换名不换语义；SDD 04 §7.4 修订稿先 ready 再动代码 | 统一到 `/annotations`（推翻 D-13）；保留原路径 | D-13 立场保留（两条语义路径是对的），只把端点从 `/volume` 泛化为 `/objects/{id}/edits` 让视频传播式编辑复用；task/method 从 taskView 取而非常量 |
| DEC-7 | `resolve_object` 以注册表索引为主，`is_mine` 仅兜底；既有 id 原样保留；新源一律服务端派生 id | 纯遍历前缀正则；所有 id 规范化为 `<source>:<rel>` | 线性扫描 + 各 Source 维护前缀只是把四套约定藏起来；但改既有 id 会牵连 annotation store、recent localStorage、atlas 引用，故索引不改名 |
| DEC-8 | `TaskSpec`/`AnnotationIn` 字段名 `image_id` 保留（语义为对象 id），ObjectMeta 为正名、ImageMeta 作别名一版；`center` 改为 `meta.center` 可选 | `image_id` → `object_id` 全面改名 | `AnnotationIn.image_id` 是 SDD 04 冻结的写契约且落盘字段，改名是纯噪声；`center` 必填对视频/自然图像不成立 |
| DEC-9 | `Region.box` 统一为 `(x0,y0,x1,y1)`；parseViewer 过渡映射按此语义，且 object/focus 优先、旧字段仅在缺失时映射并 warn；第 0 波补契约测试 | 按 `routes.ts:350` 注释的 `[x,y,w,h]` 映射 | `session.ts:229` 是实际生产者且后端全链一致，`routes.ts:350` 注释是错的；不选定语义则错位以新名字延续 |
| DEC-10 | 过渡期只有一套服务端真相：SourceBase 从 axes/calibration 回填旧四字段，前端 lint 禁读；「删过渡」是第 7 波的独立准出，不可延后 | 删除随发行周期延后 | P6/P7 楔子正是这样滞留的；「视频落地」的定义包含旧字段、端点 alias、ViewerContext 旧字段全部删除 |
| DEC-11 | 引擎只由对象几何决定：`ENGINES` 按 ObjectKind 键，`axisFor` 从 axes 派生；`TaskPlugin.viewer` 保留一版但不再被读 | `task?.viewer ?? kindToViewer(kind)` 双来源 | 保留任务轴决定引擎与「引擎由对象几何决定」矛盾，无任务的视频/自然图像仍要靠核心里的映射表；引擎是表征关切，属于对象 |
| DEC-12 | 后端 `DETECTORS` 元素是带七件的 Detector 协议，公共前缀上提到 `run_task`；`Detector.kind` 与 science-core `Adapter.kind` 同名字空间但不继承 | 裸 Callable 表；直接继承 `segmentation/base.py:72` Adapter ABC | 裸表无协议约束、各 detector 重复校验；但 `Adapter.run` 吃 `DetectRequest(image: np.ndarray)`，是进程内像素层，后端做的是取数 + 子进程 + 标定，硬继承会让后端 import 模型层或让 science-core 感知文件系统。同名字空间由不变量测试保证 |
| DEC-13 | `run_task` 门控用 `TaskPlugin.object_kinds` 而非 modality 相等；`Detection` 只加 `region`（`roi_used` 保留一版），这是三信封唯一触碰并明说 | `plugin.modality != ref.modality` 比对；直接改 `roi_used` | 任务接受的是几何族，natural_image 上的通用任务与 video 帧级任务才能复用同一行；列窗 `(x0,x1)` 装不下帧区间 |
| DEC-14 | CI 门禁：`frontend/src`（除 plugins/）与 `backend/app`（除 sources/、detectors/）禁止模态字面量比较；「删一个 Source 后三端可启动且该模态从四处同时消失」作为准出用例；**Modality 放宽为 str 前先清零字面量** | 只在风险里写「grep 归零」；校验四端目录 id 一致 | 这是唯一能客观证明「视频没再长 if」的验收；Literal 放宽后 TS 不报错静默走 else，必须先清零再放宽 |
| DEC-15 | runtime 直接做最小 `ToolProvider` 注册表，六个现有工具包成 provider；`SegmenterPort` 立 `segment` 单方法 | `supports(kind)` 门控、需要时再补；一并立 `track?` | 视频第一版就需要 `sample_frames`，欠账会立刻到期；但 `track?` 无第二实现，等真有视频后端再谈 |
| DEC-16 | `Calibration.kind` 为开放集（string），`value` 任意 + source + provenance；未知 kind → HardReject | Literal 四值 | DICOM 超声多区域与 WSI 各 level mpp 下一个格式就要再改；HardReject 保证未知 kind 不出假值 |
| DEC-17 | mock/hc_synth 隐式回退全部删除，改为 `dev_mode()` 下显式注册的 `synthetic-us`/`synthetic-hc` Source；无数据首屏为空态 + 导入优先 | 保留 `if not _has_data()` 分支 | mock 回退让伪造 id 看似成功（`api.py:366-368` 注释已自述此风险）；测试改显式注册合成源。**同波须改 `scripts/dev/health.sh:6` 与 `restart-backend.sh:12`**，否则无数据机器会误报服务挂了 |
| DEC-18 | `openObject` 的触发规则显式：`trigger = task?.trigger ?? "manual"`，无任务模态写成 SDD 10 的显式 no-task 契约，REGISTRY 不为其造空行 | 「natural 无行即 manual」隐式规则；为 natural_image 加空行 | 隐式缺省与「REGISTRY 是能力清单单一事实源」打架；但 REGISTRY 是任务清单，造空行反而污染任务轴 |
| DEC-19 | VideoSource 在第 1 波就落地注册，只做数据轴；表征/任务/agent 在第 6 波 | 视频整体放最后一波 | 数据轴前置既是 Source 协议的真实验收（第六个模态零改七个文件），也让第 6 波只剩前端与观测 |
| DEC-20 | 设计落为 Feature SDD 10「视觉对象与数据源收敛」；`docs/designs` 只写决策理由记录；SDD 02/04/08/01/05/07 修订以 SDD 10 为上游 | 只新建 `docs/designs` 一篇 | 改了三份以上冻结契约字段而无自己的 SDD，下次审计又是「设计意图在 designs、落地在 SDD、二者脱节」；仓库规则要求跨层契约立 Feature SDD |
| DEC-21 | 降级路径写进计划：若 CS3D mock RenderingEngine smoke 测试做不出，引擎合并降为「只抽纯函数 + 共用 hooks + 手工回归清单」，合并顺延独立立项 | 无降级路径，硬做合并 | 两引擎合计 1044 行、零组件测试兜底，是全计划最高风险单步，不应阻塞其后三波 |

### 7.9 明确不采纳

- **四端同名 pack 目录约定 + packs/index + check-packs.py + packs.json**：纲领 §七判为「更强模型不会让它更值钱」的基础设施；git mv 五套模块的搬迁噪声淹没语义改动；REGISTRY 由包合并会让单一事实源从一处漂移成合并函数。
- **后端 Detector 继承 science-core `Adapter` ABC**：`Adapter.run` 吃 `DetectRequest(image: np.ndarray)`，是进程内像素层；后端 detector 做取数 + 隔离子进程 + 标定。改为同名字空间 + 不变量测试对齐（DEC-12）。
- **`image_id` → `object_id` 全面改名**：`AnnotationIn.image_id` 是 SDD 04 冻结写契约且落盘字段，改名是纯噪声（DEC-8）。
- **用 `/objects` 列表取代 `/images?modality=`**：SDD 08 冻结的数据轴入口，返回的本就是 ObjectMeta，改名无收益（DEC-5）。
- **既有对象 id 规范化为 `<source>:<rel>`**：牵连 annotation store、recent localStorage、atlas 引用；注册表建索引即可（DEC-7）。
- **第一版接 CS3D VideoViewport 做实时播放**：harness 定位下 v1 只承诺 agent 观测与拖拽定位，逐帧 StackViewport 与 CT z 轴同构零新引擎；避免被拉去做转码/流媒体。
- **entry_points / 动态 import 的运行期插件加载**：无第三方作者需求；先静态合并，形状不变。
- **新建 `POST /task/verify` 公共验证器端点与验证按钮搬家**：只把 `/wsi/{id}/verify` 的内部实现收进`Detector.verify`，路径与按钮位置不动，等验证器进入独立排期（见 §8.6）。
- **把工作台/舞台/图谱等非模态插件的设计纳入本 SDD**：与对象/模态抽象正交；落点已指出（`edition.ts`、ToolProvider、CHROME_SEGMENTS），另立设计。
- **在本版定死 Track 的逐帧编辑语义**：等第一个真实视频跟踪任务跑通后在 SDD 04 修订中补，避免空想契约。
- **`Modality`/`TaskType` 一步放宽为 str 再清字面量**：顺序颠倒会让 20+ 处 `===` 静默走 else（DEC-14）。
- **`ViewerContext` 改名为 `Focus` 顶层**：该名字在 SDD 02 与前端/runtime 多处引用，只收敛字段不改名，Focus 作为其内部字段。
- **后端下发单语 `modality_label` 替代 i18n 键**：i18n 是 `I18nKey` 强类型双语表，直接下发会丢 en 语种；改为下发 `label_key` + 兜底 `label`。
- **为尚未存在的模块预先补测试**（painters/useBrushBuffer/FrameSource/MaskSink 的独立测试债）：等于把引擎合并的验收条件复制一份，属重复计价（DEBT-35 降级理由）。

---

## 8. 分波清理计划

### 8.1 原则

- **两套编号不混用**：DEBT-01…35 指债务条目，DEC-1…21 指设计决策，D6/D7 仅指 2026-08-27 审计的两条原始大债。
- **排序按「何时做最省」而非「何时最严重」**：i18n 文案严重度低但会被第 3 波顺手带走；引擎合并严重度高但依赖前端状态先定型，必须排在第 4 波。
- **先容器后内容**：元数据形状（`ObjectMeta.axes/calibration/resources`）是容器，Focus、引擎选择、agent 观测是内容；容器先由后端下发，内容依次搬家。
- **服务端只有一套真相**：过渡期旧字段由 `SourceBase` 统一回填，不允许前后端各算一份（DEC-10）。
- **四拍合入**：新入口 → 旧入口 alias/派生 → 改断言 → 删旧。**四拍同样适用于单端内部**：第 3 波的前端塌缩必须走「先加 focus + 把三槽改为 focus 的派生 getter（不删）→ 逐文件改消费点 → 删派生 getter」三个 PR。
- **可安全中断点 = 旧路径仍完整且三端可编译**。波内 PR 之间不是安全点，只有波末是。
- **每波准出证据机器可判**：一律落成 `make test`（含 `test-version`）+ `make lint` + 不变量断言 + CI grep 计数，均在 WSL 内跑。
- **先清字面量再放宽类型**（DEC-14）：`Modality`/`TaskType` 放宽为 `str` 排在后端字面量清零**之后的那一波**，不在同波内自证。
- **测试先于重构，断言改为不变量**（DEBT-35 降级后的形态）。
- **过程证据落 record，不落活文档**：grep 基线、git diff 零改清单、手工回归签字表一律写入 `docs/todo/2026-09-18-002-object-convergence-execution-log.zh-CN.md`。
- **视频作为协议验收，不作为能力考核**：第 1 波用 VideoSource 检验 Source 协议；第 6 波只承诺「能看、能标、能被 agent 观测」。
- **纲领 §七逐波自检**：答案是「只是更整齐」的降级为顺手项。
- **chat 发行包是独立发布物，每波都要验**：`docker/Dockerfile` 设 `VITE_GLAUX_EDITION=chat`，镜像内无 Python 后端；`App.tsx:8` 走 `ChatShell`，`useConversation.ts:99` 的 `CHAT_EDITION ? undefined : toViewerContext()` 本就短路。凡改 `toViewerContext`、示例卡、观测通道的波，准出必须包含 `frontend/src/chatEdition.test.tsx` 与 `agent-runtime/tests/integration/chat-edition.test.ts` 两份用例绿灯。

### 8.2 波次总览

| 波 | 标题 | 解决 | 依赖 | 可并行 | 预估 |
| --- | --- | --- | --- | --- | --- |
| W0 | 安全网、契约冻结与文档上游（不改运行时行为） | DEBT-35；DEC-9 契约前置；DEC-20 文档上游；DEC-6 前置 | — | 文档线与测试线可并行 | 4 人日 |
| W1 | 后端数据轴塌缩：Source 协议 + resolve_object + ObjectMeta，用 VideoSource 验收 | DEBT-25、26、28；DEBT-05 元数据半边；DEBT-21 后端半边；DEBT-29 数据轴部分 | W0 | W0 文档线 | 6 人日 |
| W2 | 后端动作轴与表征面：DETECTORS + run_task 公共前缀 + /objects 端点族 + 标注库迁移 | DEBT-27；DEBT-02 后端半边；DEBT-06；DEBT-07 后端半边；DEBT-05 标定半边；DEBT-04 存储半边；DEBT-08 后端半边 | W1 | W3 前端类型镜像起草（不合入） | 5 人日 |
| W3 | 前端状态与动作收敛：一个 Focus、一张对象表、三个动作（内部走三拍） | DEBT-03、09、10、11、13、15、20、21 前端半边、23、24；DEBT-01 前端半边；DEBT-08 前端半边 | W1、W2 | W4 纯函数抽取起草 | 7 人日 |
| W4 | 查看器引擎收敛：ENGINES 按 kind + 三注册面 + 画笔宿主合一 | DEBT-12、14、16、17、18、19、22；DEBT-07 前端半边 | W3 | W5 | 6 人日 |
| W5 | agent 上下文、观测通道与工具注册面 | DEBT-01 runtime 半边；DEBT-02、30、31、32、33；DEC-9 runtime 半边 | W2、W3 | W4 | 4 人日 |
| W6 | 视频表征落地：能看、能标、能被 agent 观测（不含自动跟踪） | DEBT-04 索引维；DEBT-29 表征部分；**关闭 D6、D7** | W4、W5 | — | 4 人日 |
| W7 | 过渡物清除（单独一波、可整体回滚） | DEC-10；DEBT-06/07 收尾；DEC-11/DEC-13 收尾 | W6 | — | 2 人日 |

**总量 38 人日。** 每波末均为可安全中断点。

### 8.3 各波步骤与准出门禁

#### W0 · 安全网、契约冻结与文档上游

**目标**：把三端测试从「绑定楔子字段名与枚举长度」改成「绑定语义不变量」；立起 SDD 10 草案、SDD 04 §7.4 修订稿（本波即 ready）与执行记录 record。本波不改产品代码（例外：两处错误注释）。

**步骤**

1. frontend 补行为测试：`openObject` 后 `activeObject().id` 与 `toViewerContext()` 携带的对象 id 一致；切对象后 `applyToolExecutionEvent` 拒绝旧 id；`switchModality` 后 `activeModel` 不跨模态泄漏。现用旧字段写，W3 只换取值方式不换断言语义。
2. frontend 尝试用 mock RenderingEngine 写引擎 smoke 测试（渲染一帧 + 画一条 polyline + 提交一次画笔）。做得出 → W4 走完整合并；做不出 → 当场记录并把 W4 降级（DEC-21）。
3. backend **按实测扩大覆盖面**：`test_datasource_registry.py`（18 处模态字面量，含 `:43` 的 `== 5`）、`test_datasource_samples.py`、`test_datasources_api.py`、`test_datasource_detect.py`、`test_uploads_api.py`、`test_natural_images.py`（7 处）、`test_cache_invalidation.py`、`test_api.py`（`:100` 改契约断言，隐式默认模态改显式传参）。
4. science-core：`test_tasks.py:63` 的 `adapter_kind` 枚举断言改为「非空」，W2 后升级为「∈ DETECTORS 键集合」；`:64` 的 `viewer` 枚举断言同处理。
5. backend 补两条 xfail 回归：`/image/{ct_id}` 无 CUBS 数据时应 404（注明 W1 转绿）；`/task/measure` 对 `totalseg_liver_kidney` 携 voxel 标定应成功（注明 W2 转绿）。
6. agent-runtime 新建 `tests/contract/viewer-context.test.ts` 覆盖 `parseViewer`（当前零用例），含 `roi_box` 按 `(x0,y0,x1,y1)` 契约与 400 分支；四个工具测试的旧字段断言改语义断言；fakeBackend 预留 `ct_`/`slide_`/`vid-` 三类 id 与 `/objects/{id}/frame` 桩。
7. 产品代码唯一改动（纯注释）：改正 `agent-runtime/src/transport/routes.ts:350` 的 `[x, y, w, h]` 为 `(x0,y0,x1,y1)`；改正 `frontend/src/components/Viewer.tsx:13` 的 OrthographicViewport 注释。
8. CI 新增 `scripts/ci/check-modality-literals.sh`，统计三端六个模态字面量比较命中数。**本波只打印基线、不阻断**，W7 转阻断。
9. 文档：新建 SDD 10 README（`kind: living, status: draft`）；**裁定模态标签的 i18n 归属**（`DataSource` 下发 `label_key` + 兜底 `label`，前端优先查 i18n 键）；新建决策上游 record 与执行记录 record。
10. 文档：SDD 04 §7.4 修订稿（MaskSink 两实现 + `POST /objects/{id}/edits`，DEC-13 立场不变）**评审至 ready**——不可让 W2 的准出门禁引用 W2 自己的产出。

**准出门禁**

- `make test`（含 `test-version`）与 `make lint` 全绿；两条后端回归以 xfail 记并注明转绿波次。
- 新增行为测试在**当前代码**上通过——证明断言绑的是语义不是未来形状。
- 后端 8 个测试文件、runtime 4 个工具测试、science-core `test_tasks.py` 的旧断言全部改完。
- `check-modality-literals.sh` 可运行，三端基线命中数记入执行记录 record。
- SDD 10 draft 与两份 record 存在且 frontmatter 合规；`docs/sdd/README.md` 加 10 行。
- **SDD 04 §7.4 修订稿状态为 ready**。
- 引擎 smoke 测试可行性结论写入 record。

**SDD 联动**：新建 SDD 10（draft）、`docs/designs/2026-09-18-object-source-convergence-decisions.zh-CN.md`（record）、`docs/todo/2026-09-18-002-…`（record）；SDD 04 §7.4 → ready；`docs/sdd/README.md` 索引；`docs/todo/2026-08-27-001` 的 D6/D7 状态改「由 SDD 10 承接」。

#### W1 · 后端数据轴塌缩

**目标**：五个 `dataset_*.py` 的并列约定收成一张 `SOURCES` 表与一个 `resolve_object` 入口；`ObjectMeta` 用 axes/calibration/resources 表达几何与标定；旧四字段由 `SourceBase` 回填，前端与 runtime 零改。同波落地 VideoSource 数据轴。**Modality 类型本波不放宽**，只清字面量。

**步骤**

1. 新建 `backend/app/sources/base.py`：Source Protocol + SourceBase（回填旧字段，DEC-10）+ SOURCES 字典。
2. `schemas.py`：新增 Axis/Calibration/Index/Region/ReferenceFrame/ObjectMeta（含 `axis()`/`check_index()`）；`ImageMeta = ObjectMeta` 别名；旧四字段保留为过渡字段。**Modality 仍为 Literal，仅增 video 一值**。
3. 五个数据模块末尾各追加一个 Source 类并注册，**模块内函数体零改**；`hc_real`/`hc_synth` 改两个 DataSource 实例，消除 `hc_dataset.py:24-30` 的先后判。
4. **收编 `backend/app/datasource_detect.py`**：`:57` `if modality == "pathology"` 与 `:59` `if modality == "ct_abdomen"` 删除，两个 `_detect_*` 迁入各 `Source.detect_calibration`，`register_folder(detect=...)` 改调 `SOURCES[m].detect_calibration`，VideoSource 在此做 fps 探测。
5. 新建 `backend/app/dataset_video.py`：VideoSource(SourceBase)，PyAV 惰性 import，缺库 probe 返 False 并在 `/datasources` 标 unavailable；`backend/pyproject.toml` 增 `av`（可选 extra），**同步更新 `scripts/version_matrix.py` 以通过 `make test-version`**。
6. `datasource_registry.py:32, 92-137, 229-282`：`MODALITIES = tuple(SOURCES)`；`_builtin_specs` 由 `builtin_sample` 提供；新增 `resolve_object(id)` 与 `id → ObjectRef` 索引（register/seed/invalidate 重建，未命中再 `is_mine` 兜底）；DataSource 增 kind/label/label_key/importable；`register_folder` 校验 `modality in SOURCES`；`_invalidate_dataset_caches` 遍历 `SOURCES.invalidate()`。
7. `config.py:119-200`：`root_has_data` → `SOURCES[m].probe(root)`；四个 `*_data_available()` 改薄 alias；`caches.py:21` `_CACHED` 删除。
8. `routers/api.py:131-147`：`/images?modality=` 五分支改 `SOURCES[m]` 一行，`mock.dataset()` 回退删除。`:369-382`：`/image/{id}` 改 `resolve_object → source.frame(Index())`，删 startswith 与 `mock.synthetic_png`，未知 id 404。
9. mock 与 hc_synth 改 `dev_mode()` 下显式注册的 `synthetic-us` / `synthetic-hc`（DEC-17）。
10. `upload_store.py:20-27, 77`：`_MAGIC` 由 `SOURCES[*].formats` 汇总（mp4 `ftyp@4`、webm `0x1A45DFA3`），classify 按 offset 校验；`routers/uploads.py:35` 的固定模态改由 probe/formats 推断。
11. `routers/annotations.py:66-96`：`_dims_for` 阶梯改 `resolve_object → meta.check_index`（只换实现，`z` 字段名不动）；`segment_ts.py:57` 的 `CT_ROOT` 直读改 `dataset_ct.nifti_path`。
12. **开发脚本去模态耦合**：`scripts/dev/health.sh:6` 与 `scripts/dev/restart-backend.sh:12` 的 `curl /images?modality=carotid_imt` 改为打 `/datasources` + `/capabilities`（mock 删除后原判据在无数据机器上恒 0，会误报服务挂了）。

**准出门禁**

- `make test` + `make lint` 全绿；「`/image/{ct_id}` 无数据 404」由 xfail 转绿。
- **新旧 meta 逐字段 diff = 空**（每个 SOURCES 键各 1 真实 + 1 合成 id），diff 记入 record。diff 不空一律按 bug 处理，不得改期望值。
- **删一个 Source 验收**：注释掉任意注册行后三端可启动，该模态同时从 `/datasources`、`/capabilities`、ImportPanel 消失。
- **视频零改清单验收**：VideoSource 接入未改 `resolve_object` / annotations / config / caches / `register_folder` / `upload_store` / uploads 任何一行（git diff 逐文件核对，结论进 record）。
- 不变量：每个 SOURCES 键有 probe/list_ids/builtin_sample；`MODALITIES` 与 `SOURCES` 键集合恒等。
- `check-modality-literals.sh` 对 `backend/app`（除 `sources/`）命中为 0（**含 `datasource_detect.py`**）。
- 前端与 agent-runtime 一行未改；chat 版两份 edition 测试绿。

**SDD 联动**：SDD 10（Source 协议、resolve_object 索引规则、ObjectMeta/Axis/Calibration；draft → ready）；SDD 08 §5/§6（ObjectMeta 与 DataSource 新字段、新增「SOURCES 与 DataSource 的关系」小节、**「/images?modality= 冻结」改写为「路径与查询参数冻结，响应体按 SDD 10 演进」**、上传模态由 probe 推断、mock/hc_synth 改 dev_mode）；**`docs/runbooks/datasource-registry.md` 同提交更新**（含 5 处模态字面量）；`docs/architecture.zh-CN.md` 与 `assets/architecture.svg`（新增 `sources/` 与 `dataset_video.py`）。

#### W2 · 后端动作轴与表征面

**目标**：`kernel.py` 的 adapter_kind 四分支拆成 DETECTORS 表，公共前缀上提到 `run_task`；新增 `/objects/{id}/frame|raw|tiles|edits`，旧端点退内部 alias；annotations 做一次带版本号的库迁移。前端与 runtime 零改。

**步骤**

1. **本波第一步**：`schemas.py` 的 Modality/TaskType 放宽为 `str` + validator 查 SOURCES/REGISTRY（前置已在 W1 准出达成：后端字面量 0 命中，DEC-14）。
2. 新建 `backend/app/detectors/base.py`：Detector Protocol + DETECTORS。与 `segmentation/base.py:72` Adapter 同名字空间但不继承（DEC-12，理由写 docstring）。
3. `kernel.py:115-203` 四分支拆为 `detectors/{wall_pair,contour,volume,wsi}.py`；`_enrich_gold` → `Detector.reference`；CT labelmap 编辑 → `Detector.apply_edit`；**WSI 复现验证收进 `Detector.verify` 但不新立 `POST /task/verify`**，`/wsi/{id}/verify` 保持原路径内部改调。
4. `run_task` 公共前缀上提：resolve_object → `kind ∈ plugin.object_kinds`（422）→ available（503）→ `region.kind ∈ accepted_regions`（422）→ 标定解析；`:251-274` 信封组装不动。
5. `kernel.py:277-282` `measure_task` 入参改 Calibration，不再恒 CUBS；science-core 增 `calibration_from_dict`（未知 kind → HardReject）与 `resolve_calibration_for(obj)`；CFSource 增 TIME_BASE + `resolve_video_calibration`。
6. `tasks.py:115-136`：TaskPlugin 增 object_kinds/trigger/classes（类表搬入 CT 行，WSI 行 `on_region`）；capabilities 开放集并下发 voi/z_scroll/verify；viewer 标 deprecated。
7. `contracts.py:203`：Detection 增 `region`（`roi_used` 保留一版）。**本波对三信封的唯一触碰**。
8. 新建 `backend/app/routers/objects.py`：`GET /objects/{id}`；`/frame?z&t&level&roi&size&window`（`X-Glaux-Frame` 头；slide 强制 level，roi 超限 413）；`/raw`；`/tiles/{l}/{c}/{r}`；`POST /objects/{id}/edits`（EditRequest，派发 `DETECTORS[kind].apply_edit`，重测走 `plugin.measure`）。
9. `api.py:150-160, 225-240, 304-306`：`/volumes`、`/slides`、`/volume/*`、`/wsi/tile` 改内部 alias；`VolumeMaskEditRequest`（含 task Literal）删除改 EditRequest。**alias 保留到 W7，前端切换在 W4**。
10. `annotations.py:41, 136-145`：`AnnotationIn` 增 index（z 作别名）；`_plugin_for` 改 resolve_object 查 REGISTRY，删 `is_wsi` 特判；`GET /annotations` 增 `index_from`/`index_to`。
11. **annotations SQLite 迁移**：`store.py:25` `_KINDS` 扩为含 `point`（track/event 随原语推迟），而 `:30` 是 `CREATE TABLE IF NOT EXISTS`、`:34` 内联 `CHECK(kind IN (...))` 对老库不生效。实现 `PRAGMA user_version` + 建新表/拷数据/换名/重建 `:47` 索引的升级路径，并补老库升级用例。
12. **降级为顺手小 PR（不占关键路径、不进门禁）**：`kernel.models()` 汇总 `Detector.methods()`；`capabilities()` 的 provider/license 从 `_DS_META` 搬到 DataSource。

**准出门禁**

- `make test` + `make lint` 全绿；「`/task/measure` 携 voxel 标定成功」由 xfail 转绿。
- 不变量：`set(REGISTRY 全部 adapter_kind) == set(DETECTORS)`；`test_tasks.py:63` 升级为查 DETECTORS 键集合。
- 三信封回归：`Detection.roi_used` 字段名与取值未变；TaskOutput 快照逐字节一致。
- **标注库迁移用例**：预置 v0 `.db` 升级后老数据可读、新 kind 可写、索引存在，升级不被重复触发。
- 端点等价性：旧 alias 与新 `/objects/*` 对每个模态返回同一字节流。
- `X-Glaux-Frame` 契约测试：四种 kind 各取一帧断言 origin/scale/width/height；slide 超限 roi 返 413。
- `check-modality-literals.sh` 后端仍为 0（放宽类型后未回潮）。
- 前端与 agent-runtime 一行未改；chat 版两份 edition 测试绿。

**SDD 联动**：SDD 10（Detector 协议、run_task 公共前缀、`/objects` 端点族与 `X-Glaux-Frame`）；SDD 04 §7.4 落库定稿（W0 已 ready）、§8.2/§9.1（`Annotation.z` → index、kind 集合增 point、**存储版本号与迁移规则**）；science-core 三个模块 docstring；`docs/architecture.zh-CN.md`（新增 `detectors/` 与 `routers/objects.py`）。

#### W3 · 前端状态与动作收敛（内部走三拍）

**目标**：store 三槽 + wsiRoi + 四份列表收成 focus + objects；actions 收成三个动作；**引擎与标注桥的取值也在本波改完**，保证波内每个 PR 可编译。实测面：21 个文件 180 处旧字段引用。

**步骤**

- **第一拍（PR-A，只加不删）**：`api/types.ts` 增七个新类型（ImageMeta 作别名）；`api/client.ts` 增 `objects(modality)`/`objectEdits`/`taskMeasure(calibration)`；`store/session.ts` 增 focus + objects + 四个 setter + `activeObject()`/`objectsOf()`，**同时把 `activeImage`/`activeVolume`/`activeSlide`/`wsiRoi` 改为 focus 的派生 getter（不删字段）**；coords 扩 Index；toolOptions 按能力位分槽。此拍后 21 个消费文件一行不改仍可运行。
- **第二拍（PR-B，改消费点）**：`data/actions.ts`（19 处）→ 三动作；`SideBar.tsx`（11 处）删四布尔与五个标签字段，`RecentList.open` 与 `onSelect` 统一 `openObject`，`ImportPanel` 读 `/datasources.importable`；**`Editor.tsx`（13 处）与 `StatusBar.tsx`**（原计划遗漏）改 `activeObject()`/`objectsOf`；`focus/{StagePanel,FocusTopBar,FocusSidePanel}.tsx`（各 9 处）改 `activeObject()`；`TitleBar.tsx` 删按模态猜扩展名与 `"CUBS-tech"` 回退；`useConversation.ts`（13 处）`toViewerContext` 收成五字段且**保持 `:99` 的 CHAT_EDITION 短路**；`toolBridge.ts`（3 处）比对 `focus.object_id`。
- **第二拍续（引擎与桥的取值，不可推到 W4）**：`CornerstoneViewer.tsx`（10 处）、`VolumeViewer.tsx`（13 处）、`WsiViewer.tsx`（21 处）改为从 props 收 `{object, focus}`、不再 `useSession` 取当前对象（**只换取值来源，不合并文件、不改渲染逻辑**）；`Viewer.tsx` 成唯一读 store 处并下传；`csAnno.ts:313-330` 字符串解析删除；**`viewer/imtWallTool.ts:47` 改为从工具配置拿 objectId**（它同时踩「读 `activeImage`」与「自拼 `web:` 前缀」两条，W3 不改则波内不可编译）。
- **第三拍（PR-C，删旧）**：删四个派生 getter 与六个旧 setter；`modality`/`activeModel` 改 `string|null`，`setModels` 不再兜底。
- **缺引擎空态**：`Viewer.tsx` 按 ObjectKind 查表后缺键分支渲染 i18n「查看器引擎尚未接入」（新增 zh/en 两键）。W1–W3 期间 video 已在切换器，而现状 `Viewer.tsx:19` 的 `?? "raster_2d"` 兜底不会命中缺键分支。
- `data/recent.ts`：RecentItem 增 kind、modality 放宽，v1→v2 单向迁移（旧项补 kind，推断不出则丢弃不报错）；纯函数逻辑不动。
- i18n：新增 `useModalityLabel(ds)`（优先 `label_key` 查 i18n，缺键回落 label），合并双键；**`focus_example_*` 三组文案改领域中立措辞，EXAMPLES 仍是静态 i18n 键**。
- `annotation/bridge.ts` 不改，仅 `loadAnnotations` 的 z 参数改名 index。

**准出门禁**

- `make test` + `make lint` 全绿；W0 三条行为测试在新实现上不改断言语义即通过。
- **三个 PR 各自可独立合入且合入后三端可编译**；PR-C 后 grep `activeImage|activeVolume|activeSlide|wsiRoi` 在 `frontend/src` 命中为 0。
- 5 个测试文件共 33 处旧字段改完（`FocusSidePanel.test.tsx` 11、`actions.test.ts` 9、`FocusTopBar.test.tsx` 9、`SideBar.test.tsx` 3、`imtWallTool.test.ts` 1；`toolBridge.test.ts` 对这四字段 0 命中）。
- `recent.ts` v1→v2 迁移单测覆盖空/脏/旧三种输入。
- 回归走查 6 条：CUBS 2D、HC18、CT 逐层、WSI ROI、自然图像不自动跑、**video 对象打开显示「引擎尚未接入」**；签字表进 record。
- `check-modality-literals.sh` 对 `frontend/src` 命中为 0。
- **chat 版验收**：两份 edition 测试绿；ChatShell 路径不触达 `/datasources`，示例卡不依赖后端。

**SDD 联动**：SDD 10（前端 store/actions 契约、显式 no-task 触发契约、缺引擎空态契约）；SDD 01 §8（示例卡领域中立、文案以「对象」替代「图像」）；SDD 07（natural_image 改「无 TaskView 的模态」通用空态与显式 manual）；SDD 08 §6（ImportPanel accept 由 `/datasources.importable` 下发）。

#### W4 · 查看器引擎收敛

**目标**：引擎选择由任务轴改到对象几何；两引擎合并（可降级），WsiViewer 去私有 UI 成 PyramidViewer；建立三个注册面。**不做 `plugins/imt` 目录迁移**。

**步骤**

1. 第一步（纯函数，独立合入）：`viewer/maskPng.ts`（两份 `maskToPng` 合一）；`viewer/overlay/painters.ts`（PAINTERS + `drawPrimitives` 按 `focus.index` 过滤；`CornerstoneViewer.tsx:142-244` 算法迁入不重写）；`hooks/{useCsStackEngine,useOverlayCanvas,useBrushBuffer}.ts`。
2. 第二步：VolumeViewer 改用三 hooks + painters（行为不变，单独合入）；第三步：CornerstoneViewer 同。
3. 第四步：合并为 `viewer/FrameStackViewer.tsx`，收 ViewerProps。**若 W0 smoke 做不出，降级为「保留两文件但共用全部 hooks + 15 条手工回归」，合并顺延独立立项**（DEC-21）。
4. `Viewer.tsx`：`ENGINES` 改 `Record<ObjectKind, Component<ViewerProps>>`；`axisFor(meta)` 从 axes 找 z|t；不再读 `TaskView.viewer`（DEC-11）；缺键走 W3 已建空态。
5. `viewer/contract.ts`：FrameSource（web/nifti）、FrameAxis、MaskSink 两实现（DEC-6）、Painter、ViewerProps、`registerFrameLoader`。**前端在此切到 `/objects/{id}/edits`**（后端 alias 保留到 W7）。
6. `WsiViewer.tsx` → `viewer/PyramidViewer.tsx`：删 `_infoBar`/`_hint` 与内联样式、硬编码中文；信息条走 ViewerChrome 泛型 metrics；ROI 框选写 `focus.region`。**复现验证按钮原地保留、仍调 `/wsi/{id}/verify`**。
7. `ViewerChrome.tsx:37, 49, 64, 110`：`isCt` 删，选项条改 `CHROME_SEGMENTS` 由 `caps.has` 决定；工具过滤改 `ALWAYS={cursor,reset} ∪ caps`；抽 `useTaskTools()` 供三处共用；`Tool` 放宽 string，`TOOL_ICON` 改 Partial。
8. `csTools.ts` 提供 `registerTaskTool(name, ToolClass, activate)`，**IMT 壁线就地注册（文件不搬家）**，`:133` 的 `"wall"` 特判删除；壁线淡带 painter 进 PAINTERS。
9. **快捷键与 SDD 05 联动**：`globalKeys.ts:13` 的 `TOOL_KEYS` 随 `Tool` 放宽为 string；wall 键位由任务声明；`SHORTCUT_ROWS` 按当前 `TaskView.tools` 生成。SDD 05 §7 键位表同提交更新。
10. `VolumeViewer.tsx:429-430` 硬编码改 `taskView.task`/`taskView.default_method`；`nifti.ts` 的 modality 与默认窗由 FrameSource 注入。

**准出门禁**

- `make test` + `make lint` 全绿；painters / useBrushBuffer / FrameSource / MaskSink 两实现各有 vitest。
- smoke 可行则留一个用例；不可行则 15 条手工回归（2D 壁线 5 / CT 逐层画笔 5 / WSI ROI 5）逐条签字进 record。
- Primitive 覆盖回归：mask/bbox/point_set 在 2D 引擎不再静默丢弃。
- CT 窗位条由 capabilities 含 voi 出现（摘掉能力位则消失）。
- 键位回归：`w` 键仅在 wall 能力位存在时生效；SDD 05 键位表与实现一致。
- `Viewer.tsx` 是 `frontend/src/viewer/` 与三引擎文件中唯一 `useSession` 调用点（grep）。
- chat 版两份 edition 测试绿。

**SDD 联动**：SDD 10（ENGINES/PAINTERS/CHROME_SEGMENTS/registerTaskTool 与 ViewerProps 契约）；SDD 04（capabilities 开放集与 CHROME_SEGMENTS 对应、Tool 放宽 string、任务专属工具经 registerTaskTool，**路径仍在 `frontend/src/viewer/`**）；**SDD 05 §7 修订**（键位表由 `TaskView.tools` 驱动）；`README.zh-CN.md:39` 补句指向 SDD 10；`docs/architecture.zh-CN.md`（frontend 新增 `viewer/`）。

#### W5 · agent 上下文、观测通道与工具注册面

**目标**：ViewerContext 收敛为五字段；四个看图工具统一经 `fetchObservation(focus)` 走 `/objects/{id}/frame`；`defaultToolFactory` 改 ToolProvider 注册表；提示词领域无关；SegmenterPort 只立 `segment`。

**步骤**

1. `contracts.ts:94-101`：ViewerContext 增 collection/object/focus，旧字段保留；类型逐字镜像 `frontend/src/api/types.ts`。
2. `routes.ts:330-356`：`parseViewer` 按 `object.kind` 判别联合校验；object/focus 优先，旧字段仅在缺失时映射并 **warn + 计数**（`roi_box` 按 `(x0,y0,x1,y1)`）；`parsePromptImages` 不动。
3. 新建 `observation/fetch.ts`：`fetchObservation(base, focus, {size, signal})` → `{bytes, mime, frame}`，**唯一取图处**；`toObjectCoords(box, frame)` → Region。
4. 四个看图工具改调：`view-image.ts:98`、`locate-roi.ts:102`（删 `:120` 只认 PNG/JPEG 的 `readImageSize`）、`segment-region.ts:96`、`consult-atlas.ts`；`locate_roi` 输出附 ReferenceFrame，`propose_annotation` 加 index 并用 `toObjectCoords` 换算；`propose-annotation.ts:158-181` 与 `vision.ts:283-305` 不动。
5. 新建 `pi/tools/registry.ts`：ToolProvider 与 TOOL_PROVIDERS；六个工具包成 provider；`harness-registry.ts:78-113` 改遍历过滤。
6. `harness-registry.ts:117, 147-154`：提示词改「visual analysis harness」+ 按 `object.kind` 生成当前对象句 + promptFragment；删 `:234-241` 的 `tools.some(name===…)` 反推；`:215-270` 不动。
7. `run-task.ts:36`：描述从 `GET /tasks` 动态拼；请求体透传 calibration/region。
8. `vision.ts:40/55/220`：三条 system 改领域无关措辞；`AtlasDescription.modality` 保留成像方法语义（DEC-3）。
9. 新建 `annotation/segmenter-port.ts`：**SegmenterPort{segment} 单方法**；`segmentation-client.ts` 为首个实现；`segment-region.ts` 依赖 Port。

**准出门禁**

- `make test` + `make lint` 全绿；`tests/contract/viewer-context.test.ts` 在新 parseViewer 上通过。
- 新增 `tools/registry.test.ts`：`supports(focus)` 过滤生效。
- **观测正确性自动化断言**：CT 停在第 N 层调 `view_current_image`，`X-Glaux-Frame.index.z === N`；WSI 某 level+ROI 同理（DEBT-02 核心验收）。
- fakeBackend 增 `/objects/{id}/frame` 与 `ct_`/`slide_`/`vid-` 用例。
- 旧字段映射 warn 计数在一次完整回归中为 0，数字进 record（W7 前置）。
- grep：`agent-runtime/src` 中 `biomedical` 与直连 `/image/{id}` 取图均 0 命中。
- **chat 版验收**：chat 模式无 viewer context 时不挂载需要 focus 的工具、不发起 `fetchObservation`。

**SDD 联动**：SDD 02 §4.1/§9/D-9（ViewerContext 收敛、**撤回「不需要视口元数据」**、新增观测通道小节、run_task 改 calibration/region、propose_annotation 加 index、身份改 visual analysis harness、ToolProvider 与 SegmenterPort）；SDD 10（TOOL_PROVIDERS / SegmenterPort runtime 注册面）；SDD 07（SegmentationClient 改 SegmenterPort 实现）；`docs/runbooks/agent-connection.md` 同提交更新。

#### W6 · 视频表征落地

**目标**：视频从「只有数据轴」走到「帧栈可看、帧级可标、agent 可抽帧观测」，全程不写 `=== "video"`。**不含 TrackDetector / segment_video / Track/Event 原语 / track_region**。视频此时是「无 TaskView 的模态」，与 natural_image 同形，走 DEC-18 显式 manual。

**步骤**

1. frontend 新建 `videoFrameSource`（imageIds 生成 `glaux-frame:${id}#t=${i}`，`registerImageLoader` 走 `resources.frame`）；`Viewer.tsx` 由 `axisFor(meta)==="t"` 组装 `axis:{kind:"t", index, count, fps, onIndex}`；**`ENGINES.video` 已在 W4 指向 FrameStackViewer，零新引擎**。
2. frontend：`TimelineSeg`（播放位置/逐帧/跳转，**不含事件区间**）由 capabilities 含 timeline 出现；`toolOptions.playback` 槽；`coords.t` 角标；`formatCalibration` 支持 time_base。
3. frontend：帧级原语（Bbox/Polyline/Mask/PointSet 带 `at:{t}`）按 `focus.index.t` 过滤；画笔 `useBrushBuffer` + `annotationMaskSink.commit(mask, dims, {t})` 与 `bridge.ts` 零改。
4. science-core：各 Primitive 加 `at: Index | None`，`primitive_to_dict`/`from_dict` 同步；前端与 runtime 镜像。**Track/Event 不加**（无任务产出，「不空想契约」）。
5. backend：`dataset_video.py` 的 frame 解码补 LRU 与 seek 优化；capabilities 为 video 下发 timeline（该模态无 TaskPlugin，能力位由 `Source.kind` 默认集提供，写进 SDD 10）。
6. agent-runtime：TOOL_PROVIDERS 增 `sample_frames`（按 t 列表取多帧缩略，`requires.vision`，经 `fetchObservation`）；`toolBridge` 比对 `focus.object_id` + `index.t`。
7. ImportPanel 的 video 项由 `/datasources.importable` 自动出现（**仅单文件 mp4/webm/mkv**）。

**准出门禁**

- `make test` + `make lint` 全绿。
- **视频端到端**：导入 mp4 → 出现在切换器 → 逐帧滚动 → 在某帧画 bbox 并落库（`index.t` 正确）→ 重新打开回灌 → agent 调 `view_current_image` / `sample_frames` / `propose_annotation`（带 `index.t`）。
- **新增 vs 零改清单**：store 字段、actions、annotations 路由、`Viewer.tsx` 之外的组件、parseViewer 与 defaultToolFactory、`bridge.ts` 零改；结论进 record。
- `check-modality-literals.sh` 三端对 `"video"` 为 0。
- **D6/D7 关闭条件核对**：`set(REGISTRY.adapter_kind) == set(DETECTORS)`；路由层无 startswith 与 `is_hc`/`is_ct`/`is_wsi`。
- chat 版两份 edition 测试绿。

**SDD 联动**：SDD 10（视频落地形态、无 TaskView 模态的能力位来源）；SDD 04（`Annotation.index` 语义定稿：volume=z / video=t / slide=level）；**新建 `docs/runbooks/video-modality.md`**（kind: living）；`docs/roadmaps/charter.zh-CN.md`（视频由承诺改为已交付：表征与标注层）；`docs/architecture.zh-CN.md`。

#### W7 · 过渡物清除（独立成波、可整体回滚）

**目标**：删除过渡字段、旧端点 alias、ViewerContext 旧字段、`TaskPlugin.viewer`、`Detection.roi_used`，并把 CI grep 门禁由统计转阻断。**独立成波而非压在 W6**：删除是纯回退性操作，与视频交付的风险曲线不同，且 chat 发行包是独立发版物，需要可单独回滚的 PR。

**步骤**

1. **前置校验（不满足则本波不执行，顺延并在 SDD 10 登记新时点）**：三端 grep 门禁零命中；W5 的 warn 计数为 0；chat 镜像构建的前端版本 ≥ W5 产物。
2. 删除过渡字段：backend ObjectMeta 的四字段与 SourceBase 回填；ImageMeta 别名（Python 与 TS）；TaskSpec 的 `cubs_cf`/`roi`/`roi_box` 与 `_legacy` validator；TaskMeasureRequest 残留 `cf`。
3. 删除端点 alias：`/volumes`、`/slides`、`/volume/{id}`、`/volume/{id}/labelmap`、`/volume/{id}/mask-edit`、`/wsi/{id}/tile`。**`/image/{id}` 与 `/wsi/{id}/verify` 保留**（前者是 agent 与外部引用面，后者等验证器立项），两者在 SDD 10 登记为「有意保留」。
4. 删除 runtime 旧字段：ViewerContext 的 `image_id`/`modality`/`cubs_cf`/`roi_box` 与 parseViewer 映射分支。
5. 删除其余过渡物：`TaskPlugin.viewer`；`Detection.roi_used`；Annotation 的 `z` API 别名（**存储列 z 保留，不做第二次库迁移**）；前端 lint 禁读规则随字段一并删。
6. CI：`check-modality-literals.sh` 转**阻断**，纳入 `make test` 前置。
7. runbook 收尾：`docs/runbooks/p6-3d-totalseg-wedge.md` 与 `p7-wsi-nuclei-wedge.md` 中引用已删端点的段落改写为 `/objects/{id}/edits` 与 `/objects/{id}/tiles`。

**准出门禁**

- `make test` + `make lint` 全绿；旧端点返 404 且有用例断言。
- **过渡物清零断言**：grep `cf|voxel_spacing_mm|mpp_um|dims|ImageMeta|cubs_cf|roi_box|roi_used|TaskPlugin.viewer` 在三端核心目录零命中。
- CI grep 门禁转阻断后一次完整 CI 通过。
- **回滚演练**：本波 PR revert 后三端仍可启动、测试全绿。
- chat 版两份 edition 测试绿；docker 镜像构建通过。
- SDD 10 `status` ready → implemented；SDD 02/04/08/01/05/07 修订全部落库；D6/D7 标为已关闭并注明依据。

**SDD 联动**：SDD 10（status → implemented、删除时点标为已执行、「有意保留」清单）；`docs/designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md` §7.2（「注册表驱动」落点扩为对象模型 + 四张表，链到 SDD 10）；`docs/todo/2026-08-27-001`（D6/D7 关闭，只改 frontmatter 与状态）；两份楔子 runbook 端点改写；执行记录 record 终态归档。

### 8.4 可安全中断点

| 中断点 | 系统状态 |
| --- | --- |
| W0 末 | 产品代码未变（仅两处注释），测试与文档已就位 |
| W1 末 | 后端数据轴已收敛，旧字段由 SourceBase 回填，前端与 runtime 零改，视频在数据轴可见 |
| W2 末 | 后端动作轴与表征面已收敛，旧端点 alias 双通，前端与 runtime 零改 |
| W3 末 | 前端状态与动作已收敛，引擎仍是三份但只读 props；**波内三个 PR 之间不是安全点** |
| W4 末 | 引擎收敛完成（或降级为共用 hooks），三注册面就位 |
| W5 末 | agent 观测通道打通，旧字段映射仍在 |
| W6 末 | 视频可看可标可观测，过渡物仍在（系统完整可发布） |
| W7 末 | 过渡物清除，门禁转阻断 |

### 8.5 切换风险

| 切换点 | 风险 | 缓解 |
| --- | --- | --- |
| W1 · SourceBase 回填 | 回填值与原模块直出值不一致（cf 舍入、dims 顺序、voxel 轴序），前端仍全量读旧字段，偏差即静默错图/错标定 | 准出必须有「新旧 meta 逐字段 diff = 空」快照测试；diff 不空一律按 bug 处理，不得改期望值 |
| W1 · mock 回退删除 | 无数据机器首屏从「有假图」变空态；`scripts/dev/health.sh:6` 与 `restart-backend.sh:12` 用 `/images?modality=carotid_imt` 的张数判健康，会误报服务挂了 | 同波改为打 `/datasources` + `/capabilities`；开发脚本显式 `GLAUX_DEV_MODE=1`，CI 显式注册合成源，发行包保持空态 |
| W2 · annotations kind CHECK | `CREATE TABLE IF NOT EXISTS` + 内联 CHECK，老库不会被 ALTER，新 kind 写入在运行期失败而空库单测全绿 | 实现 `PRAGMA user_version` + 建新表/拷数据/换名/重建索引，以老库升级用例为门禁；W7 不做第二次迁移 |
| W2→W4 · mask-edit 切端点 | `base_seq` 乐观并发跨两个端点；桌面壳与 backend 分别发版时旧前端打新后端 404、新前端打旧后端 405 | 后端 alias 保留到 W7，前端切换放在 W4，两者之间始终双通 |
| W3 · 前端字段整体收敛 | 21 个文件 180 处引用；`recent.ts` v1→v2 影响已有用户的「最近打开」 | 拆三个 PR（加派生 getter → 改消费点 → 删派生）；**引擎三文件与 csAnno/imtWallTool 的取值改造必须在第二拍完成**；`readRecent` 单向迁移且有单测 |
| W4 · 两引擎合并 | 537 + 507 行合并，零组件测试兜底，全计划最高风险单步 | 按 DEC-21 降级：W0 的 smoke mock 做不出则只共用 hooks 不合并文件，不阻塞 W5/W6/W7 |
| W4 · 快捷键与工具类型同时放宽 | `TOOL_KEYS` 是写死的 Tool 映射，`wall` 迁到 registerTaskTool 后若键表不同步，`w` 键静默失效且无测试覆盖 | 准出包含键位回归与 SDD 05 §7 同提交更新 |
| W5→W7 · ViewerContext 收敛 | agent-runtime、frontend、**chat 镜像**是三个独立发布物；旧前端 + 新 runtime 时走旧字段映射，`roi_box` 语义选错即 ROI 错位且无报错 | W0 已把 `(x0,y0,x1,y1)` 写成契约测试并改正注释；映射分支 warn + 计数；W7 删除前须确认计数 0 且 chat 镜像前端版本 ≥ W5 产物 |
| W7 · 三类删除同波 | 回滚粒度过粗 | **独立成波并要求 revert 演练通过**；前置不满足则顺延，但必须在 SDD 10 登记新时点 |
| 贯穿 · 三信封 | 若实现中直接改 `roi_used` 语义，会静默破坏 science-core 测试与已落盘的 TaskOutput 快照 | W2 准出含「`roi_used` 字段名与取值未变」断言 |
| 贯穿 · chat 发行包 | 无 Python 后端，`useConversation.ts:99` 的短路是唯一保护；W3 改投影、W5 改工具门控、W6 加 `sample_frames` 都可能绕过它 | 每波准出都跑两份 edition 测试，并断言 chat 模式不挂载需要 focus 的工具、不发起 `fetchObservation` |

### 8.6 推迟项与触发条件

| 推迟项 | 触发条件 |
| --- | --- |
| 视频自动跟踪整体（`detectors/track.py`、`segment_video.py` 隔离子进程含 SAM2-video、REGISTRY 的 `track_objects` 行、Track/Event 两个新原语与 painter、runtime 的 `track_region` provider、`SegmenterPort.track`、TimelineSeg 的事件区间标记） | 出现明确的视频跟踪/事件检测任务需求；届时是「REGISTRY 一行 + Detector 一个 + provider 一个」 |
| `POST /task/verify` 公共端点、通用验证器语义、复现验证按钮搬到 BottomPanel | 纲领四要素中的「验证器」进入独立排期。W2 只把 `/wsi/{id}/verify` 的实现收进 `Detector.verify`，路径与按钮位置不动 |
| 新建 `frontend/src/plugins/imt/` 并搬迁壁线工具 | 真正分包时一并做。目录搬家会牵动 `csTools.test.ts`、`imtWallTool.test.ts`、`wallGeom` 导入路径与 SDD 04 路径表，收益仅是目录形状 |
| 运行期插件加载与插件包形态（entry_points、前端动态 `import()`、`@glaux/plugin-*`） | 出现仓库外第三方作者，或发行包需按 edition 裁剪模态体积 |
| FocusShell 示例卡按 `/datasources` + `/tasks` 动态生成 | 插件化立项时与模态包一起设计。chat 发行包无后端，动态化会让示例卡为空；i18n 是强类型双语表，后端下发单语 label 会丢 en |
| `kernel.models()` 汇总与 `capabilities()` 的 provider/license 搬家 | 降级为 W2 中不占关键路径的顺手小 PR，不进门禁 |
| 两引擎真正合并为单一 FrameStackViewer | W0 的 CS3D RenderingEngine mock smoke 可运行。否则 W4 只抽纯函数 + 共用 hooks，合并顺延为独立立项 |
| CS3D VideoViewport 实时播放引擎 | 出现「按真实 fps 连续播放并同步 overlay」的需求。W6 第一版是逐帧 StackViewport，零新引擎 |
| 对象 id 规范化为 `<source>:<rel>` | 两个 Source 产出同名 id 的实际冲突，或需跨机器迁移标注库。W1 保留全部既有 id，只建索引 |
| annotations 存储列 `z` 改名为 `index` | 出现需要多轴索引（如 4D 的 z+t 同时落库）的真实需求。W2 只做一次带 user_version 的迁移，W7 不做第二次 |
| 非模态插件（工作台、舞台、图谱、分割与测量工具）的插件化设计 | `README.zh-CN.md:39` 承诺的插件交付进入排期，另立 SDD |
| ImportPanel 与 uploads 支持视频文件夹级导入（多文件序列、分片、转码） | 真实数据集超过单文件上传上限或需非 PyAV 可解的编码 |
| Tool 集合扩展为任务自定义工具的完整插件契约 | 出现第二个需要前端专属交互工具的任务（视频复用既有 bbox/timeline，不构成触发） |

### 8.7 非目标

- 不建插件框架、不建四端同名 pack 目录、不写 `check-packs.py`、不引入 `packs.json`，**也不做 `plugins/` 目录迁移**。插件化产物只是「每张注册表 + 一行」。
- **不改 `/images?modality=` 的路径与查询参数**，也不新建 `GET /objects` 列表端点。**但响应体按 SDD 10 演进**：W1 起返回 ObjectMeta，W7 删除四个旧字段。SDD 08 中「冻结」一词同步改写为「路径与查询参数冻结，响应体按 SDD 10 演进」。
- 不改 `TaskSpec.image_id` / `AnnotationIn.image_id` 字段名，不改既有对象 id 的拼写与前缀。
- 不重写 science-core 的 measurement 纯函数、Adapter ABC、三信封结构。对三信封的唯一触碰是 Detection 增 `region`（W2）与各 Primitive 增 `at`（W6）。
- **不允许在任一端内部一次性删除被 20+ 文件消费的字段**。跨端走四拍；单端内部走三拍。
- 不重做文档摸排。`docs/todo/2026-09-17-001` 已列完文档层过时项，本计划只在代码抽象需要联动时点名具体 SDD/runbook 小节。
- 不在本计划内做实时视频播放、转码、流媒体。
- 不处理与模态无关的既有债（net-guard SSRF、edition 门控本身、atlas 选择器、会话压缩）。
- 不把 i18n 文案清扫单独立项。**但模态标签的归属必须裁定**（W0 裁定为后端下发 `label_key` + 前端 i18n 查表）。
- 不引入新运行时依赖层。新增依赖仅 backend 的 `av`（PyAV），惰性 import、缺库 probe 返 False；同提交更新 `scripts/version_matrix.py`。
- **不把过程证据写进活文档**。grep 基线、git diff 零改清单、手工回归签字表一律进 `docs/todo/2026-09-18-002`；SDD 10 正文只写最新结论。

---

## 9. 健康的部分（确认无需改动）

### science-core

- `tasks.py:115-136` TaskPlugin 与 `:188` REGISTRY 及 `plugin_to_view`：任务轴的正确形态，只加三个字段与 video 行。
- `contracts.py` Detection/Measurement/TaskOutput 三信封与带 kind 的 `primitive_to_dict`/`from_dict`：只追加原语，不改结构。
- `calibration/calibration.py` 的 `CalibrationResult{value, source, provenance}` 与 HardReject 模板：只增 TIME_BASE 与一个派发入口。
- `measurement/{pdm,hc,ct,nuclei}.py`：纯函数，只认 Primitive 与 CalibrationResult，不认模态。
- `segmentation/base.py:72` Adapter ABC 带 kind：进程内像素层契约方向正确。

### backend

- `api.py` 的 `/tasks`、`/task/run`、`/task/measure`、`/datasources*` 端点骨架与 `/images?modality=` 列表端点。
- `kernel.py:251-274` 信封组装与 `_round_metric_values`。
- `datasource_registry.py` 的 `register_folder` 白名单、确定性 id、`sources.json` 持久化、`_invalidate_dataset_caches`、`dev_mode()`、`resolve_root`。
- `upload_store.py` 的哈希派生落盘名与 ID、文件名不进路径。
- `dataset_ct.guarded_patch_labelmap` 的锁与 base_seq 乐观并发。
- `dataset_wsi` 的瓦片缓存与三套坐标系钉死。
- `segment_proc.py` / `segment_ts.py` / `segment_wsi.py` 的缓存优先 + 隔离子进程模板（仅 `segment_ts.py:57` 改走注册表）。
- `annotations/store.py` 的 base_seq/status/source/mask 落盘。
- `routers/uploads.py` 的「取字节 → classify → register_folder」流程。

### frontend

- `actions.ts:40-43 currentTask()` 与 `:141-161 runCurrentTask()`：按注册表取任务、走统一 `/task/run`、写 metrics/primitives/source/modelVersion。
- `actions.ts:245-262 refreshDataSources`/`activeModalities` 与 `session.ts:236 dsState`：数据轴以 `/datasources` 为唯一依据，failed 与空区分。
- `Viewer.tsx:11-16` 的 ENGINES 按字符串分派接缝（只换键的来源）。
- `toolBridge.ts:24-84` 的跨进程输入严格校验与 seq 幂等。
- `recent.ts` 的 `pushRecent`/`pruneRecent`/`readRecent` 纯函数与损坏回空。
- `annotation/bridge.ts` 唯一写桥（editSeq 守卫、乐观草稿、409/422 回滚）。
- `annotation/csAnno.ts:51-183` 的往返映射与 `wsiAnno.ts` 的 W3C↔契约纯函数。
- `viewer/csTools.ts:57-93, 102-144` 的 `createToolGroup`/`activateTool`。
- `viewer/wallGeom.ts` 纯几何函数；`viewer/nifti.ts:63-126` NIfTI 解析/缓存/切片；`viewer/openseadragon.ts` 自定义 tileSource。
- `CornerstoneViewer.tsx:142-244` 的 polyline/ellipse/比例尺绘制算法（迁入 painters 不重写）。
- `session.ts:20-72 Connection` 与 `:76-177 uiMode/focusLayout`；`:188-197 ToolOptions` 作为工具参数真相源。
- `BottomPanel.tsx` 的 MeasurementsView/OutputView 按 metrics 与注册表 overlays 泛型渲染。
- `ViewerChrome.tsx` 的工具按钮部分（`tv.tools × capabilities`、i18n、`.chrome-*` 样式族）。
- `StatusBar.tsx:51-54` 的头条度量与工具文案（已查注册表）。
- `toolHint.ts` 两外壳共用一份 TOOL_HINT；`iconMap.ts` 图标单一真相源 + FALLBACK_ICON。
- `SideBar.tsx` 的 ModalitySwitch（可见性来自 datasources）、ExplorerView 三态、MarketplaceView 四层能力清单泛型渲染。
- `focus/{FocusShell,PaneResizer,SessionRail,ModeSwitch}.tsx` 纯布局壳。
- `styles/global.css` 的 `.modsw` 容器查询（按容器宽而非模态定排版）。
- `ViewerChrome.test.tsx` 与 `SideBar.test.tsx`：断言走能力位/数据源而非模态字面量。
- `annotationTools.test.ts:39`「switchModality 复位无泄漏（三模态轮转）」：已是一条真正的不变量测试。

### agent-runtime

- `propose-annotation.ts:158-181`：建议态恒 suggested/agent、几何二选一、退化拒绝。
- `vision.ts:283-305 toPixelBox`：归一化/像素双解读、越界裁剪、退化丢弃的纯函数。
- `harness-registry.ts:215-270`：会话 start/abort/evict/compactIfNeeded。
- `routes.ts:247-288 parsePromptImages`：附件 MIME/大小三重上限。
- `annotation/mask-to-polygon.ts`：RLE 解码 → 轮廓 → 简化，逐帧纯算法。
- `atlas/select.ts selectExemplars` 与 `atlas/client.ts egressFor`：两步检索与外发档位判定。
- `security/net-guard.ts` 出站守卫；`edition.ts` 发行判定。
- `segmentation-client.ts` 的 2026-08-24 实测约定：作为 SegmenterPort 首个实现保留。
- `tests/integration/propose-annotation-tool.test.ts:203-217`「z 透传给体数据切片」：语义断言正确，扩展为 index 时只增不改。

---

## 10. 结论

1. 34 条已核验债务全部是 P6/P7 楔子期复制粘贴的并列副本，没有一条需要引入新层；最小 diff 是把「N 份并列」合并为「1 份 + 判别字段」。
2. 只有 3 条应当单列：DEBT-25（对象 ID 判别缺注册表入口）、DEBT-01（Focus 缺失）、DEBT-02（agent 观测通道对 CT/WSI 为零或为假）。其余 31 条是六个名词的落地清单或验收面，随对应名词一并交付。
3. 目标抽象 = 一个 Focus、一张对象表、两张后端表（SOURCES/DETECTORS）、`/objects` 表征面、帧栈引擎、最小 ToolProvider；REGISTRY 仍是任务轴单一事实源，三条架构不变量不动。
4. 计划分 8 波、38 人日，每波末是可安全中断点；单端内部（W3）也必须走三拍，否则波内不可编译。
5. 视频在 W1 以 VideoSource 形态落地数据轴，作为 Source 协议的真实验收；W6 交付「能看、能标、能被 agent 观测」，自动跟踪与 Track/Event 推迟。
6. D6/D7 的关闭条件是机器可判的：`resolve_object` 唯一入口、`set(REGISTRY.adapter_kind) == set(DETECTORS)`、核心目录模态字面量零命中、过渡物在 W7 全删。
7. 最大风险是 W4 的两引擎合并（1044 行、零组件测试），已预设降级路径（DEC-21），不阻塞其后三波。
8. 按纲领 §七砍掉五项「只是更整齐」的工作：公共验证器端点与按钮搬家、`plugins/imt` 目录迁移、示例卡动态生成、`models()`/`_DS_META` 元数据整理、为尚未存在的模块预补测试。

---

## 11. 偿还进度

| ID | 债务 | 分数 | 波次 | 状态 | 关闭依据（commit / 门禁） | 关闭日期 |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

> 回填规则：状态取 `open` / `in-progress` / `closed` / `deferred`；关闭依据必须指向具体 commit 与该波准出门禁中的某一条；「并入 X」的条目在 X 所在波次的准出门禁通过后一并标 closed，并在依据列注明其验收面（如「Focus 落地，8 处消费点全部改读 activeObject()」）。
