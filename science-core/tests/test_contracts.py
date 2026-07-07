"""统一信封（contracts）测试——几何原语转换 + 信封构造 + JSON-native 序列化。"""

from __future__ import annotations

import numpy as np

from glaux_core.calibration.calibration import CalibrationResult, CFSource
from glaux_core.contracts import (
    Detection,
    EllipseShape,
    Mask,
    Measure,
    Measurement,
    Polyline,
    TaskOutput,
    detection_to_dict,
    measure_to_dict,
    measurement_to_dict,
    primitive_from_dict,
    primitive_to_dict,
    task_output_to_dict,
)
from glaux_core.io.boundaries import Boundary
from glaux_core.io.contour import Ellipse


def test_polyline_from_boundary_roundtrip():
    b = Boundary(name="LI", x=np.array([0.0, 1.0, 2.0]), y=np.array([5.0, 5.5, 6.0]))
    p = Polyline.from_boundary(b)
    assert p.role == "LI" and p.closed is False
    assert p.as_points() == [[0.0, 5.0], [1.0, 5.5], [2.0, 6.0]]


def test_polyline_role_override_and_closed():
    b = Boundary(name="raw", x=np.array([0.0, 1.0]), y=np.array([1.0, 2.0]))
    p = Polyline.from_boundary(b, role="contour")
    assert p.role == "contour"
    closed = Polyline(id="c", role="contour", points=((0.0, 0.0), (1.0, 0.0), (1.0, 1.0)), closed=True)
    assert closed.closed is True


def test_ellipse_shape_from_ellipse():
    e = Ellipse(cx=100.0, cy=80.0, a=50.0, b=40.0, theta=0.1)
    s = EllipseShape.from_ellipse(e, id="skull", role="skull")
    assert (s.cx, s.cy, s.a, s.b) == (100.0, 80.0, 50.0, 40.0)
    assert s.role == "skull"


def test_primitive_to_dict_tagged_by_kind():
    poly = Polyline(id="LI", role="LI", points=((0.0, 1.0), (2.0, 3.0)))
    ell = EllipseShape(id="e", cx=1.0, cy=2.0, a=3.0, b=4.0, theta=0.0)
    mask = Mask(id="m", ref="mask://123")
    assert primitive_to_dict(poly)["kind"] == "polyline"
    assert primitive_to_dict(poly)["points"] == [[0.0, 1.0], [2.0, 3.0]]
    assert primitive_to_dict(ell)["kind"] == "ellipse"
    assert primitive_to_dict(mask) == {"kind": "mask", "id": "m", "role": "mask", "ref": "mask://123"}


def test_measure_to_dict():
    m = Measure(value=0.918, unit="mm", label_en="IMT mean", label_zh="平均 IMT")
    assert measure_to_dict(m) == {
        "value": 0.918, "unit": "mm", "label_en": "IMT mean", "label_zh": "平均 IMT",
    }


def test_detection_and_measurement_envelopes():
    det = Detection(
        primitives=(Polyline(id="LI", role="LI", points=((0.0, 0.0),)),),
        model_version="stub@0",
        roi_used=(10, 90),
    )
    assert det.model_version == "stub@0" and det.roi_used == (10, 90)
    meas = Measurement(
        metrics={"IMT_mean": Measure(0.9, "mm", "IMT mean", "平均 IMT")},
        calibration=CalibrationResult(cf=0.06, source=CFSource.CUBS),
    )
    assert meas.overlays == ()
    assert meas.metrics["IMT_mean"].value == 0.9


def test_task_output_to_dict_shape():
    out = TaskOutput(
        task="far_wall_cca_imt",
        metrics={
            "IMT_mean": Measure(0.918, "mm", "IMT mean", "平均 IMT"),
            "IMT_max": Measure(1.02, "mm", "IMT max", "最大 IMT"),
        },
        primitives=(
            Polyline(id="LI", role="LI", points=((0.0, 5.0), (1.0, 5.5))),
            Polyline(id="MA", role="MA", points=((0.0, 6.0), (1.0, 6.5))),
        ),
        calibration=CalibrationResult(cf=0.0559, source=CFSource.CUBS, provenance={"cf": 0.0559}),
        provenance={"model_version": "caroSegDeep@cached"},
    )
    d = task_output_to_dict(out)
    assert d["task"] == "far_wall_cca_imt"
    assert set(d["metrics"]) == {"IMT_mean", "IMT_max"}
    assert d["metrics"]["IMT_mean"]["value"] == 0.918
    assert [p["kind"] for p in d["primitives"]] == ["polyline", "polyline"]
    assert d["calibration"] == {"cf": 0.0559, "source": "cubs", "provenance": {"cf": 0.0559}}
    assert d["provenance"]["model_version"] == "caroSegDeep@cached"
    # JSON-native：可被 json 序列化，无自定义类型残留
    import json

    json.dumps(d)


def test_primitive_from_dict_roundtrip():
    for p in (
        Polyline(id="LI", role="LI", points=((0.0, 1.0), (2.0, 3.0)), closed=False),
        EllipseShape(id="e", cx=1.0, cy=2.0, a=3.0, b=4.0, theta=0.5),
        Mask(id="m", ref="mask://1"),
    ):
        again = primitive_from_dict(primitive_to_dict(p))
        assert again == p


def test_primitive_from_dict_unknown_kind_raises():
    import pytest

    with pytest.raises(ValueError):
        primitive_from_dict({"kind": "wat", "id": "x"})


def test_detection_and_measurement_to_dict():
    det = Detection(
        primitives=(Polyline(id="LI", role="LI", points=((0.0, 0.0),)),),
        model_version="stub@0",
        roi_used=(10, 90),
        meta={"k": "v"},
    )
    dd = detection_to_dict(det)
    assert dd["model_version"] == "stub@0" and dd["roi_used"] == [10, 90]
    assert dd["primitives"][0]["kind"] == "polyline" and dd["meta"] == {"k": "v"}

    meas = Measurement(
        metrics={"IMT_mean": Measure(0.9, "mm", "IMT mean", "平均 IMT")},
        calibration=CalibrationResult(cf=0.06, source=CFSource.CUBS),
        overlays=(Polyline(id="pdm", role="pdm", points=((0.0, 0.0), (1.0, 1.0))),),
    )
    md = measurement_to_dict(meas)
    assert md["metrics"]["IMT_mean"]["value"] == 0.9
    assert md["calibration"]["source"] == "cubs"
    assert md["overlays"][0]["role"] == "pdm"
    import json

    json.dumps(dd)
    json.dumps(md)
