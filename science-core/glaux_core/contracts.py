"""跨任务统一信封（多模态脊柱）——检测 / 测量 / 产物的**通用数据形状**。

单任务时代每个任务各有一套 result 与几何原语（``IMTResult`` vs ``HCResult``、
``SegmentationResult`` vs ``ContourResult``），上层因此到处 ``if 模态``。本模块把几何差异
收进带类型的 :data:`Primitive`，把结果收进三个**跨任务通用**的信封：

- :class:`Detection`  —— 所有适配器的统一输出（``primitives`` 承载几何）。
- :class:`Measurement` —— 所有测量原语的统一输出（``metrics`` 字典，不再每任务一个类）。
- :class:`TaskOutput`  —— 驱动层返给上层/后端的**唯一形状**。

于是上层（run_spec / 后端端点 / 前端渲染）只认信封、不认任务：``IMT_mean`` 与 ``hc_mm``
只是 ``metrics`` 字典里不同的键；LI/MA 与椭圆只是 ``primitives`` 里不同的 :data:`Primitive`。

**几何原语**：
- :class:`Polyline` —— 开放折线（LI/MA 壁线）或闭合轮廓（``closed=True``，分割/病理）。
- :class:`EllipseShape` —— 参数化椭圆（HC 颅骨）。
- :class:`Mask` —— 栅格掩膜（病理区域 / labelmap），编码延后，先留不透明引用。
- :class:`VolumeMask` —— 3D 体掩膜（CT labelmap，多类器官，顶层一体），含 :class:`ClassSpec`
  表。前端按 classes 上色；kernel 走 ``path`` 读 NIfTI 数体素算体积/HU mean。
- :class:`PointSet` —— 点集（病理核检测质心，多类），坐标为 WSI level-0 px；含 :class:`ClassSpec`
  表 + 每点 class_id + 可选 ``roi``（框选区域，算密度用）。前端按 class 上色画质心；
  kernel 数点算计数/密度。

**帧/层绑定**（SDD 10）：每个原语带可选 ``at``——一个 ``Index`` dict（``{"t": 10}`` /
``{"z": 3}`` / ``{"level": 0}``），语义由对象 kind 决定（video=t / volume=z / slide=level）。
``None`` 表示不绑定索引（与 2D 现状兼容），序列化时省略该键。视频帧级几何复用既有原语 +
``at``，不另立逐帧类型；新几何形状（如 Keypoints）才需在此追加 dataclass 并在
:func:`primitive_to_dict` / :func:`primitive_from_dict` 补分支，上层无需改动。

:class:`Detection` 的 ``region`` 是 SDD 10 ``Region`` 判别联合的 dict 形态。
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Union

from glaux_core.calibration.calibration import CalibrationResult
from glaux_core.io.boundaries import Boundary
from glaux_core.io.contour import Ellipse

Point = tuple[float, float]


# --- 几何原语（Primitive） ---------------------------------------------------


@dataclass(frozen=True)
class Polyline:
    """一条折线：开放（LI/MA 壁线）或闭合轮廓（``closed=True``，分割/病理）。

    ``role`` 标识语义角色（``"LI"`` / ``"MA"`` / ``"contour"`` …），供前端按
    overlay_spec 上色与判定是否可编辑。坐标为像素。
    """

    id: str
    role: str
    points: tuple[Point, ...]
    closed: bool = False
    at: dict | None = None  # SDD 10：Index（{"t": 10} / {"z": 3}），None=不绑定

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
    at: dict | None = None  # SDD 10：Index，None=不绑定

    @classmethod
    def from_ellipse(cls, e: Ellipse, id: str = "ellipse", role: str = "ellipse") -> "EllipseShape":
        """由内核 :class:`~glaux_core.io.contour.Ellipse` 构造。"""
        return cls(
            id=id, cx=float(e.cx), cy=float(e.cy),
            a=float(e.a), b=float(e.b), theta=float(e.theta), role=role,
        )


@dataclass(frozen=True)
class Mask:
    """栅格掩膜（病理区域 / 2D 分割）——引用式：ref 指向 PNG/RLE 存储，几何不进 JSON 本体。

    自 SDD 04 起为正式原语（不再是占位）：2D brush 产物落 ``/annotations``（kind=mask）时用。
    """

    id: str
    ref: str  # 不透明引用（png 路径 / rle id …）
    role: str = "mask"
    at: dict | None = None  # SDD 10：Index，None=不绑定


@dataclass(frozen=True)
class Bbox:
    """轴对齐包围框（通用标注）：左上 ``(x0, y0)`` 到右下 ``(x1, y1)``，像素坐标。

    SDD 04 新增：自由标注 bbox 与 WSI 框选（on_commit 触发检测）共用；
    不参与任务测量（任务绑定几何归 Detection 管线，见 SDD 04 D-14）。
    """

    id: str
    x0: float
    y0: float
    x1: float
    y1: float
    role: str = "bbox"
    at: dict | None = None  # SDD 10：Index，None=不绑定

    def __post_init__(self) -> None:
        if self.x1 <= self.x0 or self.y1 <= self.y0:
            raise ValueError(f"Bbox 区间非法：({self.x0}, {self.y0}) → ({self.x1}, {self.y1})")


@dataclass(frozen=True)
class ClassSpec:
    """3D 体掩膜中一个器官类的元数据（id + 双语标签 + 颜色 + 是否可量）。"""

    class_id: int  # 0=背景, 1=肝, 2=左肾, 3=右肾 …
    role: str      # "liver" | "lk" | "rk" | …（与 task overlay_spec 对齐）
    label_zh: str
    label_en: str
    color: str     # "#FF8A5B" 等
    measurable: bool = True  # 体积/HU mean 等是否可量


@dataclass(frozen=True)
class VolumeMask:
    """3D 体掩膜（CT labelmap，多类器官，顶层一体）。

    - ``ref``：客户端拉 labelmap 的 URL（``/api/volume/{vid}/labelmap?task=…``）——下发前端。
    - ``classes``：该体掩膜包含的器官类表（前端按 class_spec 上色 + 面板列字段）。
    - ``raw_ref``：可选原始 CT 的 **URL**（``/api/volume/{vid}/raw``）——下发前端（画笔参考）。
    - ``path``：labelmap 本地 NIfTI **文件路径**——后端构造 Detection 时填，measure 数体素读；
      前端忽略（不下发，避免泄露文件系统布局）。
    - ``raw_path``：原始 CT 本地 NIfTI **文件路径**——measure 算 HU mean 读；前端忽略（不下发）。
      与 ``raw_ref``（URL）刻意区分：measure 走 fs 路径，前端走 URL，不可混用
      （历史 bug：kernel 曾把 URL 塞进 measure 读的字段 → ``nib.load(url)`` FileNotFoundError）。
    """

    id: str
    ref: str
    classes: tuple[ClassSpec, ...]
    raw_ref: str | None = None
    path: str | None = None
    raw_path: str | None = None
    at: dict | None = None  # SDD 10：Index，None=不绑定


@dataclass(frozen=True)
class PointSet:
    """点集（病理核检测质心，多类，顶层一体）。

    - ``points``：质心坐标 ``((x,y), ...)``，WSI **level-0 像素**（全分辨率）——与 US Polyline 存 px 同理。
    - ``point_class_ids``：与 ``points`` 等长的每点类别 id（类别无关模型全填同一 id）。
    - ``classes``：类别表（前端按 class 上色 + 面板列 per-class 计数）。
    - ``roi``：可选框选区域 ``(x0, y0, x1, y1)`` level-0 px——算核密度（count / 面积 mm²）用；
      缺失则密度不可算（measure 硬拒绝）。ROI 存在 primitive 上（自带），不依赖 ``Detection.roi_used``。
    """

    id: str
    points: tuple[Point, ...]
    point_class_ids: tuple[int, ...]
    classes: tuple[ClassSpec, ...]
    roi: tuple[float, float, float, float] | None = None
    role: str = "nuclei"
    at: dict | None = None  # SDD 10：Index，None=不绑定

    def __post_init__(self) -> None:
        if len(self.points) != len(self.point_class_ids):
            raise ValueError(
                f"PointSet points({len(self.points)}) 与 point_class_ids"
                f"({len(self.point_class_ids)}) 不等长"
            )


Primitive = Union[Polyline, EllipseShape, Mask, Bbox, VolumeMask, PointSet]


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
    """适配器的统一输出：一组几何原语 + 模型版本 + 所用 ROI / Region。

    ``region``（SDD 10）：``Region`` dict（``{"kind": "box"|"column_window"|...}``）。
    """

    primitives: tuple[Primitive, ...]
    model_version: str
    meta: dict = field(default_factory=dict)
    region: dict | None = None


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
    """一个几何原语 → 带 ``kind`` 判别的 JSON-native dict。``at`` 仅在非 None 时输出。"""
    d = _primitive_body_to_dict(p)
    if p.at is not None:
        d["at"] = dict(p.at)
    return d


def _primitive_body_to_dict(p: Primitive) -> dict:
    if isinstance(p, Polyline):
        return {"kind": "polyline", "id": p.id, "role": p.role,
                "points": p.as_points(), "closed": p.closed}
    if isinstance(p, EllipseShape):
        return {"kind": "ellipse", "id": p.id, "role": p.role,
                "cx": p.cx, "cy": p.cy, "a": p.a, "b": p.b, "theta": p.theta}
    if isinstance(p, Mask):
        return {"kind": "mask", "id": p.id, "role": p.role, "ref": p.ref}
    if isinstance(p, Bbox):
        return {"kind": "bbox", "id": p.id, "role": p.role,
                "x0": p.x0, "y0": p.y0, "x1": p.x1, "y1": p.y1}
    if isinstance(p, VolumeMask):
        d = {
            "kind": "volume_mask", "id": p.id, "ref": p.ref,
            "classes": [
                {"class_id": c.class_id, "role": c.role,
                 "label": {"en": c.label_en, "zh": c.label_zh},
                 "color": c.color, "measurable": c.measurable}
                for c in p.classes
            ],
        }
        if p.raw_ref is not None:
            d["raw_ref"] = p.raw_ref
        # path 是 backend 内部路径，**不下发前端**（避免泄露文件系统布局）
        return d
    if isinstance(p, PointSet):
        d = {
            "kind": "point_set", "id": p.id, "role": p.role,
            "points": [[x, y] for x, y in p.points],
            "point_class_ids": list(p.point_class_ids),
            "classes": [
                {"class_id": c.class_id, "role": c.role,
                 "label": {"en": c.label_en, "zh": c.label_zh},
                 "color": c.color, "measurable": c.measurable}
                for c in p.classes
            ],
        }
        if p.roi is not None:
            d["roi"] = list(p.roi)
        return d
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
        "meta": dict(d.meta),
        "region": dict(d.region) if d.region is not None else None,
    }


def measurement_to_dict(m: Measurement) -> dict:
    """测量信封 → JSON-native dict（供 ``POST /task/measure`` 拖动重测）。"""
    return {
        "metrics": {k: measure_to_dict(v) for k, v in m.metrics.items()},
        "calibration": calibration_to_dict(m.calibration),
        "overlays": [primitive_to_dict(p) for p in m.overlays],
    }


def primitive_from_dict(d: dict) -> Primitive:
    """带 ``kind`` 判别的 dict → 几何原语（``POST /task/measure`` 反序列化前端编辑后的图元）。

    ``at``（SDD 10 Index）存在时一并读回；缺省为 None。
    """
    p = _primitive_body_from_dict(d)
    at = d.get("at")
    if at is not None:
        p = replace(p, at=dict(at))
    return p


def _primitive_body_from_dict(d: dict) -> Primitive:
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
    if kind == "bbox":
        return Bbox(
            id=d["id"],
            x0=float(d["x0"]), y0=float(d["y0"]),
            x1=float(d["x1"]), y1=float(d["y1"]),
            role=d.get("role", "bbox"),
        )
    if kind == "volume_mask":
        return VolumeMask(
            id=d["id"],
            ref=d["ref"],
            classes=tuple(
                ClassSpec(
                    class_id=int(c["class_id"]),
                    role=c["role"],
                    label_zh=c["label"]["zh"],
                    label_en=c["label"]["en"],
                    color=c["color"],
                    measurable=bool(c.get("measurable", True)),
                )
                for c in d["classes"]
            ),
            raw_ref=d.get("raw_ref"),
        )
    if kind == "point_set":
        roi = d.get("roi")
        return PointSet(
            id=d["id"],
            points=tuple((float(x), float(y)) for x, y in d["points"]),
            point_class_ids=tuple(int(c) for c in d["point_class_ids"]),
            classes=tuple(
                ClassSpec(
                    class_id=int(c["class_id"]),
                    role=c["role"],
                    label_zh=c["label"]["zh"],
                    label_en=c["label"]["en"],
                    color=c["color"],
                    measurable=bool(c.get("measurable", True)),
                )
                for c in d["classes"]
            ),
            roi=tuple(float(v) for v in roi) if roi is not None else None,  # type: ignore[arg-type]
            role=d.get("role", "nuclei"),
        )
    raise ValueError(f"未知 primitive kind：{kind!r}")
