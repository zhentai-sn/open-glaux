"""分割动作层接口（U4）.

**集成不自研、且模型无关**（计划决策 #2）：所有分割模型实现同一
:class:`ModelAdapter` 契约，输出**曲线原生**的 LI/MA 双边界（非掩膜）。
换/加模型只需新增一个适配器。重算力可经远程 API（``Compute.REMOTE``）。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum

import numpy as np

from glaux_core.contracts import Detection, Polyline
from glaux_core.errors import GlauxError
from glaux_core.io.boundaries import Boundary


class SegmentationBackendUnavailable(GlauxError):
    """适配器所需的后端/权重不可用——显式失败，绝不静默返回空曲线。"""


class Compute(str, Enum):
    LOCAL = "local"
    REMOTE = "remote"  # 重算力经远程 API；本地不强依赖 GPU


@dataclass(frozen=True)
class ROI:
    """测量的列区间（远壁 CCA ~1cm 段）；可选深度带 [y0,y1]。"""

    x0: int
    x1: int
    y0: int | None = None
    y1: int | None = None

    def __post_init__(self) -> None:
        if self.x1 <= self.x0:
            raise ValueError(f"ROI 列区间非法：x0={self.x0} x1={self.x1}")

    @property
    def width(self) -> int:
        return self.x1 - self.x0


@dataclass(frozen=True)
class SegmentationRequest:
    image: np.ndarray  # 灰度 H×W
    roi: ROI | None = None
    compute: Compute = Compute.LOCAL


@dataclass(frozen=True)
class SegmentationResult:
    li: Boundary
    ma: Boundary
    roi_used: ROI
    model_version: str
    meta: dict = field(default_factory=dict)


@dataclass(frozen=True)
class DetectRequest:
    """统一适配器入口请求：给图 + 可选 ROI（输出几何形态由适配器 ``kind`` 决定）。"""

    image: np.ndarray  # 灰度 H×W
    roi: ROI | None = None


class Adapter(ABC):
    """统一适配器契约（多模态）：给图 + ROI，出 :class:`~glaux_core.contracts.Detection`。

    ``kind`` 声明几何族（``"wall_pair"`` / ``"contour"`` / ``"mask"`` …），供驱动层
    （``run_spec``）与任务插件 ``adapter_kind`` 做一次契约校验，替代 ``isinstance`` 联合。
    具体适配器可实现富接口（``segment`` / ``detect``）由基类包成 Detection，或直接覆盖 ``run``。
    """

    name: str = "abstract"
    kind: str = "abstract"

    @abstractmethod
    def run(self, request: DetectRequest) -> Detection:
        raise NotImplementedError


class ModelAdapter(Adapter):
    """壁线对分割适配器契约：给图 + ROI，出 LI/MA 双边界（曲线原生，非掩膜）。"""

    name: str = "abstract"
    kind: str = "wall_pair"

    @abstractmethod
    def segment(self, request: SegmentationRequest) -> SegmentationResult:
        """分割一张图，返回 LI/MA 曲线。缺 ROI 时应自动检测远壁。"""
        raise NotImplementedError

    def run(self, request: DetectRequest) -> Detection:
        """统一入口：调 :meth:`segment`，把 LI/MA 包成 Detection（两条 :class:`Polyline`）。"""
        seg = self.segment(SegmentationRequest(image=request.image, roi=request.roi))
        return Detection(
            primitives=(
                Polyline.from_boundary(seg.li, "LI"),
                Polyline.from_boundary(seg.ma, "MA"),
            ),
            model_version=seg.model_version,
            roi_used=(seg.roi_used.x0, seg.roi_used.x1),
            meta=dict(seg.meta),
        )
