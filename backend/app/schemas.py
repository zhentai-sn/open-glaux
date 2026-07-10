"""§5 后端契约的 pydantic 模型——前后端共享的数据形状（单一事实源）。

这些形状映射 science-core / orchestration 的领域对象（`TaskSpec` / `IntentResult` /
`IMTResult` / `Boundary`）。M0 阶段路由返回 mock，但形状即最终契约，M1 只换实现不换形状。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# --- 意图 / 规范 -------------------------------------------------------------

Scope = Literal["in_scope", "ambiguous", "out_of_scope"]
TaskType = Literal["far_wall_cca_imt", "fetal_hc", "totalseg_liver_kidney", "nuclei_detection"]
Modality = Literal["carotid_imt", "fetal_hc", "ct_abdomen", "pathology"]


class TaskSpec(BaseModel):
    """结构化任务规范——内核入口，字段明确可校验，无 NL 歧义。"""

    task: TaskType = "far_wall_cca_imt"
    image_id: str | None = None
    cubs_cf: float | None = Field(default=None, gt=0, description="标定系数 mm/px，须为正")
    roi: tuple[int, int] | None = None  # US：列窗 (x0, x1)
    roi_box: tuple[int, int, int, int] | None = None  # P7 WSI：框选 (x0, y0, x1, y1) level-0 px
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


# --- 测量 -------------------------------------------------------------------

class IMTResult(BaseModel):
    """对齐口径测量结果（内核 measure 的返回；仅后端内部与金标准对比用）。"""

    mean_mm: float
    max_mm: float
    pdm_mean_mm: float = Field(description="对称 PDM（评测口径）")
    per_column_um: list[float] = Field(default_factory=list)
    n_columns: int = 0


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
    voxel_spacing_mm: list[float] | None = None  # P6：CT 模态用（替代 cubs_cf）
    mpp_um: list[float] | None = None  # P7：WSI 模态用（(mpp_x, mpp_y) µm/px）
    dims: list[int] | None = None  # P7：WSI level-0 尺寸 (width, height) px（前端 OSD 用）


# --- 模型（扩展=适配器） -----------------------------------------------------

class ModelInfo(BaseModel):
    id: str
    pub: str
    desc: str
    active: bool
    backend: str
    modality: Modality = "carotid_imt"


# --- 能力（「插件市场」的统一抽象，§5） --------------------------------------

class Capability(BaseModel):
    """一条能力清单——把模型/数据集/连接器/skill/MCP/知识库用「环境四层」本体收成一套。

    layer：representation(表征·数据进来) / action(动作·给项目能力) /
           verification(验证·裁判) / memory(记忆·飞轮)。
    v0 只 Model + Dataset + Skill 真接线，Connector/MCP/KnowledgeBase 等先出有类型占位卡。
    """

    id: str
    kind: str  # model | adapter | skill | mcp | dataset | connector | reference_method | calibration_source | knowledge_base | correction_store
    layer: Literal["representation", "action", "verification", "memory"]
    name: str
    provider: str = ""
    license: str = ""
    status: Literal["active", "installed", "planned"] = "active"
    isolation: str = ""
    desc: str = ""
    tasks: list[str] = Field(default_factory=list)


# --- 修正回流 ----------------------------------------------------------------

class CorrectionRequest(BaseModel):
    image_id: str
    which: Literal["LI", "MA"]
    points: list[list[float]]
    imt: float


class CorrectionResult(BaseModel):
    ok: bool
    provenance: dict
