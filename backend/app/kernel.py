"""确定性内核的薄封装（F8/F9）——pdm 测量 + 模型注册表 + 泛型任务驱动。

后端不搬业务：测量用 science-core 的对齐口径 imt（共同支撑 + 对称 PDM），任务契约读
glaux_core.tasks.REGISTRY。此处只做 HTTP schema ↔ 领域对象 的映射。
意图解析已退役（2026-08-16）：NL 由 agent-runtime 的参考智能体理解，经 run_task 工具调 /task/run。

P6：在 _detect_for_spec 加 "volume" 分支（CT 模态），数据来自 segment_ts + dataset_ct，
组装成 VolumeMask + voxel_spacing 标定。
"""

from __future__ import annotations

import numpy as np

# science-core（经 config 挂上 sys.path）
from glaux_core.calibration.calibration import (  # noqa: E402
    CalibrationResult,
    CFSource,
    resolve_ct_calibration,
    resolve_wsi_calibration,
)
from glaux_core.contracts import (  # noqa: E402
    Detection,
    EllipseShape,
    PointSet,
    Polyline,
    TaskOutput,
    VolumeMask,
    measurement_to_dict,
    primitive_from_dict,
    task_output_to_dict,
)
from glaux_core.io.boundaries import Boundary  # noqa: E402
from glaux_core.measurement.pdm import imt as _imt  # noqa: E402
from glaux_core.tasks import (  # noqa: E402
    LIVER_KIDNEY_CLASSES,
    NUCLEI_CLASSES,
)
from glaux_core.tasks import (
    REGISTRY as _REGISTRY,
)
from glaux_core.tasks import (
    TaskType as _TaskType,
)
from glaux_core.tasks import (
    plugin_to_view as _plugin_to_view,
)

from . import (
    config,
    dataset,
    dataset_ct,
    dataset_wsi,
    datasource_registry,
    hc_dataset,
    mock,
    segment_proc,
    segment_ts,
    segment_wsi,
)
from .schemas import (
    IMTResult,
    ModelInfo,
    TaskSpec,
)


def _boundary(name: str, pts: list[list[float]]) -> Boundary:
    arr = np.asarray(pts, dtype=float)
    return Boundary(name=name, x=arr[:, 0], y=arr[:, 1])


def measure(
    li: list[list[float]],
    ma: list[list[float]],
    cf: float,
    x_window: tuple[float, float] | None = None,
) -> IMTResult:
    """对齐口径测量：共同支撑 + 对称 PDM（内核 imt）。"""
    res = _imt(_boundary("LI", li), _boundary("MA", ma), cf, x_window=x_window)
    return IMTResult(
        mean_mm=round(float(res.mean_mm), 4),
        max_mm=round(float(res.max_mm), 4),
        pdm_mean_mm=round(float(res.pdm_mean_mm), 4),
        per_column_um=[round(float(v), 2) for v in np.asarray(res.per_column_um).ravel()],
        n_columns=int(res.n_columns),
    )


def tasks() -> list[dict]:
    """任务注册表视图——前端 ``GET /tasks`` 的单一真相源（模态/查看器/工具/度量字段）。

    直接下发 :data:`glaux_core.tasks.REGISTRY` 的可序列化视图（不含 measure 可调用）。
    前端据此渲染任务切换器 / 工具栏 / 测量面板，**不再硬编码 if 模态**。
    """
    return [_plugin_to_view(p) for p in _REGISTRY.values()]


# --- 统一驱动（P2.0）：桥接子进程/缓存流 → 统一信封 -------------------------


def _polyline(role: str, pts) -> Polyline:
    return Polyline(id=role, role=role, points=tuple((float(x), float(y)) for x, y in pts))


def _detect_for_spec(spec: TaskSpec) -> tuple[Detection, CalibrationResult]:
    """按任务几何族在**数据入口边界**取数 → 统一 Detection + 标定。

    这是后端唯一保留的 adapter_kind 分派：观测空间的数据源天然不同（CUBS tiff+CF+子进程缓存
    vs HC18/合成椭圆检测），**非任务逻辑分派**。无 CUBS 数据时 wall_pair 回退 mock 合成边界。
    缺标定 → ValueError（映射 422 硬拒绝，不出假值）。
    """
    plugin = _REGISTRY[_TaskType(spec.task)]
    roi = tuple(spec.roi) if spec.roi else None
    if plugin.adapter_kind == "wall_pair":
        if config.data_available():
            if not spec.image_id:
                raise ValueError("run 需要 image_id")
            cf = spec.cubs_cf or dataset.cf_of(spec.image_id)
            if not cf:
                raise ValueError(f"标定不可用：{spec.image_id} 无 CF——硬拒绝，不出假 IMT")
            li, ma, mv = segment_proc.segment(spec.image_id, spec.method or dataset.CARO)
        else:  # 无 CUBS 数据 → mock 合成边界（形状即契约）
            cf = spec.cubs_cf or mock.CF_CANONICAL
            li, ma = mock.segment_boundaries(spec.roi)
            mv = f"{spec.method or dataset.CARO}@mock"
        det = Detection(
            primitives=(_polyline("LI", li), _polyline("MA", ma)),
            model_version=mv,
            roi_used=roi,
        )
        return det, CalibrationResult(cf=float(cf), source=CFSource.CUBS)

    if plugin.adapter_kind == "contour":
        if not spec.image_id or not hc_dataset.is_hc(spec.image_id):
            raise ValueError(f"非 HC 图像 id：{spec.image_id}——硬拒绝，不在错模态上瞎跑")
        cf = spec.cubs_cf or hc_dataset.cf_of(spec.image_id)
        _points, ell, mv = hc_dataset.detect(spec.image_id, roi)
        det = Detection(
            primitives=(EllipseShape.from_ellipse(ell, id="skull", role="skull"),),
            model_version=mv,
            roi_used=roi,
        )
        return det, CalibrationResult(cf=float(cf), source=CFSource.CUBS)

    if plugin.adapter_kind == "volume":
        # P6：CT 模态——数据入口边界走 segment_ts（缓存 + 隔离子进程）+ dataset_ct（标定）。
        # 与 wall_pair / contour 同形：构造 VolumeMask（含 path 与 classes），
        # 落 Detection.primitives。
        if not spec.image_id or not dataset_ct.is_ct(spec.image_id):
            raise ValueError(f"非 CT volume id：{spec.image_id}——硬拒绝，不在错模态上瞎跑")
        if not config.ct_data_available():
            raise ValueError(f"CT 数据未就绪：{config.CT_ROOT} 无 ct_*.nii.gz")
        method = spec.method or "totalsegmentator_v2"
        labelmap_path, mv = segment_ts.segment(spec.image_id, method)
        cal = resolve_ct_calibration(dataset_ct.vox_spacing_mm(spec.image_id))
        # ref 用 URL 模板（含 task 与 method），前端用 ref 拉 labelmap；path 给 kernel measure 用
        ref = f"/api/volume/{spec.image_id}/labelmap?task={spec.task}&method={method}"
        raw_ref = f"/api/volume/{spec.image_id}/raw"  # URL：下发前端
        raw_path = dataset_ct.nifti_path(spec.image_id)  # fs 路径：measure 算 HU mean 读
        vol_prim = VolumeMask(
            id=f"{spec.image_id}_labelmap",
            ref=ref,
            classes=LIVER_KIDNEY_CLASSES,
            raw_ref=raw_ref,
            path=labelmap_path,
            raw_path=raw_path,
        )
        det = Detection(
            primitives=(vol_prim,),
            model_version=mv,
            roi_used=roi,
        )
        return det, cal

    if plugin.adapter_kind == "wsi":
        # P7：病理 WSI 核检测——数据入口边界走 segment_wsi（缓存 + 隔离子进程 ROI 抽块 + 去重）+
        # dataset_wsi（MPP 标定）。与 volume 同形：
        # 构造 PointSet（含质心 + classes + roi），落 Detection。
        if not spec.image_id or not dataset_wsi.is_wsi(spec.image_id):
            raise ValueError(f"非 WSI slide id：{spec.image_id}——硬拒绝，不在错模态上瞎跑")
        if not config.wsi_data_available():
            raise ValueError(f"WSI 数据未就绪：{config.WSI_ROOT} 无 slide_*")
        if spec.roi_box is None:
            raise ValueError("WSI 核检测需 roi_box 框选区域——硬拒绝，整片推理不可行")
        method = spec.method or "stardist_he"
        roi_box = tuple(int(v) for v in spec.roi_box)
        nuclei_json_path, mv = segment_wsi.segment(spec.image_id, roi_box, method)
        data = segment_wsi.load_nuclei(nuclei_json_path)
        cal = resolve_wsi_calibration(dataset_wsi.mpp(spec.image_id))
        pts = tuple((float(x), float(y)) for x, y in data.get("points", []))
        cids = tuple(int(c) for c in data.get("class_ids", []))
        ps = PointSet(
            id=f"{spec.image_id}_nuclei",
            points=pts,
            point_class_ids=cids,
            classes=NUCLEI_CLASSES,
            roi=roi_box,
        )
        det = Detection(primitives=(ps,), model_version=mv, roi_used=None)
        return det, cal

    raise ValueError(f"未支持的 adapter_kind：{plugin.adapter_kind}")  # pragma: no cover


def _round_metric_values(d: dict) -> None:
    """展示层取整（内核数值原生，取整只在序列化边界做）。"""
    for m in d.get("metrics", {}).values():
        v = m.get("value")
        if isinstance(v, float):
            m["value"] = round(v, 4)


def _enrich_gold(d: dict, spec: TaskSpec, plugin, cal: CalibrationResult) -> None:
    """后端特有增强：与金标准的 |bias|（IMT vs Manual-A1 µm / HC vs GT mm），追加为 metric。"""
    metrics = d.get("metrics", {})
    if plugin.adapter_kind == "wall_pair":
        method = spec.method or dataset.CARO
        if not (config.data_available() and spec.image_id and method != "Manual-A1"):
            return
        if "IMT_pdm" not in metrics:
            return
        try:
            a1_li, a1_ma = dataset.boundaries_as_points(spec.image_id, "Manual-A1")
        except FileNotFoundError:
            return
        a1 = measure(a1_li, a1_ma, cal.cf)  # 既有 kernel.measure → IMTResult
        um = round(abs(metrics["IMT_pdm"]["value"] - a1.pdm_mean_mm) * 1000, 1)
        metrics["vs_A1"] = {
            "value": um,
            "unit": "µm",
            "label_en": "vs A1 |bias|",
            "label_zh": "vs A1 |偏差|",
        }
    elif plugin.adapter_kind == "contour":
        if "HC" not in metrics:
            return
        try:
            gt = hc_dataset.gt_hc_mm(spec.image_id)
        except Exception:
            return
        mm = round(abs(metrics["HC"]["value"] - gt), 2)
        metrics["vs_GT"] = {
            "value": mm,
            "unit": "mm",
            "label_en": "vs GT |bias|",
            "label_zh": "vs 真值 |偏差|",
        }


def run_task(spec: TaskSpec) -> dict:
    """统一驱动（多模态）：取数 → 注册表测量 → TaskOutput dict（+ 金标准增强、展示取整）。

    桥接后端"子进程/缓存流"到统一信封：不在进程内跑 adapter，而是复用既有取数
    （segment_proc 缓存/子进程、hc_dataset 检测），包成 Detection 后走 plugin.measure。
    """
    plugin = _REGISTRY[_TaskType(spec.task)]
    det, cal = _detect_for_spec(spec)
    meas = plugin.measure(det, cal)
    out = TaskOutput(
        task=spec.task,
        metrics=meas.metrics,
        primitives=tuple(det.primitives) + tuple(meas.overlays),
        calibration=cal,
        provenance={
            "model_version": det.model_version,
            "method": spec.method,
            "cf_source": cal.source.value,
        },
    )
    d = task_output_to_dict(out)
    _enrich_gold(d, spec, plugin, cal)
    _round_metric_values(d)
    return d


def measure_task(task: str, primitives: list[dict], cf: float) -> dict:
    """由前端编辑后的图元重测（泛型替代 /measure + /hc/measure）。"""
    plugin = _REGISTRY[_TaskType(task)]
    prims = tuple(primitive_from_dict(p) for p in primitives)
    det = Detection(primitives=prims, model_version="edited")
    meas = plugin.measure(det, CalibrationResult(cf=float(cf), source=CFSource.CUBS))
    d = measurement_to_dict(meas)
    _round_metric_values(d)
    return d


def models() -> list[ModelInfo]:
    """真实模型注册表——caroSegDeep（隔离/缓存）+ 数据集里出现的参考方法。"""
    known = {
        dataset.CARO: (
            "nl3769 · Dilated U-Net",
            "CUBS CREATIS baseline · Keras/TF 2.4.1 · far-wall + IMC",
            "isolated:uv/py3.8/TF2.4",
        ),
        "GT-FAMUS": (
            "FAMUS · reference",
            "Fusion of experts — CUBS gold-standard reference",
            "reference",
        ),
        "Manual-A1": ("Expert A1", "Manual tracing (gold)", "reference"),
        "Manual-A2": ("Expert A2", "Manual tracing", "reference"),
        "Computerized-CNR_IT": (
            "CNR Pisa",
            "First-order absolute moment edge operator",
            "reference",
        ),
        "Computerized-POLITO_UNET": (
            "Politecnico di Torino",
            "U-Net segmentation of the IMC",
            "reference",
        ),
    }
    out: list[ModelInfo] = [
        ModelInfo(
            id=dataset.CARO,
            pub=known[dataset.CARO][0],
            desc=known[dataset.CARO][1],
            active=True,
            backend=known[dataset.CARO][2],
        )
    ]
    if config.SEG_DIR.is_dir():
        for d in sorted(config.SEG_DIR.iterdir()):
            if not d.is_dir() or d.name == f"Computerized-{dataset.CARO}":
                continue
            pub, desc, be = known.get(d.name, (d.name, "CUBS reference method", "reference"))
            out.append(ModelInfo(id=d.name, pub=pub, desc=desc, active=False, backend=be))
    # 第二模态（HC）：真实 HC18 就绪时用 CSM 隔离真模型，否则合成亮环椭圆检测器。
    if config.hc_data_available():
        out.append(
            ModelInfo(
                id="CSM",
                pub="gauravxthakur · CSM (HuggingFace)",
                desc=(
                    "Convolutional Segmentation Machine · HC18 · Apache-2.0 · "
                    "头部分割 → 椭圆 → Ramanujan 周长"
                ),
                active=True,
                backend="isolated:uv/py3.12/torch-cpu",
                modality="fetal_hc",
            )
        )
    else:
        out.append(
            ModelInfo(
                id="ellipse-fit",
                pub="Bright-ring · direct LSQ ellipse",
                desc="阈高回声颅骨环 → Halir–Flusser 最小二乘椭圆拟合 → Ramanujan 周长（合成回退）",
                active=True,
                backend="local:numpy",
                modality="fetal_hc",
            )
        )
    # 第三模态（CT）：TotalSegmentator v2 隔离子进程——注册为 ct_abdomen 的 active 模型，
    # 否则前端切模态时 activeModel 停留在 IMT 的 caroSegDeep，/task/run 会把错 method 传给
    # volume 分支 → segment_ts 只认 totalsegmentator_v2 → 503（真机 e2e 实测到此坑）。
    if config.ct_data_available():
        out.append(
            ModelInfo(
                id="totalsegmentator_v2",
                pub="wasserth · TotalSegmentator v2.4.0",
                desc="nnU-Net v2 · 117 类全身 CT 分割（v0 肝+双肾 3 类）· Apache-2.0",
                active=True,
                backend="isolated:uv/py3.12/torch-cpu",
                modality="ct_abdomen",
            )
        )
    # 第四模态（病理 WSI）：StarDist-HE 隔离子进程——注册为 pathology 的 active 模型
    # （gated on 数据就绪；同 CT 段的用意——切模态后 activeModel 有正确 method）。
    if config.wsi_data_available():
        out.append(
            ModelInfo(
                id="stardist_he",
                pub="Weigert & Schmidt · StarDist 2D_versatile_he",
                desc="StarDist 星凸多边形核检测 · H&E 预训练（v0 核计数/密度）· BSD-3",
                active=True,
                backend="isolated:uv/py3.12/tf-cpu",
                modality="pathology",
            )
        )
    return out


def capabilities() -> list[dict]:
    """能力注册表（「插件市场」的单一真相源，§5）。

    按环境四要素（纲领 §六）把 skill/model/dataset/…收成一套清单。

    真实优先：Skill = TaskPlugin（REGISTRY）、Model/ReferenceMethod = models() 按 backend 分类、
    Dataset/CalibrationSource = 真实可用性；Connector/MCP/KnowledgeBase 出有类型占位卡
    （status=planned，v0 不做下载/安装/沙箱编排——市场先是目录 + 状态）。
    """
    caps: list[dict] = []
    modality_task = {p.modality: p.task.value for p in _REGISTRY.values()}

    # 动作空间 · Skill（= TaskPlugin：打包好的任务配方本身就是一种能力）
    for p in _REGISTRY.values():
        caps.append(
            {
                "id": f"skill:{p.task.value}",
                "kind": "skill",
                "layer": "action",
                "name": p.label_en,
                "provider": "glaux",
                "license": "internal",
                "status": "active",
                "isolation": "in_process",
                "desc": f"Task recipe · {p.adapter_kind} · viewer={p.viewer}",
                "tasks": [p.task.value],
            }
        )

    # 动作空间 · Model / 验证器 · ReferenceMethod（models() 按 backend 分类）
    for m in models():
        is_ref = "reference" in m.backend
        caps.append(
            {
                "id": m.id,
                "kind": "reference_method" if is_ref else "model",
                "layer": "verification" if is_ref else "action",
                "name": m.pub,
                "provider": m.pub.split(" · ")[0] if " · " in m.pub else "",
                "license": "research",
                "status": "active" if m.active else "installed",
                "isolation": m.backend,
                "desc": m.desc,
                "tasks": [modality_task.get(m.modality, "")],
            }
        )

    # 观测空间 · Dataset（注册表驱动——加一个数据源 = 多一张卡，不改本函数）
    _DS_META = {
        "cubs-tech": ("CREATIS", "CC BY", "颈动脉超声 · LI/MA 专家标注 · CF 标定"),
        "hc18": ("Grand Challenge", "CC BY-NC-SA", "999 张真实胎儿颅脑超声 + 椭圆真值"),
        "ct-demo": ("wasserth · TotalSegmentator", "Apache-2.0", "腹部 CT NIfTI demo · voxel 标定"),
        "wsi-demo": ("OpenSlide", "CC BY", "H&E 全切片 demo · MPP 标定"),
    }
    # DataSource.status → Capability.status（active/installed/planned 三态）
    _DS_STATUS = {
        "active": "active",
        "needs_calibration": "installed",
        "empty": "planned",
        "planned": "planned",
    }
    for s in datasource_registry.list_all():
        provider, lic, desc = _DS_META.get(
            s.id, (s.origin, "—", f"{s.modality} · 导入源 · {s.root}")
        )
        caps.append(
            {
                "id": f"dataset:{s.id}",
                "kind": "dataset",
                "layer": "representation",
                "name": s.name,
                "provider": provider,
                "license": lic,
                "status": _DS_STATUS.get(s.status, "planned"),
                "isolation": "local",
                "desc": desc,
                "tasks": [modality_task.get(s.modality, "")],
            }
        )

    # 验证器 · CalibrationSource（真实：CUBS CF）
    caps.append(
        {
            "id": "cal:cubs-cf",
            "kind": "calibration_source",
            "layer": "verification",
            "name": "CUBS calibration factor",
            "provider": "CREATIS",
            "license": "CC BY",
            "status": "active",
            "isolation": "local",
            "desc": "每图 mm/px 标定系数（无标定硬拒绝）",
            "tasks": ["far_wall_cca_imt"],
        }
    )

    # 占位卡（planned · 有类型不接线）——观测空间 / 动作空间 / 回合与轨迹
    caps += [
        {
            "id": "connector:dicom-pacs",
            "kind": "connector",
            "layer": "representation",
            "name": "DICOM-PACS connector",
            "provider": "—",
            "license": "—",
            "status": "planned",
            "isolation": "",
            "desc": "从院内 PACS 拉取 DICOM（待接）",
            "tasks": [],
        },
        {
            "id": "mcp:clinical-tools",
            "kind": "mcp",
            "layer": "action",
            "name": "Clinical-tools MCP",
            "provider": "—",
            "license": "—",
            "status": "planned",
            "isolation": "",
            "desc": "外部工具服务器（MCP，待接）",
            "tasks": [],
        },
        {
            "id": "kb:fetal-growth",
            "kind": "knowledge_base",
            "layer": "memory",
            "name": "Fetal growth curves",
            "provider": "—",
            "license": "—",
            "status": "planned",
            "isolation": "",
            "desc": "生长曲线 / 指南 RAG（待接）",
            "tasks": ["fetal_hc"],
        },
        {
            "id": "store:corrections",
            "kind": "correction_store",
            "layer": "memory",
            "name": "Correction store",
            "provider": "glaux",
            "license": "internal",
            "status": "planned",
            "isolation": "local",
            "desc": "人工修正沉淀为案例（占位）",
            "tasks": [],
        },
    ]
    return caps
