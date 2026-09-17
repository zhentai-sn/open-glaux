---
kind: record
status: open
title: "review: P6 3D CT 楔子（u1–u6）代码评审——待办清单"
type: review
created: 2026-07-10
scope: P6 3D TotalSegmentator 楔子（commit fb36f79..333568b）
---

# P6 · 3D CT 楔子代码评审 · 待办清单

> **用途**：对 P6「3D CT / TotalSegmentator 肝+双肾楔子」六个实现单元（u1–u6，commit
> `fb36f79..333568b`）跑的一轮结构化评审，产出可执行待办清单。此段工作由外部模型接手完成，本轮
> 评审核对其交付与 `docs/plans/2026-07-09-001-feat-p6-3d-totalseg-wedge-plan.md` 的 R1–R10 一致性。
> **日期**：2026-07-10。
> **方法**：三套 pytest 全量回归（science-core 121 / orchestration 25 / backend 56，均绿）+ 三个
> 子代理分层通读 science-core / backend / frontend 全量当前文件 + 主评审亲自核对关键路径（度量数学、
> 并发守卫、NIfTI 加载、编辑回滚）。
> **半衰期提醒**：以下 file:line 定位于评审当时的 HEAD（`333568b`）；动手前先确认现状。

## 一页纸

**数据/科学内核层（R1–R5, R9）质量真实过关**——VolumeMask 序列化、voxel_spacing 硬拒绝、体积/HU/Dice
数学、TotalSegmentator 进程隔离（主进程 `find_spec("torch") is None` 有断言）、argv 列表 + 最小 env，
这些护城河不变量都是真落实的，明显沿用了项目既有纪律。

**但交互/前端层（R6–R8）是"能过测试的壳"，且 commit 标题夸大了交付**：

1. `feat(p6/u3): VolumeViewer` —— 滚轮切 z **实际不换图**（单帧 stack），分割 labelmap **从未叠到图上**（只画角落图例）；
2. `feat(p6/u4): 画笔编辑回流` —— 前端**零画笔 UI**，`api.volumeMaskEdit` 全前端无调用点；后端端点在，但**无并发守卫**（红线⑤未落地）；
3. R6 的 ship demo CT **不在仓库**（gitignore），三条验收样例 AE1/AE2/AE3 **开箱一条都跑不通**。

发现 **1 Critical + 4 High**，集中在并发守卫缺失、切层不换图、画笔未实现、路径校验缺口。建议合并 `main`
前先修 Critical + High；其余按优先级排后续。

**本轮修复范围**：Critical/High 里后端可测项 + science-core 语义项 + 前端安全小修，本 PR 直接改并跑测试
验证（见文末「本轮已修」）。前端 3D 查看器大改造（B2 多帧加载 / 分割叠色 / 画笔 UI）需真实 CT 数据 +
浏览器预览验证，盲改风险高，列为独立后续单元。

---

## Critical

- [x] **① mask-edit 无并发守卫，医生修正会被静默覆盖** ✅ **已修（2026-07-10）** —— [backend/app/routers/api.py:217](../../backend/app/routers/api.py)（`volume_mask_edit`）+ [dataset_ct.py:108](../../backend/app/dataset_ct.py)（`patch_labelmap`）
  修复：`dataset_ct` 加 `threading.Lock` + per-(volume,method) `last_edit_seq` 计数器 + `guarded_patch_labelmap`（校验 base_seq→patch→自增全程持锁，原子）；`StaleEditError`→409；请求体加 `base_seq`，响应回传 `seq`；`/segment` 响应带初始 `seq`。补 2 测试（先到 200/落后 409/重取重试 200）。原文如下：
  plan U4 白纸黑字要求后端 `last_edit_seq` 计数器 + 落后者拒收（`plan:363/378/460`），代码里**零实现**：
  `VolumeMaskEditRequest` 无 seq 字段，`patch_labelmap` 是「读盘→改内存→覆盖同缓存键」的裸 read-modify-write，
  无锁无序列号。
  **失败场景**：两笔并发编辑同一 `ct_001`——A（先到、慢）与 B（后到、快）读同一份原始 labelmap，各自 patch
  后 `nib.save` 覆盖，**后落盘者赢**；若 A 落盘晚于 B，A 的旧编辑覆盖 B 的新修正，labelmap 静默回退。
  这正是上轮评审 High③ 在前端标记、本计划 §Institutional Learnings 明确叮嘱「别重蹈 IMT 覆辙」的同类竞态，
  在后端被重新引入。连 `test_volume_api.py` 里 plan 写明的「并发两笔 A+B → A 拒绝」测试也一并缺失。
  **修复方向**：请求体加 `base_seq`（客户端上次见到的版本）；后端维护 per-volume `last_edit_seq` 计数器，
  `base_seq` 落后即 409/422 拒收，成功则自增并回传新 seq；`patch_labelmap` 内加进程内锁保证原子。补并发测试。

## High

- [x] **② VolumeViewer 切 z 实际不换图（R7 核心功能失效）** ✅ **已修（v3 真机 e2e）**：根因是 `.nii.gz` 未 gzip 解压 + 维度映射错，重写 nifti.ts（详见文末 v3）。 —— [frontend/src/components/VolumeViewer.tsx](../../frontend/src/components/VolumeViewer.tsx)
  `setStack([imageId])` 只放**一个** imageId；`setImageIdIndex(z>0)` 对单帧 stack 越界，被 `:143` try/catch
  静默吞。滚轮只让右上角「z 3 / 40」数字在变，**画面始终是同一帧**——且该帧 pixelData（[nifti.ts:83](../../frontend/src/viewer/nifti.ts)
  `getPixelData`）取的是整卷线性数据头部，显示很可能畸变。
  **修复方向**：NIfTI 加载器改为每层一个 imageId（`nifti:<url>#z=<i>`），`setStack(ids)` 传满 N 帧，
  `setImageIdIndex` 才有意义。这是画笔编辑的前置阻塞。**需真实 CT + 浏览器预览验证**。

- [x] **③ 画笔编辑在前端完全未实现（R8 未完成，commit 标题夸大）** ✅ **已实装 + 浏览器验证（v3 真机 e2e）**：分割叠色 + 画笔（editSeqRef 守卫 + 回滚）+ mask-edit 回流，擦肝体积精确下降（详见文末 v3）。 —— [frontend/src/components/VolumeViewer.tsx](../../frontend/src/components/VolumeViewer.tsx)
  全文件唯一交互是 `onWheel`（切 z），无 pointer/画笔/class 选择/paint-erase 逻辑；`api.volumeMaskEdit`
  （[client.ts:118](../../frontend/src/api/client.ts)）全前端零调用。代码 `:14` 自注「v0 简化为图例 + 状态条；
  U4 画笔时再加 SegmentIndex」——即代码自认还停在 v0，而 commit `0800cef` 标题声称 U4 已完成。分割 labelmap
  也从未渲染叠色，`drawOverlay`（`:54`）只画颜色图例。
  **修复方向**：先解 ②（多帧加载），再补分割叠色，再照抄 [CornerstoneViewer.onPointerUp:380-420](../../frontend/src/components/CornerstoneViewer.tsx)
  的三件套：`const mySeq = ++editSeqRef.current` → await `volumeMaskEdit` → `if (mySeq !== editSeqRef.current) return`
  → 成功 commit / 失败 `setPrimitives(prePrims)` + `pushAgent({variant:"note",tone:"crit",...})`。器官 label 继续
  只进 canvas（勿引入 Rich，保②无 XSS 回归）。**需真实 CT + 浏览器预览验证**。

- [x] **④ `GET /volume/{id}` 缺 `is_ct` 白名单校验** ✅ **已修（2026-07-10）**：`volume_stream` 加 `if not dataset_ct.is_ct(volume_id): raise HTTPException(404)`，与兄弟端点一致。 —— [backend/app/routers/api.py:114](../../backend/app/routers/api.py)（`volume_stream`）
  同文件 `/labelmap`(:138) `/raw`(:165) `/segment`(:186) `/mask-edit`(:227) `/verify`(:289) 都先
  `dataset_ct.is_ct(volume_id)` 守卫，唯独 `volume_stream` 直接 `nifti_path(volume_id)` 拼路径读盘；
  `nifti_path`（[dataset_ct.py:54](../../backend/app/dataset_ct.py)）对 `volume_id` 零 sanitize。
  **失败场景**：`volume_id` 含 `../` 时 `CT_ROOT / "../../foo"` 规范化到 CT_ROOT 之外；目前靠 Starlette
  路由段意外挡住经典穿越（`../`/`%2F` 实测 404），属「意外防御」非「设计防御」，与兄弟端点不一致。
  **修复方向**：加一行 `if not dataset_ct.is_ct(volume_id): raise HTTPException(404, ...)`。

- [x] **⑤ 子进程失败吞掉 stderr，503 变不可诊断黑盒** ✅ **已修（2026-07-10）**：`_run_live` 非 0 退出 `log.warning(stderr[-2000:])`，并把 stderr 尾部塞进 `TsSegmentUnavailable`（`getattr` 兜底兼容测试 mock）。 —— [backend/app/segment_ts.py:66-98](../../backend/app/segment_ts.py)（`_run_live`）
  `check=False` + `capture_output=True` 跑子进程，但捕获的 stdout/stderr **完全没用**（没 log、没塞异常）。
  子进程失败仅靠 `_cached_labelmap` 返 None 判定，抛的 `TsSegmentUnavailable`（→503）只说「现算未产出」。
  **失败场景**：`.venv-ts` 装了但权重损坏 → 子进程 return 非 0 并在 stderr 打真实原因 → 运维只见「未产出」，
  无从排查。硬拒绝方向对，但丢 stderr 让 503 不可诊断。
  **修复方向**：子进程非 0 退出时 `log.warning(result.stderr[-2000:])`，并把摘要塞进 `TsSegmentUnavailable`。

## Medium

- [ ] **R6 ship demo CT 未入仓** —— [data/ct/](../../data/ct/) 只有 README。真实 `ct_001.nii.gz` / reference
  被 `.gitignore`（`*.nii.gz`）排除，靠 runbook 手动拉。可辩护（CT 数据协议 + 体积），但意味着 AE1/AE2/AE3
  三条验收样例开箱跑不通、e2e 从未进 CI。建议：至少 ship 一例极小的合成/公开无协议 NIfTI（几 MB）作 smoke，
  或在 README 顶部显著标注「需先跑 runbook 拉数据，否则 CT 模态全链路不可用」。

- [x] **`/volumes` 端点恒假死逻辑** ✅ **已修（2026-07-10）**：删除该死代码分支（`KERNEL_OK` 已兜底）。 —— [backend/app/routers/api.py:109](../../backend/app/routers/api.py)。
  `if not dataset_ct.is_ct.__module__:` —— `is_ct.__module__` 恒为非空字符串 `"app.dataset_ct"`，`not` 恒 `False`，
  该 503 分支**永不触发**。注释自称「防御性」，实为死代码 + 误导。删除或改成真校验（`dataset_ct is None`，
  但已被 `:107` KERNEL_OK 兜住）。

- [x] **labelmap 404 提示里 `{id}` 是内置函数** ✅ **已修（2026-07-10）**：`{id}`→`{volume_id}`。 —— [backend/app/routers/api.py:144](../../backend/app/routers/api.py)。
  f-string 里 `{id}` 解析为内置 `id` 函数，渲染出 `POST /volume/<built-in function id>/segment`。应为 `{volume_id}`。

- [ ] **kernel 缺 `edit_volume_mask`/`verify_volume` 包装，分层泄漏** —— [backend/app/routers/api.py:217,273](../../backend/app/routers/api.py)。
  plan `:353/:399` 要求逻辑走 kernel 包装（与 `run_task` 同信封），实际 `VolumeMask` 构造 / `resolve_ct_calibration`
  / `_measure_lk` / `dice_per_class` 全内联在 router handler。`_detect_for_spec` 的 volume 分支与 mask-edit
  各自独立拼 `VolumeMask`，`classes`/`ref` 重复，改一处易漏另一处。建议抽到 kernel。

- [ ] **子进程 driver 忽略 `--output`、猜输出路径、污染数据目录** —— [science-core/runners/segment_ts_headless.py:64-87](../../science-core/runners/segment_ts_headless.py)。
  driver 调 `totalsegmentator(output=None)`，靠硬编码 candidates 列表在 `in_path.parent`（即只读 `data/ct/`）
  猜 TotalSegmentator 写哪了，找不到 return 4。上游版本/参数一变输出路径即静默失败。建议真正传 `--output` 到
  专用临时目录，别往数据区写。

- [ ] **`patch_labelmap` 复用旧 header 存 dtype/scl 隐患** —— [backend/app/dataset_ct.py:170](../../backend/app/dataset_ct.py)。
  `nib.Nifti1Image(arr.astype(int32), affine, labelmap.header)` 复用原 header；若原 header `scl_slope≠1` /
  `datatype` 与 int32 不符，保存时可能按旧 scl 缩放 label 值。测试用 int32+eye header 掩盖了此风险，需真机
  TotalSegmentator 输出实测。建议重置 header dtype 或用 `set_data_dtype(np.int32)` 并清 scl。

## Low（影响小，按优先级顺手清）

- [x] `mean_dice` docstring 说「不计零空类」但实现 `sum/len` 把零空类的 0.0 也算进均值 ✅ **已修（2026-07-10）**：改 docstring 与实现一致，点明零空类与「不重叠」从字典无法区分（该 helper 实际未被端点调用，端点自算内联均值）。 —— [science-core/glaux_core/verification/dice.py:46-50](../../science-core/glaux_core/verification/dice.py)。
- [ ] 画笔编辑后不重算 HU mean —— [backend/app/routers/api.py:247](../../backend/app/routers/api.py)。`raw_ref=None`，注释已诚实标注为权衡；记账。
- [ ] `/task/run` 把所有 `Exception` 兜底 503 —— [backend/app/routers/api.py:374](../../backend/app/routers/api.py)。畸形输入错误会被误报 503 而非 422。
- [ ] mask-edit 的 PNG 解码若抛非 `ValueError`（如 `binascii.Error`）冒泡成 500 —— [backend/app/routers/api.py:235](../../backend/app/routers/api.py)。应一并捕获转 422。
- [ ] `nifti.ts:109-110` min/max 取首末体素当极值，窗宽窗位坍塌 —— [frontend/src/viewer/nifti.ts:109](../../frontend/src/viewer/nifti.ts)。CT 可能显示近纯色（有固定 WC/WW 兜底）。
- [ ] `nifti.ts:69` metaProvider 硬编码 `modality:"CT"`、`pixelSpacing:[1,1]`，忽略 `ImageMeta.voxel_spacing_mm` —— [frontend/src/viewer/nifti.ts:69](../../frontend/src/viewer/nifti.ts)。3D 体素间距未接线。
- [ ] `verify` 端点 reference 命名 `{vid}_ref.nii.gz` 与 plan/README 的 `ct_001_labelmap.nii.gz` 漂移 —— [backend/app/routers/api.py:299](../../backend/app/routers/api.py)。缺失时干净 422，仅命名不一致。
- [ ] `segment_ts.py:87` f-string 无占位符（`f"...(cached)"`）；`dataset_ct.list_ids` 的 `p.stem.split(".")[0]` 冗余 —— 纯风格。

---

## 验证时确认没问题的部分（供后续参考）

- 主 FastAPI 进程无 torch（`test_totalseg.py:143` 断言 `find_spec("torch") is None`）；TotalSegmentator 全走 `.venv-ts` 隔离子进程。
- 子进程调用 argv 列表、无 `shell=True`、最小 env（`MPLBACKEND`/`CUDA_VISIBLE_DEVICES=-1`/`PATH`）、有 timeout；有 `test_run_live_argv_and_minimal_env` 逐项验证。
- voxel_spacing 标定读不出/非正 → `HardReject`（`calibration.py:98`），与 US 路径同模板。
- `measure_liver_kidney` 体积/HU 数学正确，raw 与 labelmap shape 不一致硬拒绝（`measurement/ct.py:54`）。
- `dice_per_class` shape 不匹配 ValueError→422，零空集合返 0.0 不抛（`verification/dice.py:27`）。
- VolumeMask 序列化往返有测试（`test_ct.py:52`）；`_plugin_to_view` 注册表完整性测试覆盖新任务行。
- XSS 无回归：VolumeViewer 后端来源字符串（器官 label/class_id/任务 label）全部只进 `canvas.fillText` 或纯文本 JSX，不进 `dangerouslySetInnerHTML`；`Rich.tsx` 的 `escapeVars` 转义完整。

## 本轮已修（2026-07-10）

后端可测项 + science-core 语义项 + 前端安全小修，已直接改并跑测试验证：

- **Critical ①**（mask-edit 并发守卫）、**High ④**（volume_stream is_ct）、**High ⑤**（子进程 stderr）；
- **Medium**（/volumes 死逻辑、`{id}` f-string）；**Low**（mean_dice docstring）；
- **前端 B1（部分）**：`VolumeViewer` 切卷时同步 `setNumSlices(0)/setZ(0)`，杜绝旧 z 泄漏到新卷取索引 / overlay 旧读数（[VolumeViewer.tsx:113](../../frontend/src/components/VolumeViewer.tsx)）。**注**：这只修了 z 残留，②（多帧加载让切 z 真换图）与 ③（画笔 UI）仍开着——它们需真实 CT 数据 + 浏览器预览验证，未在本轮盲改。

**验证**：backend 58 passed（+2 并发测试）· science-core 121 · orchestration 25 · 前端 `tsc -b && vite build` 通过。

**仍开的合并前阻塞项**：② 切 z 不换图（NIfTI 多帧加载）、③ 画笔编辑 UI + 分割叠色。建议作为独立前端单元，在拉到真实 CT demo 数据 + preview 后做并验证。

## 真机 e2e 补充（2026-07-10 v3）—— 拉真实 CT + TotalSegmentator 跑通全链路

用 TotalSegmentator 官方 demo CT（`example_ct.nii.gz`，3mm 各向同性）+ 真实 nnU-Net 推理，把
「选 CT → 分割 → 切层 → 体积度量 → 画笔编辑 → Dice」端到端跑通。**真实数据暴露了一批「测试(mock)
过、真实数据崩」的 bug——全部已修 + 补测**：

**后端 / 数据管线**
- [x] **driver 根本跑不通**：`task="liver_kidney"`（非法 task 名）+ `output=None` 猜路径 + 无标签重映射 —— 改 `task="total"` + `roi_subset` + 直接落盘 + TS 原生标签(liver=5/kidney_left=3/kidney_right=2)→我们(1/2/3)重映射 + 默认 fast(3mm) CPU 友好。[segment_ts_headless.py](../../science-core/runners/segment_ts_headless.py)
- [x] **`ct_data_available()` 恒 False**：`Path("ct_001.nii.gz").suffix == ".gz"`（非 ".nii.gz"），`p.suffix in {".nii",".nii.gz"}` 永假 → `/task/run` 对 CT 恒 422「数据未就绪」。改 `name.endswith`。[config.py:95](../../backend/app/config.py)
- [x] **`raw_ref` 当 URL 传给 measure**：kernel 把 `raw_ref` 设成 URL，但 `measure_liver_kidney` 用 `nib.load(raw_ref)` 当文件路径 → FileNotFoundError（`/task/run` 503）。且两个测试对 `raw_ref` 语义矛盾（一个当 URL 下发、一个当 fs 路径 load）。拆成 `raw_path`(fs, measure 读, 不下发) + `raw_ref`(URL, 下发前端)。[contracts.py](../../science-core/glaux_core/contracts.py) / [measurement/ct.py](../../science-core/glaux_core/measurement/ct.py) / [kernel.py](../../backend/app/kernel.py)
- [x] **mask-edit 轴向错 → 422 / patch 错平面**：nibabel 数组是 (X,Y,Z)，但 `patch_labelmap` 写 `Z,Y,X=arr.shape` 并 `arr[z]` 切轴 0(=X 矢状面)；前端沿 Z 切轴状位、PNG 宽=X 高=Y → 尺寸不符 422。改 `arr[:,:,z]` + mask 转置对齐。**立方测试对称掩盖了此 bug，补非立方回归测试**。[dataset_ct.py:163](../../backend/app/dataset_ct.py) + [test_volume_api.py](../../backend/tests/test_volume_api.py)
- [x] **CT 模态无注册模型**：`models()` 只有 IMT/HC，无 ct_abdomen → 切模态时 `activeModel` 停在 caroSegDeep → `/task/run` 把错 method 传给 volume 分支 → 503。加 `totalsegmentator_v2` active 模型。[kernel.py:350](../../backend/app/kernel.py)
- [ ] **子进程最小 env 缺 `HOME`**（记账，v0 未修）：`_run_live` 的 env 只有 `MPLBACKEND/CUDA/PATH`，TotalSegmentator 首次找权重缓存用 `Path.home()` 需 `HOME` → 后端 live 路径首跑可能失败。v0 e2e 用「直接跑 driver 预置权重+缓存 → 后端走缓存命中」规避。补 `HOME` 进 env 即可。[segment_ts.py](../../backend/app/segment_ts.py)

**前端 VolumeViewer（②③ 实装完成）**
- [x] **② NIfTI 未解压 + 维度映射错**：`.nii.gz` 是 gzip，`loadNiftiVolume` 未 `decompress` → `isNIFTI` 恒 false → CT/labelmap 全加载失败（numSlices 0、无叠色）。且旧 `columns=dims[0]`（=ndim）维度全错。重写 nifti.ts：先 decompress + 正确 X=dims[1]/Y=dims[2]/Z=dims[3] + 每帧一个 imageId(多帧 stack) + CT HU 偏移窗位。[nifti.ts](../../frontend/src/viewer/nifti.ts)
- [x] **③ 分割叠色**：labelmap 整卷入 ref，按当前 z 切片着色、worldToCanvas 对齐叠加在 CT 上。加载后自动跳到器官体素最多的 z（否则默认中间层是空切片，用户看不到分割）。primitives-effect 只依赖 labelmap URL（不依赖 drawOverlay，否则初始 z 变化反复 cancel 加载）。
- [x] **③ 画笔编辑**：BrushTool（class 选择/paint-erase/半径）→ pointer 画笔迹 → PNG → POST mask-edit，沿用 CornerstoneViewer 的 `editSeqRef` 守卫 + 失败回滚 + note/crit 提示；成功后 setMetrics + 失效缓存重取 labelmap 重绘。
- [x] **Editor 门控用 activeImage 恒挡住 CT**：`image ? <Viewer/> : empty` 用 `activeImage`（CT 恒 null）→ VolumeViewer 从不挂载。改 `activeImage ?? activeVolume`。[Editor.tsx](../../frontend/src/components/Editor.tsx)

**真机 e2e 验证结果（真实数据，非 mock）**
- 分割：肝 41914 vox = **1131.7 cm³**、左肾 134.9、右肾 185.7（生理量级），CPU fast 模型 **20s**
- `/task/run`→volume_mask + 6 metrics(含 HU mean)；`/verify` Dice 全 **1.0**（vs 自复现 reference）
- 浏览器：切 CT **立即显示肝+双肾分割叠色**（auto-jump）、滚轮切 z 真换层、画笔擦肝 → 体积 **1131678→1130328（Δ1350=50vox×27mm³ 精确）** + 叠色实时更新
- 并发守卫：擦肝 base_seq 校验、409 拒收路径通

## 变更记录
- **2026-07-10**：v1。首次评审，三套 pytest 全绿 + 三子代理分层通读 P6 全量交付，产出本清单。
- **2026-07-10**：v2。修 Critical ① + High ④⑤ + Medium/Low 后端与 science-core 项 + 前端 B1 部分；验证全绿。
- **2026-07-10**：v3。真机 e2e（真实 CT + TotalSegmentator）跑通全链路，暴露并修复 7 个「mock 过真实崩」的 bug（driver / ct_data_available / raw_path / mask-edit 轴向 / CT 模型注册 / nifti gzip+维度 / Editor 门控），前端 ②③ 实装完成并浏览器验证。backend 59 / science-core 121 / orchestration 25 全绿 + tsc/build 通过。仅剩子进程 env `HOME`（记账）。
</content>
</invoke>
