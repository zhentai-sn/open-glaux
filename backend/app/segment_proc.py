"""分割适配层（F7）——caroSegDeep 走缓存优先 + 隔离子进程兜底；主进程无 TF。

- 参考方法（GT-FAMUS / Manual-A1 / Computerized-* …）：直接读 on-disk 边界（即时、真实）。
- caroSegDeep：先查缓存（eval 100 图 tech_401–500 的真实产出）；未命中则调 .venv-csd
  隔离环境（py3.8/TF2.4）现算，落盘缓存。TF 只存在于该子进程，FastAPI 主进程绝不 import。
"""

from __future__ import annotations

import subprocess

from . import config, dataset


class SegmentUnavailable(RuntimeError):
    """caroSegDeep 既无缓存又无隔离环境可现算——显式失败，不静默假造边界。"""


def segment(image_id: str, model: str, timeout: float = 180.0) -> tuple[list, list, str]:
    """返回 (li_points, ma_points, model_version)。"""
    if model != dataset.CARO:
        # 参考方法：on-disk 即时读取
        li, ma = dataset.boundaries_as_points(image_id, model)
        return li, ma, f"{model} (reference)"

    # caroSegDeep：缓存优先
    if dataset._caro_cached(image_id):
        li, ma = dataset.boundaries_as_points(image_id, dataset.CARO)
        return li, ma, "caroSegDeep (CUBS, cached)"

    # 未命中 → 隔离子进程现算
    if not config.csd_live_available():
        raise SegmentUnavailable(
            f"caroSegDeep 无 {image_id} 缓存，且隔离环境不可用（{config.CSD_PYTHON}）"
        )
    _run_live(image_id, timeout)
    if not dataset._caro_cached(image_id):
        raise SegmentUnavailable(f"caroSegDeep 现算未产出 {image_id}（远壁检测可能失败）")
    li, ma = dataset.boundaries_as_points(image_id, dataset.CARO)
    return li, ma, "caroSegDeep@live"


def _run_live(image_id: str, timeout: float) -> None:
    """在 .venv-csd 隔离环境跑 run_headless，产出落进 CSD_CACHE。"""
    config.CSD_CACHE.mkdir(parents=True, exist_ok=True)
    cmd = [
        str(config.CSD_PYTHON),
        str(config.CSD_DRIVER),
        str(config.IMAGES_DIR),
        str(config.CF_DIR),
        str(config.CSD_CACHE),
        str(config.CSD_WEIGHTS),
        image_id,
    ]
    env = {
        "MPLBACKEND": "Agg",
        "CUDA_VISIBLE_DEVICES": "-1",
        "PATH": "/usr/bin:/bin",
    }
    subprocess.run(
        cmd,
        cwd=str(config.CSD_DRIVER.parent),
        env=env,
        timeout=timeout,
        capture_output=True,
        text=True,
        check=False,  # 失败由缓存缺失判定 + 上层显式抛
    )
