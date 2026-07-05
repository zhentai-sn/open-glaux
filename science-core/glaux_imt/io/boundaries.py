"""边界表征：一条 LI/MA 折线，以及 LI+MA 成对.

`Boundary` 是内核的曲线原生表征——**不是掩膜**。CUBS 把边界存成两行
文本（x 行 / y 行），本类型直接承载这一形态。折线↔掩膜、公共支撑等
几何操作在 U3（本文件后续追加）。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Boundary:
    """一条边界折线：``x``（列坐标）与 ``y``（深度）等长的一维数组。

    约定 ``x`` 单调递增（沿图像宽度）。坐标为像素单位；转 mm 由 CF 完成。
    """

    name: str
    x: np.ndarray
    y: np.ndarray

    def __post_init__(self) -> None:
        x = np.asarray(self.x, dtype=float).reshape(-1)
        y = np.asarray(self.y, dtype=float).reshape(-1)
        if x.shape != y.shape:
            raise ValueError(
                f"边界 {self.name!r} 的 x/y 长度不等：{x.shape} vs {y.shape}"
            )
        if x.size == 0:
            raise ValueError(f"边界 {self.name!r} 为空")
        object.__setattr__(self, "x", x)
        object.__setattr__(self, "y", y)

    def __len__(self) -> int:
        return int(self.x.size)


@dataclass(frozen=True)
class BoundaryPair:
    """一次标注/预测里的 LI + MA 两条边界（远壁：LI 在上、MA 在下）。"""

    li: Boundary
    ma: Boundary
