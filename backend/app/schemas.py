"""§5 后端契约的 pydantic 模型——前后端共享的数据形状（单一事实源）。

这些形状映射 science-core / orchestration 的领域对象（`TaskSpec` / `IntentResult` /
`IMTResult` / `Boundary`）。M0 阶段路由返回 mock，但形状即最终契约，M1 只换实现不换形状。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# --- 意图 / 规范 -------------------------------------------------------------

Scope = Literal["in_scope", "ambiguous", "out_of_scope"]
TaskType = Literal["far_wall_cca_imt"]


class TaskSpec(BaseModel):
    """结构化任务规范——内核入口，字段明确可校验，无 NL 歧义。"""

    task: TaskType = "far_wall_cca_imt"
    image_id: str | None = None
    cubs_cf: float | None = Field(default=None, gt=0, description="标定系数 mm/px，须为正")
    roi: tuple[int, int] | None = None
    method: str | None = None


class InterpretRequest(BaseModel):
    nl: str
    lang: Literal["en", "zh"] = "en"
    has_image: bool = False
    image_id: str | None = None
    cubs_cf: float | None = None


class IntentResult(BaseModel):
    """三态守卫的结果——非 in_scope 不带 spec（不静默错跑）。"""

    scope: Scope
    spec: TaskSpec | None = None
    reason: str
    backend: str = "rule_based"


# --- 测量 / 运行 -------------------------------------------------------------

class MeasureRequest(BaseModel):
    li: list[list[float]] = Field(description="LI 边界逐点 [[x,y],...]")
    ma: list[list[float]] = Field(description="MA 边界逐点 [[x,y],...]")
    cf: float = Field(gt=0, description="标定系数 mm/px")
    x_window: tuple[float, float] | None = None


class IMTResult(BaseModel):
    mean_mm: float
    max_mm: float
    pdm_mean_mm: float = Field(description="对称 PDM（评测口径）")
    per_column_um: list[float] = Field(default_factory=list)
    n_columns: int = 0


class TaskResult(IMTResult):
    """run_spec 的结果——测量 + provenance。"""

    cf: float
    cf_source: str = "cubs"
    model_version: str = ""
    roi: tuple[int, int] | None = None
    vs_a1_um: float | None = None  # 与金标准 Manual-A1 的 |bias|（µm）；无 A1 时 None


# --- 数据集 / 影像 -----------------------------------------------------------

class ImageMeta(BaseModel):
    id: str
    center: str
    cf: float | None
    methods: list[str] = Field(default_factory=list)


# --- 模型（扩展=适配器） -----------------------------------------------------

class ModelInfo(BaseModel):
    id: str
    pub: str
    desc: str
    active: bool
    backend: str


# --- 分割 --------------------------------------------------------------------

class SegmentRequest(BaseModel):
    image_id: str
    model: str
    roi: tuple[int, int] | None = None


class SegmentResult(BaseModel):
    li: list[list[float]]
    ma: list[list[float]]
    model_version: str


# --- 修正回流 ----------------------------------------------------------------

class CorrectionRequest(BaseModel):
    image_id: str
    which: Literal["LI", "MA"]
    points: list[list[float]]
    imt: float


class CorrectionResult(BaseModel):
    ok: bool
    provenance: dict
