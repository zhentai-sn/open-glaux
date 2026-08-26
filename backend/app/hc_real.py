"""胎儿头围（HC）——**真实 HC18 数据 + CSM 隔离模型**实现（M1 真实接入）。

镜像 IMT 的分层：数据侧（列图 / PNG / 标定 / 参考 HC）读 science-core 的
:class:`glaux_core.io.hc18.Hc18Dataset`，纯 numpy/PIL；模型侧走 **缓存优先 + .venv-hc
隔离子进程**（CSM，torch/cv2 只存在于该子进程，FastAPI 主进程绝不 import）。

- 参考头围来自 HC18 官方 CSV（``head circumference (mm)``，挑战赛口径）。
- 分割用 HuggingFace ``gauravxthakur/Fetal-Head-Biometry`` 的 CSM（Apache-2.0）；
  子进程产出原图坐标的颅骨轮廓点，主进程 :func:`fit_ellipse` → Ramanujan 周长 × pixel size。
- 缺缓存又缺隔离环境 → 显式失败（不静默假造 HC）。
"""

from __future__ import annotations

import subprocess
from functools import lru_cache

import numpy as np

# science-core（经 config 挂上 sys.path）——纯 numpy/PIL，主进程无 torch/cv2。
from glaux_core.io.contour import fit_ellipse  # noqa: E402
from glaux_core.io.hc18 import Hc18Dataset  # noqa: E402

from . import config

_METHOD = "CSM"  # 真分割方法名（对齐 UI 模型注册表）
_GT = "GT-ellipse"  # 参考（HC18 标注椭圆）


class HcSegmentUnavailable(RuntimeError):
    """CSM 既无缓存又无隔离环境可现算——显式失败，不静默假造轮廓。"""


@lru_cache(maxsize=1)
def _ds() -> Hc18Dataset:
    return Hc18Dataset(config.HC18_ROOT)


def is_hc(image_id: str) -> bool:
    """是否本数据集内的真实 HC18 image_id。"""
    try:
        return image_id in set(_ds().list_ids())
    except Exception:
        return False


def list_ids() -> list[str]:
    return _ds().list_ids()


def cf_of(image_id: str) -> float:
    """标定 mm/px（HC18 CSV 的 pixel size）。"""
    return _ds().pixel_size_mm(image_id)


def image_png(image_id: str) -> bytes:
    return _ds().image_png(image_id)


def image_size(image_id: str) -> tuple[int, int]:
    return _ds().image_size(image_id)


def image_meta(image_id: str) -> dict:
    return {
        "id": image_id,
        "center": "HC18",
        "modality": "fetal_hc",
        "cf": cf_of(image_id),
        "methods": [_METHOD, _GT],
    }


def gt_hc_mm(image_id: str) -> float:
    """官方参考头围（mm）——检测偏差对照。"""
    return _ds().ref_hc_mm(image_id)


def _cached_contour(image_id: str):
    p = config.HC_SEG_CACHE / f"{image_id}-contour.txt"
    return p if p.is_file() else None


def _run_live(image_id: str, timeout: float) -> None:
    """在 .venv-hc 隔离环境跑 run_headless，产出（轮廓点+掩膜）落进缓存。"""
    config.HC_SEG_CACHE.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(config.HC_SEG_PYTHON),
        str(config.HC_SEG_DRIVER),
        str(_ds().images_dir),
        str(config.HC_SEG_CACHE),
        str(config.HC_SEG_WEIGHTS),
        image_id,
    ]
    subprocess.run(
        cmd,
        cwd=str(config.HC_SEG_DRIVER.parent),
        env={"MPLBACKEND": "Agg", "CUDA_VISIBLE_DEVICES": "-1", "PATH": "/usr/bin:/bin"},
        timeout=timeout,
        capture_output=True,
        text=True,
        check=False,  # 失败由缓存缺失判定 + 上层显式抛
    )


def detect(image_id: str, roi: tuple[int, int] | None = None, timeout: float = 120.0):
    """真分割：缓存优先 + 隔离子进程兜底 → 轮廓点 → 拟合椭圆。

    返回 (points, Ellipse, model_version)。``roi`` 对 CSM 全图头部分割不适用（忽略）。
    """
    cached = _cached_contour(image_id)
    model_version = "CSM (HC18, cached)"
    if cached is None:
        if not config.hc_live_available():
            raise HcSegmentUnavailable(
                f"CSM 无 {image_id} 缓存，且隔离环境不可用（{config.HC_SEG_PYTHON}）"
            )
        _run_live(image_id, timeout)
        cached = _cached_contour(image_id)
        if cached is None:
            raise HcSegmentUnavailable(f"CSM 现算未产出 {image_id}（头部分割可能失败）")
        model_version = "CSM@live"

    pts = np.loadtxt(cached)
    if pts.ndim != 2 or pts.shape[0] < 5:
        raise HcSegmentUnavailable(f"{image_id} 轮廓点不足，无法拟合椭圆")
    return pts, fit_ellipse(pts), model_version
