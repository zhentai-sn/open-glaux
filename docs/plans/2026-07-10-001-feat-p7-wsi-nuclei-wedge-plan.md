---
kind: record
status: done
title: "P7 · WSI 病理楔子落地计划 — 细胞核检测+计数（OpenSeadragon + OpenSlide）"
type: feat
date: 2026-07-10
origin: docs/designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md（§9 P7 病理 WSI）
---

# P7 · WSI 病理楔子落地计划 — 细胞核检测+计数

## Summary

把「病理全切片（WSI）」作为第四个模态族接进 Glaux，v0 任务是**细胞核检测 + 计数/密度**。沿用 P2–P6 已建成的三条脊柱——注册表无分支（`TaskPlugin`）、隔离子进程 venv（重模型不入主进程）、查看器接缝（`Viewer.tsx` 的 `ENGINES`）——但要新长出两样 CT/US 都没有的东西：

1. **瓦片服务协议**：WSI 单片十亿像素、数 GB，**不能整图下发**。后端用 **OpenSlide 现读 `.svs/.ndpi` + `DeepZoomGenerator` 动态出瓦片**（DZI 协议），瓦片落盘缓存。
2. **第二套前端查看器栈**：CS3D 3.33.5 无 WSI 深缩放能力，v0 新引 **OpenSeadragon**（独立于 CS3D），在 `ENGINES` 里加 `wsi:` 一行。

推理必须**按 ROI**（用户框选区域）跑——整片推理不可行。ROI 内切 patch → 隔离子进程跑核分割模型 → patch 边界去重 → 出 `PointSet`（核质心 + 类别，level-0 坐标）→ measure 数计数/密度（MPP 标定）。**不**碰整片推理 / 核分割边界编辑 / 多染色（IHC/多重免疫荧光）/ WSI 配准。

## Problem Frame

P6 3D CT 楔子已收口，Glaux 已有三个模态：2D 超声（IMT / HC）+ 3D CT（肝+双肾）。P6 的 Scope Boundaries 白纸黑字写明「病理 WSI（OpenSeadragon）——推到 P7+」，本计划即那一步。多模态设计文档 §9 把 WSI 列为查看器谱系的第四支。

好消息是**接缝早就留好**：`frontend/src/components/Viewer.tsx:12` 里 `// wsi: WsiViewer` 是注释占位，`TaskPlugin.viewer` 字段的 docstring（`tasks.py:88`）明说 `"wsi"` 是预期取值，`spec.roi`（列窗/框选）已在契约里且 P6 已把 `roi_used` 串进 `Detection`。剩的事是「沿接缝把 WSI + 核检测接进来」，让「病理全切片」这个模态族从设计落到运行。

难点不在接缝，在两处 CT 没有的新机制：**（a）瓦片协议**——数据入口边界从「整卷流式」变成「按需瓦片 + ROI 抽块」；**（b）第二套查看器栈**——OpenSeadragon 与 CS3D 并存，坐标系/overlay/ROI 交互全新写。

## Requirements

- R1. Primitive 联合加 `PointSet` 变体（`points`（level-0 px 坐标）+ 每点 `class_id` + `classes` 表 + 可选 `roi`），能被 `primitive_to_dict` / `primitive_from_dict` 序列化往返
- R2. `CalibrationResult` 支持 `CFSource.MPP` + `value=(mpp_x, mpp_y)`（µm/px），从 OpenSlide `openslide.mpp-x/y` 读；读不出/非正 → 硬拒绝
- R3. `TaskType` 加 `NUCLEI_DETECTION`，`REGISTRY` 登记 `TaskPlugin`（`adapter_kind="wsi"`，`viewer="wsi"`）
- R4. `measure_nuclei` 纯 numpy：ROI 内总核数 + per-class 计数 + 密度（count/mm²，用 MPP 标定 + ROI 面积）
- R5. WSI 数据层用 **OpenSlide 主进程读**（C 库 IO，同 nibabel，主进程仍断言无 torch/TF），`DeepZoomGenerator` 动态出瓦片，瓦片落盘缓存
- R6. DZI 瓦片端点：`GET /wsi/{id}.dzi`（XML 描述）、`GET /wsi/{id}/{level}/{col}_{row}.jpeg`（瓦片）、`GET /wsi/{id}/thumbnail`、`GET /wsi/{id}/region`（模型抽块用）
- R7. 核分割模型走隔离子进程（`.venv-wsi/`，torch/TF 不入主进程），**ROI 抽块 → patch 切分 → 逐 patch 推理 → 边界去重（质心 NMS）**，缓存键 `{slide_id}_{roi_hash}_{method}`
- R8. 1 例 ship-able 小 WSI（OpenSlide 可再分发测试数据 `CMU-1-Small-Region.svs`，~1.8MB，含 MPP）+ 一份该 ROI 的 reference 检测结果（作 reproducibility reference，非真 GT）
- R9. 前端 `WsiViewer` 用 **OpenSeadragon** 读 DZI 深缩放 + **ROI 框选工具** + **核质心 overlay**（canvas，按 class 上色，可开关）
- R10. 验证端点 `GET /wsi/{id}/verify` 返回 reproducibility 指标（计数一致 + 质心匹配 F1 @ 距离阈值，与 ship 的 reference 对比）
- R11. 真机端到端（ROI 推理）作手动 checkpoint，不入 CI

**Origin actors:** A1 病理研究者（在 WSI 上深缩放 + 框 ROI → 看核检测 + 计数/密度 + 验证）
**Origin flows:** F1 选 slide → F2 深缩放浏览 → F3 框 ROI → F4 跑核检测 → F5 看计数/密度 → F6 reproducibility 验证
**Origin acceptance examples:**
- AE1 选 `slide_001` → OSD 深缩放浏览到 40× 无卡顿（covers R5, R6, R9）
- AE2 在肿瘤区框一块 ROI → 跑检测 → 质心 overlay 叠在核上、计数面板出总数 + 密度（count/mm²）（covers R1, R3, R4, R7, R9）
- AE3 同 ROI 重复跑 → reproducibility 计数一致、质心 F1 ≥ 0.95（covers R8, R10）

## Scope Boundaries

- 整片（whole-slide）推理——v0 仅 ROI；整片队列扫描推到 P7.x
- 核**边界**编辑（增删/挪质心、改轮廓）——v0 只读检测结果，推到 P7.x（对齐 P6 画笔，但 point-correction 交互另设计）
- 多染色 / IHC 定量 / 多重免疫荧光 / 解卷积——推到 P7.x+
- WSI 配准（连续切片对齐）/ 拼接——后续
- 组织区域分割（上皮/间质/坏死 heatmap）——另一支任务，本 v0 只做核检测
- 跨 slide 队列聚合 / TMA 阵列分核——后续
- DICOM-WSI 输入（仅 vendor 格式经 OpenSlide，v0）——后续
- 真 GT（独立于模型预测的病理专家标注）——v0 用模型自身在 demo ROI 的预测作 reproducibility reference；后续若有标注协议再切真 GT

### Deferred to Follow-Up Work

- P7.x：ROI 内核**边界** overlay（instance 轮廓多边形，非仅质心）+ point-correction 编辑回流
- P7.x：整片分块推理 + 核密度热力图（whole-slide count map）
- P7.xx：组织区域分割任务（第二个 WSI 任务族，复用同查看器栈）
- P7.e2e 自动化 CI hook——需 GPU 共享池 + 更大 slide 夹具

---

## Context & Research

### Relevant Code and Patterns

- `science-core/glaux_core/contracts.py`：`Primitive = Polyline | EllipseShape | Mask | VolumeMask`（加 `PointSet` 变体 + `primitive_to/from_dict` 分支；`ClassSpec` 复用 P6 已有）
- `science-core/glaux_core/calibration/calibration.py`：`CalibrationResult`（P6 已扩 `value: float | tuple`；加 `CFSource.MPP` + `resolve_wsi_calibration(mpp_x, mpp_y)` 硬拒绝）
- `orchestration/glaux_orchestrator/spec.py`：`TaskType` 枚举（加 `NUCLEI_DETECTION`）
- `orchestration/glaux_orchestrator/tasks.py`：`REGISTRY` 字典 + `measure_imt/hc/liver_kidney`（新 `measure_nuclei` 纯 numpy；新 `TaskPlugin` 行 adapter_kind=`wsi` viewer=`wsi`；新 `NUCLEI_CLASSES` ClassSpec 表，参照 `LIVER_KIDNEY_CLASSES`）
- `backend/app/segment_ts.py`：**隔离子进程完整 pattern**（argv 列表 + 最小 env `CUDA_VISIBLE_DEVICES=-1` + 缓存优先 + `_run_live` stderr 记录 + `*Unavailable` 显式异常）——`segment_wsi.py` 直接对照
- `backend/app/dataset_ct.py`：数据 IO + 标定 + `lru_cache` + 主进程可读的科学 IO 库（nibabel）pattern——`dataset_wsi.py` 对照（OpenSlide 换 nibabel）
- `backend/app/config.py`：env 覆盖路径 pattern（`CSD_*`/`HC_SEG_*`/`TS_*` 全套 + `*_data_available()`/`*_live_available()`）——加 `WSI_*` 全套
- `backend/app/kernel.py:148` `_detect_for_spec`：按 `adapter_kind` 在数据入口边界分派（`wall_pair`/`contour`/`volume`）——加 `wsi` 分支；`models()` 加 active 病理模型（gated on `wsi_data_available()`，对照 `totalsegmentator_v2` 那段）
- `backend/app/routers/api.py`：端点风格（`/volumes` `/volume/*`）——加 `/slides` `/wsi/*` 同风格
- `frontend/src/components/Viewer.tsx:10` `ENGINES`：查看器注册接缝（加 `wsi: WsiViewer`）
- `frontend/src/components/VolumeViewer.tsx`：**非-CS3D-StackViewport 的独立查看器**最近先例（P6 自写 NIfTI loader + overlay canvas + editSeqRef 守卫 + `pushAgent` 提示）——`WsiViewer` 沿其「独立引擎组件」形态，但底层换 OpenSeadragon
- `frontend/src/components/Editor.tsx:15`：`activeImage ?? activeVolume` 当前对象选择——加 `?? activeSlide`
- `frontend/src/viewer/nifti.ts`：自写加载器 + 缓存 + 坐标映射 pattern（`worldToCanvas` 对齐 overlay）——`WsiViewer` 的 overlay 用 OSD `viewport.imageToViewportCoordinates` 同理
- `frontend/src/api/types.ts` + `client.ts` + `store/session.ts`：Primitive TS 镜像 + API 端点 + store 字段（加 `activeSlide` / `PointSet` 镜像 / `/slides` `/wsi/*`）
- `orchestration/tests/test_tasks.py`：注册完整性（`test_registry_covers_all_task_types` 自动覆盖新行）+ measure 单测 pattern

### Institutional Learnings

- **P6 真机 e2e 七连坑教训**（`docs/todo/2026-07-10-001-code-review-p6-3d-wedge.zh-CN.md` v3 段）：「过 mock 测试 ≠ 真机能跑」。本计划每个数据/加载单元都要**真机验证**入口——尤其 R5 瓦片协议、R7 ROI 抽块坐标系、R9 OSD overlay 坐标对齐，是最易「测试绿但真机错平面/错尺寸」的三处（对照 P6 的 nifti 轴向坑 + gzip 坑 + overlay 对齐坑）。
- **P6 编辑竞态守卫**（`docs/todo/2026-07-09-001-code-review-multimodal-arch.zh-CN.md` ③ + P6 U4）：v0 WSI 不做编辑，暂不涉及；但 P7.x point-correction 落地时**沿用** `guarded_patch_labelmap` 的 `last_edit_seq` + 锁模式，别重蹈覆辙。
- **坐标系是 WSI 的头号坑**：OpenSlide level-0 = 全分辨率 px；DeepZoom level 与 OpenSlide level 编号相反（DZI level 0 = 1×1 缩略，最大 level = 全分辨率）；OSD viewport 坐标 = 归一化到 image 宽度（0..1）。质心存 level-0 px，overlay 时 `imageToViewportCoordinates`。三套坐标必须在计划里钉死（见 High-Level Design）。

### External References

- **OpenSlide** + `openslide-python`：读 `.svs/.ndpi/.mrxs/.tiff`；`openslide.deepzoom.DeepZoomGenerator` 出 DZI 瓦片；`props["openslide.mpp-x/y"]` 取 MPP。系统需装 `libopenslide`（apt / conda）
- **OpenSeadragon**（npm `openseadragon`）：DZI 深缩放查看器；`viewport.imageToViewportCoordinates` 坐标映射；canvas overlay 或 `addOverlay`
- **核分割模型**（隔离子进程，二选一，impl 时定）：
  - **StarDist**（`2D_versatile_he` 预训练，H&E，TF）——CPU 可跑、pip 装、**类别无关**（只出核实例），v0 计数够用（对照 P6 fast 模型的「CPU 可跑」取向）
  - **HoVerNet**（PanNuke 权重，torch，5 类：neoplastic/inflammatory/connective/dead/epithelial）——**类别感知**，measure 可出 per-class + 肿瘤核占比，但重、偏 GPU
- **demo slide**：`CMU-1-Small-Region.svs`（OpenSlide freely-distributable test data，~1.8MB，Aperio，含 MPP）——小到可入仓库作 ship 夹具
- 质心去重：patch 重叠区 + 质心 NMS（距离阈值内合并），纯 numpy/scipy `cKDTree`

---

## Key Technical Decisions

- **`PointSet` 独立 Primitive 变体**（不复用 `Mask`/`VolumeMask`）：核检测天然是「质心 + 类别」的点集，非稠密掩膜；v0 存质心（不存 instance 轮廓）——十万级核的轮廓多边形下发会爆，质心 + 计数是诚实 MVP。轮廓 overlay 推 P7.x。
- **OpenSlide 主进程读**（同 nibabel/tifffile）：moat 红线是 torch/TF 不入主进程，非所有 native 库；OpenSlide 是纯数据 IO 的 C 库。主进程仍 `assert find_spec("torch") is None`。**重模型**照旧进 `.venv-wsi` 隔离。
- **动态 DeepZoom（不预转/不预切）**：用户已确认。OpenSlide `DeepZoomGenerator` 按需出瓦片 + 落盘缓存；无入库预处理管线，接入最快。瓦片缓存键 `{slide_id}/{dz_level}/{col}_{row}.jpeg`。
- **OpenSeadragon（不硬塞 CS3D）**：用户已确认。CS3D 3.33.5 无 WSI 深缩放；OSD 是病理界工业标准。代价是第二套查看器栈，但 `ENGINES` 接缝正是为此设计——加一行，Editor 一行不改。
- **v0 仅 ROI 推理**：整片推理不可行（算力 + 时延）。复用 `spec.roi`（P6 已串 `roi_used`）。ROI 内 patch 切分 + 逐块推理 + 边界质心 NMS 去重。
- **模型二选一延到 impl**：默认倾向 **StarDist-HE**（CPU 可跑、类别无关、计数够 v0）；若要 per-class（肿瘤核占比等）再上 **HoVerNet-PanNuke**。`measure_nuclei` 对两者都工作（类别无关时 per-class 塌成单类 total）。
- **reproducibility 非真 GT**：ship demo ROI 的模型自身预测作 reference；验证指标衡量「管线能否复现自身 ROI 检测」（计数一致 + 质心 F1），非真 GT 比较。文档诚实标注（对照 P6 Reproducibility Dice）。
- **v0 不做核编辑**：point-correction 交互（增删/挪质心）与 brush 语义不同，另设计；v0 = 检测 → 计数 → 验证，只读。
- **真机 e2e 手动 checkpoint**：用户流程沿 P6——子进程 smoke + 缓存命中 + measure/去重单测入 CI；ROI 真推理手动。

---

## Open Questions

### Resolved During Planning（用户已拍板）

- **v0 任务**：细胞核检测 + 计数/密度（非区域分割、非 patch 热力图）
- **查看器栈**：OpenSeadragon + DeepZoom（非 CS3D DICOM 显微镜）
- **瓦片来源**：OpenSlide 现读 + 动态 DeepZoom（非预转 OME-TIFF、非预切静态 DZI）

### Deferred to Implementation

- **核模型 StarDist-HE vs HoVerNet-PanNuke**：impl 时按「CPU 可跑 + 装得出」定；先 StarDist 跑通链路，per-class 需求明确再上 HoVerNet
- **patch 尺寸 + 重叠**：256×256 overlap 32 或模型原生输入尺寸——impl 按模型定
- **质心 NMS 距离阈值**：按核直径（~10px @ 40×）定，impl 时调
- **DZI tile_size / overlap**：OSD 默认 254+1 vs OpenSlide DeepZoomGenerator 256+1——impl 时对齐两端参数
- **瓦片缓存淘汰**：v0 落盘不淘汰（demo slide 小）；大 slide 的 LRU 推后续
- **OSD 与现有 vite 打包整合**：`openseadragon` 纯前端包，impl 时确认 SSR/worker 无冲突
- **ROI 框选工具**：OSD 自带 selection 插件 vs 自写 canvas rect——impl 时定，倾向自写（少依赖）
- **libopenslide 系统依赖**：团队机器 apt/conda 装法进 runbook；CI 用 `openslide-bin`（wheel 自带二进制）免系统装

---

## Output Structure

```
backend/app/
  config.py                          # U1（追加 GLAUX_WSI_* + wsi_data_available/wsi_live_available）
  dataset_wsi.py                     # U2（OpenSlide 读 + DeepZoom 瓦片 + MPP + region 抽块）
  segment_wsi.py                     # U3（隔离子进程 + ROI patch 推理 + 质心去重 + WsiSegmentUnavailable）
  routers/api.py                     # U2 + U3 + U5（/slides /wsi/*）
  verification/nuclei.py             # U5（计数一致 + 质心匹配 F1，纯 numpy/scipy）
  kernel.py                          # U1 + U3（_detect_for_spec 加 wsi 分支；models() 加病理模型）
backend/tests/
  test_wsi_tiles.py                  # U2（DZI 描述 + 瓦片 + region + MPP）
  test_wsi_segment.py                # U3（subprocess smoke + 缓存 + patch 去重）
  test_wsi_api.py                    # U3 + U5（/task/run wsi + verify）
science-core/glaux_core/
  contracts.py                       # U1（PointSet + 序列化分支）
  calibration/calibration.py         # U1（CFSource.MPP + resolve_wsi_calibration 硬拒绝）
  measurement/nuclei.py              # U1（measure_nuclei 纯 numpy：计数 + 密度）
  tests/measurement/test_nuclei.py   # U1
science-core/runners/
  segment_wsi_headless.py            # U3（子进程 driver：读 region → 模型 → 质心 json）
orchestration/glaux_orchestrator/
  spec.py                            # U1（TaskType.NUCLEI_DETECTION）
  tasks.py                           # U1（measure_nuclei + REGISTRY 行 + NUCLEI_CLASSES）
orchestration/tests/
  test_tasks.py                      # U1（注册完整性 + measure_nuclei 已知数据对）
frontend/src/
  components/WsiViewer.tsx           # U4（OpenSeadragon + DZI + ROI 框选 + 核 overlay）
  components/Viewer.tsx              # U4（ENGINES["wsi"] = WsiViewer）
  components/Editor.tsx              # U4（activeImage ?? activeVolume ?? activeSlide）
  viewer/openseadragon.ts            # U4（OSD 一次性 init + tileSource + 坐标映射工具）
  api/types.ts                       # U4（PointSet TS 镜像）
  api/client.ts                      # U4（/slides / dziUrl / runWsi / verifyWsi）
  store/session.ts                   # U4（activeSlide 字段）
  package.json                       # U4（openseadragon 依赖）
data/wsi/                            # U2（ship 1 例 demo）
  slide_001.svs                      # input（CMU-1-Small-Region.svs 重命名）
  slide_001_ref_nuclei.json          # reproducibility reference（模型自身在 demo ROI 的检测）
README.md                            # U6（P7 v0 启动说明）
docs/runbooks/p7-wsi-nuclei-wedge.md # U6
```

---

## High-Level Technical Design

> *Directional guidance for review. Implementing agents should treat as context, not code to reproduce.*

**数据流**

```
NL → /interpret → TaskSpec{task: NUCLEI_DETECTION, roi: (x0,y0,x1,y1)}   # roi = level-0 px 框选
                → run_spec (无分支) → _detect_for_spec("wsi")
                                        ├─ dataset_wsi.read_region(slide, roi, level=0)   # OpenSlide 主进程
                                        ├─ segment_wsi.segment(slide, roi, method)         # 缓存优先 + 隔离子进程
                                        │     ├─ 缓存命中 → 读质心 json
                                        │     └─ 未命中 → subprocess .venv-wsi/bin/python segment_wsi_headless.py
                                        │           ├─ region → patch 切分（overlap）
                                        │           ├─ 逐 patch 模型推理（StarDist/HoVerNet）
                                        │           └─ patch 边界质心 NMS 去重 → 质心 json（level-0 坐标）
                                        ├─ resolve_wsi_calibration(mpp_x, mpp_y)            # OpenSlide props
                                        │     └─ 读不出/非正 → HardReject
                                        └─ measure_nuclei(det, cal)                        # numpy 计数 + 密度
                                              ↓
                                TaskOutput{primitives=[PointSet(points, classes, roi)], metrics, ...}
                                              ↓
                                /task/run → JSON → 前端 store
                                              ↓
                                <Viewer> 看到 task.viewer === "wsi" → WsiViewer
                                              ↓
                                OpenSeadragon 读 /wsi/{id}.dzi 深缩放浏览
                                              ↓
                                ROI 框选工具 → spec.roi → /task/run
                                              ↓
                                PointSet.points（level-0 px）→ imageToViewportCoordinates → canvas overlay 按 class 上色
                                              ↓
                                计数面板：总核数 / 密度(count/mm²) / ROI 面积(mm²)
```

**WSI 查看器与现有 2D/3D 的关键差异**

- **数据下发**：US/CT = 整图/整卷；WSI = **瓦片按需**（DZI 金字塔），永不整片下发
- **查看器引擎**：US/CT = CS3D；WSI = **OpenSeadragon**（独立栈，第二套 ready/init）
- **滚轮语义**：CT = 切 z；WSI = **深缩放**（OSD 原生连续缩放，跨金字塔层）
- **标定来源**：US = cubs_cf (mm/px)；CT = pixdim (mm/voxel)；WSI = **MPP (µm/px)**，来自 OpenSlide props
- **Primitive**：US = Polyline/Ellipse；CT = VolumeMask；WSI = **PointSet**（质心 + 类别）
- **推理范围**：US/CT = 整图/整卷；WSI = **ROI 框选**（整片不可行），patch 切分 + 边界去重
- **三套坐标系**（钉死）：① OpenSlide level-0 px（质心/ROI 存储 + 计算的真相坐标）；② DeepZoom level（DZI 瓦片编号，与 OpenSlide level 反向，仅瓦片路由用）；③ OSD viewport（归一化 0..1，仅渲染 overlay 用，经 `imageToViewportCoordinates` 换算）

---

## Implementation Units

### U1. PointSet + MPP Calibration + 注册表增量

**Goal:** 把 PointSet Primitive 变体、MPP 标定、NUCLEI_DETECTION 任务插件落到数据层。无 runtime 改动，纯类型 + 注册表。

**Requirements:** R1, R2, R3, R4

**Dependencies:** None

**Files:**
- Modify: `science-core/glaux_core/contracts.py`（加 `PointSet` dataclass：`id / role / points: tuple[tuple[float,float],...] / point_class_ids: tuple[int,...] / classes: tuple[ClassSpec,...] / roi: tuple[float,...] | None` + `Primitive` 联合 + `primitive_to/from_dict` 分支）
- Modify: `science-core/glaux_core/calibration/calibration.py`（加 `CFSource.MPP` 枚举值 + `resolve_wsi_calibration(mpp_x, mpp_y) -> CalibrationResult` 读不出/非正硬拒绝，value=(mpp_x,mpp_y)）
- Create: `science-core/glaux_core/measurement/nuclei.py`（`measure_nuclei(det, cal) -> Measurement`，纯 numpy：总数 + per-class 计数 + 密度 = count / ROI_area_mm²，ROI 面积 = (w×h) px × mpp_x × mpp_y / 1e6）
- Modify: `orchestration/glaux_orchestrator/spec.py`（`TaskType.NUCLEI_DETECTION = "nuclei_detection"`）
- Modify: `orchestration/glaux_orchestrator/tasks.py`（`measure_nuclei` 接入 + `REGISTRY` 加行：adapter_kind=`wsi`，viewer=`wsi`，tools 含 pan + roi 框选 + reset，overlays 按类上色；`NUCLEI_CLASSES` ClassSpec 表）
- Create: `science-core/tests/measurement/test_nuclei.py`（PointSet 序列化往返 + `measure_nuclei` 已知数据对）
- Modify: `orchestration/tests/test_tasks.py`（`test_registry_covers_all_task_types` 自动覆盖新行；加 `test_measure_nuclei`）

**Approach:**
- `PointSet.points` 存 level-0 px 坐标（真相坐标，与 US Polyline 存 px 同理）
- `NUCLEI_CLASSES`：v0 若用 StarDist（类别无关）= 单类 `nucleus`；若 HoVerNet-PanNuke = 5 类。ClassSpec 结构复用 P6 `LIVER_KIDNEY_CLASSES`
- `measure_nuclei`：从 `det.primitives[0]`（PointSet）数点，按 `point_class_ids` 分组计数；密度用 `det.roi_used` 面积（无 ROI → 用 points 凸包或报错，v0 要求有 ROI）+ MPP
- `resolve_wsi_calibration`：mpp 缺失/≤0 → `ValueError`（映射 422），不出假密度

**Patterns to follow:**
- `contracts.py` 现有 `VolumeMask` + `primitive_to/from_dict` 分支结构（P6 刚加）
- `tasks.py` 现有 `measure_liver_kidney` 签名 + `LIVER_KIDNEY_CLASSES` 表
- `test_tasks.py` 现有 `test_measure_liver_kidney` 风格

**Test scenarios:**
- Happy: `PointSet(points=((10,10),(20,20)), point_class_ids=(1,1), classes=(ClassSpec(1,"nucleus",...),), roi=(0,0,100,100))` → 序列化 → 反序列化 → 字段一致
- Happy: `measure_nuclei` 喂 500 点 + roi=(0,0,1000,1000)px + mpp=(0.25,0.25) → count=500；面积=(1000×1000)×0.25²/1e6=0.0625 mm²；密度=500/0.0625=8000 /mm²
- Happy (class-aware): 300 neoplastic + 200 inflammatory → per-class 计数 + neoplastic 占比 0.6
- Error: mpp=(0,0) → HardReject；mpp 缺失 → HardReject
- Error: `measure_nuclei` 无 roi → ValueError（v0 要求 ROI 算密度）
- Error: `primitive_from_dict` 未知 kind → ValueError
- Integration: `_plugin_to_view(NUCLEI_DETECTION)` → `viewer="wsi"`，metric_keys 含 count/density/area

**Verification:**
- `pytest orchestration/tests/test_tasks.py science-core/tests/measurement/test_nuclei.py` 全绿
- `GET /tasks` 返回新增 `nuclei_detection` 任务，viewer=wsi
- `assert find_spec("openslide") is None`（本单元纯 numpy，不引 OpenSlide）

---

### U2. OpenSlide 瓦片服务 + 数据 serve + demo slide

**Goal:** OpenSlide 主进程读 WSI + `DeepZoomGenerator` 动态出 DZI 瓦片 + MPP 标定 + region 抽块，1 例小 demo slide ship 到 `data/wsi/`。无模型。

**Requirements:** R5, R6, R8（demo slide 部分）

**Dependencies:** U1

**Files:**
- Modify: `backend/app/config.py`（加 `WSI_ROOT` + `WSI_CACHE`（瓦片缓存）+ `wsi_data_available()`；`GLAUX_WSI_*` env 覆盖）
- Create: `backend/app/dataset_wsi.py`（`list_ids()` / `is_wsi(id)` / `open_slide(id) -> OpenSlide`（lru_cache）/ `dzi_descriptor(id) -> str`（XML）/ `tile(id, level, col, row) -> bytes`（缓存优先）/ `thumbnail(id)` / `read_region(id, x, y, w, h, level) -> np.ndarray` / `mpp(id) -> (mx,my)` 硬拒绝 / `image_meta(id)`）
- Modify: `backend/app/routers/api.py`（`GET /slides` → `[ImageMeta{modality:"pathology"}]`；`GET /wsi/{id}.dzi`；`GET /wsi/{id}/{level}/{col}_{row}.jpeg`；`GET /wsi/{id}/thumbnail`；`GET /wsi/{id}/region?x&y&w&h&level`）
- Create: `data/wsi/slide_001.svs`（CMU-1-Small-Region.svs 重命名；含 MPP）
- Create: `backend/tests/test_wsi_tiles.py`（DZI XML 形状 + 瓦片 JPEG magic + region shape + MPP 读取 + 缓存命中）

**Approach:**
- OpenSlide 是数据 IO C 库，主进程可 import（同 nibabel）；主进程仍 `assert find_spec("torch") is None`
- `DeepZoomGenerator(slide, tile_size=256, overlap=1)` 出 DZI；`.dzi` XML 含 Width/Height/TileSize/Format/Overlap
- 瓦片缓存：`WSI_CACHE/{id}/{level}/{col}_{row}.jpeg`；命中直读，未命中 `dz.get_tile(level,(col,row))` → JPEG → 落盘 → 返回
- `mpp(id)`：`float(slide.properties["openslide.mpp-x"])`；KeyError/≤0 → ValueError（硬拒绝）
- `read_region`：OpenSlide `read_region((x,y), level, (w,h))` → RGBA → RGB np.ndarray（模型抽块 + region 端点复用）
- 端点 `Response(content=bytes, media_type="image/jpeg")`；DZI `media_type="application/xml"`

**Patterns to follow:**
- `backend/app/dataset_ct.py` 完整形态（`lru_cache` open + `image_meta` + `is_ct` 白名单 + 路径硬拒绝）
- `backend/app/routers/api.py` 现有 `/volume/{id}` 流式端点风格 + `is_ct` 404 守卫
- `backend/app/config.py` `CT_ROOT` / `ct_data_available()` 复合后缀判断（`.svs`/`.ndpi` 用 endswith）

**Test scenarios:**
- Happy: `GET /wsi/slide_001.dzi` → XML 含 `<Image TileSize="256"` + Width/Height 匹配 slide 尺寸
- Happy: `GET /wsi/slide_001/{maxlevel}/0_0.jpeg` → JPEG magic `\xff\xd8`；第二次请求走缓存（文件已存在）
- Happy: `dataset_wsi.mpp("slide_001")` → (mx,my) 正值 tuple
- Happy: `read_region("slide_001", 0,0,256,256, 0)` → shape (256,256,3)
- Error: `dataset_wsi.mpp` slide 无 mpp props → ValueError
- Error: `GET /wsi/missing/...` → 404（`is_wsi` 守卫）
- Edge: `GET /slides` 至少含 slide_001，modality="pathology"
- Invariant: `assert find_spec("torch") is None`（主进程）

**Verification:**
- `pytest backend/tests/test_wsi_tiles.py` 全绿
- 手工：`curl localhost:8000/wsi/slide_001.dzi` 出 XML；浏览器直开一块瓦片 URL 出图
- `assert find_spec("torch") is None` 在主进程成立

---

### U3. 核分割隔离子进程 + ROI 抽块推理 + 去重

**Goal:** 核模型经 `.venv-wsi/` 隔离子进程接入；ROI 内 patch 切分 → 逐块推理 → 边界质心 NMS 去重 → 质心 json（level-0 坐标）。`_detect_for_spec` 加 `wsi` 分支，`models()` 加 active 病理模型。

**Requirements:** R7

**Dependencies:** U1, U2

**Files:**
- Modify: `backend/app/config.py`（加 `WSI_SEG_PYTHON` / `WSI_SEG_DRIVER` / `WSI_SEG_WEIGHTS` / `WSI_SEG_CACHE` + `wsi_live_available()`）
- Create: `backend/app/segment_wsi.py`（`segment(slide_id, roi, method) -> (nuclei_json_path, model_version)`，缓存优先 + `_run_live` + `WsiSegmentUnavailable`；缓存键 `{slide_id}_{roi_hash}_{method}.json`）
- Create: `science-core/runners/segment_wsi_headless.py`（子进程 driver：argparse `--slide --roi --out`；OpenSlide read_region → patch 切分（overlap）→ 模型推理 → 质心 NMS 去重 → 写质心 json（level-0 坐标 + class_id））
- Create: `science-core/.venv-wsi/` setup（README 段：`uv venv .venv-wsi --python 3.12 && uv pip install <stardist|hovernet 栈> openslide-bin numpy scipy`）
- Modify: `backend/app/kernel.py`（`_detect_for_spec` 加 `wsi` 分支：`is_wsi` 守卫 → `segment_wsi.segment(id, roi)` → 读质心 json → 构造 `PointSet(points, point_class_ids, classes=NUCLEI_CLASSES, roi)` → `resolve_wsi_calibration(dataset_wsi.mpp(id))`；`models()` 加病理模型 gated on `wsi_data_available()`，modality="pathology"）
- Create: `backend/tests/test_wsi_segment.py`（subprocess smoke mock 掉真模型，测 argv/env/缓存 + 质心去重纯函数单测）
- Modify: `backend/tests/test_wsi_api.py`（`POST /task/run` wsi 分支 → PointSet + 6 metrics）

**Approach:**
- `segment_wsi.segment` 镜像 `segment_ts.segment`：缓存命中 → 读 json；未命中 → 检查 venv → 跑子进程 → 验缓存；失败抛 `WsiSegmentUnavailable`
- 子进程最小 env（`CUDA_VISIBLE_DEVICES=-1 MPLBACKEND=Agg`），argv 列表，无 shell
- ROI 抽块：`read_region` 取 ROI → 切 patch（如 256×256 overlap 32）→ 逐块推理 → 质心从 patch 坐标 +patch_origin 回 level-0 坐标
- **去重**（纯函数，独立单测）：重叠带内 `cKDTree` 找距离 < 阈值的质心对 → 合并（保一）；这是「patch 边界同一核被数两次」的根因，对照 P6 轴向坑——最易测试绿真机错
- `roi_hash`：ROI 坐标 + method 的稳定 hash 作缓存键（同 ROI 重复跑命中）

**Patterns to follow:**
- `backend/app/segment_ts.py` 完整 pattern（缓存 + 隔离 + `_run_live` stderr + `TsSegmentUnavailable`）
- `backend/app/kernel.py:188` `volume` 分支（`is_ct` 守卫 + `resolve_ct_calibration` + 构造 Primitive + Detection）
- `backend/app/kernel.py:353` `models()` 的 `totalsegmentator_v2` active 模型段（gated on data_available）

**Test scenarios:**
- Happy: `segment_wsi.segment("slide_001", roi, "stardist_he")` 缓存命中 → 路径 + model_version cached
- Happy: 缓存未命中 + venv 可用 → 子进程 → 验新缓存 → live
- Error: 缓存未命中 + venv 不可用 → `WsiSegmentUnavailable`（不返空）
- Unit（去重）: 两 patch 重叠带各一质心相距 3px（<阈值 5）→ 去重后 1 个；相距 20px → 保留 2 个
- Unit（坐标）: patch_origin=(512,256) 内质心 (10,10) → level-0 (522,266)
- Error: ROI 越界 slide 尺寸 → 422
- Integration: `POST /task/run{task:nuclei_detection, roi}` → PointSet + metrics（count/density/area）
- Invariant: `assert find_spec("torch") is None`（主进程）

**Verification:**
- `pytest backend/tests/test_wsi_segment.py backend/tests/test_wsi_api.py` 全绿
- 子进程 smoke：mock 模型，调真 `.venv-wsi/bin/python`（未建则 skip），确认 argv + env
- 手工（真机 checkpoint）：`.venv-wsi` 装 StarDist → 对 slide_001 一块 ROI 跑 → 质心 json 出、计数合理

---

### U4. WsiViewer（OpenSeadragon + DZI + ROI 框选 + 核 overlay）

**Goal:** 前端按 `task.viewer === "wsi"` 分派到 `WsiViewer`，OSD 读 DZI 深缩放 + ROI 框选工具 + 核质心 canvas overlay（按 class 上色，可开关）。

**Requirements:** R9

**Dependencies:** U1（PointSet 类型），U2（DZI 端点）

**Files:**
- Modify: `frontend/package.json`（加 `openseadragon` + `@types/openseadragon`）
- Create: `frontend/src/viewer/openseadragon.ts`（OSD 一次性 init 封装 + tileSource 构造 + `imageToViewportCoordinates` 坐标工具）
- Create: `frontend/src/components/WsiViewer.tsx`（OSD 挂载 `/wsi/{id}.dzi` + ROI 框选（自写 canvas rect → level-0 px）+ 核 overlay canvas（viewport 变化时重绘，`point_class_ids` 上色）+ 计数面板接线）
- Modify: `frontend/src/components/Viewer.tsx`（`ENGINES["wsi"] = WsiViewer`）
- Modify: `frontend/src/components/Editor.tsx`（`activeImage ?? activeVolume ?? activeSlide`）
- Modify: `frontend/src/api/types.ts`（`PointSet` + `ClassSpec` TS 镜像）
- Modify: `frontend/src/api/client.ts`（`slides()` / `dziUrl(id)` / `runWsi(id, roi)` / `verifyWsi(id)`）
- Modify: `frontend/src/store/session.ts`（`activeSlide: string | null`）
- Modify: `frontend/src/data/actions.ts`（`runCurrentTask` 加 wsi 分支：带 roi）

**Approach:**
- OSD `tileSources: "/wsi/{id}.dzi"`；OSD 自处理金字塔加载 + 深缩放（不自写瓦片调度）
- ROI 框选：自写 canvas 叠加层监听 drag → 屏幕 px → OSD `viewport.pointFromPixel` → `viewportToImageCoordinates` → level-0 px 矩形 → `setRoi`
- 核 overlay：独立 canvas 铺在 OSD canvas 上；OSD `animation`/`update-viewport` 事件触发重绘；每质心 `viewport.imageToViewportCoordinates(px)` → 屏幕坐标 → 画 2px 圆点，`classes[class_id].color` 上色；开关 toggle
- 大计数性能：只画当前 viewport 可见 + 缩放阈值下聚合（v0 demo ROI 核数千级，直接全画即可；十万级推 P7.x）
- store：`activeSlide` 独立于 activeImage/activeVolume；切模态时 WsiViewer 卸载销毁 OSD 实例（避免 WebGL 泄漏）

**Patterns to follow:**
- `frontend/src/components/VolumeViewer.tsx` 独立引擎组件形态（ref 管理 + overlay canvas + `drawOverlayRef` 解耦 effect + `pushAgent` 提示 + 卸载清理）
- `frontend/src/components/Viewer.tsx` `ENGINES` 注册接缝
- `frontend/src/viewer/nifti.ts` overlay 坐标映射（CS3D `worldToCanvas` ↔ OSD `imageToViewportCoordinates` 同角色）
- `frontend/src/components/Editor.tsx` 当前对象选择链

**Test scenarios:**
- Type: `PointSet` TS 类型与 `Primitive` 联合编译通过；`client.runWsi` 返回类型对
- Integration (smoke): WsiViewer 挂载不崩（mock OSD 或 preview 手验）
- Edge: DZI 404 → 显示空白不抛
- Edge: 切模态回 CT/IMT → OSD 实例销毁，无 WebGL 残留
- Edge: ROI 框选出 slide 边界 → clamp 到 slide 尺寸
- Edge: overlay 坐标随 OSD 缩放/平移实时跟随核位置（真机验证——最易错的坐标对齐）

**Verification:**
- `npm run lint` + `npm run typecheck` + `npm run build` 全绿，产物含 WsiViewer + openseadragon chunk
- 手工（真机）：preview 起前后端 → 切病理模态 → OSD 深缩放 → 框 ROI → 跑检测 → 质心 overlay 精确叠在核上、随缩放跟随 → 计数面板出总数 + 密度

---

### U5. Reproducibility 验证（计数一致 + 质心 F1）

**Goal:** `GET /wsi/{id}/verify` 返回 reproducibility 指标：与 ship 的 `slide_001_ref_nuclei.json`（模型自身在 demo ROI 的检测）对比，出计数一致 + 质心匹配 F1 @ 距离阈值。非真 GT。

**Requirements:** R10, R8（reference 部分）

**Dependencies:** U3

**Files:**
- Create: `backend/app/verification/nuclei.py`（`nuclei_reproducibility(pred_points, ref_points, dist_thresh) -> dict`：`cKDTree` 双向匹配 → precision/recall/F1 + count_pred/count_ref/count_ratio，纯 numpy/scipy）
- Modify: `backend/app/routers/api.py`（`GET /wsi/{id}/verify?task=&roi=` → `{f1, precision, recall, count_pred, count_ref}`）
- Modify: `backend/app/kernel.py`（如需 `verify_wsi(id, roi, task)` 包装）
- Create: `data/wsi/slide_001_ref_nuclei.json`（在 demo ROI 上跑一次模型的质心，作 reference）
- Modify: `frontend/src/components/WsiViewer.tsx`（面板底部 "Reproducibility vs reference" 区块：F1 + 计数比）
- Modify: `frontend/src/api/client.ts`（`verifyWsi`）
- Modify: `backend/tests/test_wsi_api.py`（verify 形状 + 已知数据对：完全一致 F1=1.0；全错开 F1=0.0；半重叠中间值）

**Approach:**
- 质心匹配：`cKDTree` 最近邻，距离 < 阈值算 TP；未匹配 pred = FP，未匹配 ref = FN；F1 = 2TP/(2TP+FP+FN)
- 双向唯一匹配（一个 ref 只配一个 pred），避免重复计 TP
- 阈值按核直径（~阈值 5–10px @ level-0）；文档诚实标注 reference 是模型自身预测，衡量「复现」非「正确」
- 前端展示：F1 绿 >0.95 / 黄 0.85–0.95 / 红 <0.85 + 计数比

**Patterns to follow:**
- `backend/app/verification/dice.py`（P6 纯 numpy 验证 + 诚实语义 docstring）
- `backend/app/routers/api.py` 现有 `/volume/{id}/verify` 端点形状

**Test scenarios:**
- Happy: pred == ref → F1=1.0, count_ratio=1.0
- Happy: pred 与 ref 50% 匹配 → F1 中间值
- Edge: pred 空 → recall=0, F1=0（不抛）
- Edge: 阈值内多 pred 抢一 ref → 只算一 TP（唯一匹配）
- Error: pred/ref 坐标维度不符 → ValueError
- Integration: `GET /wsi/slide_001/verify` 返回 f1/precision/recall/count

**Verification:**
- `pytest backend/tests/test_wsi_api.py -k verify` 全绿
- 手工（真机）：U3 真跑一遍 → `curl /wsi/slide_001/verify` 看 F1 ≥ 0.95（同 ROI 同 method 自复现应近 1.0）

---

### U6. 端到端手动 checkpoint 文档 + 真机流程

**Goal:** 把「装 `.venv-wsi` + libopenslide + 跑 demo ROI」的人工流程写成 README + runbook，标记手动 e2e checkpoint（不入 CI）。

**Requirements:** R11

**Dependencies:** U1–U5

**Files:**
- Modify: `README.md`（加 P7 段：装 `.venv-wsi`、libopenslide 系统依赖、跑 `slide_001` demo ROI、预期计数 + F1）
- Create: `docs/runbooks/p7-wsi-nuclei-wedge.md`（详细步骤：env、libopenslide 装法（apt/conda/openslide-bin）、命令、预期输出、坐标系三坑、常见错误）
- Modify: `backend/app/segment_wsi.py` docstring（声明 e2e 手动）

**Approach:**
- 文档结构：先决条件（libopenslide！）→ 步骤 → 预期输出 → 已知问题（坐标系 + libopenslide 装不出）
- 不写 shell 脚本（手工流程 YAGNI）
- 标注「本流程工程师手动执行，不入 CI」

**Patterns to follow:**
- `docs/runbooks/p6-3d-totalseg-wedge.md`（P6 runbook 结构）
- `README.md` 现有章节风格

**Test scenarios:**
- Test expectation: none —— 文档变更，无代码行为变化

**Verification:**
- 工程师按 runbook 在干净环境跑通——本 plan 不自动化此步

---

## System-Wide Impact

- **Interaction graph:** 新增端点 `GET /slides`、`GET /wsi/{id}.dzi`、`GET /wsi/{id}/{level}/{col}_{row}.jpeg`、`GET /wsi/{id}/thumbnail`、`GET /wsi/{id}/region`、`GET /wsi/{id}/verify`（6 个）；`GET /tasks` 自动含 `nuclei_detection` 行；`/task/run` 走新 `wsi` adapter_kind 分支；前端 `Viewer` 按 `task.viewer` 分派到新 `WsiViewer`
- **Error propagation:** MPP 硬拒绝 → 422；子进程不可用 → `WsiSegmentUnavailable` → 503；ROI 越界 → 422；pred/ref 维度不符 → 422；DZI/瓦片 404 → 404
- **State lifecycle risks:** OSD 是独立 WebGL 上下文——切模态时必须销毁实例（对照 P6 CS3D 卸载）；瓦片缓存落盘无淘汰（v0 demo 小，大 slide 推后续 LRU）
- **API surface parity:** 6 新端点 + 1 新 Primitive 变体（PointSet）+ 1 新 Calibration kind（MPP）+ 1 新 TaskType + 1 新 adapter_kind（wsi）+ 1 新 viewer 引擎（OpenSeadragon）
- **Integration coverage:** ROI 真推理手动 e2e（不入 CI）；CI 覆盖：瓦片/DZI 端点 + 质心去重纯函数 + 坐标映射单测 + subprocess smoke + measure + verify 单测
- **Unchanged invariants:** 现有 US/CT 路径不变；PointSet 是新 Primitive 变体不影响 Polyline/Ellipse/Mask/VolumeMask 序列化；主进程仍 `assert find_spec("torch") is None`（OpenSlide 是数据 IO 库不违反）

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| **坐标系三套混淆**（level-0 px / DeepZoom level / OSD viewport）导致 overlay 错位——WSI 头号坑 | High-Level Design 钉死三套坐标职责；U3 质心坐标 + U4 overlay 映射各独立单测；真机验证列为 U4 硬 checkpoint（对照 P6 nifti 轴向坑） |
| **patch 边界重复计核**（同核跨 patch 被数两次） | U3 质心 NMS 去重设为独立纯函数 + 距离阈值单测（重叠带各一质心场景） |
| `libopenslide` 系统依赖团队机器装不出 | CI 用 `openslide-bin`（wheel 自带二进制）免系统装；runbook 给 apt/conda/pip 三路 |
| **StarDist/HoVerNet 装不出 / 版本漂移** | 锁版本；先 StarDist（pip 友好、CPU 可跑）跑通链路，HoVerNet 作 per-class 增强项；venv 命令进 runbook |
| WSI 真 slide 太大不能入仓库 | v0 用 `CMU-1-Small-Region.svs`（~1.8MB，OpenSlide 可再分发测试数据），大 slide 走 env 指向本机 |
| OpenSeadragon 与 vite/现有打包冲突 | `openseadragon` 是成熟纯前端包；U4 试装时确认 chunk 分割 + 无 SSR 依赖 |
| 动态 DeepZoom 首次瓦片慢（无预切） | 瓦片落盘缓存；demo slide 小；大 slide 首帧慢进 runbook 已知问题 |
| Reproducibility F1 < 0.95 表明去重/坐标不稳 | 文档诚实标注「非真 GT」；数字低先排查质心去重 + 坐标映射 + 缓存键（roi_hash） |
| **v0 只出质心不出轮廓**，病理医生想看核边界 | 明确 v0 = 质心 + 计数 MVP；instance 轮廓 overlay 推 P7.x，计划已声明 |

---

## Documentation / Operational Notes

- `README.md`：加 P7 段，说明 v0 第一个病理 WSI 任务（核检测+计数），手动 e2e 入口 + libopenslide 依赖
- `docs/runbooks/p7-wsi-nuclei-wedge.md`：详细 runbook（env、libopenslide 装法、命令、预期输出、坐标系三坑）
- `docs/designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md`：§9 病理 WSI 设计源头，本 plan 是其实现分解
- `docs/plans/2026-07-09-001-feat-p6-3d-totalseg-wedge-plan.md`：P6 楔子先例，本 plan 沿其六单元结构 + 隔离子进程/注册表无分支/查看器接缝三脊柱
- `docs/todo/2026-07-10-001-code-review-p6-3d-wedge.zh-CN.md`：P6 真机 e2e 七连坑教训——本 plan 的「真机验证入口」纪律来源

---

## Sources & References

- **Origin document:** [docs/designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md](../designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md)（§9 病理 WSI、查看器谱系第四支）
- **P6 先例 plan:** [docs/plans/2026-07-09-001-feat-p6-3d-totalseg-wedge-plan.md](2026-07-09-001-feat-p6-3d-totalseg-wedge-plan.md)
- **P6 真机教训:** [docs/todo/2026-07-10-001-code-review-p6-3d-wedge.zh-CN.md](../todo/2026-07-10-001-code-review-p6-3d-wedge.zh-CN.md)
- **Related code:** `science-core/glaux_core/contracts.py`、`orchestration/glaux_orchestrator/tasks.py`、`backend/app/segment_ts.py`、`backend/app/dataset_ct.py`、`backend/app/kernel.py`、`frontend/src/components/Viewer.tsx`、`frontend/src/components/VolumeViewer.tsx`
- **External:** OpenSlide + openslide-python（DeepZoomGenerator）、OpenSeadragon、StarDist（2D_versatile_he）/ HoVerNet（PanNuke）、CMU-1-Small-Region.svs（OpenSlide test data）
