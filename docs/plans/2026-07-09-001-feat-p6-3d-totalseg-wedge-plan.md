---
kind: record
status: done
title: "P6 · 3D CT 楔子落地计划 — TotalSegmentator 肝+双肾"
type: feat
date: 2026-07-09
origin: docs/designs/2026-07-09-001-p6-3d-totalseg-wedge.zh-CN.md
---

# P6 · 3D CT 楔子落地计划 — TotalSegmentator 肝+双肾

## Summary

把 P6 设计文档的 P6.0–P6.5 拆成六个独立可收口的 implementation unit——从 VolumeMask Primitive + voxel_spacing 标定在注册表的增量落地，到 TotalSegmentator 隔离子进程适配、CS3D OrthographicViewport 驱动的 VolumeViewer、画笔编辑回流、Reproducibility Dice 验证，再到手动 e2e checkpoint。沿用现有「隔离子进程 venv + 缓存优先 + 注册表无分支」模式，**不**碰 117 全量 / MPR / 画笔撤销栈 / 病理 WSI。

## Problem Frame

P5 dockview 外壳已收口。Glaux 已有两个 2D 超声任务（IMT / HC）。P6 是设计文档 §9 写明的下一个查看器接入——VolumeViewport（3D）。前端 Viewer 接缝（`components/Viewer.tsx` 的 `ENGINES`）和后端 `TaskPlugin` 注册表（`orchestration/glaux_orchestrator/tasks.py`）都已在 P2 落地，等于接缝和信封现成。剩的事是「沿接缝把 TotalSegmentator v2 的肝+双肾接进来」，让"3D 体数据"这个模态族从设计落到运行。

## Requirements

- R1. Primitive 联合加 `VolumeMask` 变体（`ref` + `classes` + 可选 `raw_ref`），并能被 `primitive_to_dict` / `primitive_from_dict` 序列化往返
- R2. `CalibrationResult` 扩展支持 `voxel_spacing=(sx,sy,sz)` mm 标定，读不出硬拒绝
- R3. `TaskType` 加 `TOTALSEG_LIVER_KIDNEY`，`REGISTRY` 登记 `TaskPlugin`（adapter_kind=`volume`，viewer=`volume_3d`）
- R4. `measure_liver_kidney` 纯 numpy 算每个类别的体素数 × voxel_volume_mm3 与（若有 raw_ref）HU mean
- R5. TotalSegmentator v2 走隔离子进程（`.venv-ts/`，torch 不入主进程），缓存键 `{vid}_{task}_{method}`
- R6. 1 例 ship-able CT（TotalSegmentator 公开 demo case）+ 对应预测 labelmap（作 reproducibility reference，非真 GT）
- R7. 前端 `VolumeViewer` 用 CS3D OrthographicViewport + `@cornerstonejs/dicom-image-loader` 走 NIfTI（社区包 `cornerstone-nifti` 复用）
- R8. 画笔编辑：CS3D SegmentIndex + BrushTool，提交时 `POST /volume/{id}/mask-edit`，后端 patch labelmap + 重 measure
- R9. 验证端点 `GET /volume/{id}/verify` 返回 per-class Dice（与 ship 的 reproducibility reference 对比）
- R10. 真机端到端（GPU 推理）作手动 checkpoint，不入 CI

**Origin actors:** A1 研究者（看 3D 切片 + 体积 + 验证 + 编辑）
**Origin flows:** F1 选 CT → F2 跑分割 → F3 切层浏览 → F4 体积度量 → F5 画笔修正 → F6 Reproducibility Dice
**Origin acceptance examples:** AE1 选 ct_001 → 看肝+双肾分割 → 肝体积 1300-1700 cm³（A 级范围）（covers R1, R3, R4, R7）；AE2 在 z=80 擦一块肝 → 肝体积下降（covers R5, R8）；AE3 Reproducibility Dice 肝 ≥ 0.95（covers R6, R9）

## Scope Boundaries

- 117 类全量扩到——推到 P6.x
- MPR（三平面联动）/ 3D 体积渲染——推到 P6.x+
- 画笔撤销/重做栈——后续
- 跨病人队列聚合 / 纵向对比——后续
- 病理 WSI（OpenSeadragon）——推到 P7+
- 主动学习 / 在线学习——后续
- DICOM 输入（仅 NIfTI v0）——后续
- 真 GT（独立于 TotalSegmentator 预测的 manual annotation）——v0 用 TotalSegmentator 自己的预测作 reproducibility reference；后续若有数据协议再切真 GT

### Deferred to Follow-Up Work

- P6.x：扩到 ~10 主器官（脾/胰/胃/胆囊/主动脉/腔静脉/膀胱/肾上腺/前列腺/子宫）
- P6.xx：扩到 117 全量
- P6.5e2e 自动化的 CI hook——需 GPU 共享池

---

## Context & Research

### Relevant Code and Patterns

- `science-core/glaux_core/contracts.py`：`Primitive = Polyline | EllipseShape | Mask`（加 `VolumeMask` 变体 + `ClassSpec` + `primitive_to/from_dict` 分支）
- `science-core/glaux_core/calibration/calibration.py`：`CalibrationResult` 当前 `cf: float`（扩字段 `value` 兼容 scalar 与 tuple；新 kind `VOXEL_SPACING`）
- `orchestration/glaux_orchestrator/spec.py`：`TaskType` 枚举（加 `TOTALSEG_LIVER_KIDNEY`）
- `orchestration/glaux_orchestrator/tasks.py`：`REGISTRY` 字典 + `measure_imt` / `measure_hc`（新 `measure_liver_kidney`，参照 pdm.py 风格纯 numpy）
- `backend/app/segment_proc.py` / `hc_real.py`：子进程隔离 pattern（argv 列表 + 最小 env + 缓存优先 + `_run_live` + `*Unavailable` 显式异常）
- `backend/app/config.py`：env 覆盖路径 pattern（`CSD_*` / `HC_SEG_*` 全套）
- `backend/app/kernel.py`：`_detect_for_spec` 在数据入口边界按 `adapter_kind` 分派（新增 `volume` 分支）
- `backend/app/routers/api.py`：端点塌缩到 `/task/*` 的风格（新增 `/volumes` / `/volume/*` 走同样风格）
- `backend/app/dataset.py` / `hc_dataset.py`：数据列表 + 标定 + 图像 serve pattern
- `frontend/src/components/Viewer.tsx`：`ENGINES` 注册接缝（`volume_3d: VolumeViewer`）
- `frontend/src/components/CornerstoneViewer.tsx`：CS3D 一次性 init + StackViewport + 编辑回流 pattern（VolumeViewer 沿同形态）
- `frontend/src/viewer/cornerstone.ts`：`csReady()` + `web:` 加载器 + 元数据 provider pattern（VolumeViewer 沿用 init，新增 NIfTI loader）
- `frontend/src/api/types.ts` + `client.ts` + `store/session.ts`：Primitive TS 镜像 + API 端点 + store 字段
- `orchestration/tests/test_tasks.py`：注册完整性 + measure 单测 pattern

### Institutional Learnings

- `docs/designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md` §10 开放问题 #2：`VolumeMask` 形态已留位（`id, ref, frame?`），本设计落实完整形态
- `docs/todo/2026-07-09-001-code-review-multimodal-arch.zh-CN.md` ③ 编辑竞态：实现 P6.3 时**沿用**最近 P6 修复的 `editSeqRef` 守卫（不重蹈 IMT 覆辙）

### External References

- TotalSegmentator v2.4.0：GitHub repo + Zenodo 预训练权重（`totalsegmentator_v2.4.0.zip`，~1.2GB，Apache-2.0）
- `@cornerstonejs/dicom-image-loader`（含 `cornerstone-nifti` 加载器）
- `nibabel` (python)：NIfTI 读 + pixdim 解析；放 science-core 主 deps
- `medpy` 或自写 Dice（numpy 5 行）：per-class 系数

---

## Key Technical Decisions

- **`VolumeMask` 独立变体**（不挂 Mask）：与设计文档 §10 开放问题 #2 一致；顶层一体含 `classes` 字段，多器官同时呈现不爆炸
- **`CalibrationResult.value: float | tuple[float,float,float]`**（不重命名 `cf`）：保留 US 路径兼容性，CT 走 tuple 路径
- **`TaskPlugin.adapter_kind="volume"`**：与现有 `"wall_pair"/"contour"/"mask"` 并列；`_detect_for_spec` 加新分支
- **隔离子进程 venv `.venv-ts/`**（与 `.venv-csd/` `.venv-hc/` 同构）：torch + nnU-Net + `totalsegmentator` Python 包；主进程断言 `find_spec("torch") is None`
- **缓存键 `{vid}_{task}_{method}.nii.gz`**：与现有 on-disk labelmap cache 同形
- **`cornerstone-nifti` 拉社区包**（不自写）：用户确认；30 行 NIfTI loader 不值得重维护，社区包覆盖 NIfTI/NRRD/MHD
- **Reproducibility Dice 非真 GT**：用 TotalSegmentator 自 ship 的 demo case 预测作 reference；Dice 数字衡量"我们的管线能否复现上游 demo"——非真 GT 比较。文档里诚实标注
- **真机 e2e 手动 checkpoint**：用户确认不入 CI；子进程 smoke + 缓存命中 + measure 单测入 CI
- **`raw_ref` 可选字段**：仅在需要 HU mean 时填（CT 必填，US 类将来填）

---

## Open Questions

### Resolved During Planning

- VolumeMask 形态：独立变体（设计已定）
- NIfTI 加载器：拉 `cornerstone-nifti` 社区包
- 测试姿势：CI 跑子进程 smoke + measure 单测；真机 e2e 手动
- GT 来源：TotalSegmentator 自 ship demo case（reproducibility reference，非真 GT）

### Deferred to Implementation

- 画笔半径默认（2/5/10 px）与 UX：impl 时调，按真实使用调
- BrushTool 在 CS3D 5.x 的 API 漂移：impl 时复核
- TotalSegmentator 命令行参数：impl 时按官方 CLI 文档落实（最少 `--i input.nii.gz --o output.nii.gz --ta v2.4.0 --task total`）
- `@cornerstonejs/dicom-image-loader` 与现有 `cornerstone.ts` 的 init 整合：impl 时看是否可复用 `csReady()` 或需独立 ready
- TotalSegmentator demo case 的具体文件名与 ship 位置：impl 时定（预期 `assets/ct/totalseg_demo/` 或 `data/ct/`，不超 200MB）

---

## Output Structure

```
backend/app/
  segment_ts.py                      # P6.1
  dataset_ct.py                      # P6.1
  config.py                          # P6.1（追加 GLAUX_TS_*）
  routers/api.py                     # P6.1 + P6.3 + P6.4
  verification/dice.py               # P6.4
  kernel.py                          # P6.0 + P6.1（_detect_for_spec 加 volume 分支）
backend/tests/
  test_totalseg.py                   # P6.1（subprocess smoke + cache + measure）
  test_volume_api.py                 # P6.1 + P6.3 + P6.4
science-core/glaux_core/
  contracts.py                       # P6.0（VolumeMask + ClassSpec + 序列化）
  calibration/calibration.py         # P6.0（VOXEL_SPACING kind + 硬拒绝）
  measurement/ct.py                  # P6.0（measure_liver_kidney 纯 numpy）
  tests/test_volume_mask.py          # P6.0
orchestration/glaux_orchestrator/
  spec.py                            # P6.0（TaskType.TOTALSEG_LIVER_KIDNEY）
  tasks.py                           # P6.0（measure_liver_kidney + REGISTRY 行）
orchestration/tests/
  test_tasks.py                      # P6.0（注册完整性 + measure 已知数据对）
frontend/src/
  components/VolumeViewer.tsx        # P6.2
  components/Viewer.tsx              # P6.2（ENGINES["volume_3d"] = VolumeViewer）
  viewer/nifti.ts                    # P6.2（NIfTI 加载器注册到 csReady）
  api/types.ts                       # P6.2（VolumeMask TS 镜像）
  api/client.ts                      # P6.2（/volumes / /volume/* / verify）
  store/session.ts                   # P6.2（如需加 volumeImage 字段）
  package.json                       # P6.2（@cornerstonejs/dicom-image-loader 依赖）
data/ct/                             # P6.1（ship 1 例 demo）
  ct_001.nii.gz                      # input
  ct_001_labelmap.nii.gz             # reproducibility reference（TotalSegmentator 官方 demo 预测）
README.md                            # P6.5（v0 启动说明）
```

---

## High-Level Technical Design

> *Directional guidance for review. Implementing agents should treat as context, not code to reproduce.*

**数据流**

```
NL → /interpret → TaskSpec{task: TOTALSEG_LIVER_KIDNEY}
                → run_spec (无分支) → _detect_for_spec("volume")
                                        ├─ dataset_ct.load_nifti(vid)
                                        ├─ segment_ts.segment(vid)        # 缓存优先 + 隔离子进程
                                        │     ├─ 缓存命中 → 读 .nii.gz
                                        │     └─ 未命中 → subprocess .venv-ts/bin/python run_headless.py
                                        ├─ calib_ct.resolve(vid)            # NIfTI pixdim → voxel_spacing
                                        │     └─ 读不出 → HardReject
                                        └─ measure_liver_kidney(det, cal)   # numpy 数体素 × voxel_volume + HU mean
                                              ↓
                                TaskOutput{primitives=[VolumeMask(ref, classes)], metrics, ...}
                                              ↓
                                /task/run → JSON → 前端 store
                                              ↓
                                <Viewer> 看到 task.viewer === "volume_3d" → VolumeViewer
                                              ↓
                                OrthographicViewport 读 NIfTI + 滚轮切 z
                                              ↓
                                VolumeMask.ref → 拉 labelmap → 当前 z 切片按 classes 着色叠加
                                              ↓
                                BrushTool 激活 → onPaint → POST /volume/{id}/mask-edit
                                              ↓
                                后端 patch labelmap + 重 measure + 写回 store.metrics
```

**3D Viewer 与现有 2D 的关键差异**

- **滚轮语义**：2D = 缩放，3D = 切 z 轴（不缩放）
- **标定来源**：2D = cubs_cf (mm/px) 或手动点选，3D = NIfTI pixdim (mm/voxel, 必有)
- **Primitive**：2D 用 Polyline/Ellipse，3D 用 VolumeMask（顶层一体含 classes）
- **编辑**：2D 拖手柄改 Polyline，3D 画笔改 labelmap 当前 z 切片的某 class 体素

---

## Implementation Units

### U1. VolumeMask + Calibration + 注册表增量

**Goal:** 把 VolumeMask Primitive 变体、voxel_spacing 标定、TOTALSEG_LIVER_KIDNEY 任务插件落到数据层。无 runtime 改动，纯类型 + 注册表。

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `science-core/glaux_core/contracts.py`（加 `VolumeMask` / `ClassSpec` dataclass + `Primitive` 联合 + `primitive_to/from_dict` 分支）
- Modify: `science-core/glaux_core/calibration/calibration.py`（加 `CFSource.VOXEL_SPACING` 枚举值 + `value: float | tuple[float,float,float]` 字段 + `resolve_ct_calibration(nifti_path)` 读 pixdim 硬拒绝）
- Create: `science-core/glaux_core/measurement/ct.py`（`measure_liver_kidney(det, cal) -> Measurement`，纯 numpy 数体素 + HU mean）
- Modify: `orchestration/glaux_orchestrator/spec.py`（`TaskType.TOTALSEG_LIVER_KIDNEY = "totalseg_liver_kidney"`）
- Modify: `orchestration/glaux_orchestrator/tasks.py`（`measure_liver_kidney` 接入 + `REGISTRY` 加 `TOTALSEG_LIVER_KIDNEY` 任务行：adapter_kind=`volume`，viewer=`volume_3d`，tools 含 pan + brush，overlays 三色）
- Create: `science-core/tests/test_volume_mask.py`（VolumeMask 序列化往返 + `measure_liver_kidney` 已知数据对）
- Modify: `orchestration/tests/test_tasks.py`（`test_registry_covers_all_task_types` 自动覆盖新行；加 `test_measure_liver_kidney` 单测）

**Approach:**
- 沿用 `Mask` 的引用式接口（`ref: str` 指向 labelmap URL）
- `ClassSpec` 含 `class_id / role / label_zh / label_en / color / measurable`
- `CalibrationResult` 字段扩展用 `value` 替代 `cf` 名（保兼容：现有 cubs_cf 路径继续传 float 到 `value`）
- `measure_liver_kidney` 接受 `Detection.primitives[0]` 为 `VolumeMask`，遍历 `classes` 数体素 + 累加 HU

**Patterns to follow:**
- `contracts.py` 现有 `Mask` + `primitive_to/from_dict` 分支结构
- `tasks.py` 现有 `measure_hc` / `measure_imt` 签名风格
- `test_tasks.py` 现有 `test_measure_hc_from_detection` / `test_measure_imt_from_detection` 风格

**Test scenarios:**
- Happy path: `VolumeMask(ref="/api/volume/ct_001/labelmap?class=1", classes=(ClassSpec(class_id=1, role="liver", ...),))` → 序列化 → 反序列化 → 字段一致
- Happy path: `measure_liver_kidney` 喂假 50×50×50 numpy 数组（class=1 中心 30×30×30 体素）→ 肝体积 = 27000 × voxel_volume_mm3（如 voxel=(1,1,1) → 27000 mm³）
- Edge case: voxel_spacing=(0.5, 0.5, 1.5) → 肝体积 = 27000 × 0.375 = 10125 mm³
- Error path: NIfTI pixdim 缺失/含零/含负 → `HardReject`（不返回 None）
- Error path: `measure_liver_kidney` 喂空 classes → ValueError
- Error path: `primitive_to_dict` / `primitive_from_dict` 收到未知 kind → TypeError / ValueError
- Integration: `_plugin_to_view(TOTALSEG_LIVER_KIDNEY)` → 含 `viewer="volume_3d"`，`overlays` 三色，`metric_keys` 6 个

**Verification:**
- `pytest orchestration/tests/test_tasks.py science-core/tests/test_volume_mask.py` 全绿
- `GET /tasks` 返回新增的 `totalseg_liver_kidney` 任务
- `primitive_to_dict({"kind": "volume_mask", ...})` 往返与原 dataclass 字段一致

---

### U2. TotalSegmentator 隔离子进程 + 数据 serve

**Goal:** 把 TotalSegmentator v2 通过 `.venv-ts/` 隔离子进程接入，加数据列表 + NIfTI serve，1 例 demo case ship 到 `data/ct/`。

**Requirements:** R5, R6

**Dependencies:** U1

**Files:**
- Modify: `backend/app/config.py`（加 `GLAUX_TS_*` 全套：`TS_PYTHON` / `TS_DRIVER` / `TS_WEIGHTS` / `TS_CACHE` / `CT_DATA_ROOT`）
- Create: `backend/app/segment_ts.py`（`segment(volume_id, method) -> (labelmap_path, model_version)`，缓存优先 + `_run_live` + `TsSegmentUnavailable`）
- Create: `backend/app/dataset_ct.py`（`list_volumes()` / `load_nifti(volume_id) -> np.ndarray` / `vox_spacing(volume_id) -> tuple[float,float,float]` / `image_meta(volume_id)` / `labelmap_path(volume_id, method)`）
- Create: `science-core/runners/segment_ts_headless.py`（子进程 driver，argparse `--volume_id --method`，读 NIfTI → 调 `totalsegmentator` Python API → 写 .nii.gz）
- Create: `science-core/.venv-ts/` setup docs（README 段，非 venv 自身——venv 由 `uv venv .venv-ts --python 3.12 && uv pip install torch --index-url ... nibabel totalsegmentator nnunetv2` 起）
- Create: `data/ct/ct_001.nii.gz`（从 TotalSegmentator GitHub release 下载的 demo case）
- Create: `data/ct/ct_001_labelmap.nii.gz`（同上，作为 reproducibility reference）
- Modify: `backend/app/routers/api.py`（加 `GET /volumes` / `GET /volume/{id}` 端点）
- Create: `backend/tests/test_totalseg.py`（subprocess smoke：mock 掉真正 nnU-Net，测 argv/env/缓存逻辑）
- Modify: `backend/tests/test_api.py`（加 `test_volumes_endpoint` / `test_volume_serve`）

**Approach:**
- `segment_ts.segment(volume_id, method)` 完全镜像 `segment_proc.segment` 的形状：缓存命中 → 读；未命中 → 检查 venv 可用 → 跑子进程 → 再验缓存；都失败抛 `TsSegmentUnavailable`
- 子进程 driver 走最小 env（`MPLBACKEND=Agg CUDA_VISIBLE_DEVICES=-1 PATH=/usr/bin:/bin`），argv 列表
- 缓存文件 `{vid}_{method}.nii.gz` 落 `TS_CACHE/`
- `dataset_ct` 用 `nibabel.load` 读 NIfTI header 取 pixdim；体积本身按需返回 bytes
- 端点设计：`GET /volumes` → `[ImageMeta{...}]`（modality=`ct`），`GET /volume/{id}` → 流式 NIfTI bytes

**Patterns to follow:**
- `backend/app/segment_proc.py` 完整 pattern（缓存 + 隔离 + Unavailable）
- `backend/app/hc_real.py` 的 `image_meta` 形态
- `backend/app/dataset.py` 的 `cf_of` / `image_png` / `list_ids` 形态
- `backend/app/routers/api.py` 现有 `/images` / `/image/{id}` 形态

**Test scenarios:**
- Happy path: `segment_ts.segment("ct_001", "totalsegmentator_v2")` 缓存命中 → 返回缓存路径 + model_version="totalsegmentator_v2 (cached)"
- Happy path: 缓存未命中 + venv 可用 → 调子进程 → 验新缓存出现 → 返回路径 + model_version="totalsegmentator_v2@live"
- Error path: 缓存未命中 + venv 不可用 → 抛 `TsSegmentUnavailable`，**不**返回空
- Error path: venv 跑子进程但超时（>600s）→ 抛 + 缓存未更新
- Happy path: `dataset_ct.vox_spacing("ct_001")` 返回 (sx, sy, sz) tuple
- Error path: `dataset_ct.vox_spacing("missing")` → FileNotFoundError
- Integration: `GET /volumes` 返回至少 1 项含 ct_001；`GET /volume/ct_001` 返回 NIfTI bytes（前 4 字节 = `b"n+1\ "` 或 `b"nii\x0a"` magic）
- Edge case: `assert importlib.util.find_spec("torch") is None`（主进程无 torch）

**Verification:**
- `pytest backend/tests/test_totalseg.py backend/tests/test_api.py` 全绿
- 子进程 smoke test：mock nnU-Net，调真 `.venv-ts/bin/python`（如未建 venv 则 skip），确认 argv + env 正确
- `assert importlib.util.find_spec("torch") is None` 在主进程成立
- 手工：`curl localhost:8000/volumes` 列出 ct_001

---

### U3. VolumeViewer（CS3D OrthographicViewport + NIfTI）

**Goal:** 前端按 `task.viewer === "volume_3d"` 分派到 `VolumeViewer`，读 NIfTI CT 卷 + labelmap，轴状位滚轮切层渲染。

**Requirements:** R7

**Dependencies:** U1（VolumeMask 类型）

**Files:**
- Modify: `frontend/package.json`（加 `@cornerstonejs/dicom-image-loader`，含 `cornerstone-nifti`）
- Create: `frontend/src/viewer/nifti.ts`（注册 NIfTI loader 到 `csReady()` 旁；或独立 `niftiReady()`）
- Create: `frontend/src/components/VolumeViewer.tsx`（CS3D OrthographicViewport + 滚轮切 z + VolumeMask 渲染）
- Modify: `frontend/src/components/Viewer.tsx`（`ENGINES["volume_3d"] = VolumeViewer`）
- Modify: `frontend/src/api/types.ts`（`VolumeMask` + `ClassSpec` TS 镜像）
- Modify: `frontend/src/api/client.ts`（`volumes(modality)` / `volumeUrl(id)` / `verifyVolume(id, task)`）
- Modify: `frontend/src/store/session.ts`（如需 `activeVolume: string | null`，独立于 `activeImage`）
- Modify: `frontend/src/data/actions.ts`（如 `runCurrentTask` 加 volume 分支）

**Approach:**
- `@cornerstonejs/dicom-image-loader` 走 `wadouri:` scheme 加载 NIfTI（社区包默认支持）
- `csReady()` 已一次性 init CS3D core；`niftiReady()` 独立 init `cornerstoneDICOMImageLoader` 并 `external.cornerstone.registerImageLoader('nifti', ...)`
- `VolumeViewer` 形态对照 `CornerstoneViewer`：一次性 init engine + OrthographicViewport，wheel 切 z（不是 zoom），绘制 NIfTI + labelmap 叠加
- VolumeMask 渲染：拉 `ref` 拿 labelmap，按当前 z 切 2D slice，按 `classes[].class_id` 上色，半透明叠加
- 沿用 `csReady` 单例（不重新 init），但 init 顺序：`csReady()` 先 core，再 `niftiReady()` 加 loader

**Patterns to follow:**
- `frontend/src/components/CornerstoneViewer.tsx` 完整形态（一次性 init + viewport + wheel + overlay）
- `frontend/src/viewer/cornerstone.ts` `csReady()` + `web:` loader 模式
- `frontend/src/components/Viewer.tsx` `ENGINES` 注册模式

**Test scenarios:**
- Type: `VolumeMask` TS 类型与 `Primitive` 联合编译通过
- Type: `client.volumes()` / `client.volumeUrl(id)` 返回类型与 `Primitive` 形状对
- Integration (smoke): 加载 `VolumeViewer` 不崩溃（mock CS3D init 即可，或在 preview 中手动）
- Edge case: 切到 z=0 / z=max 不越界
- Edge case: labelmap ref 404 → viewer 显示空白不抛
- Edge case: 切模态回 IMT → VolumeViewer 卸载，CornerstoneViewer 重新挂载，无残留

**Verification:**
- `npm run lint` + `npm run typecheck` 全绿
- `npm run build` 产物 `dist/assets/*.js` 含 `VolumeViewer` chunk
- 手工：preview 起前端 + 后端，切到 CT 模态看轴状位切片滚动

---

### U4. 画笔编辑回流（POST mask-edit + 度量重算）

**Goal:** 在 VolumeViewer 中激活画笔（CS3D SegmentIndex + BrushTool），按 z 切片 + class_id 画/擦，提交时调后端 patch labelmap + 重 measure，前端 store.metrics 实时更新。

**Requirements:** R8

**Dependencies:** U2（后端 mask-edit 端点） + U3（VolumeViewer + BrushTool）

**Files:**
- Create: `backend/app/routers/api.py` 端点 `POST /volume/{id}/mask-edit`（请求体 `{task, slices: [{z, mask_png_ref, class_id, mode}], method}`；后端读原 labelmap → 按 slices union patch → 写新 labelmap → 调 `measure_liver_kidney` → 返回 metrics dict）
- Modify: `backend/app/kernel.py`（加 `edit_volume_mask(volume_id, slices, class_id, mode, method) -> dict` 走同种信封装）
- Create: `backend/app/dataset_ct.py` 函数 `patch_labelmap(volume_id, slices, class_id, mode, method) -> Path`（原 labelmap 读 + 单切片二维掩膜 union + 写新文件 + 更新缓存）
- Modify: `frontend/src/components/VolumeViewer.tsx`（顶栏画笔控件：半径/模式/class radio；BrushTool 激活；onPaint → 防抖后批量提交）
- Modify: `frontend/src/api/client.ts`（`maskEditVolume(volume_id, payload)`）
- Create: `backend/tests/test_volume_api.py`（编辑 → 体积下降 / 上升 / 错误路径）
- Modify: `frontend/src/...` 测试（如有）：测组件状态

**Approach:**
- 后端 mask-edit：用 `nibabel.load` + `numpy` 读原 labelmap，按 `slices[].z` 提单切片，按 `mask_png_ref` 解 PNG → numpy mask → `mode==erase` 时 `arr[mask] = 0`，`mode==paint` 时 `arr[mask] = class_id` → 写新 labelmap（同缓存键）→ 调 `measure_liver_kidney` → 返回 metrics
- 缓存命中：单切片编辑不影响其他切片，缓存可原地覆盖（同一 vid+method）
- 防护：编辑并发（同 vid 同时两笔）→ 用同 U1 后端 `editSeqRef` 风格的后端守卫（`last_edit_seq` 计数器 + 落后者拒收）
- 前端提交：单笔提交（不上撤销栈，YAGNI），debounce 200ms
- VolumeMask 新版 metric 走 `setMetrics` + `setPrimitives` 同 IMT 路径；面板泛型重渲

**Patterns to follow:**
- `backend/app/routers/api.py` 现有 `/task/measure` 端点
- `backend/app/kernel.py` `_detect_for_spec` + `run_task` 风格
- `frontend/src/components/CornerstoneViewer.tsx` `onPointerUp` 编辑→后测流程（用 U1 已修复的 `editSeqRef` 守卫避免覆盖）
- `frontend/src/api/client.ts` `taskMeasure` 端点

**Test scenarios:**
- Happy path: 单 slice erase 100 体素 → 肝体积下降（确切数值 = 100 × voxel_volume_mm3）
- Happy path: paint 把背景填成肝 → 肝体积上升
- Error path: `class_id` 不在 VolumeMask.classes → 422
- Error path: `mask_png_ref` 非 base64 PNG → 422
- Error path: 并发两笔 A (erase) + B (paint) → A 拒绝（被 B 超越）
- Integration: 端点 → store.metrics 写入 → 面板重渲
- Edge case: 切到 z=max 之外 → 422

**Verification:**
- `pytest backend/tests/test_volume_api.py` 全绿
- 手工：preview 切到 z=80，激活画笔，擦一小块肝，肝体积下降，store.metrics 更新

---

### U5. Reproducibility Dice 验证

**Goal:** `GET /volume/{id}/verify` 返回 per-class Dice，与 ship 的 `ct_001_labelmap.nii.gz`（TotalSegmentator 官方 demo 预测）对比。这是"我们的管线能否复现上游 demo"的可复现性检查，**非**真 GT 比较。

**Requirements:** R9

**Dependencies:** U2（labelmap 缓存） + U3（前端调 verify）

**Files:**
- Create: `backend/app/verification/dice.py`（`dice_per_class(pred_path, gt_path, classes: list[int]) -> dict[int, float]`，纯 numpy）
- Modify: `backend/app/routers/api.py`（加 `GET /volume/{id}/verify?task=` → `{class_id: dice, class_label: ...}`）
- Modify: `backend/app/kernel.py`（如需 `verify_volume(volume_id, task) -> dict` 包装）
- Modify: `frontend/src/components/VolumeViewer.tsx`（面板底部加 "Reproducibility Dice vs reference" 区块）
- Modify: `frontend/src/api/client.ts`（`verifyVolume(volume_id, task)`）
- Create: `backend/tests/test_volume_api.py`（verify endpoint 形状 + Dice 已知数据对：完美重叠 = 1.0，完全错开 = 0.0）

**Approach:**
- Dice 公式：`2|p∩g| / (|p| + |g|)`，纯 numpy
- 验证体素：pred 与 ref shape 必须一致，否则 ValueError
- 文档诚实标注：reference 是 ship 的 demo 预测，非真 GT；Dice 衡量"复现"而非"正确性"
- 前端展示：每 class 一行 `Dice vs reference: 0.97 (liver)` 形式，绿色 >0.95，黄色 0.85-0.95，红色 <0.85

**Patterns to follow:**
- `backend/app/verification/` 现有 `crosscenter.py` / `consistency.py` 风格
- `backend/app/routers/api.py` 现有端点形状

**Test scenarios:**
- Happy path: pred == ref → 1.0（每个 class）
- Happy path: pred 与 ref 50% 重叠 → 0.667（2×0.5/1.0）
- Edge case: 某 class pred 全 0 → 0/0 → 返回 0.0（不抛）
- Error path: pred 与 ref shape 不同 → ValueError
- Integration: `GET /volume/ct_001/verify` 返回含 liver/lk/rk 三个键

**Verification:**
- `pytest backend/tests/test_volume_api.py -k verify` 全绿
- 手工：跑一遍 U2 真子进程（手动 checkpoint）→ `curl /volume/ct_001/verify` 看 Dice 数字 ≥ 0.95

---

### U6. 端到端手动 checkpoint 文档 + 真机流程

**Goal:** 把"装 venv + 拉权重 + 跑 1 例 demo"的人工流程写成 README，标记为手动 e2e checkpoint（不入 CI）。

**Requirements:** R10

**Dependencies:** U1–U5

**Files:**
- Modify: `README.md`（加 P6 段：装 `.venv-ts/`、下 TotalSegmentator 权重、跑 `data/ct/ct_001` 案例、预期 Dice）
- Create: `docs/runbooks/p6-3d-totalseg-wedge.md`（详细步骤：环境变量、命令、预期输出、常见错误）
- Modify: `backend/app/segment_ts.py` docstring（声明 e2e 是手动流程）

**Approach:**
- 文档结构：先决条件 → 步骤（5 步内）→ 预期输出 → 已知问题
- 不写 shell 脚本（手工流程；YAGNI）
- 标注 "本流程由工程师手动执行，不入 CI；GPU/CPU 重"

**Patterns to follow:**
- `docs/researches/` 现有文档结构
- `README.md` 现有章节风格

**Test scenarios:**
- Test expectation: none -- 文档变更，无代码行为变化

**Verification:**
- 工程师按 README 步骤在干净环境跑通——本 plan 不自动化此步

---

## System-Wide Impact

- **Interaction graph:** `GET /volumes` / `GET /volume/{id}` / `POST /volume/{id}/segment` / `POST /volume/{id}/mask-edit` / `GET /volume/{id}/verify` 新增 5 个端点；`GET /tasks` 自动含新任务行；`/task/run` 走新 adapter_kind 分支；前端 `Viewer` 按 `task.viewer` 分派到新 `VolumeViewer`
- **Error propagation:** 标定硬拒绝走 `HardReject` → 422；子进程不可用走 `TsSegmentUnavailable` → 503；并发画笔编辑 → 422（被超越）；pred/ref shape 不匹配 → 422
- **State lifecycle risks:** 缓存覆盖（单 slice edit 改整个 labelmap.nii.gz）—— 同 vid 不可并发编辑（U4 守卫）；CS3D 5.x 切模态时 VolumeViewer 卸载无残留（U3 测过）
- **API surface parity:** 5 个新端点 + 1 个新 Primitive 变体 + 1 个新 Calibration kind + 1 个新 TaskType
- **Integration coverage:** 真机 e2e 手动（不入 CI）；CI 覆盖：subprocess smoke + 缓存 + measure 单测 + 编辑单测 + Dice 单测
- **Unchanged invariants:** 现有 2D IMT/HC 路径不变；VolumeMask 是新 Primitive 变体不影响现有 `Polyline`/`EllipseShape`/`Mask` 序列化

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `@cornerstonejs/dicom-image-loader` API 与 CS3D 4.21 不兼容 | 锁版本；U3 试装时如不兼容，fallback 走 P5 的 `web:` 自写 NIfTI loader（设计已留口） |
| TotalSegmentator 权重下载慢（~1.2GB） | 文档标"首次 ~5min"；手动 checkpoint 不入 CI |
| TotalSegmentator 命令行在 v2.4.0 变化 | 锁 v2.4.0；U2 落实时按官方 README |
| `.venv-ts/` 在团队机器装不出来（torch 编译问题） | README 给出 `uv` 一行命令；常见错误进 runbook |
| BrushTool 偏离 CS3D 5.x 计划 | 锁 CS3D 4.21；U4 落实时如 API 漂移，回退到 CS3D 2D 路径上的同种"自绘 canvas 蒙版"模式 |
| Reproducibility Dice < 0.95 表明 pipeline 与上游不一致 | 文档诚实标注"非真 GT"；如数字低，先排查 `measure_liver_kidney` / 标定 / 缓存逻辑 |
| VolumeMask 与现有 `Mask` Primitive 命名混淆 | 测试覆盖 `_plugin_to_view` 返回的 task 行不含 volume_mask primitive（v0 volume 任务不返回 2D Mask） |

---

## Documentation / Operational Notes

- `README.md`：加 P6 段，说明 v0 第一个 3D 任务（肝+双肾），手动 e2e 流程入口
- `docs/runbooks/p6-3d-totalseg-wedge.md`：详细 runbook（环境变量、命令、预期输出）
- `docs/designs/2026-07-09-001-p6-3d-totalseg-wedge.zh-CN.md`：设计源头，本 plan 是其实现分解
- `docs/todo/2026-07-09-001-code-review-multimodal-arch.zh-CN.md`：U4 沿用其编辑竞态修复模式

---

## Sources & References

- **Origin document:** [docs/designs/2026-07-09-001-p6-3d-totalseg-wedge.zh-CN.md](../designs/2026-07-09-001-p6-3d-totalseg-wedge.zh-CN.md)
- **Multimodal design:** [docs/designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md](../designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md)（§9 P6、§10 开放问题 #2）
- **Code review (P6 借力):** [docs/todo/2026-07-09-001-code-review-multimodal-arch.zh-CN.md](../todo/2026-07-09-001-code-review-multimodal-arch.zh-CN.md)
- **Related code:** `science-core/glaux_core/contracts.py`、`orchestration/glaux_orchestrator/tasks.py`、`backend/app/segment_proc.py`、`backend/app/kernel.py`、`frontend/src/components/Viewer.tsx`、`frontend/src/components/CornerstoneViewer.tsx`
- **External:** TotalSegmentator v2.4.0 (GitHub + Zenodo)、`@cornerstonejs/dicom-image-loader`、`nibabel`
