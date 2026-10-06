"""标注度量（SDD 23 §7.3）：框、凹多边形、掩膜；µm、mm 与像素单位。"""

from __future__ import annotations

import pytest
from PIL import Image

from app.annotations.measure import measure, spacing_of
from app.schemas import Axis


class _Meta:
    """度量只读 ``axis(name)``；不构造完整 ObjectMeta。"""

    def __init__(self, *axes: Axis):
        self.axes = list(axes)

    def axis(self, name: str) -> Axis | None:
        return next((a for a in self.axes if a.name == name), None)


def _meta(spacing: float | None, unit: str = "px", sy: float | None = None) -> _Meta:
    return _Meta(
        Axis(name="x", size=1000, spacing=spacing, unit=unit),
        Axis(name="y", size=1000, spacing=sy if sy is not None else spacing, unit=unit),
    )


def _row(prim: dict, **kw) -> dict:
    return {"primitive": prim, "seq": 1, **kw}


def test_bbox_pixels_without_calibration():
    m = measure(_row({"kind": "bbox", "x0": 0, "y0": 0, "x1": 10, "y1": 20}), None, None)
    assert m == {"area": 200.0, "perimeter": 60.0, "unit": "px", "area_unit": "px2"}


def test_concave_polygon_um():
    # L 形：面积 3，周长 8（像素）；0.5 µm/px → 0.75 µm²、4 µm
    pts = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]]
    m = measure(_row({"kind": "polyline", "closed": True, "points": pts}), _meta(0.5, "um"), None)
    assert m["area"] == pytest.approx(0.75) and m["perimeter"] == pytest.approx(4.0)
    assert (m["unit"], m["area_unit"]) == ("um", "um2")


def test_anisotropic_mm_spacing():
    m = measure(
        _row({"kind": "bbox", "x0": 0, "y0": 0, "x1": 3, "y1": 4}), _meta(0.8, "mm", sy=2.0), None
    )
    assert m["area"] == pytest.approx(3 * 4 * 0.8 * 2.0)
    assert m["perimeter"] == pytest.approx(2 * (3 * 0.8 + 4 * 2.0))


def test_mismatched_or_missing_spacing_falls_back_to_pixels():
    meta = _Meta(Axis(name="x", size=10, spacing=1.0, unit="mm"), Axis(name="y", size=10))
    assert spacing_of(meta) == (1.0, 1.0, "px")


def test_mask_counts_nonzero_pixels_and_has_no_perimeter(tmp_path):
    (tmp_path / "masks").mkdir()
    img = Image.new("L", (10, 10), 0)
    for x in range(4):
        for y in range(5):
            img.putpixel((x, y), 255)
    img.save(tmp_path / "masks" / "m1.png")
    m = measure(_row({"kind": "mask"}, mask_ref="masks/m1.png", id="m1"), None, tmp_path)
    assert m == {"area": 20.0, "unit": "px", "area_unit": "px2"}
    assert measure(_row({"kind": "mask"}, mask_ref="masks/none.png"), None, tmp_path) is None


def test_point_has_no_measures():
    assert measure(_row({"kind": "point", "x": 1, "y": 1}), None, None) is None
