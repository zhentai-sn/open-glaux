"""HC 评测 harness 的单元测试——度量自证正确 + 端到端（临时假数据集，CI 安全）。"""

from __future__ import annotations

import math

import numpy as np
import pytest

from eval.hc_harness import bland_altman_mm, evaluate, hc_pred_mm
from glaux_imt.io.contour import Ellipse
from glaux_imt.io.hc18 import Hc18Dataset, filled_ellipse_mask
from PIL import Image


def _poly(ell: Ellipse, n=200) -> np.ndarray:
    return ell.polygon(n)


def test_bland_altman_known_values():
    bias, sd, lo, hi, mae, mx = bland_altman_mm([10.0, 12.0, 11.0], [10.0, 10.0, 10.0])
    assert bias == pytest.approx(1.0)
    assert mae == pytest.approx(1.0)
    assert mx == pytest.approx(2.0)


def test_hc_pred_mm_matches_ramanujan():
    ell = Ellipse(0.0, 0.0, 100.0, 100.0, 0.0)  # 圆，半径 100
    pts = _poly(ell)
    assert hc_pred_mm(pts, 0.1) == pytest.approx(2 * math.pi * 100 * 0.1, rel=1e-3)


def test_perfect_prediction_gives_zero_bias_and_dice_one(tmp_path):
    # 假数据集：GT 椭圆 + CSV；缓存里放"完美预测"= GT 轮廓点 → bias≈0、Dice≈1
    imgdir = tmp_path / "training_set" / "training_set"
    imgdir.mkdir(parents=True)
    ell = Ellipse(120.0, 90.0, 70.0, 50.0, 0.2)
    h, w = 180, 240
    outer = filled_ellipse_mask(ell, (h, w))
    inner = filled_ellipse_mask(Ellipse(120.0, 90.0, 66.0, 46.0, 0.2), (h, w))
    Image.fromarray(((outer & ~inner) * 255).astype("uint8"), "L").save(imgdir / "000_HC_Annotation.png")
    Image.fromarray((outer * 180).astype("uint8"), "L").save(imgdir / "000_HC.png")
    ps = 0.1
    (tmp_path / "training_set_pixel_size_and_HC.csv").write_text(
        "filename,pixel size(mm),head circumference (mm)\n"
        f"000_HC.png,{ps},{ell.circumference() * ps:.4f}\n"
    )
    cache = tmp_path / "cache"
    cache.mkdir()
    np.savetxt(cache / "000_HC-contour.txt", _poly(ell), fmt="%.2f")

    ds = Hc18Dataset(tmp_path)
    agg, rows = evaluate(ds, cache, ds.list_ids(), with_dice=True)
    assert agg.n == 1
    assert agg.mae_mm < 0.2  # 完美预测 → 近零误差（pred/ref 同源于绘制椭圆）
    # Dice：pred 椭圆 vs 从 4px 宽标注环拟合的 GT（半轴略小），0.96+ 已属高度重叠
    assert agg.mean_dice is not None and agg.mean_dice > 0.95
    assert rows[0]["id"] == "000_HC"


def test_evaluate_raises_on_empty_cache(tmp_path):
    imgdir = tmp_path / "training_set" / "training_set"
    imgdir.mkdir(parents=True)
    (tmp_path / "training_set_pixel_size_and_HC.csv").write_text(
        "filename,pixel size(mm),head circumference (mm)\n000_HC.png,0.1,44.0\n"
    )
    ds = Hc18Dataset(tmp_path)
    with pytest.raises(ValueError, match="无可评测"):
        evaluate(ds, tmp_path / "empty_cache", ["000_HC"], with_dice=False)
