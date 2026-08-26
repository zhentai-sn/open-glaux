"""P6 楔子：CT 体积分割适配层（TotalSegmentator v2.4.0 隔离子进程）。

缓存优先 + 隔离子进程兜底；主进程无 torch。

镜像 IMT / HC 的分层：
- 数据侧：``backend/app/dataset_ct.py`` 读 NIfTI（主进程允许 nibabel，不重模型）。
- 模型侧：``science-core/runners/segment_ts_headless.py`` 在 .venv-ts 隔离子进程跑
  TotalSegmentator（torch / nnunetv2 只存在于该子进程，FastAPI 主进程绝不 import）。
- 缺缓存又缺隔离环境 → :class:`TsSegmentUnavailable` 显式失败，不静默假造 labelmap。

v0 仅跑 ``totalsegmentator_v2`` 单 method（plan: 3 类肝+双肾楔子；后续 P6.x 扩 117 类
再分 method）。缓存键 = ``(volume_id, method)``，落 ``.nii.gz``（gzip 压缩节省 10×）。
"""

from __future__ import annotations

import logging
import subprocess

from . import config

log = logging.getLogger(__name__)


class TsSegmentUnavailable(RuntimeError):
    """TotalSegmentator 既无缓存又无隔离环境可现算——显式失败，不静默假造 labelmap。"""


def _cached_labelmap(volume_id: str, method: str):
    """缓存路径：``{vid}_{method}.nii.gz``。命中返回 Path，未命中返回 None。"""
    p = config.TS_CACHE / f"{volume_id}_{method}.nii.gz"
    return p if p.is_file() else None


def _labelmap_path(volume_id: str, method: str):
    """不论缓存是否存在，都返回目标路径（未命中时子进程会写入这里）。"""
    return config.TS_CACHE / f"{volume_id}_{method}.nii.gz"


def labelmap_path(volume_id: str, method: str = "totalsegmentator_v2"):
    """labelmap 路径——backend kernel.build_detection / segment 端点 / volume serve 共用。

    不在 :func:`segment` 内调用，避免副作用；调用方按需决定是否要 ensure。
    """
    return _labelmap_path(volume_id, method)


def _run_live(volume_id: str, method: str, timeout: float) -> str:
    """在 .venv-ts 隔离环境跑 segment_ts_headless，labelmap 落进 TS_CACHE。

    子进程 argv 列表（无 shell=True）；env 最小化（MPLBACKEND / CUDA / PATH）。
    与 caroSegDeep / CSM 同模板。

    返回子进程 stderr 尾部（供上层在未产出时塞进异常，避免 503 变不可诊断黑盒）。
    """
    config.TS_CACHE.mkdir(parents=True, exist_ok=True)
    in_path = config.CT_ROOT / f"{volume_id}.nii.gz"
    out_path = _labelmap_path(volume_id, method)
    if not in_path.is_file():
        raise TsSegmentUnavailable(f"CT 体积不存在：{in_path}")
    cmd = [
        str(config.TS_PYTHON),
        str(config.TS_DRIVER),
        "--input",
        str(in_path),
        "--output",
        str(out_path),
        "--method",
        method,
    ]
    env = {
        "MPLBACKEND": "Agg",
        "CUDA_VISIBLE_DEVICES": "-1",  # v0 CPU-only；GPU 走单独配置
        "PATH": "/usr/bin:/bin",
    }
    result = subprocess.run(
        cmd,
        cwd=str(config.TS_DRIVER.parent),
        env=env,
        timeout=timeout,
        capture_output=True,
        text=True,
        check=False,  # 失败由缓存缺失判定 + 上层显式抛
    )
    # getattr 兜底：真实 subprocess.run 返回 CompletedProcess；测试可能 mock 成返回 None
    stderr_tail = (getattr(result, "stderr", "") or "")[-2000:]
    if getattr(result, "returncode", 0) != 0:
        # 硬拒绝方向对（不静默假造 labelmap），但把子进程真实报错留下来供排查——
        # 缺权重 / OOM / torch 崩 / nnU-Net 报错都在这。
        log.warning(
            "segment_ts_headless 非 0 退出 rc=%s vid=%s method=%s\nstderr:\n%s",
            result.returncode,
            volume_id,
            method,
            stderr_tail,
        )
    return stderr_tail


def segment(
    volume_id: str, method: str = "totalsegmentator_v2", timeout: float = 600.0
) -> tuple[str, str]:
    """真分割：缓存优先 + 隔离子进程兜底。

    返回 ``(labelmap_path, model_version)``。调用方负责读 labelmap 算 measure。
    缺缓存 + 缺隔离环境 / 子进程未产出 → :class:`TsSegmentUnavailable`（**不**静默假造）。
    """
    if method != "totalsegmentator_v2":
        raise TsSegmentUnavailable(f"P6 v0 仅支持 totalsegmentator_v2 method，得 {method!r}")
    cached = _cached_labelmap(volume_id, method)
    if cached is not None:
        return str(cached), "TotalSegmentator v2.4.0 (cached)"
    if not config.ts_live_available():
        raise TsSegmentUnavailable(
            f"TotalSegmentator 无 {volume_id} 缓存，且隔离环境不可用（{config.TS_PYTHON}）"
        )
    stderr_tail = _run_live(volume_id, method, timeout)
    cached = _cached_labelmap(volume_id, method)
    if cached is None:
        detail = f"：{stderr_tail.strip()}" if stderr_tail.strip() else ""
        raise TsSegmentUnavailable(
            f"TotalSegmentator 现算未产出 {volume_id}（labelmap 落盘失败或子进程异常）{detail}"
        )
    return str(cached), "TotalSegmentator v2.4.0@live"
