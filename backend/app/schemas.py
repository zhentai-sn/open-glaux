"""§5 后端契约的 pydantic 模型——前后端共享的数据形状（单一事实源）。

这些形状映射 science-core 的领域对象（`glaux_core.tasks.TaskSpec` / `IMTResult` / `Boundary`）。
M0 阶段路由返回 mock，但形状即最终契约，M1 只换实现不换形状。
意图层契约（Scope / InterpretRequest / IntentResult / IntentBackendInfo）已于 2026-08-16 退役。
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, model_validator

log = logging.getLogger("glaux.legacy")

# --- 规范 -------------------------------------------------------------------

# SDD 10 规则 10 / D-14：W1 已把后端的模态字面量比较清零，W2 把 Modality / TaskType 由 Literal
# 放宽为 str，取值由注册表校验（SOURCES / glaux_core.tasks.REGISTRY），不在此手抄一份。


def _known_modality(v: str) -> str:
    from .sources import SOURCES  # 延迟导入：SOURCES 会导入各数据模块

    if v not in SOURCES:
        raise ValueError(f"未注册的模态：{v}（须为 {tuple(SOURCES)}）")
    return v


def _known_task(v: str) -> str:
    from glaux_core.tasks import REGISTRY

    if v not in {t.value for t in REGISTRY}:
        raise ValueError(f"未注册的任务：{v}")
    return v


Modality = Annotated[str, AfterValidator(_known_modality)]
TaskType = Annotated[str, AfterValidator(_known_task)]

#: 过渡字段命中计数（SDD 10 §12：W7 的准入条件是一次完整回归后为 0）。
LEGACY_HITS: Counter[str] = Counter()


# --- 测量 -------------------------------------------------------------------


class IMTResult(BaseModel):
    """对齐口径测量结果（内核 measure 的返回；仅后端内部与金标准对比用）。"""

    mean_mm: float
    max_mm: float
    pdm_mean_mm: float = Field(description="对称 PDM（评测口径）")
    per_column_um: list[float] = Field(default_factory=list)
    n_columns: int = 0


# --- 视觉对象（SDD 10 §9.2） ------------------------------------------------

AxisName = Literal["x", "y", "z", "t", "level"]


class Axis(BaseModel):
    """一条采样轴。

    轴序按 kind 固定：image [x,y]、volume [x,y,z]、slide [x,y,level]、video [x,y,t]。
    """

    name: AxisName
    size: int = Field(gt=0)
    spacing: float | None = None
    unit: str = "px"


class Calibration(BaseModel):
    """标定。``kind`` 是开放集（D-16），``value`` 的形状由 ``kind`` 决定。"""

    kind: str
    value: object
    source: str
    provenance: dict = Field(default_factory=dict)


class Stream(BaseModel):
    """与 axes 正交的附加流声明（D-23）。开放集，当前只有 audio。"""

    kind: str
    sample_rate: int | None = None
    channels: int | None = None
    duration_ms: int | None = None
    codec: str | None = None


class Index(BaseModel):
    """第三轴索引；哪一维有意义由对象的 axes 决定。"""

    z: int | None = None
    t: int | None = None
    level: int | None = None


class Region(BaseModel):
    """判别联合；``box`` 为 (x0, y0, x1, y1)，level-0 或帧像素（D-9）。"""

    kind: Literal["box", "column_window", "slice", "frame_range"]
    x0: int | None = None
    y0: int | None = None
    x1: int | None = None
    y1: int | None = None
    z: int | None = None
    t0: int | None = None
    t1: int | None = None
    seed: dict | None = None

    @model_validator(mode="after")
    def _shape(self):
        need = {
            "box": ("x0", "y0", "x1", "y1"),
            "column_window": ("x0", "x1"),
            "slice": ("z",),
            "frame_range": ("t0", "t1"),
        }[self.kind]
        if any(getattr(self, f) is None for f in need):
            raise ValueError(f"region {self.kind} 需要 {need}")
        if self.kind in ("box", "column_window") and not self.x0 < self.x1:
            raise ValueError("region 须 x0 < x1")
        if self.kind == "box" and not self.y0 < self.y1:
            raise ValueError("region 须 y0 < y1")
        return self


class ReferenceFrame(BaseModel):
    """一帧观测在对象坐标系中的位置：对象坐标 × scale − origin × scale = 帧像素。"""

    object_id: str
    index: Index
    origin: tuple[float, float]
    scale: float
    width: int
    height: int


#: 第三轴名 → kind。image 无第三轴。
_THIRD_AXIS = ("z", "t", "level")


class ObjectMeta(BaseModel):
    """一个视觉对象的元数据——``GET /images?modality=`` 列表元素（SDD 10 §5.1）。

    ``cf`` / ``voxel_spacing_mm`` / ``mpp_um`` / ``dims`` 为过渡字段，由 ``SourceBase`` 从
    ``axes`` / ``calibration`` 单向回填（D-10），W7 删除。``center`` 与 ``methods: list[str]``
    同为过渡形态：前端在 W3 前仍直读二者，W1 保持旧形状（见执行记录 W1）。
    """

    id: str
    kind: Literal["image", "volume", "slide", "video"]
    modality: Modality
    source_id: str
    display_name: str = ""
    axes: list[Axis]
    calibration: Calibration | None = None
    resources: dict[str, str]
    streams: list[Stream] = Field(default_factory=list)
    methods: list[str] = Field(default_factory=list)
    meta: dict = Field(default_factory=dict)
    # 过渡一版（W7 删）
    center: str = ""
    cf: float | None = None
    voxel_spacing_mm: list[float] | None = None
    mpp_um: list[float] | None = None
    dims: list[int] | None = None

    def axis(self, name: str) -> Axis | None:
        return next((a for a in self.axes if a.name == name), None)

    def check_index(self, index: Index) -> None:
        """越界或请求了不存在的轴 → ``ValueError``（上层映射 422）。"""
        for name in _THIRD_AXIS:
            value = getattr(index, name)
            if value is None:
                continue
            ax = self.axis(name)
            if ax is None:
                raise ValueError(f"对象 {self.id} 没有 {name} 轴")
            if not 0 <= value < ax.size:
                raise ValueError(f"{name}={value} 越界（合法范围 0..{ax.size - 1}）")


ImageMeta = ObjectMeta  # 过渡别名一版（W7 删）


# --- 任务与编辑输入（SDD 10 §4.3） --------------------------------------------


class TaskSpec(BaseModel):
    """结构化任务规范——内核入口，字段明确可校验，无 NL 歧义。

    ``image_id`` 字段名保留，语义为对象 id（D-8）。``cubs_cf`` / ``roi`` / ``roi_box`` 为过渡字段，
    由 ``_legacy`` 单向映射为 ``calibration`` / ``region``（D-9：``roi_box`` 为 (x0, y0, x1, y1)），
    命中时 warn 并计数，W7 删除。新字段已给出时对应旧字段整体忽略。
    """

    task: TaskType = "far_wall_cca_imt"
    image_id: str | None = None
    method: str | None = None
    calibration: Calibration | None = None
    region: Region | None = None
    # 过渡一版（W7 删）
    cubs_cf: float | None = Field(default=None, gt=0, description="标定系数 mm/px，须为正")
    roi: tuple[int, int] | None = None  # 列窗 (x0, x1)
    roi_box: tuple[int, int, int, int] | None = None  # 框选 (x0, y0, x1, y1) level-0 px

    @model_validator(mode="after")
    def _legacy(self):
        if self.cubs_cf is not None and self.calibration is None:
            LEGACY_HITS["cubs_cf"] += 1
            log.warning("TaskSpec.cubs_cf 已过渡，映射为 calibration{mm_per_px}")
            self.calibration = Calibration(kind="mm_per_px", value=self.cubs_cf, source="cubs_cf")
        if self.region is None and self.roi_box is not None:
            LEGACY_HITS["roi_box"] += 1
            log.warning("TaskSpec.roi_box 已过渡，映射为 region{box}")
            x0, y0, x1, y1 = self.roi_box
            self.region = Region(kind="box", x0=x0, y0=y0, x1=x1, y1=y1)
        elif self.region is None and self.roi is not None:
            LEGACY_HITS["roi"] += 1
            log.warning("TaskSpec.roi 已过渡，映射为 region{column_window}")
            self.region = Region(kind="column_window", x0=self.roi[0], x1=self.roi[1])
        return self


class TaskMeasureRequest(BaseModel):
    """统一测量（多模态）——前端编辑几何后携任务 + 图元 + 标定重测。

    ``primitives`` 为 :func:`glaux_core.contracts.primitive_to_dict` 的形状（带 kind 判别）。
    标定收 ``Calibration``（开放集，D-16）；``cf`` 为过渡字段，映射为 ``mm_per_px``。
    """

    task: TaskType
    primitives: list[dict] = Field(description="编辑后的几何原语 [{kind,...},...]")
    calibration: Calibration | None = None
    cf: float | None = Field(default=None, gt=0, description="过渡一版：标定系数 mm/px")

    @model_validator(mode="after")
    def _legacy(self):
        if self.calibration is None:
            if self.cf is None:
                raise ValueError("需要 calibration（或过渡字段 cf）")
            LEGACY_HITS["cf"] += 1
            log.warning("TaskMeasureRequest.cf 已过渡，映射为 calibration{mm_per_px}")
            self.calibration = Calibration(kind="mm_per_px", value=self.cf, source="cubs_cf")
        return self


class EditOp(BaseModel):
    """一笔掩膜编辑：``index`` 定位被编辑的切片 / 帧。"""

    index: Index
    class_id: int
    mode: Literal["paint", "erase"] = "paint"
    mask_png: str = Field(description="data:image/png;base64,...")


class EditRequest(BaseModel):
    """``POST /objects/{id}/edits``：``task`` / ``method`` 由前端从 TaskView 取（§7 规则 17）。"""

    task: TaskType
    method: str
    base_seq: int = Field(description="乐观并发基线；与服务端序号不符 → 409")
    ops: list[EditOp] = Field(default_factory=list)


# --- 数据源（注册表 · 文件夹导入） ------------------------------------------


class DataSourceInfo(BaseModel):
    """一个已注册的数据源（builtin / imported / connector）——``GET/POST /datasources`` 契约。"""

    id: str
    name: str
    modality: Modality
    root: str
    origin: Literal["builtin", "imported", "connector"]
    calibration: dict = Field(default_factory=dict)
    status: Literal["active", "needs_calibration", "empty", "planned"]
    # SDD 10 §9.3：几何族、展示标签（label_key 优先，label 兜底）与可导入后缀
    kind: Literal["image", "volume", "slide", "video"]
    label: str = ""
    label_key: str = ""
    importable: list[str] = Field(default_factory=list)


class UploadAccepted(BaseModel):
    """一个受理并落盘的上传文件（SDD 08 §9.2）。``filename`` 只用于回显，不参与任何路径。"""

    id: str
    filename: str
    bytes: int


class UploadRejected(BaseModel):
    """一个被拒的上传文件；``reason`` 为 §9.2 的三值 enum。"""

    filename: str
    reason: Literal["unsupported_type", "too_large", "corrupt"]


class UploadResult(BaseModel):
    """``POST /uploads/images`` 响应：写入的数据源 + 逐文件受理/拒绝清单。"""

    source: DataSourceInfo
    accepted: list[UploadAccepted]
    rejected: list[UploadRejected]


class DatasourceImportRequest(BaseModel):
    """导入一个文件夹为数据源。``path`` 须在服务端白名单根下（防任意目录读）。"""

    path: str
    modality: Modality
    calibration: dict | None = Field(
        default=None, description='标定提示，如 {"mpp":[0.5,0.5]}；缺则 needs_calibration'
    )
    name: str | None = None


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
    """一条能力清单——把模型/数据集/连接器/skill/MCP/知识库按环境四要素（纲领 §六）收成一套。

    layer（取值沿用旧名）：representation = 观测空间 / action = 动作空间 /
           verification = 验证器 / memory = 回合与轨迹。
    v0 只 Model + Dataset + Skill 真接线，Connector/MCP/KnowledgeBase 等先出有类型占位卡。
    """

    id: str
    # model | adapter | skill | mcp | dataset | connector | reference_method |
    # calibration_source | knowledge_base | correction_store
    kind: str
    layer: Literal["representation", "action", "verification", "memory"]
    name: str
    provider: str = ""
    license: str = ""
    status: Literal["active", "installed", "planned"] = "active"
    isolation: str = ""
    desc: str = ""
    tasks: list[str] = Field(default_factory=list)


# --- 修正回流 ----------------------------------------------------------------
