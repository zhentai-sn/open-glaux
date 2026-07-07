"""HC18 数据读取 + 闭合轮廓几何辅助的单元测试（CI 安全：用临时假数据集，不依赖真实下载）。"""

from __future__ import annotations

import numpy as np
import pytest
from PIL import Image

from glaux_core.io.contour import Ellipse
from glaux_core.io.hc18 import Hc18Dataset, dice, filled_ellipse_mask


def _write_fake(root) -> Ellipse:
    """写一个最小 HC18 样式的临时数据集：一图 + 椭圆轮廓标注 + CSV。"""
    imgdir = root / "training_set" / "training_set"
    imgdir.mkdir(parents=True)
    ell = Ellipse(cx=120.0, cy=90.0, a=70.0, b=50.0, theta=0.2)
    h, w = 180, 240
    outer = filled_ellipse_mask(ell, (h, w))
    inner = filled_ellipse_mask(Ellipse(120.0, 90.0, 66.0, 46.0, 0.2), (h, w))
    ring = outer & ~inner  # 3~4px 宽的椭圆轮廓环（模拟 HC18 标注线）
    Image.fromarray((ring * 255).astype("uint8"), "L").save(imgdir / "000_HC_Annotation.png")
    Image.fromarray((outer * 180).astype("uint8"), "L").save(imgdir / "000_HC.png")
    (root / "training_set_pixel_size_and_HC.csv").write_text(
        "filename,pixel size(mm),head circumference (mm)\n"
        f"000_HC.png,0.1,{ell.circumference() * 0.1:.2f}\n"
    )
    return ell


def test_dataset_reads_manifest_and_gt(tmp_path):
    ell = _write_fake(tmp_path)
    ds = Hc18Dataset(tmp_path)
    assert ds.available()
    assert ds.list_ids() == ["000_HC"]
    assert ds.pixel_size_mm("000_HC") == pytest.approx(0.1)
    assert ds.ref_hc_mm("000_HC") == pytest.approx(ell.circumference() * 0.1, abs=0.05)
    assert ds.image_size("000_HC") == (240, 180)
    assert ds.image_png("000_HC")[:8] == b"\x89PNG\r\n\x1a\n"


def test_gt_ellipse_recovers_drawn_ellipse(tmp_path):
    ell = _write_fake(tmp_path)
    g = Hc18Dataset(tmp_path).gt_ellipse("000_HC")
    assert g.a == pytest.approx(ell.a, abs=2.0)
    assert g.b == pytest.approx(ell.b, abs=2.0)
    assert g.cx == pytest.approx(ell.cx, abs=2.0)


def test_available_false_when_missing(tmp_path):
    assert not Hc18Dataset(tmp_path).available()


def test_dice_identical_is_one_and_empty_overlap_is_zero():
    e = Ellipse(50.0, 50.0, 30.0, 20.0, 0.0)
    m = filled_ellipse_mask(e, (100, 100))
    assert dice(m, m) == 1.0
    assert dice(m, np.zeros((100, 100), bool)) == 0.0  # 一方空 → 0（不静默判等）
    assert dice(np.zeros((4, 4), bool), np.zeros((4, 4), bool)) == 1.0  # 两方空 → 1


def test_dice_partial_overlap_between_zero_and_one():
    a = filled_ellipse_mask(Ellipse(50.0, 50.0, 30.0, 30.0, 0.0), (100, 100))
    b = filled_ellipse_mask(Ellipse(60.0, 50.0, 30.0, 30.0, 0.0), (100, 100))
    assert 0.0 < dice(a, b) < 1.0
