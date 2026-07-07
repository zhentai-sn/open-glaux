"""边界表征：一条 LI/MA 折线，以及 LI+MA 成对.

`Boundary` 是内核的曲线原生表征——**不是掩膜**。CUBS 把边界存成文本
坐标，本类型直接承载这一形态。折线↔掩膜、公共支撑等几何操作在 U3
（本文件后续追加）。
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


# --- U3 几何：折线重采样 / 公共支撑 / 折线↔掩膜 -------------------------------


@dataclass(frozen=True)
class CommonSupport:
    """LI 与 MA 在公共 x 区间上、逐整数列重采样后的对齐表征。"""

    x: np.ndarray  # 整数列坐标
    li_y: np.ndarray
    ma_y: np.ndarray

    def __len__(self) -> int:
        return int(self.x.size)


def resample_per_column(boundary: Boundary, x_grid: np.ndarray | None = None) -> Boundary:
    """把一条折线线性重采样到整数列（每列一点）。

    CUBS 的 interpolated 版本已是每列一点；本函数用于原始/模型输出的统一化。
    默认网格为覆盖 ``boundary.x`` 的整数列。（pchip 曲线插值留作 ``[interp]`` 增强。）
    """
    if x_grid is None:
        x_grid = np.arange(
            int(np.ceil(boundary.x.min())), int(np.floor(boundary.x.max())) + 1
        )
    order = np.argsort(boundary.x)
    y = np.interp(x_grid, boundary.x[order], boundary.y[order])
    return Boundary(name=boundary.name, x=x_grid.astype(float), y=y)


def common_support(
    li: Boundary, ma: Boundary, x_window: tuple[float, float] | None = None
) -> CommonSupport:
    """在 LI 与 MA 的**公共 x 区间**上逐整数列对齐——PDM 与掩膜的前置。

    ``x_window`` 给定时再与之求交，用于把测量限制到**跨方法共同支撑**
    （对齐 CUBS 论文：不同方法量的是同一段血管壁，否则 bias 不可比）。
    """
    lo = int(np.ceil(max(li.x.min(), ma.x.min())))
    hi = int(np.floor(min(li.x.max(), ma.x.max())))
    if x_window is not None:
        lo = max(lo, int(np.ceil(x_window[0])))
        hi = min(hi, int(np.floor(x_window[1])))
    if hi < lo:
        raise ValueError("LI 与 MA 无公共 x 支撑，无法对齐")
    x = np.arange(lo, hi + 1)
    li_r = resample_per_column(li, x)
    ma_r = resample_per_column(ma, x)
    return CommonSupport(x=x.astype(float), li_y=li_r.y, ma_y=ma_r.y)


def to_mask(li: Boundary, ma: Boundary, shape: tuple[int, int]) -> np.ndarray:
    """把 LI–MA 之间的内中膜区域栅格化为布尔掩膜（供 Dice 等区域度量）。

    ``shape`` = (H, W)。每列填充 [LI_y, MA_y] 之间的行（含端点，四舍五入取整）。
    """
    h, w = shape
    mask = np.zeros((h, w), dtype=bool)
    cs = common_support(li, ma)
    for xc, y_top, y_bot in zip(cs.x, cs.li_y, cs.ma_y):
        col = int(round(xc))
        if not (0 <= col < w):
            continue
        top = int(round(min(y_top, y_bot)))
        bot = int(round(max(y_top, y_bot)))
        top = max(top, 0)
        bot = min(bot, h - 1)
        if bot >= top:
            mask[top : bot + 1, col] = True
    return mask


def mask_to_boundaries(mask: np.ndarray) -> BoundaryPair:
    """从内中膜区域掩膜反解 LI（每列最上像素）/ MA（每列最下像素）。

    供集成"输出掩膜"的模型时把区域反解回曲线原生表征。空列跳过。
    """
    h, w = mask.shape
    xs, li_y, ma_y = [], [], []
    for col in range(w):
        rows = np.flatnonzero(mask[:, col])
        if rows.size == 0:
            continue
        xs.append(float(col))
        li_y.append(float(rows.min()))
        ma_y.append(float(rows.max()))
    if not xs:
        raise ValueError("空掩膜，无法反解边界")
    x = np.asarray(xs)
    return BoundaryPair(
        li=Boundary("LI", x, np.asarray(li_y)),
        ma=Boundary("MA", x, np.asarray(ma_y)),
    )
