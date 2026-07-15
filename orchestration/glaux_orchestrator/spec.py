"""结构化任务规范（U9）——科学内核的**确定性入口契约**（纯类型，无行为）。

编排层的核心不变量：NL 意图先落成一个**明确、可复现、可校验**的 ``TaskSpec``，再由它
驱动内核（读取→标定→分割→测量→产物）。规范本身不含自然语言歧义，LLM/VLM 的所有不确定
都收敛在「NL→规范」这一步（见 :mod:`glaux_orchestrator.intent`）。

**多模态**：任务族的**契约与行为**（几何族 / 测量原语 / 信号词 / 查看器 / 工具）住在
:mod:`glaux_orchestrator.tasks` 的 :data:`~glaux_orchestrator.tasks.REGISTRY`；本模块只留跨任务
通用的**纯规范类型**：任务枚举、落域、任务规范、意图结果——被意图层与驱动层共享，无重依赖。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class TaskType(str, Enum):
    """内核支持的任务族。新增任务 = 在此加一枚 + 在 :data:`tasks.REGISTRY` 登记契约。"""

    FAR_WALL_CCA_IMT = "far_wall_cca_imt"  # 颈动脉远壁内中膜厚度
    FETAL_HC = "fetal_hc"  # 胎儿头围
    TOTALSEG_LIVER_KIDNEY = "totalseg_liver_kidney"  # P6：CT 肝+双肾分割 + 体积/HU mean
    NUCLEI_DETECTION = "nuclei_detection"  # P7：病理 WSI 核检测 + 计数/密度


class Scope(str, Enum):
    """意图相对内核能力的落域——沿用硬拒绝哲学，绝不把不确定静默跑成错结果。"""

    IN_SCOPE = "in_scope"        # 能映射到确定的 TaskSpec
    AMBIGUOUS = "ambiguous"      # 是医学测量意图但目标不明 → 需澄清
    OUT_OF_SCOPE = "out_of_scope"  # 超出当前已注册任务 → 拒绝
    CHAT = "chat"                # 非测量意图（问候/元问题/闲聊）→ 自由对话回复（reason 即回复）


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
