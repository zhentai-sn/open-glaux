"""P7 U1 测试：PointSet Primitive + measure_nuclei + Calibration mpp。

覆盖：序列化往返、measure 已知数据对（计数/密度/面积）、per-class 计数、硬拒绝路径。
"""

from __future__ import annotations

import json

import pytest

from glaux_core.calibration.calibration import (
    CFSource,
    CalibrationResult,
    resolve_wsi_calibration,
)
from glaux_core.contracts import (
    ClassSpec,
    Detection,
    Measurement,
    PointSet,
    primitive_from_dict,
    primitive_to_dict,
)
from glaux_core.errors import HardReject
from glaux_core.measurement.nuclei import (
    assert_calibration_wsi_or_raise,
    measure_nuclei,
)


def _classes_single() -> tuple[ClassSpec, ...]:
    return (
        ClassSpec(class_id=1, role="nucleus", label_zh="细胞核", label_en="Nucleus",
                  color="#7BE0AD", measurable=True),
    )


def _classes_pannuke() -> tuple[ClassSpec, ...]:
    return (
        ClassSpec(class_id=1, role="neoplastic", label_zh="肿瘤核", label_en="Neoplastic",
                  color="#FF5A5A", measurable=True),
        ClassSpec(class_id=2, role="inflammatory", label_zh="炎症核", label_en="Inflammatory",
                  color="#4FB0FF", measurable=True),
    )


# --- PointSet 序列化 ---------------------------------------------------------


def test_point_set_serialize_round_trip():
    ps = PointSet(
        id="slide_001_nuclei",
        points=((10.0, 10.0), (20.5, 30.5)),
        point_class_ids=(1, 2),
        classes=_classes_pannuke(),
        roi=(0.0, 0.0, 100.0, 100.0),
    )
    d = primitive_to_dict(ps)
    assert d["kind"] == "point_set"
    assert d["id"] == "slide_001_nuclei"
    assert d["role"] == "nuclei"
    assert d["points"] == [[10.0, 10.0], [20.5, 30.5]]
    assert d["point_class_ids"] == [1, 2]
    assert d["roi"] == [0.0, 0.0, 100.0, 100.0]
    assert [c["class_id"] for c in d["classes"]] == [1, 2]
    assert d["classes"][0]["label"]["zh"] == "肿瘤核"

    ps2 = primitive_from_dict(d)
    assert ps2.id == ps.id
    assert ps2.points == ps.points
    assert ps2.point_class_ids == (1, 2)
    assert ps2.roi == (0.0, 0.0, 100.0, 100.0)
    assert [c.class_id for c in ps2.classes] == [1, 2]

    json.dumps(d)  # JSON-native


def test_point_set_without_roi_serializes():
    ps = PointSet(id="x", points=((1.0, 2.0),), point_class_ids=(1,),
                  classes=_classes_single(), roi=None)
    d = primitive_to_dict(ps)
    assert "roi" not in d  # roi=None 不下发
    ps2 = primitive_from_dict(d)
    assert ps2.roi is None


def test_point_set_length_mismatch_raises():
    with pytest.raises(ValueError, match="不等长"):
        PointSet(id="x", points=((1.0, 2.0), (3.0, 4.0)), point_class_ids=(1,),
                 classes=_classes_single())


# --- Calibration mpp ---------------------------------------------------------


def test_resolve_wsi_calibration_happy_path():
    cal = resolve_wsi_calibration((0.25, 0.25))
    assert cal.source is CFSource.MPP
    assert cal.value == (0.25, 0.25)
    assert cal.cf == 0.0
    assert cal.provenance["source"] == "openslide.mpp"
    assert cal.provenance["mpp_xy_um"] == [0.25, 0.25]


def test_resolve_wsi_calibration_zero_or_negative_rejects():
    for bad in [(0, 0.25), (-1, 0.25), (0.25, 0), (0.25, -0.5)]:
        with pytest.raises(HardReject, match="WSI mpp"):
            resolve_wsi_calibration(bad)


def test_resolve_wsi_calibration_wrong_shape_rejects():
    with pytest.raises(HardReject, match="WSI 标定形状非法"):
        resolve_wsi_calibration((0.25, 0.25, 0.25))  # type: ignore[arg-type]


def test_assert_calibration_wsi_or_raise():
    wsi = resolve_wsi_calibration((0.5, 0.5))
    assert_calibration_wsi_or_raise(wsi)  # 不抛

    us = CalibrationResult(source=CFSource.CUBS, cf=0.06, value=0.06)
    with pytest.raises(HardReject, match="WSI 任务需 mpp"):
        assert_calibration_wsi_or_raise(us)


# --- measure_nuclei 已知数据对 -----------------------------------------------


def test_measure_nuclei_count_density_area():
    """500 点 + 1000×1000 px ROI + mpp (0.25,0.25) → 面积 0.0625 mm²、密度 8000。"""
    points = tuple((float(i % 1000), float(i % 1000)) for i in range(500))
    ps = PointSet(id="x", points=points, point_class_ids=tuple(1 for _ in points),
                  classes=_classes_single(), roi=(0.0, 0.0, 1000.0, 1000.0))
    det = Detection(primitives=(ps,), model_version="t")
    cal = resolve_wsi_calibration((0.25, 0.25))
    meas = measure_nuclei(det, cal)
    assert isinstance(meas, Measurement)
    assert meas.metrics["nuclei_count"].value == pytest.approx(500.0)
    assert meas.metrics["roi_area_mm2"].value == pytest.approx(0.0625)
    assert meas.metrics["nuclei_density_mm2"].value == pytest.approx(8000.0)
    assert meas.metrics["nuclei_count"].unit == "个"
    assert meas.metrics["nuclei_density_mm2"].unit == "个/mm²"


def test_measure_nuclei_anisotropic_mpp():
    """mpp (0.5, 0.25) → 面积 = 1000×1000 × 0.5×0.25 / 1e6 = 0.125 mm²。"""
    points = tuple((0.0, 0.0) for _ in range(100))
    ps = PointSet(id="x", points=points, point_class_ids=tuple(1 for _ in points),
                  classes=_classes_single(), roi=(0.0, 0.0, 1000.0, 1000.0))
    det = Detection(primitives=(ps,), model_version="t")
    cal = resolve_wsi_calibration((0.5, 0.25))
    meas = measure_nuclei(det, cal)
    assert meas.metrics["roi_area_mm2"].value == pytest.approx(0.125)
    assert meas.metrics["nuclei_density_mm2"].value == pytest.approx(100.0 / 0.125)


def test_measure_nuclei_per_class_counts():
    """类别感知：300 neoplastic(1) + 200 inflammatory(2) → per-class 计数。"""
    ids = tuple(1 if i < 300 else 2 for i in range(500))
    points = tuple((float(i), 0.0) for i in range(500))
    ps = PointSet(id="x", points=points, point_class_ids=ids,
                  classes=_classes_pannuke(), roi=(0.0, 0.0, 1000.0, 1000.0))
    det = Detection(primitives=(ps,), model_version="t")
    cal = resolve_wsi_calibration((0.25, 0.25))
    meas = measure_nuclei(det, cal)
    assert meas.metrics["nuclei_count"].value == pytest.approx(500.0)
    assert meas.metrics["neoplastic_count"].value == pytest.approx(300.0)
    assert meas.metrics["inflammatory_count"].value == pytest.approx(200.0)


def test_measure_nuclei_empty_points():
    """0 点 → 计数 0、密度 0（不抛）。"""
    ps = PointSet(id="x", points=(), point_class_ids=(),
                  classes=_classes_single(), roi=(0.0, 0.0, 1000.0, 1000.0))
    det = Detection(primitives=(ps,), model_version="t")
    cal = resolve_wsi_calibration((0.25, 0.25))
    meas = measure_nuclei(det, cal)
    assert meas.metrics["nuclei_count"].value == 0.0
    assert meas.metrics["nuclei_density_mm2"].value == 0.0


def test_measure_nuclei_no_point_set_raises():
    det = Detection(primitives=(), model_version="t")
    cal = resolve_wsi_calibration((0.25, 0.25))
    with pytest.raises(ValueError, match="需 1 枚 PointSet"):
        measure_nuclei(det, cal)


def test_measure_nuclei_no_roi_raises():
    ps = PointSet(id="x", points=((0.0, 0.0),), point_class_ids=(1,),
                  classes=_classes_single(), roi=None)
    det = Detection(primitives=(ps,), model_version="t")
    cal = resolve_wsi_calibration((0.25, 0.25))
    with pytest.raises(ValueError, match="缺 roi"):
        measure_nuclei(det, cal)


def test_measure_nuclei_wrong_cal_raises():
    ps = PointSet(id="x", points=((0.0, 0.0),), point_class_ids=(1,),
                  classes=_classes_single(), roi=(0.0, 0.0, 100.0, 100.0))
    det = Detection(primitives=(ps,), model_version="t")
    us = CalibrationResult(source=CFSource.CUBS, cf=0.06, value=0.06)
    with pytest.raises(ValueError, match="需 mpp"):
        measure_nuclei(det, us)


def test_measure_nuclei_degenerate_roi_raises():
    """ROI 面积为 0（零宽）→ 硬拒绝。"""
    ps = PointSet(id="x", points=((0.0, 0.0),), point_class_ids=(1,),
                  classes=_classes_single(), roi=(10.0, 0.0, 10.0, 100.0))
    det = Detection(primitives=(ps,), model_version="t")
    cal = resolve_wsi_calibration((0.25, 0.25))
    with pytest.raises(ValueError, match="面积非正"):
        measure_nuclei(det, cal)
