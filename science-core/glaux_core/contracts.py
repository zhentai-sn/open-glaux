"""跨任务统一信封（多模态脊柱）——检测 / 测量 / 产物的**通用数据形状**。

单任务时代每个任务各有一套 result 与几何原语（``IMTResult`` vs ``HCResult``、
``SegmentationResult`` vs ``ContourResult``），上层因此到处 ``if 模态``。本模块把几何差异
收进带类型的 :data:`Primitive`，把结果收进三个**跨任务通用**的信封：

- :class:`Detection`  —— 所有适配器的统一输出（``primitives`` 承载几何）。
- :class:`Measurement` —— 所有测量原语的统一输出（``metrics`` 字典，不再每任务一个类）。
- :class:`TaskOutput`  —— 驱动层返给上层/后端的**唯一形状**。

于是上层（run_spec / 后端端点 / 前端渲染）只认信封、不认任务：``IMT_mean`` 与 ``hc_mm``
只是 ``metrics`` 字典里不同的键；LI/MA 与椭圆只是 ``primitives`` 里不同的 :data:`Primitive`。

**几何原语**（v0.3 落地 Polyline / Ellipse，Mask 留引用式接口位）：
- :class:`Polyline` —— 开放折线（LI/MA 壁线）或闭合轮廓（``closed=True``，分割/病理）。
- :class:`EllipseShape` —— 参数化椭圆（HC 颅骨）。
- :class:`Mask` —— 栅格掩膜（病理区域 / labelmap），编码延后，先留不透明引用。

未来模态（BBox / Keypoints / 3D 体掩膜 / 视频帧掩膜）按需在此追加一个 dataclass +
在 :func:`primitive_to_dict` 补一条分支，上层无需改动。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Union

from glaux_core.calibration.calibration import CalibrationResult
from glaux_core.io.boundaries import Boundary
from glaux_core.io.contour import Ellipse

Point = tuple[float, float]


# --- 几何原语（Primitive） ---------------------------------------------------


@dataclass(frozen=True)
class Polyline:
    """一条折线：开放（LI/MA 壁线）或闭合（``closed=True``，分割/病理轮廓）。

    ``role`` 标识语义角色（``"LI"`` / ``"MA"`` / ``"contour"`` …），供前端按
    overlay_spec 上色与判定是否可编辑。坐标为像素。
    """

    id: str
    role: str
    points: tuple[Point, ...]
    closed: bool = False

    @classmethod
    def from_boundary(cls, b: Boundary, role: str | None = None) -> "Polyline":
        """由内核 :class:`~glaux_core.io.boundaries.Boundary` 折线构造（开放）。"""
        r = role or b.name
        pts = tuple((float(x), float(y)) for x, y in zip(b.x, b.y))
        return cls(id=r, role=r, points=pts, closed=False)

    def as_points(self) -> list[list[float]]:
        """转 ``[[x,y],...]``（送测量 / API 用）。"""
        return [[x, y] for x, y in self.points]


@dataclass(frozen=True)
class EllipseShape:
    """参数化椭圆（HC 颅骨拟合）：中心 (cx,cy)、半长轴 a、半短轴 b、旋转 theta（弧度）。"""

    id: str
    cx: float
    cy: float
    a: float
    b: float
    theta: float
    role: str = "ellipse"

    @classmethod
    def from_ellipse(cls, e: Ellipse, id: str = "ellipse", role: str = "ellipse") -> "EllipseShape":
        """由内核 :class:`~glaux_core.io.contour.Ellipse` 构造。"""
        return cls(
            id=id, cx=float(e.cx), cy=float(e.cy),
            a=float(e.a), b=float(e.b), theta=float(e.theta), role=role,
        )


@dataclass(frozen=True)
class Mask:
    """栅格掩膜（病理区域 / labelmap）——引用式占位，编码（RLE/PNG）延后落地。"""

    id: str
    ref: str  # 不透明引用（png 路径 / rle id …）
    role: str = "mask"


Primitive = Union[Polyline, EllipseShape, Mask]


# --- 结果信封 ----------------------------------------------------------------


@dataclass(frozen=True)
class Measure:
    """一个标量度量 + 单位 + 双语标签（前端泛型渲染面板，不再硬编码字段名）。"""

    value: float
    unit: str
    label_en: str
    label_zh: str


@dataclass(frozen=True)
class Detection:
    """适配器的统一输出：一组几何原语 + 模型版本 + 所用 ROI。"""

    primitives: tuple[Primitive, ...]
    model_version: str
    roi_used: tuple[int, int] | None = None
    meta: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Measurement:
    """测量原语的统一输出：度量字典 + 标定 + 测量副产物（PDM 投影线 / 长短轴…）。"""

    metrics: dict[str, Measure]
    calibration: CalibrationResult
    overlays: tuple[Primitive, ...] = ()


@dataclass(frozen=True)
class TaskOutput:
    """驱动层的唯一产物形状——度量 + 待绘几何 + 标定 + provenance。"""

    task: str
    metrics: dict[str, Measure]
    primitives: tuple[Primitive, ...]
    calibration: CalibrationResult
    provenance: dict = field(default_factory=dict)


# --- 序列化（JSON-native；带 kind 判别，供后端 / 前端） -----------------------


def primitive_to_dict(p: Primitive) -> dict:
    """一个几何原语 → 带 ``kind`` 判别的 JSON-native dict。"""
    if isinstance(p, Polyline):
        return {"kind": "polyline", "id": p.id, "role": p.role,
                "points": p.as_points(), "closed": p.closed}
    if isinstance(p, EllipseShape):
        return {"kind": "ellipse", "id": p.id, "role": p.role,
                "cx": p.cx, "cy": p.cy, "a": p.a, "b": p.b, "theta": p.theta}
    if isinstance(p, Mask):
        return {"kind": "mask", "id": p.id, "role": p.role, "ref": p.ref}
    raise TypeError(f"未知 primitive 类型：{type(p).__name__}")  # pragma: no cover


def measure_to_dict(m: Measure) -> dict:
    return {"value": m.value, "unit": m.unit, "label_en": m.label_en, "label_zh": m.label_zh}


def calibration_to_dict(c: CalibrationResult) -> dict:
    return {"cf": c.cf, "source": c.source.value, "provenance": dict(c.provenance)}


def task_output_to_dict(o: TaskOutput) -> dict:
    """产物信封 → JSON-native dict（后端可直接包成 HTTP 响应）。"""
    return {
        "task": o.task,
        "metrics": {k: measure_to_dict(v) for k, v in o.metrics.items()},
        "primitives": [primitive_to_dict(p) for p in o.primitives],
        "calibration": calibration_to_dict(o.calibration),
        "provenance": dict(o.provenance),
    }


def detection_to_dict(d: Detection) -> dict:
    """检测信封 → JSON-native dict（供 ``POST /task/detect``）。"""
    return {
        "primitives": [primitive_to_dict(p) for p in d.primitives],
        "model_version": d.model_version,
        "roi_used": list(d.roi_used) if d.roi_used is not None else None,
        "meta": dict(d.meta),
    }


def measurement_to_dict(m: Measurement) -> dict:
    """测量信封 → JSON-native dict（供 ``POST /task/measure`` 拖动重测）。"""
    return {
        "metrics": {k: measure_to_dict(v) for k, v in m.metrics.items()},
        "calibration": calibration_to_dict(m.calibration),
        "overlays": [primitive_to_dict(p) for p in m.overlays],
    }


def primitive_from_dict(d: dict) -> Primitive:
    """带 ``kind`` 判别的 dict → 几何原语（``POST /task/measure`` 反序列化前端编辑后的图元）。"""
    kind = d.get("kind")
    if kind == "polyline":
        return Polyline(
            id=d["id"], role=d["role"],
            points=tuple((float(x), float(y)) for x, y in d["points"]),
            closed=bool(d.get("closed", False)),
        )
    if kind == "ellipse":
        return EllipseShape(
            id=d["id"], cx=float(d["cx"]), cy=float(d["cy"]),
            a=float(d["a"]), b=float(d["b"]), theta=float(d["theta"]),
            role=d.get("role", "ellipse"),
        )
    if kind == "mask":
        return Mask(id=d["id"], ref=d["ref"], role=d.get("role", "mask"))
    raise ValueError(f"未知 primitive kind：{kind!r}")
