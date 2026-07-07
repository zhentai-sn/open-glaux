"""任务插件注册表（多模态脊柱）——把「一个模态的一个任务」打包成一行契约。

单任务时代 :mod:`spec` 的注册表只承载元数据（label/signals），行为仍在驱动层
``if 几何族`` 分派。本模块把**行为**也绑进注册表：每个 :class:`TaskPlugin` 声明其
适配器几何族（``adapter_kind``）、测量原语（``measure`` 可调用）、面板度量、查看器与
标注工具、overlay 画法。于是驱动层（:func:`glaux_orchestrator.run.run_spec`）与后端/前端
**只读注册表、无分支**：

    加一种任务 = 在 :data:`REGISTRY` 登记一行 + 写一个 ``measure`` + 实现一个 ``Adapter``。
    上层（意图路由 / run_spec / 后端端点 / 前端渲染）一行不改。

``measure`` 契约：``(Detection, CalibrationResult) -> Measurement``，从统一 :class:`Detection`
的 primitives 取回几何、调内核测量原语、产出通用 :class:`Measurement`（度量字典）。
**不在此四舍五入**——取整是展示层（后端序列化）的事，保持内核数值原生。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from glaux_core.calibration.calibration import CalibrationResult
from glaux_core.contracts import Detection, EllipseShape, Measure, Measurement, Polyline
from glaux_core.io.boundaries import Boundary
from glaux_core.io.contour import Ellipse
from glaux_core.measurement.hc import hc_from_ellipse as _hc_from_ellipse
from glaux_core.measurement.pdm import imt as _imt

from glaux_orchestrator.spec import TaskType


# --- 前端渲染契约（随 /tasks 下发，前端据此不再 if 模态） ---------------------


@dataclass(frozen=True)
class MetricDef:
    """一个面板度量的声明（键 + 单位 + 双语标签），决定展示字段与顺序。"""

    key: str
    unit: str
    label_en: str
    label_zh: str


@dataclass(frozen=True)
class ToolDef:
    """一个标注工具（替代前端硬编码的 IMT_TOOLS / HC_TOOLS）。"""

    id: str
    glyph: str
    label_en: str
    label_zh: str


@dataclass(frozen=True)
class OverlaySpec:
    """一种 primitive 的画法：语义角色 + 颜色 + 是否可编辑。"""

    role: str
    color: str
    editable: bool = False


@dataclass(frozen=True)
class TaskPlugin:
    """一个任务族的完整契约——元数据 + 行为 + 渲染。新增模态在 :data:`REGISTRY` 登记一行。"""

    task: TaskType
    adapter_kind: str  # 需要的适配器几何族："wall_pair" / "contour" / "mask" / ...
    modality: str  # 数据模态（前端切换器/数据集路由）："carotid_imt" / "fetal_hc" / ...
    label_en: str
    label_zh: str
    signals: tuple[str, ...]  # 规则意图后端的关键词信号（中英，小写）
    default_method: str  # 缺省适配器名
    measure: Callable[[Detection, CalibrationResult], Measurement]
    metrics: tuple[MetricDef, ...]  # 面板度量字段（顺序即展示序）
    viewer: str  # 前端查看器引擎提示："raster_2d" | "volume_3d" | "wsi" | "video"
    tools: tuple[ToolDef, ...]
    overlays: tuple[OverlaySpec, ...]


# --- 测量原语（Detection → Measurement），每任务一个 ------------------------


def _polyline_to_boundary(p: Polyline, name: str) -> Boundary:
    arr = np.asarray(p.points, dtype=float).reshape(-1, 2)
    return Boundary(name=name, x=arr[:, 0], y=arr[:, 1])


def measure_imt(det: Detection, cal: CalibrationResult) -> Measurement:
    """壁线对 → 法向 PDM 厚度：从 Detection 取 LI/MA 两条 Polyline，出 mean/max/对称 PDM。"""
    by_role = {p.role: p for p in det.primitives if isinstance(p, Polyline)}
    if "LI" not in by_role or "MA" not in by_role:
        raise ValueError("IMT 测量需 LI 与 MA 两条壁线 Polyline")
    r = _imt(
        _polyline_to_boundary(by_role["LI"], "LI"),
        _polyline_to_boundary(by_role["MA"], "MA"),
        cal.cf,
        x_window=det.roi_used,  # ROI 列窗（对齐原 /run 口径；None → 全公共支撑）
    )
    return Measurement(
        metrics={
            "IMT_mean": Measure(float(r.mean_mm), "mm", "IMT mean", "平均 IMT"),
            "IMT_max": Measure(float(r.max_mm), "mm", "IMT max", "最大 IMT"),
            "IMT_pdm": Measure(float(r.pdm_mean_mm), "mm", "IMT (sym. PDM)", "IMT（对称 PDM）"),
        },
        calibration=cal,
    )


def measure_hc(det: Detection, cal: CalibrationResult) -> Measurement:
    """闭合轮廓 → 椭圆周长：从 Detection 取拟合椭圆，出 HC/BPD/OFD/面积。"""
    ell_prim = next((p for p in det.primitives if isinstance(p, EllipseShape)), None)
    if ell_prim is None:
        raise ValueError("HC 测量需一枚拟合椭圆 EllipseShape")
    ell = Ellipse(cx=ell_prim.cx, cy=ell_prim.cy, a=ell_prim.a, b=ell_prim.b, theta=ell_prim.theta)
    r = _hc_from_ellipse(ell, cal.cf)
    return Measurement(
        metrics={
            "HC": Measure(float(r.hc_mm), "mm", "Head circumference", "头围"),
            "BPD": Measure(float(r.bpd_mm), "mm", "Biparietal diameter", "双顶径"),
            "OFD": Measure(float(r.ofd_mm), "mm", "Occipitofrontal diameter", "枕额径"),
            "area": Measure(float(r.area_mm2), "mm²", "Ellipse area", "椭圆面积"),
        },
        calibration=cal,
    )


# --- 任务注册表——新增模态在此登记一行 --------------------------------------

REGISTRY: dict[TaskType, TaskPlugin] = {
    TaskType.FAR_WALL_CCA_IMT: TaskPlugin(
        task=TaskType.FAR_WALL_CCA_IMT,
        adapter_kind="wall_pair",
        modality="carotid_imt",
        label_en="Carotid far-wall IMT",
        label_zh="颈动脉远壁 IMT",
        signals=(
            "imt", "intima", "media", "内中膜", "颈动脉", "cca", "carotid",
            "far wall", "far-wall", "远壁", "内膜", "中膜",
        ),
        default_method="caroSegDeep",
        measure=measure_imt,
        metrics=(
            MetricDef("IMT_mean", "mm", "IMT mean", "平均 IMT"),
            MetricDef("IMT_max", "mm", "IMT max", "最大 IMT"),
            MetricDef("IMT_pdm", "mm", "IMT (sym. PDM)", "IMT（对称 PDM）"),
        ),
        viewer="raster_2d",
        tools=(
            ToolDef("cursor", "▸", "Select / Pan", "选择 / 平移"),
            ToolDef("editli", "◠", "Edit LI", "编辑 LI"),
            ToolDef("editma", "◡", "Edit MA", "编辑 MA"),
            ToolDef("reset", "⟲", "Reset to model", "重置为模型输出"),
        ),
        overlays=(
            OverlaySpec("LI", "#4FB0FF", editable=True),
            OverlaySpec("MA", "#FF8A5B", editable=True),
        ),
    ),
    TaskType.FETAL_HC: TaskPlugin(
        task=TaskType.FETAL_HC,
        adapter_kind="contour",
        modality="fetal_hc",
        label_en="Fetal head circumference",
        label_zh="胎儿头围",
        signals=(
            "hc", "head circumference", "头围", "胎儿", "fetal", "skull", "颅骨",
            "biparietal", "bpd", "双顶径", "颅围", "胎头",
        ),
        default_method="ellipse-fit",
        measure=measure_hc,
        metrics=(
            MetricDef("HC", "mm", "Head circumference", "头围"),
            MetricDef("BPD", "mm", "Biparietal diameter", "双顶径"),
            MetricDef("OFD", "mm", "Occipitofrontal diameter", "枕额径"),
            MetricDef("area", "mm²", "Ellipse area", "椭圆面积"),
        ),
        viewer="raster_2d",
        tools=(
            ToolDef("cursor", "▸", "Select / Pan", "选择 / 平移"),
            ToolDef("reset", "⟲", "Re-detect", "重新检测"),
        ),
        overlays=(
            OverlaySpec("skull", "#C39BFF", editable=False),
        ),
    ),
}


def task_for_signals(text: str) -> TaskType | None:
    """文本命中哪个任务的信号词；命中多个时按注册顺序（IMT 优先）取第一个。"""
    low = (text or "").lower()
    for task, plugin in REGISTRY.items():
        if any(sig in low for sig in plugin.signals):
            return task
    return None


def plugin_to_view(plugin: TaskPlugin) -> dict:
    """任务插件 → JSON-native 视图（供后端 ``GET /tasks`` 下发前端；不含 measure 可调用）。"""
    return {
        "task": plugin.task.value,
        "adapter_kind": plugin.adapter_kind,
        "modality": plugin.modality,
        "label": {"en": plugin.label_en, "zh": plugin.label_zh},
        "default_method": plugin.default_method,
        "viewer": plugin.viewer,
        "metrics": [
            {"key": m.key, "unit": m.unit, "label": {"en": m.label_en, "zh": m.label_zh}}
            for m in plugin.metrics
        ],
        "tools": [
            {"id": t.id, "glyph": t.glyph, "label": {"en": t.label_en, "zh": t.label_zh}}
            for t in plugin.tools
        ],
        "overlays": [
            {"role": o.role, "color": o.color, "editable": o.editable} for o in plugin.overlays
        ],
    }
