"""P6 U1 测试：VolumeMask Primitive + measure_liver_kidney + Calibration voxel_spacing。

覆盖：序列化往返、measure 已知数据对、HU mean、硬拒绝路径、ClassSpec 解析。
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict

import numpy as np
import pytest

from glaux_core.calibration.calibration import (
    CFSource,
    CalibrationResult,
    resolve_ct_calibration,
)
from glaux_core.contracts import (
    ClassSpec,
    Detection,
    Measure,
    Measurement,
    VolumeMask,
    primitive_from_dict,
    primitive_to_dict,
)
from glaux_core.measurement.ct import (
    assert_calibration_ct_or_raise,
    measure_liver_kidney,
)
from glaux_core.errors import HardReject

import nibabel as nib


# --- VolumeMask 序列化 -------------------------------------------------------


def _classes() -> tuple[ClassSpec, ...]:
    return (
        ClassSpec(class_id=1, role="liver", label_zh="肝", label_en="Liver",
                  color="#FF8A5B", measurable=True),
        ClassSpec(class_id=2, role="lk", label_zh="左肾", label_en="L kidney",
                  color="#4FB0FF", measurable=True),
        ClassSpec(class_id=3, role="rk", label_zh="右肾", label_en="R kidney",
                  color="#4FB0FF", measurable=True),
    )


def test_volume_mask_serialize_round_trip():
    """primitive_to/from_dict 往返：含/不含 raw_ref 两路径。"""
    v = VolumeMask(id="ct_001", ref="/api/volume/ct_001/labelmap?task=totalseg_liver_kidney",
                   classes=_classes(), raw_ref=None, path="/tmp/ct_001.nii.gz")
    d = primitive_to_dict(v)
    assert d["kind"] == "volume_mask"
    assert d["id"] == "ct_001"
    assert d["ref"] == "/api/volume/ct_001/labelmap?task=totalseg_liver_kidney"
    assert "raw_ref" not in d  # raw_ref=None 时不下发（前端不读 raw）
    assert "path" not in d      # path 是 backend 内部路径，**不**下发前端
    assert [c["class_id"] for c in d["classes"]] == [1, 2, 3]
    assert d["classes"][0]["label"]["zh"] == "肝"
    assert d["classes"][0]["color"] == "#FF8A5B"

    v2 = primitive_from_dict(d)
    assert v2.id == v.id and v2.ref == v.ref and v2.raw_ref is None
    assert [c.class_id for c in v2.classes] == [1, 2, 3]
    assert v2.classes[0].label_zh == "肝"

    # JSON-native
    json.dumps(d)


def test_volume_mask_with_raw_ref_serializes():
    v = VolumeMask(id="ct_001", ref="/api/volume/ct_001/labelmap",
                   classes=_classes(), raw_ref="/api/volume/ct_001/raw", path=None)
    d = primitive_to_dict(v)
    assert d["raw_ref"] == "/api/volume/ct_001/raw"
    v2 = primitive_from_dict(d)
    assert v2.raw_ref == "/api/volume/ct_001/raw"


def test_primitive_from_dict_unknown_kind_raises():
    with pytest.raises(ValueError, match="未知 primitive kind"):
        primitive_from_dict({"kind": "alien"})


def test_primitive_to_dict_unknown_type_raises():
    class _Bogus:
        pass
    with pytest.raises(TypeError, match="未知 primitive 类型"):
        primitive_to_dict(_Bogus())


# --- Calibration voxel_spacing ----------------------------------------------


def test_resolve_ct_calibration_happy_path():
    cal = resolve_ct_calibration((0.5, 0.5, 1.5))
    assert cal.source is CFSource.VOXEL_SPACING
    assert cal.value == (0.5, 0.5, 1.5)
    assert cal.cf == 0.0  # CT 路径 cf 留 0
    assert cal.provenance["source"] == "nifti_pixdim"
    assert cal.provenance["voxel_spacing_mm"] == [0.5, 0.5, 1.5]


def test_resolve_ct_calibration_zero_or_negative_rejects():
    for bad in [(0, 0.5, 1.0), (-1, 0.5, 1.0), (0.5, 0.5, 0), (0.5, 0.5, 0.0)]:
        with pytest.raises(HardReject, match="CT voxel_spacing"):
            resolve_ct_calibration(bad)


def test_resolve_ct_calibration_wrong_shape_rejects():
    with pytest.raises(HardReject, match="CT 标定形状非法"):
        resolve_ct_calibration((0.5, 0.5))  # type: ignore[arg-type]


def test_assert_calibration_ct_or_raise():
    ct = resolve_ct_calibration((1.0, 1.0, 1.0))
    assert_calibration_ct_or_raise(ct)  # 不抛

    us = CalibrationResult(source=CFSource.CUBS, cf=0.06, value=0.06)
    with pytest.raises(HardReject, match="CT 任务需 voxel_spacing"):
        assert_calibration_ct_or_raise(us)


# --- measure_liver_kidney 已知数据对 ----------------------------------------


def _write_nifti(arr: np.ndarray, path: str, pixdim=(1.0, 1.0, 1.0)) -> None:
    """写一个 3D NIfTI（Z,Y,X 顺序与 nibabel 一致；pixdim 走 header）。"""
    img = nib.Nifti1Image(arr.astype(np.int32), affine=np.eye(4))
    img.header.set_zooms(pixdim)
    nib.save(img, path)


def _make_labelmap(z=10, y=10, x=10) -> np.ndarray:
    """造一张 10x10x10 labelmap：肝=1 中心 6x6x6，左肾=2 角 2x2x2，右肾=3 另一角 2x2x2。"""
    arr = np.zeros((z, y, x), dtype=np.int32)
    # 肝：z[2:8], y[2:8], x[2:8] → 6*6*6=216 体素
    arr[2:8, 2:8, 2:8] = 1
    # 左肾：z[0:2], y[0:2], x[0:2] → 8 体素
    arr[0:2, 0:2, 0:2] = 2
    # 右肾：z[0:2], y[8:10], x[8:10] → 8 体素
    arr[0:2, 8:10, 8:10] = 3
    return arr


def test_measure_liver_kidney_volumes_with_unit_voxels(tmp_path):
    """voxel_spacing=(1,1,1) → 体积 = 体素数（mm³）。HU 跳过（无 raw_ref）。"""
    labelmap = _make_labelmap()
    p = str(tmp_path / "label.nii.gz")
    _write_nifti(labelmap, p)
    classes = _classes()
    vol = VolumeMask(id="ct_001", ref="/api/volume/ct_001/labelmap",
                     classes=classes, raw_ref=None, path=p)
    det = Detection(primitives=(vol,), model_version="test@0")
    cal = resolve_ct_calibration((1.0, 1.0, 1.0))
    meas = measure_liver_kidney(det, cal)
    assert isinstance(meas, Measurement)
    assert meas.metrics["liver_volume_mm3"].value == pytest.approx(216.0)
    assert meas.metrics["lk_volume_mm3"].value == pytest.approx(8.0)
    assert meas.metrics["rk_volume_mm3"].value == pytest.approx(8.0)
    assert meas.metrics["liver_volume_mm3"].unit == "mm³"
    # raw_ref 缺失 → HU 不出
    assert "liver_hu_mean" not in meas.metrics


def test_measure_liver_kidney_with_voxel_spacing(tmp_path):
    """voxel_spacing=(0.5, 0.5, 1.5) → 单 voxel 0.375 mm³。"""
    labelmap = _make_labelmap()
    p = str(tmp_path / "label.nii.gz")
    _write_nifti(labelmap, p, pixdim=(0.5, 0.5, 1.5))
    vol = VolumeMask(id="ct_001", ref="x", classes=_classes(), path=p)
    det = Detection(primitives=(vol,), model_version="t")
    cal = resolve_ct_calibration((0.5, 0.5, 1.5))
    meas = measure_liver_kidney(det, cal)
    assert meas.metrics["liver_volume_mm3"].value == pytest.approx(216.0 * 0.375)
    assert meas.metrics["lk_volume_mm3"].value == pytest.approx(8.0 * 0.375)


def test_measure_liver_kidney_hu_mean(tmp_path):
    """raw_path 提供 → 算 HU mean（每 class 在 raw 区域上的均值）。measure 走 fs 路径 raw_path。"""
    labelmap = _make_labelmap()
    raw = (labelmap * 50).astype(np.float32)  # 肝=50, lk=100, rk=150, 背景=0
    lp = str(tmp_path / "label.nii.gz")
    rp = str(tmp_path / "raw.nii.gz")
    _write_nifti(labelmap, lp)
    _write_nifti(raw, rp)
    classes = _classes()
    vol = VolumeMask(id="ct_001", ref="x", classes=classes, raw_path=rp, path=lp)
    det = Detection(primitives=(vol,), model_version="t")
    cal = resolve_ct_calibration((1.0, 1.0, 1.0))
    meas = measure_liver_kidney(det, cal)
    assert meas.metrics["liver_hu_mean"].value == pytest.approx(50.0)
    assert meas.metrics["lk_hu_mean"].value == pytest.approx(100.0)
    assert meas.metrics["rk_hu_mean"].value == pytest.approx(150.0)


def test_measure_liver_kidney_empty_organ_reports_zero(tmp_path):
    """某 class 在 labelmap 中无体素 → 体积 0、HU 0（不抛）。"""
    arr = np.zeros((10, 10, 10), dtype=np.int32)
    arr[2:8, 2:8, 2:8] = 1  # 只有肝
    p = str(tmp_path / "label.nii.gz")
    _write_nifti(arr, p)
    classes = _classes()  # 含 lk / rk 但 labelmap 里没
    vol = VolumeMask(id="ct_001", ref="x", classes=classes, path=p)
    det = Detection(primitives=(vol,), model_version="t")
    cal = resolve_ct_calibration((1.0, 1.0, 1.0))
    meas = measure_liver_kidney(det, cal)
    assert meas.metrics["liver_volume_mm3"].value == pytest.approx(216.0)
    assert meas.metrics["lk_volume_mm3"].value == 0.0
    assert meas.metrics["rk_volume_mm3"].value == 0.0


def test_measure_liver_kidney_no_volume_mask_raises():
    det = Detection(primitives=(), model_version="t")
    cal = resolve_ct_calibration((1.0, 1.0, 1.0))
    with pytest.raises(ValueError, match="需 1 枚 VolumeMask"):
        measure_liver_kidney(det, cal)


def test_measure_liver_kidney_no_path_raises():
    classes = _classes()
    vol = VolumeMask(id="ct_001", ref="x", classes=classes, path=None)
    det = Detection(primitives=(vol,), model_version="t")
    cal = resolve_ct_calibration((1.0, 1.0, 1.0))
    with pytest.raises(RuntimeError, match="缺 path"):
        measure_liver_kidney(det, cal)


def test_measure_liver_kidney_wrong_cal_raises():
    classes = _classes()
    vol = VolumeMask(id="ct_001", ref="x", classes=classes, path="/tmp/any.nii.gz")
    det = Detection(primitives=(vol,), model_version="t")
    # 非 CT 标定（CUBS）→ measure 第一步就报
    us = CalibrationResult(source=CFSource.CUBS, cf=0.06, value=0.06)
    with pytest.raises(ValueError, match="需 voxel_spacing"):
        measure_liver_kidney(det, us)


def test_measure_liver_kidney_raw_shape_mismatch_rejects(tmp_path):
    """raw CT shape 与 labelmap 不一致 → 硬拒绝，不静默算错 HU。"""
    labelmap = _make_labelmap()  # 10x10x10
    raw = np.zeros((20, 20, 20), dtype=np.float32)  # 不同 shape
    lp = str(tmp_path / "label.nii.gz")
    rp = str(tmp_path / "raw.nii.gz")
    _write_nifti(labelmap, lp)
    _write_nifti(raw, rp)
    vol = VolumeMask(id="ct_001", ref="x", classes=_classes(), raw_path=rp, path=lp)
    det = Detection(primitives=(vol,), model_version="t")
    cal = resolve_ct_calibration((1.0, 1.0, 1.0))
    with pytest.raises(ValueError, match="不一致"):
        measure_liver_kidney(det, cal)
