"""3D CT 测量原语（P6 楔子）——从 VolumeMask 数体素算体积 + HU mean。

- 体积 = ``count × sx × sy × sz``（mm³），确定性几何，不经 LLM。
- HU mean = ``Σ(intensity[mask == class_id]) / count``，需 raw CT 引用；
  若 ``raw_ref`` 缺失则跳过 HU mean（volume 仍出）。
- 标签源是 :class:`~glaux_core.contracts.VolumeMask.classes`（注册表声明 + 后端补 path）。

数据依赖：``nibabel`` 读 NIfTI labelmap + raw CT（主进程；不在 .venv-ts 隔离内）。
"""

from __future__ import annotations

from typing import Iterable

import numpy as np

from glaux_core.calibration.calibration import CalibrationResult, CFSource
from glaux_core.contracts import (
    ClassSpec,
    Detection,
    Measure,
    Measurement,
    VolumeMask,
)
from glaux_core.errors import HardReject


def _voxel_volume_mm3(cal: CalibrationResult) -> float:
    """从 voxel_spacing 标定求单 voxel 物理体积。"""
    if cal.source is not CFSource.VOXEL_SPACING:
        raise ValueError(f"CT 测量需 voxel_spacing 标定，得 {cal.source.value}")
    sx, sy, sz = cal.value  # type: ignore[misc]
    return sx * sy * sz


def _load_labelmap_array(path: str) -> np.ndarray:
    """读 NIfTI labelmap → int ndarray (Z, Y, X)。"""
    import nibabel as nib  # 局部 import：科学内核按需引入，主进程默认无 nibabel

    if not path:
        raise RuntimeError("VolumeMask 缺 path：backend 应在构造 Detection 时填")
    img = nib.load(path)
    return np.asarray(img.dataobj).astype(np.int32, copy=False)


def _load_raw_intensities(raw_ref: str | None, shape: tuple[int, ...]) -> np.ndarray | None:
    """读原始 CT → float ndarray，shape 必须与 labelmap 一致；缺 raw_ref 返回 None。"""
    if not raw_ref:
        return None
    import nibabel as nib

    img = nib.load(raw_ref)
    arr = np.asarray(img.dataobj).astype(np.float32, copy=False)
    if arr.shape != shape:
        raise ValueError(
            f"raw CT shape {arr.shape} 与 labelmap shape {shape} 不一致——"
            f"硬拒绝，不静默算错 HU"
        )
    return arr


def _per_class_metrics(
    labelmap: np.ndarray,
    raw: np.ndarray | None,
    classes: Iterable[ClassSpec],
    voxel_mm3: float,
) -> dict[str, Measure]:
    """对每个器官类，输出 ``{role}_volume_mm3`` 与（若有 raw）``{role}_hu_mean``。"""
    out: dict[str, Measure] = {}
    for cls in classes:
        if not cls.measurable:
            continue
        if cls.class_id == 0:
            # class_id=0 是背景，体积不报
            continue
        mask = labelmap == cls.class_id
        count = int(mask.sum())
        if count == 0:
            # 跳过空器官（v0：静默不出，与 measure_imt 缺 LI 同模板——前者 raise，后者只跳过）
            # 仍出 entry 以保留面板列字段（值为 0）。
            out[f"{cls.role}_volume_mm3"] = Measure(
                value=0.0, unit="mm³",
                label_zh=f"{cls.label_zh} 体积",
                label_en=f"{cls.label_zh} volume",
            )
            if raw is not None:
                out[f"{cls.role}_hu_mean"] = Measure(
                    value=0.0, unit="HU",
                    label_zh=f"{cls.label_zh} 平均 HU",
                    label_en=f"{cls.label_zh} mean HU",
                )
            continue
        out[f"{cls.role}_volume_mm3"] = Measure(
            value=float(count) * voxel_mm3,
            unit="mm³",
            label_zh=f"{cls.label_zh} 体积",
            label_en=f"{cls.label_zh} volume",
        )
        if raw is not None:
            hu_sum = float(raw[mask].sum())
            out[f"{cls.role}_hu_mean"] = Measure(
                value=hu_sum / count,
                unit="HU",
                label_zh=f"{cls.label_zh} 平均 HU",
                label_en=f"{cls.label_zh} mean HU",
            )
    return out


def measure_liver_kidney(det: Detection, cal: CalibrationResult) -> Measurement:
    """VolumeMask → 各器官体积（mm³）+（可选）HU mean。

    - 期望 ``det.primitives[0]`` 是 :class:`VolumeMask`。
    - 期望 ``cal.source is CFSource.VOXEL_SPACING``。
    - VolumeMask 必带 ``path``（后端构造时填）；否则 :class:`RuntimeError`。
    """
    vol_prim = next((p for p in det.primitives if isinstance(p, VolumeMask)), None)
    if vol_prim is None:
        raise ValueError("CT 测量需 1 枚 VolumeMask")
    if vol_prim.path is None:
        raise RuntimeError(
            f"VolumeMask {vol_prim.id!r} 缺 path——backend run_task 应填"
        )
    voxel_mm3 = _voxel_volume_mm3(cal)
    labelmap = _load_labelmap_array(vol_prim.path)
    # HU mean 读 raw_path（本地 fs 路径），**不是** raw_ref（URL，仅下发前端）
    raw = _load_raw_intensities(vol_prim.raw_path, labelmap.shape)
    metrics = _per_class_metrics(labelmap, raw, vol_prim.classes, voxel_mm3)
    return Measurement(metrics=metrics, calibration=cal, overlays=())


def assert_calibration_ct_or_raise(cal: CalibrationResult) -> None:
    """防御性守卫——非 voxel_spacing 标定直接 raise（测量必走 ct 标定）。"""
    if cal.source is not CFSource.VOXEL_SPACING:
        raise HardReject(
            f"CT 任务需 voxel_spacing 标定，得 {cal.source.value}——硬拒绝"
        )
