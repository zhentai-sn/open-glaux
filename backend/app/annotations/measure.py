"""标注度量（SDD 23 §7.3）：面积与周长，有空间标定时换算为物理单位。

坐标是对象像素（WSI 为 level-0 像素）。``x``、``y`` 轴都有 ``spacing`` 且 ``unit`` 相同时
按间距换算，否则单位为 ``px``。掩膜面积为非零像素数，按 ``(id, seq)`` 缓存解码结果。
"""

from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

from PIL import Image

from ..schemas import ObjectMeta


def spacing_of(meta: ObjectMeta | None) -> tuple[float, float, str]:
    """``(sx, sy, unit)``；无可用标定时为 ``(1, 1, "px")``。"""
    if meta is None:
        return 1.0, 1.0, "px"
    ax, ay = meta.axis("x"), meta.axis("y")
    if (
        ax is not None
        and ay is not None
        and ax.spacing
        and ay.spacing
        and ax.unit == ay.unit
        and ax.unit != "px"
    ):
        return float(ax.spacing), float(ay.spacing), ax.unit
    return 1.0, 1.0, "px"


def _polygon(points: list[list[float]], sx: float, sy: float) -> tuple[float, float]:
    area = 0.0
    perimeter = 0.0
    n = len(points)
    for i in range(n):
        x0, y0 = points[i]
        x1, y1 = points[(i + 1) % n]
        area += x0 * y1 - x1 * y0
        perimeter += math.hypot((x1 - x0) * sx, (y1 - y0) * sy)
    return abs(area) / 2 * sx * sy, perimeter


@lru_cache(maxsize=512)
def _mask_pixels(path: str, seq: int) -> int | None:  # noqa: ARG001 - seq 只参与缓存键
    p = Path(path)
    if not p.is_file():
        return None
    with Image.open(p) as img:
        hist = img.convert("L").histogram()
    return sum(hist) - hist[0]


def measure(row: dict, meta: ObjectMeta | None, root: Path) -> dict | None:
    """一条标注的 ``measures``；点、掩膜文件缺失时返回 None。"""
    sx, sy, unit = spacing_of(meta)
    prim = row["primitive"]
    kind = prim.get("kind")
    perimeter: float | None
    if kind == "bbox":
        w, h = prim["x1"] - prim["x0"], prim["y1"] - prim["y0"]
        area, perimeter = w * h * sx * sy, 2 * (w * sx + h * sy)
    elif kind == "polyline":
        area, perimeter = _polygon(prim["points"], sx, sy)
    elif kind == "mask":
        ref = row.get("mask_ref") or prim.get("ref")
        pixels = _mask_pixels(str(root / ref), row["seq"]) if ref else None
        if pixels is None:
            return None
        area, perimeter = pixels * sx * sy, None
    else:
        return None
    out = {"area": area, "unit": unit, "area_unit": f"{unit}2"}
    if perimeter is not None:
        out["perimeter"] = perimeter
    return out
