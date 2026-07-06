"""结构化任务规范（U9）——科学内核的**确定性入口契约**。

编排层的核心不变量：NL 意图先落成一个**明确、可复现、可校验**的 ``TaskSpec``，
再由它驱动内核（读取→标定→分割→测量→产物）。规范本身不含自然语言歧义，
LLM/VLM 的所有不确定都收敛在「NL→规范」这一步（见 :mod:`glaux_orchestrator.intent`）。

**多模态**：内核支持一族任务，每个任务由 :class:`TaskDef` 声明其几何族、度量口径、
信号词与人读标签（见 :data:`TASKS` 注册表）。加一种超声测量 = 注册一个 TaskDef +
提供对应几何的测量原语，**上层（意图路由 / 驱动 / 后端 / 前端）全部读注册表、不硬编码**。
v0.2 两个任务：远壁 CCA 内中膜厚度（IMT，壁线对几何）、胎儿头围（HC，闭合椭圆几何）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class TaskType(str, Enum):
    """内核支持的任务族。"""

    FAR_WALL_CCA_IMT = "far_wall_cca_imt"  # 颈动脉远壁内中膜厚度
    FETAL_HC = "fetal_hc"  # 胎儿头围


class GeometryKind(str, Enum):
    """任务的几何族——决定分割输出形态与测量原语。"""

    WALL_PAIR = "wall_pair"  # 两条开放壁线（LI/MA）→ 法向厚度（PDM）
    CLOSED_CONTOUR = "closed_contour"  # 一条闭合轮廓 → 椭圆拟合 → 周长


@dataclass(frozen=True)
class TaskDef:
    """一个任务族的声明式元数据——上层据此路由/展示，避免各处硬编码 if task==...。"""

    task: TaskType
    geometry: GeometryKind
    metric: str  # 主度量代号（IMT / HC）
    unit: str  # 主度量单位
    label_en: str
    label_zh: str
    default_method: str  # 缺省分割适配器名
    signals: tuple[str, ...]  # 规则后端的关键词信号（中英，小写）


# 任务注册表——**新增模态在此登记一行**（+ 对应几何的测量原语）。
TASKS: dict[TaskType, TaskDef] = {
    TaskType.FAR_WALL_CCA_IMT: TaskDef(
        task=TaskType.FAR_WALL_CCA_IMT,
        geometry=GeometryKind.WALL_PAIR,
        metric="IMT",
        unit="mm",
        label_en="Carotid far-wall IMT",
        label_zh="颈动脉远壁 IMT",
        default_method="caroSegDeep",
        signals=(
            "imt", "intima", "media", "内中膜", "颈动脉", "cca", "carotid",
            "far wall", "far-wall", "远壁", "内膜", "中膜",
        ),
    ),
    TaskType.FETAL_HC: TaskDef(
        task=TaskType.FETAL_HC,
        geometry=GeometryKind.CLOSED_CONTOUR,
        metric="HC",
        unit="mm",
        label_en="Fetal head circumference",
        label_zh="胎儿头围",
        default_method="ellipse-fit",
        signals=(
            "hc", "head circumference", "头围", "胎儿", "fetal", "skull", "颅骨",
            "biparietal", "bpd", "双顶径", "颅围", "胎头",
        ),
    ),
}


def task_for_signals(text: str) -> TaskType | None:
    """文本命中哪个任务的信号词；命中多个时按注册顺序（IMT 优先）取第一个。"""
    low = (text or "").lower()
    for task, td in TASKS.items():
        if any(sig in low for sig in td.signals):
            return task
    return None


class Scope(str, Enum):
    """意图相对内核能力的落域——沿用硬拒绝哲学，绝不把不确定静默跑成错结果。"""

    IN_SCOPE = "in_scope"        # 能映射到确定的 TaskSpec
    AMBIGUOUS = "ambiguous"      # 是医学测量意图但目标不明 → 需澄清
    OUT_OF_SCOPE = "out_of_scope"  # 超出 v0 能力（非颈动脉 IMT）→ 拒绝


@dataclass(frozen=True)
class TaskSpec:
    """驱动内核的结构化规范。字段确定、可复现、可序列化。

    ``cubs_cf`` 为 None 表示标定留给标定层裁决（可能硬拒绝）；``roi`` 为可选列区间。
    """

    task: TaskType
    image_path: str | None = None
    cubs_cf: float | None = None
    roi: tuple[int, int] | None = None
    method: str = "stub"  # 分割适配器名（stub / carosegdeep / ...）

    def __post_init__(self) -> None:
        if not isinstance(self.task, TaskType):
            raise ValueError(f"未知任务类型：{self.task!r}")
        if self.roi is not None:
            x0, x1 = self.roi
            if x1 <= x0:
                raise ValueError(f"ROI 列区间非法：{self.roi}")
        if self.cubs_cf is not None and not (self.cubs_cf > 0):
            raise ValueError(f"cubs_cf 须为正或 None：{self.cubs_cf}")


@dataclass(frozen=True)
class IntentResult:
    """NL→规范的结果。``IN_SCOPE`` 时 ``spec`` 非空；否则 ``spec`` 为 None 且给出原因。"""

    scope: Scope
    spec: TaskSpec | None
    reason: str
    backend: str = "rule-based"

    def __post_init__(self) -> None:
        if self.scope is Scope.IN_SCOPE and self.spec is None:
            raise ValueError("IN_SCOPE 必须携带 TaskSpec")
        if self.scope is not Scope.IN_SCOPE and self.spec is not None:
            raise ValueError("非 IN_SCOPE 不应携带 TaskSpec（不静默错跑）")
