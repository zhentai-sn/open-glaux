"""§5 后端契约的 pydantic 模型——前后端共享的数据形状（单一事实源）。

这些形状映射 science-core / orchestration 的领域对象（`TaskSpec` / `IntentResult` /
`IMTResult` / `Boundary`）。M0 阶段路由返回 mock，但形状即最终契约，M1 只换实现不换形状。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# --- 意图 / 规范 -------------------------------------------------------------

Scope = Literal["in_scope", "ambiguous", "out_of_scope"]
TaskType = Literal["far_wall_cca_imt", "fetal_hc"]
Modality = Literal["carotid_imt", "fetal_hc"]


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
    backend: Literal["rule", "vlm"] = "rule"  # 意图后端：关键词规则 / Claude VLM
    api_key: str | None = None  # VLM 密钥（UI 填入；缺省用服务端 env）
    model: str | None = None  # VLM 模型覆盖


class IntentBackendInfo(BaseModel):
    id: Literal["rule", "vlm"]
    name: str
    available: bool
    reason: str


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


class TaskMeasureRequest(BaseModel):
    """统一测量（多模态）——前端编辑几何后携任务 + 图元 + 标定重测。

    ``primitives`` 为 :func:`glaux_core.contracts.primitive_to_dict` 的形状（带 kind 判别）。
    """

    task: TaskType
    primitives: list[dict] = Field(description="编辑后的几何原语 [{kind,...},...]")
    cf: float = Field(gt=0, description="标定系数 mm/px")


# --- 数据集 / 影像 -----------------------------------------------------------

class ImageMeta(BaseModel):
    id: str
    center: str
    cf: float | None
    methods: list[str] = Field(default_factory=list)
    modality: Modality = "carotid_imt"


# --- 胎儿头围（HC，闭合轮廓模态） -------------------------------------------

class HCEllipse(BaseModel):
    """拟合椭圆（像素）——供前端叠加渲染。"""

    cx: float
    cy: float
    a: float  # 半长轴
    b: float  # 半短轴
    theta: float  # 长轴相对 +x 的旋转（弧度）


class HCMeasureRequest(BaseModel):
    points: list[list[float]] = Field(description="颅骨轮廓逐点 [[x,y],...]，≥5 点")
    cf: float = Field(gt=0, description="标定系数 mm/px")


class HCResult(BaseModel):
    hc_mm: float  # 头围（椭圆周长）
    bpd_mm: float  # 双顶径（短轴）
    ofd_mm: float  # 枕额径（长轴）
    area_mm2: float
    ellipse: HCEllipse  # 拟合椭圆（像素）
    n_points: int = 0


class HCRunRequest(BaseModel):
    image_id: str
    cubs_cf: float | None = Field(default=None, gt=0)
    roi: tuple[int, int] | None = None


class HCRunResult(HCResult):
    """HC 规范驱动结果——检测 + 测量 + provenance + 对真值偏差。"""

    cf: float
    model_version: str = ""
    contour: list[list[float]] = Field(default_factory=list)  # 检测到的环点（叠加/编辑用）
    vs_gt_mm: float | None = None  # 与真值椭圆 HC 的 |bias|（mm）；类比 IMT 的 vs_a1


# --- 模型（扩展=适配器） -----------------------------------------------------

class ModelInfo(BaseModel):
    id: str
    pub: str
    desc: str
    active: bool
    backend: str
    modality: Modality = "carotid_imt"


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
