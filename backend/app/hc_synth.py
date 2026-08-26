"""胎儿头围（HC）——**自包含合成数据集**（无需外部下载）的**回退实现**。

真实路径见 :mod:`app.hc_real`（HC18 + CSM 隔离模型）；当 HC18 数据/模型不就绪时，
:mod:`app.hc_dataset` 路由到本模块，使无数据环境/CI 也能演示闭合轮廓几何。**确定性合成**：
由已知真值椭圆栅格化出高回声颅骨环灰度图（+ 轻散斑 + 深度增益背景）。
诚实边界：像素是合成的（明确标注 synthetic），但**下游全为真几何**——
真椭圆检测（阈环→最小二乘拟合，见 BrightRingEllipseAdapter）、真 Ramanujan 周长、
真标定（mm/px）。真值椭圆仅用于① 生成图像 ② 作对照参考（类比 IMT 的 Manual-A1）。

镜像 CUBS 数据接口：``list_ids`` / ``cf_of`` / ``image_png`` / ``image_meta``，
id 前缀 ``hc_`` 与颈动脉 ``tech_`` 区分模态。
"""

from __future__ import annotations

import io
import math
import re
from functools import lru_cache

import numpy as np
from glaux_core.io.contour import Ellipse
from glaux_core.measurement.hc import hc_from_ellipse
from glaux_core.segmentation.base import ROI
from glaux_core.segmentation.contour import BrightRingEllipseAdapter, ContourRequest
from PIL import Image

MODALITY = "fetal_hc"
PREFIX = "hc_"
_ID_RE = re.compile(r"^hc_(\d+)$")

W, H = 640, 480  # 合成图尺寸（W×H）
N = 10  # 演示图数
_METHOD = "ellipse-fit"  # 真检测方法名（对齐任务注册表 default_method）
_GT = "GT-ellipse"  # 参考（真值椭圆）

_adapter = BrightRingEllipseAdapter(percentile=90.0)


def is_hc(image_id: str) -> bool:
    return bool(_ID_RE.match(image_id))


def _index(image_id: str) -> int:
    m = _ID_RE.match(image_id)
    if not m:
        raise KeyError(f"非 HC id：{image_id}")
    return int(m.group(1))


@lru_cache(maxsize=1)
def list_ids() -> list[str]:
    return [f"hc_{i:03d}" for i in range(1, N + 1)]


def gt_ellipse(image_id: str) -> Ellipse:
    """该图的**真值颅骨椭圆**（像素）——确定性随 id 变化（尺寸/长短轴比/旋转/中心）。"""
    i = _index(image_id)
    a = 170.0 + 7.0 * i  # 半长轴 170..240 px
    b = a * (0.70 + 0.012 * (i % 4))  # 半短轴（长短轴比 0.70..0.74）
    theta = math.radians(-12 + 4 * i)
    cx = W / 2 + 8 * math.sin(i)  # 轻微偏心，避免全部居中
    cy = H / 2 + 6 * math.cos(i)
    return Ellipse(cx=cx, cy=cy, a=a, b=b, theta=theta)


def cf_of(image_id: str) -> float:
    """标定 mm/px（确定性随 id 变化，落在生理量级使 HC∈[~150,260]mm）。"""
    i = _index(image_id)
    return round(0.135 + 0.004 * (i % 5), 4)


@lru_cache(maxsize=N)
def _image_array(image_id: str) -> np.ndarray:
    """由真值椭圆栅格化的合成颅脑图（uint8 H×W）：高回声环 + 散斑 + 深度增益背景。"""
    ell = gt_ellipse(image_id)
    rng = np.random.default_rng(_index(image_id) + 1)
    yy, xx = np.mgrid[0:H, 0:W].astype(float)
    ct, st = math.cos(-ell.theta), math.sin(-ell.theta)
    u = ((xx - ell.cx) * ct - (yy - ell.cy) * st) / ell.a
    v = ((xx - ell.cx) * st + (yy - ell.cy) * ct) / ell.b
    r = np.hypot(u, v)

    depth_gain = 30.0 + 25.0 * (yy / H)  # 浅表亮、深部略暗的背景
    img = depth_gain.copy()
    img += np.where(r < 1.0, 22.0 * (1.0 - r), 0.0)  # 颅内轻回声充填
    ring = np.abs(r - 1.0) < 0.11  # 高回声颅骨环（~10% 像素）
    img[ring] = 205.0 + 25.0 * (1.0 - np.abs(r[ring] - 1.0) / 0.11)
    # 中线镰（faint falx）：沿长轴一条细亮线，增真实感（不影响环检测）
    midline = (np.abs(v) < 0.03) & (r < 0.9)
    img[midline] = np.maximum(img[midline], 120.0)
    img = img + rng.normal(0.0, 9.0, img.shape)  # 散斑
    return np.clip(img, 0, 255).astype(np.uint8)


def image_png(image_id: str) -> bytes:
    arr = _image_array(image_id)
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()


def image_size(image_id: str) -> tuple[int, int]:
    _index(image_id)  # 校验 id
    return (W, H)


def image_meta(image_id: str) -> dict:
    return {
        "id": image_id,
        "center": "synthetic-HC",
        "modality": MODALITY,
        "cf": cf_of(image_id),
        "methods": [_METHOD, _GT],
    }


def detect(image_id: str, roi: tuple[int, int] | None = None):
    """真椭圆检测：亮环阈值 + 最小二乘拟合。返回 (points, Ellipse, model_version)。"""
    req_roi = ROI(x0=roi[0], x1=roi[1]) if roi else None
    res = _adapter.detect(ContourRequest(image=_image_array(image_id).astype(float), roi=req_roi))
    return res.points, res.ellipse, res.model_version


def gt_hc_mm(image_id: str) -> float:
    """真值椭圆的头围（mm）——检测偏差对照参考。"""
    return hc_from_ellipse(gt_ellipse(image_id), cf_of(image_id)).hc_mm
