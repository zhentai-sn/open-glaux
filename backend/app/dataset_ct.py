"""P6 楔子：CT 体积数据集封装——列表 / NIfTI serve / labelmap 路径 / voxel spacing。

镜像 :mod:`dataset` / :mod:`hc_dataset` 的形态：纯数据 IO（nibabel 在主进程允许——非重模型）。
重模型（TotalSegmentator）走 :mod:`segment_ts` 隔离子进程。

P6 v0：``data/ct/`` 下 ship 的 NIfTI demo 案例，ID 形如 ``ct_001``，命名规则：
- ``<id>.nii.gz`` —— 原始 CT 输入
- ``<id>_<method>.nii.gz`` —— 分割 labelmap（TotalSegmentator 输出），落 ``TS_CACHE/``
"""

from __future__ import annotations

import re
from functools import lru_cache

import nibabel as nib
import numpy as np

from . import config


_ID_RE = re.compile(r"^ct_\d{3}$")


def list_ids() -> list[str]:
    """``data/ct/`` 下所有形如 ``ct_001.nii.gz`` 的 volume id 列表。"""
    if not config.CT_ROOT.is_dir():
        return []
    out: list[str] = []
    for p in sorted(config.CT_ROOT.glob("ct_*.nii.gz")):
        m = _ID_RE.match(p.stem.split(".")[0])
        if m:
            out.append(p.stem.split(".")[0])
    return out


def is_ct(image_id: str) -> bool:
    """是否是本数据集内的 CT volume id。"""
    try:
        return image_id in set(list_ids())
    except Exception:
        return False


@lru_cache(maxsize=8)
def _load_nifti(volume_id: str) -> nib.Nifti1Image:
    """读 NIfTI（lru_cache 避免重复 IO；后端单进程多请求时省时间）。"""
    p = config.CT_ROOT / f"{volume_id}.nii.gz"
    if not p.is_file():
        raise FileNotFoundError(f"CT 体积不存在：{p}")
    return nib.load(str(p))


def nifti_path(volume_id: str) -> str:
    """原始 NIfTI 路径（前端 /api/volume/{id} 流式返回用）。"""
    p = config.CT_ROOT / f"{volume_id}.nii.gz"
    if not p.is_file():
        raise FileNotFoundError(f"CT 体积不存在：{p}")
    return str(p)


def vox_spacing_mm(volume_id: str) -> tuple[float, float, float]:
    """voxel_spacing (sx, sy, sz) mm——读 NIfTI header pixdim[1:4]。

    读不出/非正 → :class:`ValueError`（硬拒绝模板同 calibration 层）。
    """
    img = _load_nifti(volume_id)
    pixdim = img.header.get_zooms()[:3]
    if not all(float(v) > 0 for v in pixdim):
        raise ValueError(f"CT {volume_id} pixdim 非法：{pixdim!r}")
    return (float(pixdim[0]), float(pixdim[1]), float(pixdim[2]))


def shape(volume_id: str) -> tuple[int, int, int]:
    """(Z, Y, X) 形状。"""
    img = _load_nifti(volume_id)
    return tuple(int(s) for s in img.shape)  # type: ignore[return-value]


def image_meta(volume_id: str) -> dict:
    """数据集元信息——与 /images 端点 shape 对齐（modality 字段恒 "ct"）。"""
    sx, sy, sz = vox_spacing_mm(volume_id)
    return {
        "id": volume_id,
        "center": "CT",
        "modality": "ct_abdomen",  # 与 TaskPlugin.modality 对齐（前端 /images 路由）
        "cf": None,                 # CT 走 voxel_spacing，不是 cubs_cf
        "methods": ["totalsegmentator_v2"],
        "voxel_spacing_mm": [sx, sy, sz],
    }
