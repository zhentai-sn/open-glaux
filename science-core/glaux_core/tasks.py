"""任务注册表（多模态脊柱）——「环境能做什么」的单一事实源。

把「一个模态的一个任务」打包成一行契约 :class:`TaskPlugin`：适配器几何族（``adapter_kind``）、
测量原语（``measure`` 可调用）、面板度量、查看器与标注工具、overlay 画法。驱动层、后端端点、
前端渲染、（将来的）智能体工具列表**只读注册表、无分支**：

    加一种任务 = 在 :data:`REGISTRY` 登记一行 + 写一个 ``measure`` + 实现一个 ``Adapter``。
    上层一行不改。

同文件还住着跨任务共享的纯规范类型 :class:`TaskType` / :class:`TaskSpec`——
:class:`TaskSpec` 是科学内核的**确定性入口契约**（字段确定、可复现、可序列化），
不含任何自然语言歧义。

``measure`` 契约：``(Detection, CalibrationResult) -> Measurement``，从统一 :class:`Detection`
的 primitives 取回几何、调内核测量原语、产出通用 :class:`Measurement`（度量字典）。
**不在此四舍五入**——取整是展示层（后端序列化）的事，保持内核数值原生。

历史：本模块由 ``orchestration/glaux_orchestrator/{spec,tasks}.py`` 迁入（2026-08-16，
见 ``docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md`` P1）。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum

import numpy as np

from glaux_core.calibration.calibration import CalibrationResult
from glaux_core.contracts import (
    ClassSpec,
    Detection,
    EllipseShape,
    Measure,
    Measurement,
    Polyline,
)
from glaux_core.io.boundaries import Boundary
from glaux_core.io.contour import Ellipse
from glaux_core.measurement.ct import measure_liver_kidney as _measure_liver_kidney
from glaux_core.measurement.hc import hc_from_ellipse as _hc_from_ellipse
from glaux_core.measurement.nuclei import measure_nuclei as _measure_nuclei
from glaux_core.measurement.pdm import imt as _imt

# --- 纯规范类型：任务枚举 + 任务规范 ------------------------------------------


class TaskType(str, Enum):
    """内核支持的任务族。新增任务 = 在此加一枚 + 在 :data:`REGISTRY` 登记契约。"""

    FAR_WALL_CCA_IMT = "far_wall_cca_imt"  # 颈动脉远壁内中膜厚度
    FETAL_HC = "fetal_hc"  # 胎儿头围
    TOTALSEG_LIVER_KIDNEY = "totalseg_liver_kidney"  # P6：CT 肝+双肾分割 + 体积/HU mean
    NUCLEI_DETECTION = "nuclei_detection"  # P7：病理 WSI 核检测 + 计数/密度


@dataclass(frozen=True)
class TaskSpec:
    """驱动内核的结构化规范。字段确定、可复现、可序列化。

    ``cubs_cf`` 为 None 表示标定留给标定层裁决（可能硬拒绝）；``roi`` 为可选列区间。
    """

    task: TaskType
    image_path: str | None = None
    cubs_cf: float | None = None
    roi: tuple[int, int] | None = None
    method: str = "stub"  # 分割适配器名（stub / carosegdeep / ellipse-fit / ...）

    def __post_init__(self) -> None:
        if not isinstance(self.task, TaskType):
            raise ValueError(f"未知任务类型：{self.task!r}")
        if self.roi is not None:
            x0, x1 = self.roi
            if x1 <= x0:
                raise ValueError(f"ROI 列区间非法：{self.roi}")
        if self.cubs_cf is not None and not (self.cubs_cf > 0):
            raise ValueError(f"cubs_cf 须为正或 None：{self.cubs_cf}")


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
    key: str | None = None


@dataclass(frozen=True)
class OverlaySpec:
    """一种 primitive 的画法：语义角色 + 颜色 + 是否可编辑。"""

    role: str
    color: str
    editable: bool = False


@dataclass(frozen=True)
class TaskPlugin:
    """一个任务族的完整契约——元数据 + 行为 + 渲染。新增模态在 :data:`REGISTRY` 登记一行。

    SDD 04：``tools`` 改用统一工具集合（cursor/bbox/polygon/brush/reset）；新增
    ``capabilities``（引擎能力位：该任务可用的通用标注工具）与 ``on_commit``
    （标注落库后的任务联动钩子，如 WSI bbox → run_task）。

    SDD 10：
    - ``object_kinds``：该任务可作用的对象几何族（ObjectKind：``image``/``volume``/``slide``/
      ``video``）；``run_task`` 用它门控，不做 modality 相等比较（D-13）。
    - ``trigger``：``on_open``（打开对象即跑）/ ``on_region``（框选后跑）/ ``manual``。
    - ``classes``：任务产出的类别表（与 overlays 同步）。
    - ``capabilities``：开放集字符串（``bbox``/``polygon``/``brush``/``wall``/``voi``/
      ``z_scroll``/``timeline``/``verify``），驱动前端工具过滤。
    """

    task: TaskType
    adapter_kind: str  # 需要的适配器几何族："wall_pair" / "contour" / "mask" / ...
    modality: str  # 数据模态（前端切换器/数据集路由）："carotid_imt" / "fetal_hc" / ...
    label_en: str
    label_zh: str
    signals: tuple[str, ...]  # 规则意图后端的关键词信号（中英，小写）
    default_method: str  # 缺省适配器名
    measure: Callable[[Detection, CalibrationResult], Measurement]
    metrics: tuple[MetricDef, ...]  # 面板度量字段（顺序即展示序）
    tools: tuple[ToolDef, ...]
    overlays: tuple[OverlaySpec, ...]
    capabilities: tuple[str, ...] = ()  # 开放集能力位（SDD 04/10），见类 docstring
    on_commit: dict | None = None  # SDD 04：标注落库后钩子，如 {"bbox": {"action": "run_task"}}
    object_kinds: tuple[str, ...] = ()  # SDD 10：ObjectKind（image|volume|slide|video）
    trigger: str = "manual"  # SDD 10：on_open | on_region | manual
    classes: tuple[ClassSpec, ...] = ()  # SDD 10：任务类别表


# --- 测量原语（Detection → Measurement），每任务一个 ------------------------


def _polyline_to_boundary(p: Polyline, name: str) -> Boundary:
    arr = np.asarray(p.points, dtype=float).reshape(-1, 2)
    return Boundary(name=name, x=arr[:, 0], y=arr[:, 1])


def measure_imt(det: Detection, cal: CalibrationResult) -> Measurement:
    """壁线对 → 法向 PDM 厚度：从 Detection 取 LI/MA 两条 Polyline，出 mean/max/对称 PDM。"""
    by_role = {p.role: p for p in det.primitives if isinstance(p, Polyline)}
    if "LI" not in by_role or "MA" not in by_role:
        raise ValueError("IMT 测量需 LI 与 MA 两条壁线 Polyline")
    window = (
        (det.region["x0"], det.region["x1"])
        if det.region and det.region.get("kind") == "column_window"
        else None
    )
    r = _imt(
        _polyline_to_boundary(by_role["LI"], "LI"),
        _polyline_to_boundary(by_role["MA"], "MA"),
        cal.cf,
        x_window=window,
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


# P6：CT 肝+双肾的 ClassSpec 表（REGISTRY 行 classes 引用；后端 build VolumeMask 用）。
LIVER_KIDNEY_CLASSES: tuple[ClassSpec, ...] = (
    ClassSpec(class_id=1, role="liver", label_zh="肝", label_en="Liver",
              color="#FF8A5B", measurable=True),
    ClassSpec(class_id=2, role="lk", label_zh="左肾", label_en="L kidney",
              color="#4FB0FF", measurable=True),
    ClassSpec(class_id=3, role="rk", label_zh="右肾", label_en="R kidney",
              color="#4FB0FF", measurable=True),
)


# P7：病理 WSI 核检测的 ClassSpec 表（与 NUCLEI_DETECTION 行 overlays 同步；后端 build PointSet 用）。
# v0 用 StarDist-HE（类别无关）→ 单类 nucleus；升级 HoVerNet-PanNuke（5 类）时在此扩表 +
# 同步 overlays（neoplastic/inflammatory/connective/dead/epithelial），measure_nuclei 无需改。
NUCLEI_CLASSES: tuple[ClassSpec, ...] = (
    ClassSpec(class_id=1, role="nucleus", label_zh="细胞核", label_en="Nucleus",
              color="#7BE0AD", measurable=True),
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
        tools=(
            ToolDef("cursor", "▸", "Select / Pan", "选择 / 平移", key="v"),
            ToolDef("bbox", "▭", "Bounding box", "框标注", key="r"),
            ToolDef("polygon", "⬠", "Polygon", "多边形标注", key="p"),
            ToolDef("wall", "≈", "Wall edit", "壁线编辑", key="w"),
            ToolDef("brush", "✎", "Brush", "画笔", key="b"),
            ToolDef("reset", "⟲", "Reset to model", "重置为模型输出"),
        ),
        overlays=(
            OverlaySpec("LI", "#4FB0FF", editable=True),
            OverlaySpec("MA", "#FF8A5B", editable=True),
        ),
        # "wall" 是 IMT 专属能力位：壁线形变手柄自成一个工具，不再占用 polygon。
        # polygon 在所有模态一律是自由多边形（落 /annotations），语义不因模态而变。
        capabilities=("bbox", "polygon", "brush", "wall"),
        object_kinds=("image",),
        trigger="on_open",
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
        tools=(
            ToolDef("cursor", "▸", "Select / Pan", "选择 / 平移", key="v"),
            ToolDef("bbox", "▭", "Bounding box", "框标注", key="r"),
            ToolDef("polygon", "⬠", "Polygon", "多边形标注", key="p"),
            ToolDef("brush", "✎", "Brush", "画笔", key="b"),
            ToolDef("reset", "⟲", "Re-detect", "重新检测"),
        ),
        overlays=(
            OverlaySpec("skull", "#C39BFF", editable=False),
        ),
        capabilities=("bbox", "polygon", "brush"),
        object_kinds=("image",),
        trigger="on_open",
    ),
    # P6 楔子：CT 肝+双肾分割（3 类）。几何族 "volume" 走 VolumeMask Primitive；后端
    # _detect_for_spec 的 "volume" 分支派发到 segment_ts.subprocess；tools 含 brush。
    TaskType.TOTALSEG_LIVER_KIDNEY: TaskPlugin(
        task=TaskType.TOTALSEG_LIVER_KIDNEY,
        adapter_kind="volume",
        modality="ct_abdomen",
        label_en="Liver + kidneys (CT, 3 classes)",
        label_zh="肝+双肾 (CT, 3 类)",
        signals=(
            "liver", "kidney", "ct", "abdomen", "腹部", "肝", "肾", "ct", "ct扫描",
            "肝脏", "左肾", "右肾", "器官体积", "organ volume",
        ),
        default_method="totalsegmentator_v2",
        measure=_measure_liver_kidney,  # type: ignore[arg-type]
        metrics=(
            MetricDef("liver_volume_mm3", "mm³", "Liver volume", "肝体积"),
            MetricDef("liver_hu_mean", "HU", "Liver mean HU", "肝平均 HU"),
            MetricDef("lk_volume_mm3", "mm³", "L kidney volume", "左肾体积"),
            MetricDef("lk_hu_mean", "HU", "L kidney mean HU", "左肾平均 HU"),
            MetricDef("rk_volume_mm3", "mm³", "R kidney volume", "右肾体积"),
            MetricDef("rk_hu_mean", "HU", "R kidney mean HU", "右肾平均 HU"),
        ),
        tools=(
            ToolDef("cursor", "▸", "Pan / Zoom", "平移 / 缩放", key="v"),
            ToolDef("bbox", "▭", "Bounding box", "框标注", key="r"),
            ToolDef("polygon", "⬠", "Polygon", "多边形标注", key="p"),
            ToolDef("brush", "✎", "Brush edit", "画笔编辑", key="b"),
            ToolDef("reset", "⟲", "Reset to model", "重置为模型输出"),
        ),
        overlays=(
            OverlaySpec("liver", "#FF8A5B", editable=True),
            OverlaySpec("lk", "#4FB0FF", editable=True),
            OverlaySpec("rk", "#4FB0FF", editable=True),
        ),
        capabilities=("bbox", "polygon", "brush", "voi", "z_scroll"),
        object_kinds=("volume",),
        trigger="on_open",
        classes=LIVER_KIDNEY_CLASSES,
    ),
    # P7 楔子：病理 WSI 细胞核检测 + 计数/密度。几何族 "wsi" 走 PointSet Primitive；后端
    # _detect_for_spec 新加 "wsi" 分支派发到 segment_wsi.subprocess（ROI 抽块 + 质心去重）。
    # 查看器按对象 kind 选用 OpenSeadragon；tools 含 ROI 框选。
    TaskType.NUCLEI_DETECTION: TaskPlugin(
        task=TaskType.NUCLEI_DETECTION,
        adapter_kind="wsi",
        modality="pathology",
        label_en="Nuclei detection (WSI)",
        label_zh="细胞核检测 (病理 WSI)",
        signals=(
            "nuclei", "nucleus", "cell", "细胞核", "细胞", "核检测", "核计数", "核密度",
            "病理", "pathology", "wsi", "全切片", "组织切片", "h&e", "he染色", "cellularity",
        ),
        default_method="stardist_he",
        measure=_measure_nuclei,  # type: ignore[arg-type]
        metrics=(
            MetricDef("nuclei_count", "个", "Nuclei count", "核计数"),
            MetricDef("nuclei_density_mm2", "个/mm²", "Nuclei density", "核密度"),
            MetricDef("roi_area_mm2", "mm²", "ROI area", "ROI 面积"),
        ),
        tools=(
            ToolDef("cursor", "▸", "Pan / Zoom", "平移 / 缩放", key="v"),
            ToolDef("bbox", "▭", "Select ROI", "框选 ROI", key="r"),
            ToolDef("polygon", "⬠", "Polygon", "多边形标注", key="p"),
            ToolDef("reset", "⟲", "Re-detect", "重新检测"),
        ),
        overlays=(
            OverlaySpec("nucleus", "#7BE0AD", editable=False),
        ),
        capabilities=("bbox", "polygon", "verify"),  # brush 无服务端落点，禁用（SDD 04 §7.1）
        on_commit={"bbox": {"action": "run_task"}},  # bbox 落库后触发核检测（SDD 04 §7.3）
        object_kinds=("slide",),
        trigger="on_region",
        classes=NUCLEI_CLASSES,
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
        "metrics": [
            {"key": m.key, "unit": m.unit, "label": {"en": m.label_en, "zh": m.label_zh}}
            for m in plugin.metrics
        ],
        "tools": [
            {
                "id": t.id,
                "glyph": t.glyph,
                "label": {"en": t.label_en, "zh": t.label_zh},
                **({"key": t.key} if t.key else {}),
            }
            for t in plugin.tools
        ],
        "overlays": [
            {"role": o.role, "color": o.color, "editable": o.editable} for o in plugin.overlays
        ],
        "capabilities": list(plugin.capabilities),
        "on_commit": plugin.on_commit,
        "object_kinds": list(plugin.object_kinds),
        "trigger": plugin.trigger,
        "classes": [
            {"class_id": c.class_id, "role": c.role,
             "label": {"en": c.label_en, "zh": c.label_zh},
             "color": c.color, "measurable": c.measurable}
            for c in plugin.classes
        ],
    }
