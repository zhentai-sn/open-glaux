---
kind: record
status: implemented
title: "P6 · 3D CT 楔子 — TotalSegmentator 肝+双肾接入设计"
type: design
created: 2026-07-09
scope: P6 / feat/p6-3d-totalseg (TBD)
---

# P6 · 3D CT 楔子 — TotalSegmentator 肝+双肾接入设计

> **用途**：在 `feat/multimodal-arch`（P1–P5 已收口）的基础上，把 Glaux 第一个 3D 体数据楔子落到 TotalSegmentator v2 的肝+双肾任务上——兑现[多模态设计文档 §9 P6](../designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md)（VolumeViewport 沿 Viewer 接缝接入）并落实 §10 开放问题 #2（`VolumeMask` 形态）。
> **日期**：2026-07-09 · **状态**：approved（脑暴产出） · **依据**：[纲领](../../roadmaps/charter.zh-CN.md) · [路线图 阶段 4](../../roadmaps/20260705-product-roadmap.zh-CN.md) · [多模态设计文档](../designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md) · [CUBS 楔子脑暴](../../brainstorms/20260705-01-cubs-imt-first-task.zh-CN.md)
> **半衰期提醒**：TotalSegmentator 权重 / 包版本（2025-11 v2.4.0）、CS3D 5.x API、NIfTI 加载器选型可能漂移；动工前复核第六节依赖与落地顺序。

---

## 0. 一页纸

**问题**：Glaux 已接两个 2D 超声任务（IMT / HC），下一个场景按路线图是病理 WSI（OpenSeadragon）。但**前沿 3D 体数据（CT/MRI）才是医学影像研究的主力形态**（器官体积、肿瘤负荷、解剖变异都靠 3D 量化）——延后 3D 会让「跨模态」叙事跛脚。P6 提前到 3D，病理 WSI 推到 P7+。

**解法**：沿用现有「隔离子进程 venv + 缓存优先 + 注册表驱动」模式，把 TotalSegmentator v2 预训练权重（3 类：肝 + 左肾 + 右肾）当作第一个 3D 适配器接入；通过「VolumeMask Primitive 新变体」落实设计文档 §10 开放问题 #2，让 3D labelmap 与现有 2D Primitive 联合并列存在。

**楔子范围**（严守「楔子要窄」）：1 个 3D 任务（肝+双肾），1-2 个预 ship CT 案例（含 1 例 GT），1 个 3D Viewer（轴状位 OrthographicViewport + 滚轮切层），1 个画笔编辑（CS3D SegmentIndex + BrushTool），1 个体积测量（确定性几何，不让 LLM 估数），1 个 GT Dice 验证。**不**做：117 类全量、MPR、3D 体积渲染、跨病人队列聚合、画笔撤销栈。

**护城河贡献**：
- **动作层**：3D 分割适配器（subprocess 隔离）——与现有 caroSegDeep / CSM 同构
- **验证层**：Dice 验证（vs GT，1 例示范）——为后续 P6.x 扩器官时的「自评 vs GT」留接口
- **记忆层**：画笔编辑后的修正 labelmap 入库——3D 飞轮入口
- **不**走「模型越强越值钱」负债；护城河全在环境

**不可退让的产品不变量**（沿用现有铁律）：
- 测量确定性（不经 LLM 估值，几何计算）
- 标定硬拒绝（CT 的 voxel_spacing 读不出 → 拒绝，不静默假造）
- 主进程无重框架（torch 全在 `.venv-ts/`，与 TF 全在 `.venv-csd/` 同构）
- 真实/合成双轨（v0 ship 真实 CT 案例，合成数据为可选）
- 注册表无分支（加任务 = 写 measure 函数 + 登记 `TaskPlugin` 一行 + 实现 Adapter）

---

## 1. 战略决策汇总（脑暴结论）

| 维度 | 决定 | 备选 / 留待后续 |
|---|---|---|
| 方向 | 3D 体数据（CT） | 病理 WSI 推 P7+ |
| 数据集/任务 | TotalSegmentator v2（117 类） | 用预训练权重 + 1-2 公开案例（无需签协议） |
| 楔子器官数 | **3 类：肝 + 左肾 + 右肾** | P6.x 扩到 ~10 主器官；P6.xx 扩到 117 全量 |
| 3D 交互 | **轴状位连续切片滚动** | MPR / 体积渲染留待 P6.x+ |
| Primitive 表达 | **新增 `VolumeMask` 变体**（顶层一体） | 复用 `Mask` + frame；嵌套（两路都不要） |
| 画笔编辑 | **走一气：paint/erase → 度量重算** | 先只看不编 |
| 标定 | **读 NIfTI `pixdim[1:4]`，读不出硬拒绝** | NIfTI + DICOM 双轨；仅一档 |
| GT 验证 | **ship 1 例 `ct_001_gt.nii.gz` + Dice 报告** | 不 ship GT（推迟验证层） |

---

## 2. 架构 + 数据流

```
NL → /interpret (三态守卫，rule 后端读 signals: liver/kidney/ct/abdomen)
   → TaskSpec{task: "totalseg_liver_kidney"}
   → run_spec (无分支，plugin.measure 派发)
       ├─ Adapter (volume_kind)
       │     └─ subprocess .venv-ts/bin/python -m segment_ts \
       │                  --volume <NIfTI path> --task liver_kidney --out <labelmap>
       │     └─ 写缓存 science-core/cache/totalseg/{vid}_{task}_{method}.nii.gz
       ├─ Calibration: 读 NIfTI pixdim → voxel_spacing_mm=(sx,sy,sz)
       │     └─ 读不出 → 硬拒绝（与 US 路径的 cubs_cf=none 走同一拒绝模板）
       └─ measure_liver_kidney(Detection, Calibration)
             └─ 读 labelmap.nii.gz，按 class_id 数体素 × voxel_volume_mm3
             └─ (若 raw_ref 可用) 算 mean HU
             └─ 返回 Measurement{metrics: {...}, calibration, overlays: []}

前端：
  <Viewer imageSource={kind:"volume_nifti", url:"/api/volume/ct_001"} />
        ↓
  ENGINES["volume_3d"] = VolumeViewer (new)
        ↓
  CS3D OrthographicViewport + 滚轮切层 + labelmap 叠加
        ↓
  Brush 工具激活 → onPaint(z, class_id, mode) → POST /volume/ct_001/mask-edit
        ↓
  后端 patch labelmap + 重 measure → 回写 store.metrics → 面板泛型重渲
```

---

## 3. 数据契约

### 3.1 `VolumeMask` Primitive（设计文档 §10 开放问题 #2 落实）

```python
@dataclass(frozen=True)
class ClassSpec:
    class_id: int                    # 0=背景, 1=肝, 2=左肾, 3=右肾
    role: str                        # "liver" | "lk" | "rk" | …
    label_zh: str
    label_en: str
    color: str                       # "#FF8A5B" 等
    measurable: bool = True          # 体积/平均 HU 等是否可量

@dataclass(frozen=True)
class VolumeMask:
    id: str                          # 全局唯一
    ref: str                         # 客户端拉 labelmap 的 URL 模板
                                     # "/api/volume/{vid}/labelmap?task=totalseg_liver_kidney"
    classes: tuple[ClassSpec, ...]   # 该体掩膜里包含哪些器官
    raw_ref: str | None = None       # 可选：原始 CT 引用（用于算 HU mean）

Primitive = Polyline | Ellipse | Polygon | Mask | BBox | Keypoints | VolumeMask
```

**为什么是独立变体而不是 `Mask + frame`**：一个 `VolumeMask` 表达「整个体分割的多类器官」是同一语义单元；切分成多个 `Mask` 会让多器官同时呈现时实体数爆炸，且图例/颜色/拓扑关系都要在客户端拼。设计文档 §2.1 已留位 `VolumeMask(id, ref, frame?)`，本设计把它落到完整形态（`classes` 字段），`frame` 字段隐含在 viewer 当前 z 索引上由前端管，不下到 Primitive。

### 3.2 `CalibrationKind` 扩展

```python
# 现有 US 路径：CalibrationKind ∈ {real (cubs_cf), estimated, none→硬拒绝}
# 新增 CT 路径：CalibrationKind 加入 "voxel_spacing"
@dataclass(frozen=True)
class CalibrationResult:
    kind: str                        # "cubs_cf" | "estimated_cf" | "voxel_spacing"
    value: float | tuple[float, float, float]  # US: mm/px; CT: (sx,sy,sz) mm
    source: str                      # "cubs_meta" | "imageMeta" | "nifti_pixdim" | …
    status: str                      # "real" | "estimated" | "none"
    # hard-reject 契约：status="none" 必须 raise，无静默路径
```

### 3.3 `TaskPlugin` 注册（`REGISTRY` 新增一行）

```python
REGISTRY["totalseg_liver_kidney"] = TaskPlugin(
    task="totalseg_liver_kidney",
    geometry="volume_mask",
    label_en="Liver + kidneys (CT, 3 classes)",
    label_zh="肝+双肾 (CT, 3 类)",
    signals=("liver", "kidney", "ct", "abdomen", "segmentation"),
    default_method="totalsegmentator_v2",

    adapter_kind="volume",            # 新加于 "wall_pair"/"contour"/"mask" 之外
    measure=measure_liver_kidney,     # 见 §5
    metric_keys=(
        "liver_volume_mm3", "liver_hu_mean",
        "lk_volume_mm3",    "lk_hu_mean",
        "rk_volume_mm3",    "rk_hu_mean",
    ),

    viewer="volume_3d",               # 新 viewer 类型，ENGINES["volume_3d"] = VolumeViewer
    tools=(TOOL_PAN, TOOL_BRUSH),     # 画笔新增
    overlay_spec=(
        OverlaySpec(role="liver", editable=True, color="#FF8A5B"),
        OverlaySpec(role="lk",    editable=True, color="#4FB0FF"),
        OverlaySpec(role="rk",    editable=True, color="#4FB0FF"),
    ),
)
```

### 3.4 端点（塌入 P2 风格的 `/volume/*` 前缀）

| 端点 | 用途 | 备注 |
|---|---|---|
| `GET /volumes` | 列出预置 CT 案例（id + 模态 + 描述） | 与 `/images` 对齐 |
| `GET /volume/{id}` | 流式返回 NIfTI 体积 | CS3D NIfTI loader（cornerstone-nifti 或自写） |
| `GET /volume/{id}/labelmap?task=` | 流式返回 labelmap（已缓存则直返） | 缓存键 `{vid}_{task}_{method}` |
| `POST /volume/{id}/segment` | 触发子进程跑 TotalSegmentator | 同步返回 labelmap_ref（模型在秒级完成）或异步 task_id |
| `POST /volume/{id}/mask-edit` | 接收画笔修正，patch labelmap，重 measure | 与现有 `/correction` 同形；返回 metrics dict |
| `GET /volume/{id}/gt?task=` | 返回 GT labelmap（用于 Dice 验证） | 仅当 ship 了 GT 时存在；缺则 404 |

---

## 4. 前端

### 4.1 Viewer 接缝实例化

```ts
// ENGINES 加一项（viewer.tsx / components/Viewer/index.tsx）
const ENGINES: Record<string, React.FC<ViewerProps>> = {
  raster_2d: CornerstoneViewer,         // 已存在
  volume_3d: VolumeViewer,              // 新增
  // wsi: OpenSeadragonViewer,          // P7+
  // video: CornerstoneVideoViewer,      // 后续
};
```

`VolumeViewer` 结构（沿用 `CornerstoneViewer` 同形态）：
- 一次性 CS3D init + OrthographicViewport（不破坏现有 StackViewport 实例化）
- 滚轮切 z 轴（不是缩放）
- VolumeMask 渲染：拉 `VolumeMask.ref` 拿 NIfTI labelmap → 按当前 z 切 2D 切片 → 按 `classes[].class_id` 上色 → 半透明叠加在 CT 切片上
- 画笔激活时：CS3D SegmentIndex + BrushTool，onPaint → 回调上层
- 不重写 CS3D init——沿用 `cornerstone.ts` 已有的 `csReady()` 一次性初始化

### 4.2 画笔编辑 UX

- 顶栏出现画笔控件：半径（2/5/10 px）/ 模式（paint/erase）/ 当前 class（liver/lk/rk radio）
- 滚轮不变：仍切层
- 鼠标按下拖动 → 沿轨迹画/擦该 class 标签
- 弹起 → `POST /volume/{id}/mask-edit`：
  ```json
  {
    "task": "totalseg_liver_kidney",
    "slices": [{"z": 80, "mask_png_ref": "data:image/png;base64,..."}],
    "class_id": 1,
    "mode": "erase"
  }
  ```
- 后端：原 labelmap + 掩膜 union → 写新 labelmap → 重 measure → 返回新 metrics
- 前端：把 metrics dict 写回 `store.metrics` → 面板泛型重渲
- **不**做：撤销/重做栈、跨切片批量编辑

### 4.3 面板

- 沿用现有 `BottomPanel` 泛型 metrics 渲染（[多模态设计 §4.3](../designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md) 已实现）
- 新增可点击的 GT 验证条：「Dice vs GT: 0.94（肝）/ 0.91（L 肾）/ 0.92（R 肾）」—— `verification` 层首个落地实例

---

## 5. 后端

### 5.1 测量函数 `measure_liver_kidney`

```python
def measure_liver_kidney(det: Detection, cal: CalibrationResult) -> Measurement:
    """det.primitives[0] 必为 VolumeMask；cal.status="real" 且 kind="voxel_spacing" 才有 voxel_mm3。"""
    vol: VolumeMask = det.primitives[0]
    sx, sy, sz = cal.value                       # (sx,sy,sz) mm
    voxel_mm3 = sx * sy * sz
    metrics: dict[str, Measure] = {}
    for cls in vol.classes:
        if not cls.measurable: continue
        count, hu_sum = _count_voxels_and_hu(vol.ref, cls.class_id, vol.raw_ref)
        metrics[f"{cls.role}_volume_mm3"] = Measure(
            value=count * voxel_mm3,
            unit="mm³",
            label_zh=f"{cls.label_zh} 体积",
            label_en=f"{cls.label_zh} volume",
        )
        if vol.raw_ref:                           # 仅 CT 有 HU
            metrics[f"{cls.role}_hu_mean"] = Measure(
                value=hu_sum / max(count, 1),
                unit="HU",
                label_zh=f"{cls.label_zh} 平均 HU",
                label_en=f"{cls.label_zh} mean HU",
            )
    return Measurement(metrics=metrics, calibration=cal, overlays=[])
```

`_count_voxels_and_hu` 内部用 `nibabel.load` + `numpy.where` 一次性遍历；**不**走 LLM，**不**走神经网络，纯 numpy 统计。

### 5.2 标定

CT 标定是**体素物理尺寸**（mm/voxel），NIfTI header 自带（`pixdim[1:4]`）。**不存在「找不到标定」**——NIfTI 必有，若缺则文件损坏。

`calibration/ct.py`：
```python
def resolve_ct_calibration(nifti_path: str) -> CalibrationResult:
    img = nib.load(nifti_path)
    pixdim = img.header.get_zooms()[:3]          # (sx,sy,sz)
    if not all(p > 0 for p in pixdim):
        raise CalibrationError("NIfTI pixdim 缺失/非法——文件损坏，硬拒绝")
    return CalibrationResult(
        kind="voxel_spacing",
        value=tuple(pixdim),
        source="nifti_pixdim",
        status="real",
    )
```

### 5.3 模型集成（沿用隔离模式）

```
science-core/.venv-ts/                  # torch + nnU-Net + totalsegmentator
backend/app/segment_ts.py               # subprocess 调用 argv 列表
backend/app/dataset_ct.py               # /volumes 列表 + NIfTI serve
```

`segment_ts.py` 模式与 `segment_proc.py` / `hc_real.py` 一致：
- argv 列表（无 `shell=True`）
- 显式 `env=` minimal
- 缓存键 = `(volume_id, task, method)` → 跑过即跳过
- 主进程无 torch（断言 `find_spec("torch") is None`，沿用现有 `find_spec("tensorflow")` 模板）
- 子进程超时上限 600s（CT 比 US 重，3D 卷积慢）
- 输出：labelmap `.nii.gz`（gzip 压缩节省 10×）

### 5.4 GT Dice 验证

```python
# backend/app/verification/dice.py
def dice_per_class(pred_path: str, gt_path: str, classes: list[int]) -> dict[int, float]:
    pred = nib.load(pred_path).get_fdata()
    gt = nib.load(gt_path).get_fdata()
    out = {}
    for c in classes:
        p, g = (pred == c), (gt == c)
        inter = np.logical_and(p, g).sum()
        union = np.logical_or(p, g).sum()
        out[c] = 2.0 * inter / max(p.sum() + g.sum(), 1)
    return out
```

`GET /volume/{id}/verify?task=...` 返回 `{class_id: dice}`，前端嵌面板底部。

---

## 6. 依赖与落地顺序

| 依赖 | 状态 | 备注 |
|---|---|---|
| `@cornerstonejs/core` (4.21+) | ✅ 已装 | 需检查 OrthographicViewport 公开 API 稳定性 |
| `@cornerstonejs/tools` | ✅ 已装（含 `BrushTool`/`SegmentIndex` 概念验证） | dead dep（已 linted）— 这轮用上 |
| `cornerstone-nifti` | ❌ 新增 | 社区包，maintained；或自写 NIfTI loader（沿用 `cornerstone.ts:web:` 方案） |
| `nibabel` (python) | ❌ 新增 | NIfTI 读写 + header 解析；放 science-core 主 deps |
| `totalsegmentator` (python) | ❌ 新增（独立 venv-ts） | nnU-Net 一键调用 |
| `nnunetv2` | ❌ 新增（独立 venv-ts） | TotalSegmentator 依赖 |
| `medpy` | ❌ 新增 | Dice / HD95 指标；或自写（numpy 即可，Dice 5 行） |

**分阶段落地（与多模态设计文档 §9 同构）**：

| 阶段 | 内容 | 验证 | 依赖 |
|---|---|---|---|
| **P6.0** 后端 VolumeMask + Calibration 新增 | 落实设计 §3.1/§3.2/§5.1/§5.2；注册表新加 `totalseg_liver_kidney`；fake adapter 先出 dummy labelmap | pytest（calibration 硬拒绝路径、measure 已知数据对） | nibabel（主 deps） |
| **P6.1** 子进程 + 缓存 + 数据列表 | `segment_ts.py` argv 模式；`.venv-ts/` 起；ship 1 例 CT；`/volumes` + `/volume/{id}` | subprocess smoke test（mock nnU-Net 调真 venv）；缓存命中 | totalsegmentator 包；ship ct_001.nii.gz |
| **P6.2** 前端 VolumeViewer | CS3D OrthographicViewport + NIfTI loader + VolumeMask 渲染 | preview：CT 切片滚动 + 假 labelmap 三色叠加 | cornerstone-nifti 或自写 |
| **P6.3** 画笔编辑回流 | CS3D BrushTool + `POST /volume/{id}/mask-edit` + 度量重算 + 面板泛型渲染 | preview：擦一块 → 体积下降 | P6.0/1/2 全 |
| **P6.4** GT Dice 验证 | ship `ct_001_gt.nii.gz`；`/volume/{id}/verify`；面板显示 Dice | Dice 与 nnU-Net 报告数 ±0.01 | ship GT 文件 |
| **P6.5** 真机端到端 | ship 真实 nnU-Net 跑通 1 例；评测报告 | Dice ≥ 0.90（肝）/ 0.85（肾）作为基线 | P6.0–4 全 |

**P6 不做**（YAGNI 护栏）：
- 117 类全量（→ P6.x）
- MPR / 3D 体积渲染（→ P6.x+）
- 跨病人队列聚合 / 纵向对比（→ 后续）
- 病理 WSI（→ P7+）
- 画笔撤销/重做栈、多切片批量编辑（先单步编辑）
- 主动学习/在线学习（先积累 corrections → 后续）

---

## 7. 权衡与开放决策

| 决策 | 选择 | 权衡 |
|---|---|---|
| 楔子器官数 | 3 类（肝+双肾） | 验证管线最窄 vs 验证多器官拓扑关系（→ P6.x） |
| 3D 交互 | 单轴状位滚动 | UX 最熟悉最轻量 vs MPR/3D 渲染（→ P6.x+） |
| Primitive 表达 | 新增 `VolumeMask` 变体 | 语义最干净、扩展好 vs Primitive 联合多一变体 |
| 标定来源 | 仅 NIfTI pixdim | 简单、CT 主流 vs 不支持 DICOM（→ 后续） |
| 画笔粒度 | 单切片 edit 即时提交 | UX 简单、链路完整 vs 撤销栈（→ 后续） |
| GT 验证范围 | 1 例 Dice | 验证层首个落地实例 vs 大规模评测（→ 后续） |

**开放问题（留待 P6.x）**：
1. 117 类全量扩到时，`metric_keys` 涨到 100+ 键——面板的泛型渲染需要 list/paginate，不能平铺
2. 多器官的拓扑关系（如肝→胆囊、肾→肾上腺）是否进 `measurement.overlays`
3. CT 之外的 DICOM 模态（MRI/PET）的 HU 等价指标、窗位预设（lung/mediastinal/bone）

---

## 8. 变更记录

- **2026-07-09**：v1。脑暴产出，approved。落实[多模态设计文档 §9 P6](../designs/2026-07-07-glaux-multimodal-architecture.zh-CN.md) 与 §10 开放问题 #2（`VolumeMask` 形态）；首个 3D 楔子选 TotalSegmentator v2 肝+双肾；路径：3D 体数据先行，病理 WSI 推 P7+。
