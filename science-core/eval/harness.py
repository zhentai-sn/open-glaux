"""评测 harness（U8）——阶段 4 的可发表证明.

复现 CUBS 一致性口径：Bland-Altman(bias + 95% LoA, µm)、逐边界 Dice/Hausdorff、
leave-one-center-out 跨中心表。度量在合成 GT 上自证正确（完美预测→bias≈0、
Dice≈1、Hausdorff≈0；已知偏移→bias≈偏移）。

成功阈（据 CUBS 调研）：绝对 CIMT bias ≤160µm（观察者内），理想 ≤110µm
（CREATIS 级）；参考观察者内 160±140µm、观察者间 194±177µm。
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np

from glaux_core.io.boundaries import Boundary, BoundaryPair, common_support, to_mask
from glaux_core.measurement.pdm import imt, polyline_distances
from glaux_core.verification.crosscenter import loco_report

# 专家变异参考阈（µm）
INTRA_OBSERVER_UM = 160.0
INTER_OBSERVER_UM = 194.0
CREATIS_CLASS_UM = 110.0


@dataclass(frozen=True)
class BlandAltman:
    bias_um: float
    sd_um: float
    loa_lower_um: float
    loa_upper_um: float
    abs_bias_mean_um: float
    n: int

    def within_intra_observer(self) -> bool:
        return self.abs_bias_mean_um <= INTRA_OBSERVER_UM


def bland_altman(pred_mm: Sequence[float], ref_mm: Sequence[float]) -> BlandAltman:
    pred = np.asarray(pred_mm, float)
    ref = np.asarray(ref_mm, float)
    if pred.shape != ref.shape or pred.size == 0:
        raise ValueError("pred/ref 需等长且非空")
    diff_um = (pred - ref) * 1000.0
    bias = float(diff_um.mean())
    sd = float(diff_um.std(ddof=1)) if diff_um.size > 1 else 0.0
    loa = 1.96 * sd
    return BlandAltman(
        bias_um=bias,
        sd_um=sd,
        loa_lower_um=bias - loa,
        loa_upper_um=bias + loa,
        abs_bias_mean_um=float(np.abs(diff_um).mean()),
        n=int(diff_um.size),
    )


def _support_range(pair: BoundaryPair) -> tuple[float, float]:
    """一对 LI/MA 的公共支撑 x 区间 [lo, hi]。"""
    cs = common_support(pair.li, pair.ma)
    return float(cs.x.min()), float(cs.x.max())


def paired_imt(pred: BoundaryPair, ref: BoundaryPair, cf: float) -> tuple[float, float]:
    """对齐 CUBS 评测口径：两方法在**跨方法共同 x 支撑**上、用**对称 PDM** 各算 IMT(mm)。

    跨方法比 IMT 必须量同一段血管壁，否则支撑失配污染 bias（如 GT-FAMUS 全宽
    vs 手动局部 ROI）。返回 ``(imt_pred_mm, imt_ref_mm)``，均为对称 polyline
    distance 均值 × CF。二者无足够重叠 → 抛 :class:`ValueError`。
    """
    p_lo, p_hi = _support_range(pred)
    r_lo, r_hi = _support_range(ref)
    lo, hi = max(p_lo, r_lo), min(p_hi, r_hi)
    if hi - lo < 1:
        raise ValueError(f"两方法共同 x 支撑不足：[{lo}, {hi}]")
    win = (lo, hi)
    return (
        imt(pred.li, pred.ma, cf, x_window=win).pdm_mean_mm,
        imt(ref.li, ref.ma, cf, x_window=win).pdm_mean_mm,
    )


def agreement(
    pred: Mapping[str, BoundaryPair],
    ref: Mapping[str, BoundaryPair],
    cf: Mapping[str, float],
) -> BlandAltman:
    """两方法在共同支撑 + 对称 PDM 口径下的 Bland-Altman（观察者内/间、方法 vs 金标准通用）。

    仅取三者交集的 image_id；单图共同支撑不足则跳过（不静默计 0）。
    """
    ids = [i for i in pred if i in ref and i in cf]
    p_mm, r_mm = [], []
    for i in ids:
        try:
            pi, ri = paired_imt(pred[i], ref[i], cf[i])
        except ValueError:
            continue
        p_mm.append(pi)
        r_mm.append(ri)
    return bland_altman(p_mm, r_mm)


def dice_score(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, bool)
    b = np.asarray(b, bool)
    denom = int(a.sum() + b.sum())
    if denom == 0:
        return 1.0
    return 2.0 * int((a & b).sum()) / denom


def hausdorff_distance(a: Boundary, b: Boundary) -> float:
    """两条边界的对称 Hausdorff 距离（像素）。"""
    pa = np.column_stack([a.x, a.y])
    pb = np.column_stack([b.x, b.y])
    return float(max(polyline_distances(pa, pb).max(), polyline_distances(pb, pa).max()))


def boundary_dice(pred: BoundaryPair, ref: BoundaryPair, shape: tuple[int, int]) -> float:
    """内中膜区域 Dice（LI–MA 之间栅格化后比较）。"""
    return dice_score(to_mask(pred.li, pred.ma, shape), to_mask(ref.li, ref.ma, shape))


@dataclass(frozen=True)
class MethodEvaluation:
    bland_altman: BlandAltman
    cross_center: dict[str, dict[str, float]]


def evaluate_method(
    pred_mm: Mapping[str, float],
    ref_mm: Mapping[str, float],
    centers: Mapping[str, str] | None = None,
) -> MethodEvaluation:
    """对一个方法 vs 金标准做 Bland-Altman + LOCO 跨中心表。"""
    ids = [i for i in pred_mm if i in ref_mm]
    ba = bland_altman([pred_mm[i] for i in ids], [ref_mm[i] for i in ids])
    table: dict[str, dict[str, float]] = {}
    if centers:
        abs_err = {i: abs(pred_mm[i] - ref_mm[i]) * 1000.0 for i in ids}
        table = loco_report(abs_err, centers)
    return MethodEvaluation(bland_altman=ba, cross_center=table)
