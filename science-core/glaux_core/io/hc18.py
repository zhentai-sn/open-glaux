"""HC18 挑战赛数据读取——胎儿头围（HC）第二模态的**真实数据事实源**。

磁盘格式（Zenodo record 1327317，CC-BY-4.0，2026-07-07 下载核对）：

- 图像   ``training_set/<id>.png``（灰度，多为 800×540；含多切面命名 ``NNN_HC`` /
         ``NNN_2HC`` / ``NNN_3HC``）
- 标注   ``training_set/<id>_Annotation.png``——颅骨**椭圆轮廓线**（白≈3px 宽，黑底）
- 清单   ``training_set_pixel_size_and_HC.csv``：``filename, pixel size(mm), head circumference (mm)``
         999 行为权威图像清单 + 标定(mm/px) + 参考头围(mm)。

与 CUBS（:mod:`glaux_core.io.cubs`，颈动脉壁线对）并列的闭合轮廓数据源：本模块**只读数据**、
模型无关（纯 numpy/PIL），标注→GT 椭圆用 :func:`glaux_core.io.contour.fit_ellipse`。GT 头围
以 CSV 的 ``head circumference (mm)`` 为准（挑战赛官方口径 = 标注椭圆周长×pixel size）。
"""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

from glaux_core.io.contour import Ellipse, fit_ellipse

MODALITY = "fetal_hc"
_ANNOT_SUFFIX = "_Annotation.png"
# HC18 图像名：<base>HC，base 形如 000_ / 032_2 / 063_3；id = 去 .png 的文件名
_ID_RE = re.compile(r"^\d+_\d*HC$")


@dataclass(frozen=True)
class Hc18Record:
    image_id: str  # 去 .png 的文件名，如 000_HC / 032_2HC
    image_path: Path
    annotation_path: Path
    pixel_size_mm: float  # mm/pixel（标定）
    ref_hc_mm: float  # 官方参考头围（mm）


class Hc18Dataset:
    """HC18 训练集读取器。``root`` 下含 ``training_set/`` 与 ``*_pixel_size_and_HC.csv``。"""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self.images_dir = self.root / "training_set" / "training_set"
        self.csv_path = self.root / "training_set_pixel_size_and_HC.csv"

    def available(self) -> bool:
        return self.images_dir.is_dir() and self.csv_path.is_file()

    @lru_cache(maxsize=1)
    def _rows(self) -> dict[str, tuple[float, float]]:
        """image_id → (pixel_size_mm, ref_hc_mm)，来自权威 CSV。"""
        out: dict[str, tuple[float, float]] = {}
        with open(self.csv_path, newline="") as f:
            for row in csv.DictReader(f):
                image_id = row["filename"][:-4]  # 去 .png
                out[image_id] = (float(row["pixel size(mm)"]), float(row["head circumference (mm)"]))
        return out

    def list_ids(self) -> list[str]:
        """有图有 CSV 记录的 image_id（排序）。"""
        rows = self._rows()
        return sorted(i for i in rows if (self.images_dir / f"{i}.png").is_file())

    def record(self, image_id: str) -> Hc18Record:
        ps, hc = self._rows()[image_id]
        return Hc18Record(
            image_id=image_id,
            image_path=self.images_dir / f"{image_id}.png",
            annotation_path=self.images_dir / f"{image_id}{_ANNOT_SUFFIX}",
            pixel_size_mm=ps,
            ref_hc_mm=hc,
        )

    def pixel_size_mm(self, image_id: str) -> float:
        return self._rows()[image_id][0]

    def ref_hc_mm(self, image_id: str) -> float:
        return self._rows()[image_id][1]

    def image_png(self, image_id: str) -> bytes:
        """原始灰度 PNG 字节（前端画布用）。"""
        with Image.open(self.images_dir / f"{image_id}.png") as im:
            buf = io.BytesIO()
            im.convert("L").save(buf, format="PNG")
            return buf.getvalue()

    def image_size(self, image_id: str) -> tuple[int, int]:
        with Image.open(self.images_dir / f"{image_id}.png") as im:
            return im.size  # (w, h)

    def gt_outline_points(self, image_id: str) -> np.ndarray:
        """GT 标注椭圆轮廓线的白像素 (N,2) x=列 y=行（原图坐标）。"""
        with Image.open(self.images_dir / f"{image_id}{_ANNOT_SUFFIX}") as im:
            arr = np.asarray(im.convert("L"))
        ys, xs = np.where(arr > 127)
        return np.column_stack([xs, ys]).astype(float)

    def gt_ellipse(self, image_id: str) -> Ellipse:
        """对 GT 轮廓线拟合的真值椭圆（原图像素）。"""
        return fit_ellipse(self.gt_outline_points(image_id))


def filled_ellipse_mask(ell: Ellipse, shape: tuple[int, int]) -> np.ndarray:
    """把椭圆栅格化为填充布尔掩膜。``shape`` = (H, W)。"""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    ct, st = math.cos(-ell.theta), math.sin(-ell.theta)
    u = ((xx - ell.cx) * ct - (yy - ell.cy) * st) / ell.a
    v = ((xx - ell.cx) * st + (yy - ell.cy) * ct) / ell.b
    return (u * u + v * v) <= 1.0


def dice(a: np.ndarray, b: np.ndarray) -> float:
    """两个布尔掩膜的 Dice 系数（两者全空记 1.0）。"""
    a = np.asarray(a, bool)
    b = np.asarray(b, bool)
    denom = int(a.sum() + b.sum())
    if denom == 0:
        return 1.0
    return 2.0 * int((a & b).sum()) / denom
