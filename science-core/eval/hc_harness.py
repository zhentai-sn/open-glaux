"""胎儿头围（HC）评测 harness——第二模态的**端到端可发表证明**。

与 IMT 的 :mod:`eval.harness`（壁线对、µm 口径）并列的闭合轮廓评测。对齐 HC18 挑战赛
官方口径：预测椭圆周长 × pixel size = HC(mm)，对 CSV 参考头围做 **Bland-Altman + MAE(mm)**；
再对填充头区掩膜做 **Dice**（预测掩膜 vs GT 椭圆填充，原图坐标系）。

预测来自隔离子进程（.venv-hc CSM）落盘的两份缓存：``<id>-contour.txt``（原图像素轮廓点）
与 ``<id>-mask.png``（原图尺寸填充掩膜）。度量层纯 numpy，不依赖 torch/cv2。

成功阈（据 HC18 文献）：整体 MAE 约 1.7–2.5mm（榜单强方法量级）；Dice ≥ 0.97。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

import numpy as np

from glaux_core.io.contour import fit_ellipse
from glaux_core.io.hc18 import Hc18Dataset, dice, filled_ellipse_mask


@dataclass(frozen=True)
class HcAgreement:
    n: int
    bias_mm: float  # 平均差（预测−参考）
    sd_mm: float  # 差的标准差
    loa_lower_mm: float  # 95% 一致性界下限
    loa_upper_mm: float
    mae_mm: float  # 平均绝对误差
    max_abs_mm: float  # 最大绝对误差
    mean_dice: float | None  # 平均 Dice（无掩膜时 None）


def bland_altman_mm(pred_mm: Sequence[float], ref_mm: Sequence[float]) -> tuple:
    pred = np.asarray(pred_mm, float)
    ref = np.asarray(ref_mm, float)
    if pred.shape != ref.shape or pred.size == 0:
        raise ValueError("pred/ref 需等长且非空")
    diff = pred - ref
    bias = float(diff.mean())
    sd = float(diff.std(ddof=1)) if diff.size > 1 else 0.0
    loa = 1.96 * sd
    return bias, sd, bias - loa, bias + loa, float(np.abs(diff).mean()), float(np.abs(diff).max())


def hc_pred_mm(contour_pts: np.ndarray, pixel_size_mm: float) -> float:
    """轮廓点 → 最小二乘椭圆 → Ramanujan 周长 × pixel size = HC(mm)。"""
    return fit_ellipse(contour_pts).circumference() * pixel_size_mm


def evaluate(
    ds: Hc18Dataset,
    cache_dir,
    image_ids: Sequence[str],
    *,
    with_dice: bool = True,
) -> tuple[HcAgreement, list[dict]]:
    """对给定 image_ids 汇总 HC 一致性 + Dice。缺预测的图跳过（不静默计 0）。

    Dice 口径：管线**交付的拟合椭圆**填充区 vs GT 标注椭圆填充区（原图栅格）——反映实际
    交付几何的重叠，而非 CSM 粗分辨率原始掩膜。返回 (总体指标, 逐图明细)。
    """
    from pathlib import Path

    cache_dir = Path(cache_dir)
    preds, refs, dices, rows = [], [], [], []
    for image_id in image_ids:
        cpath = cache_dir / f"{image_id}-contour.txt"
        if not cpath.is_file():
            continue
        pts = np.loadtxt(cpath)
        if pts.ndim != 2 or pts.shape[0] < 5:
            continue
        ps = ds.pixel_size_mm(image_id)
        pred_ell = fit_ellipse(pts)
        hc_p = pred_ell.circumference() * ps
        hc_r = ds.ref_hc_mm(image_id)
        preds.append(hc_p)
        refs.append(hc_r)

        d = None
        if with_dice:
            w, h = ds.image_size(image_id)  # (w, h) → 掩膜 (h, w)
            pred_mask = filled_ellipse_mask(pred_ell, (h, w))
            gt_mask = filled_ellipse_mask(ds.gt_ellipse(image_id), (h, w))
            d = dice(pred_mask, gt_mask)
            dices.append(d)
        rows.append({"id": image_id, "hc_pred_mm": hc_p, "hc_ref_mm": hc_r,
                     "diff_mm": hc_p - hc_r, "dice": d})

    if not preds:
        raise ValueError("无可评测的预测（缓存为空？）")
    bias, sd, lo, hi, mae, mx = bland_altman_mm(preds, refs)
    agg = HcAgreement(
        n=len(preds), bias_mm=bias, sd_mm=sd, loa_lower_mm=lo, loa_upper_mm=hi,
        mae_mm=mae, max_abs_mm=mx, mean_dice=(float(np.mean(dices)) if dices else None),
    )
    return agg, rows
