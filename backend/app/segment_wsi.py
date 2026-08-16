"""P7 楔子：WSI 核检测适配层（StarDist-HE 隔离子进程）——缓存优先 + 隔离子进程兜底；主进程无 torch/TF。

镜像 :mod:`segment_ts` 的分层，但按 WSI 特性拆分职责（护城河：数据 IO 在主进程，模型在隔离子进程）：
- **主进程**（本模块 + :mod:`dataset_wsi` + :mod:`glaux_core.detection.nuclei_post`）：
  OpenSlide 读 ROI region → :func:`~glaux_core.detection.nuclei_post.tile_grid` 切 patch →
  子进程回来后加偏移 → :func:`~glaux_core.detection.nuclei_post.dedup_centroids` 去重。
  这三步都是确定性几何/IO，可被主测试套件覆盖（P7 头号坑：跨 patch 重复计核）。
- **隔离子进程**（``science-core/runners/segment_wsi_headless.py``，.venv-wsi）：**只**跑
  「patch 图 → 质心」的模型部分（StarDist/TF 只存在于该子进程，FastAPI 主进程绝不 import）。
- 缺缓存又缺隔离环境 → :class:`WsiSegmentUnavailable` 显式失败，不静默假造质心。

ROI 抽块推理（整片不可行）：``roi=(x0,y0,x1,y1)`` level-0 px。缓存键 = ``(slide_id, roi_hash, method)``。
"""

from __future__ import annotations

import hashlib
import json
import logging
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from . import config, dataset_wsi

log = logging.getLogger(__name__)

PATCH = 256
OVERLAP = 32
DEDUP_DIST = 8.0  # level-0 px；~核直径量级


class WsiSegmentUnavailable(RuntimeError):
    """核分割既无缓存又无隔离环境可现算——显式失败，不静默假造质心。"""


def _roi_hash(roi: tuple[int, int, int, int], method: str) -> str:
    """ROI 框 + method 的稳定短 hash（同 ROI 重复跑命中缓存）。"""
    key = f"{int(roi[0])}_{int(roi[1])}_{int(roi[2])}_{int(roi[3])}_{method}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def nuclei_path(slide_id: str, roi: tuple[int, int, int, int], method: str = "stardist_he") -> Path:
    """质心 json 缓存路径——不论是否存在都返回（未命中时本模块会写入这里）。"""
    return config.WSI_SEG_CACHE / f"{slide_id}_{_roi_hash(roi, method)}_{method}.json"


def _cached(slide_id: str, roi, method: str) -> Path | None:
    p = nuclei_path(slide_id, roi, method)
    return p if p.is_file() else None


def _run_live(slide_id: str, roi: tuple[int, int, int, int], method: str, timeout: float) -> str:
    """主进程抽 ROI + 切 patch → 隔离子进程跑模型 → 主进程加偏移 + 去重 → 写质心 json。

    子进程 argv 列表（无 shell=True）；env 最小化。与 segment_ts 同模板。
    返回子进程 stderr 尾部（未产出时塞进异常，避免 503 变黑盒）。
    """
    from glaux_core.detection.nuclei_post import dedup_centroids, tile_grid

    x0, y0, x1, y1 = (int(v) for v in roi)
    roi_w, roi_h = x1 - x0, y1 - y0
    if roi_w <= 0 or roi_h <= 0:
        raise WsiSegmentUnavailable(f"ROI 非正：{roi}")

    # 主进程：OpenSlide 抽 ROI region（level-0 RGB）+ 读 MPP（driver 按训练 MPP 重采样纠偏）
    roi_rgb = dataset_wsi.read_region(slide_id, x0, y0, roi_w, roi_h, level=0)  # (H,W,3)
    try:
        mpp_x, _mpp_y = dataset_wsi.mpp(slide_id)
    except ValueError:
        mpp_x = 0.25  # 读不出 MPP → 按训练 MPP（scale=1，不重采样）

    config.WSI_SEG_CACHE.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"wsiseg_{slide_id}_") as work:
        workdir = Path(work)
        # 主进程：切 patch（tested tile_grid）→ 写 patch png + manifest（ROI-local 原点）
        boxes = tile_grid(roi_w, roi_h, patch=PATCH, overlap=OVERLAP)
        manifest = []
        for i, (bx0, by0, bx1, by1) in enumerate(boxes):
            patch = roi_rgb[by0:by1, bx0:bx1]
            fn = f"patch_{i:05d}.png"
            Image.fromarray(patch).save(workdir / fn)
            manifest.append({"file": fn, "x0": bx0, "y0": by0})
        (workdir / "manifest.json").write_text(json.dumps(manifest))
        out_json = workdir / "centroids.json"

        cmd = [
            str(config.WSI_SEG_PYTHON),
            str(config.WSI_SEG_DRIVER),
            "--workdir",
            str(workdir),
            "--manifest",
            str(workdir / "manifest.json"),
            "--output",
            str(out_json),
            "--method",
            method,
            "--mpp",
            str(mpp_x),
        ]
        env = {
            "MPLBACKEND": "Agg",
            "CUDA_VISIBLE_DEVICES": "-1",  # v0 CPU-only
            "TF_CPP_MIN_LOG_LEVEL": "3",
            "PATH": "/usr/bin:/bin",
            # StarDist 首次 from_pretrained 把 HE 权重缓存到 ~/.keras——最小 env 需带 HOME，
            # 否则缓存查找失败重新下载/报错（P6 对 TotalSegmentator 记过同类 HOME 坑）。
            "HOME": str(config.HOME),
        }
        result = subprocess.run(
            cmd,
            cwd=str(config.WSI_SEG_DRIVER.parent),
            env=env,
            timeout=timeout,
            capture_output=True,
            text=True,
            check=False,
        )
        stderr_tail = (getattr(result, "stderr", "") or "")[-2000:]
        if getattr(result, "returncode", 0) != 0:
            log.warning(
                "segment_wsi_headless 非 0 退出 rc=%s slide=%s method=%s\nstderr:\n%s",
                getattr(result, "returncode", "?"),
                slide_id,
                method,
                stderr_tail,
            )
        if not out_json.is_file():
            return stderr_tail

        # 主进程：读 ROI-local 质心 → 加 ROI 原点偏到 level-0 → 去重（tested）
        raw = json.loads(out_json.read_text())
        pts = np.asarray(raw.get("points", []), dtype=float).reshape(-1, 2)
        cids = np.asarray(raw.get("class_ids", []), dtype=int).reshape(-1)
        n_raw = len(pts)
        if n_raw:
            pts = pts + np.array([x0, y0], dtype=float)  # ROI-local → level-0
            pts, cids = dedup_centroids(pts, cids, dist_thresh=DEDUP_DIST)
        out = {
            "slide_id": slide_id,
            "roi": [x0, y0, x1, y1],
            "method": method,
            "model_version": raw.get("model_version", method),
            "points": pts.tolist(),
            "class_ids": cids.tolist(),
            "n_raw": int(n_raw),
            "n_dedup": int(len(pts)),
        }
        nuclei_path(slide_id, roi, method).write_text(json.dumps(out))
    return stderr_tail


def segment(
    slide_id: str,
    roi: tuple[int, int, int, int],
    method: str = "stardist_he",
    timeout: float = 600.0,
) -> tuple[str, str]:
    """真核检测：缓存优先 + 隔离子进程兜底。

    返回 ``(nuclei_json_path, model_version)``。调用方读 json 构造 PointSet 算 measure。
    缺缓存 + 缺隔离环境 / 子进程未产出 → :class:`WsiSegmentUnavailable`（**不**静默假造）。
    """
    if method != "stardist_he":
        raise WsiSegmentUnavailable(f"P7 v0 仅支持 stardist_he method，得 {method!r}")
    cached = _cached(slide_id, roi, method)
    if cached is not None:
        return str(cached), "StarDist 2D_versatile_he (cached)"
    if not config.wsi_live_available():
        raise WsiSegmentUnavailable(
            f"核分割无 {slide_id} ROI 缓存，且隔离环境不可用（{config.WSI_SEG_PYTHON}）"
        )
    stderr_tail = _run_live(slide_id, tuple(int(v) for v in roi), method, timeout)
    cached = _cached(slide_id, roi, method)
    if cached is None:
        detail = f"：{stderr_tail.strip()}" if stderr_tail.strip() else ""
        raise WsiSegmentUnavailable(
            f"核分割现算未产出 {slide_id}（质心落盘失败或子进程异常）{detail}"
        )
    return str(cached), "StarDist 2D_versatile_he@live"


def load_nuclei(path: str) -> dict:
    """读质心 json（kernel 构造 PointSet 用）。"""
    return json.loads(Path(path).read_text())
