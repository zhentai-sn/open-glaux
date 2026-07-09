"""任务插件注册表测试——注册完整性、信号路由、测量原语、/tasks 视图。"""

from __future__ import annotations

import json

import numpy as np
import pytest

from glaux_core.calibration.calibration import CFSource, CalibrationResult, resolve_ct_calibration
from glaux_core.contracts import (
    ClassSpec,
    Detection,
    EllipseShape,
    Polyline,
    VolumeMask,
)
from glaux_orchestrator.spec import TaskType
from glaux_orchestrator.tasks import (
    LIVER_KIDNEY_CLASSES,
    REGISTRY,
    measure_hc,
    measure_imt,
    plugin_to_view,
    task_for_signals,
)


def test_registry_covers_all_task_types():
    assert set(REGISTRY) == set(TaskType)
    for task, plugin in REGISTRY.items():
        assert plugin.task is task
        assert plugin.adapter_kind in {"wall_pair", "contour", "volume"}
        assert plugin.viewer in {"raster_2d", "volume_3d"}
        assert callable(plugin.measure)


def test_task_for_signals_routes():
    assert task_for_signals("测远壁颈动脉 IMT") is TaskType.FAR_WALL_CCA_IMT
    assert task_for_signals("estimate fetal head circumference") is TaskType.FETAL_HC
    assert task_for_signals("测头围") is TaskType.FETAL_HC
    # P6：CT 肝/肾信号词路由
    assert task_for_signals("肝体积") is TaskType.TOTALSEG_LIVER_KIDNEY
    assert task_for_signals("measure liver volume from CT") is TaskType.TOTALSEG_LIVER_KIDNEY
    assert task_for_signals("hello world") is None


def _cal(cf: float = 0.06):
    return CalibrationResult(cf=cf, source=CFSource.CUBS)


def test_measure_imt_from_detection():
    det = Detection(
        primitives=(
            Polyline(id="LI", role="LI", points=((0.0, 100.0), (1.0, 100.0), (2.0, 100.0))),
            Polyline(id="MA", role="MA", points=((0.0, 108.0), (1.0, 108.0), (2.0, 108.0))),
        ),
        model_version="stub@0",
    )
    meas = measure_imt(det, _cal(0.06))
    assert meas.metrics["IMT_mean"].value == pytest.approx(0.48)  # 8px × 0.06
    assert set(meas.metrics) == {"IMT_mean", "IMT_max", "IMT_pdm"}
    assert meas.metrics["IMT_mean"].unit == "mm"


def test_measure_imt_missing_wall_raises():
    det = Detection(primitives=(Polyline(id="LI", role="LI", points=((0.0, 1.0),)),), model_version="x")
    with pytest.raises(ValueError):
        measure_imt(det, _cal())


def test_measure_hc_from_detection():
    ell = EllipseShape(id="skull", cx=100.0, cy=90.0, a=80.0, b=60.0, theta=0.0)
    det = Detection(primitives=(ell,), model_version="stub@0")
    meas = measure_hc(det, _cal(0.1))
    assert meas.metrics["BPD"].value == pytest.approx(2 * 60 * 0.1)  # 短轴
    assert meas.metrics["OFD"].value == pytest.approx(2 * 80 * 0.1)  # 长轴
    assert set(meas.metrics) == {"HC", "BPD", "OFD", "area"}


def test_plugin_to_view_is_json_native_without_callable():
    view = plugin_to_view(REGISTRY[TaskType.FAR_WALL_CCA_IMT])
    assert view["task"] == "far_wall_cca_imt"
    assert view["viewer"] == "raster_2d"
    assert view["adapter_kind"] == "wall_pair"
    assert view["modality"] == "carotid_imt"
    assert [m["key"] for m in view["metrics"]] == ["IMT_mean", "IMT_max", "IMT_pdm"]
    assert {t["id"] for t in view["tools"]} == {"cursor", "editli", "editma", "reset"}
    assert view["overlays"][0] == {"role": "LI", "color": "#4FB0FF", "editable": True}
    assert "measure" not in view  # 不下发可调用
    json.dumps(view)  # JSON-native


def test_plugin_to_view_totalseg_liver_kidney():
    """P6：CT 任务 plugin view 应含 volume_3d viewer + 6 个 metric keys + brush 工具 + 三色 overlay。"""
    view = plugin_to_view(REGISTRY[TaskType.TOTALSEG_LIVER_KIDNEY])
    assert view["task"] == "totalseg_liver_kidney"
    assert view["viewer"] == "volume_3d"
    assert view["adapter_kind"] == "volume"
    assert view["modality"] == "ct_abdomen"
    expected_keys = {
        "liver_volume_mm3", "liver_hu_mean",
        "lk_volume_mm3", "lk_hu_mean",
        "rk_volume_mm3", "rk_hu_mean",
    }
    assert {m["key"] for m in view["metrics"]} == expected_keys
    assert {t["id"] for t in view["tools"]} == {"cursor", "brush", "reset"}
    roles = {o["role"] for o in view["overlays"]}
    assert roles == {"liver", "lk", "rk"}
    assert all(o["editable"] for o in view["overlays"])
    assert "measure" not in view
    json.dumps(view)


def test_liver_kidney_classes_constant():
    """LIVER_KIDNEY_CLASSES 与 plugin.overlays 同步（class_id/role/label/color）。"""
    plugin = REGISTRY[TaskType.TOTALSEG_LIVER_KIDNEY]
    overlay_roles = {o.role for o in plugin.overlays}
    assert {c.role for c in LIVER_KIDNEY_CLASSES} == overlay_roles
    assert [c.class_id for c in LIVER_KIDNEY_CLASSES] == [1, 2, 3]
    assert LIVER_KIDNEY_CLASSES[0].label_zh == "肝"
    assert LIVER_KIDNEY_CLASSES[0].color == "#FF8A5B"


def test_measure_liver_kidney_via_registry(tmp_path):
    """通过 REGISTRY 调 measure_liver_kidney：写一个 10³ 假 labelmap + (1,1,1) 标定。"""
    import nibabel as nib

    arr = np.zeros((10, 10, 10), dtype=np.int32)
    arr[2:8, 2:8, 2:8] = 1  # 肝 216 体素
    arr[0:2, 0:2, 0:2] = 2  # lk 8 体素
    p = str(tmp_path / "label.nii.gz")
    nib.save(nib.Nifti1Image(arr, np.eye(4)), p)
    vol = VolumeMask(id="ct_001", ref="x", classes=LIVER_KIDNEY_CLASSES, path=p)
    det = Detection(primitives=(vol,), model_version="test")
    cal = resolve_ct_calibration((1.0, 1.0, 1.0))
    meas = REGISTRY[TaskType.TOTALSEG_LIVER_KIDNEY].measure(det, cal)
    assert meas.metrics["liver_volume_mm3"].value == pytest.approx(216.0)
    assert meas.metrics["lk_volume_mm3"].value == pytest.approx(8.0)
    # rk 不在 labelmap → 0（不出 hu）
    assert meas.metrics["rk_volume_mm3"].value == 0.0
