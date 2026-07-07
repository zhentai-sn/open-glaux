"""任务插件注册表测试——注册完整性、信号路由、测量原语、/tasks 视图。"""

from __future__ import annotations

import json

import pytest

from glaux_core.calibration.calibration import CalibrationResult, CFSource
from glaux_core.contracts import Detection, EllipseShape, Polyline

from glaux_orchestrator.spec import TaskType
from glaux_orchestrator.tasks import (
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
        assert plugin.adapter_kind in {"wall_pair", "contour"}
        assert plugin.viewer == "raster_2d"
        assert callable(plugin.measure)


def test_task_for_signals_routes():
    assert task_for_signals("测远壁颈动脉 IMT") is TaskType.FAR_WALL_CCA_IMT
    assert task_for_signals("estimate fetal head circumference") is TaskType.FETAL_HC
    assert task_for_signals("测头围") is TaskType.FETAL_HC
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
