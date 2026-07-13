"""U3：导入文件夹时的标定自动探测——从数据文件读嵌入的标定，免用户手填。

多数真实 WSI/CT 自带标定（OpenSlide ``mpp-x/y`` / NIfTI ``pixdim``），导入时读出来即
``status=active``；读不出（缺嵌入标定）→ 返回空 dict → 注册表标 ``needs_calibration``，
提示用户补（护城河：不猜标定，宁可硬拒绝）。

只做数据 IO（OpenSlide/nibabel 是主进程允许的 C 库，同 dataset_wsi/dataset_ct）——
与 :mod:`datasource_registry`（纯 stdlib）分离，作为 ``register_folder(detect=...)`` 注入。
carotid/HC 标定结构复杂（每图 CF / pixel-size csv）→ 暂返回空（导入后续）。
"""

from __future__ import annotations

from pathlib import Path

from . import config


def _detect_wsi(root: Path) -> dict:
    """读该文件夹第一张 slide 的 OpenSlide mpp → {"mpp": [mx, my]}。读不出 → {}。"""
    import openslide

    slides = sorted(p for p in root.glob("slide_*") if p.suffix.lower() in config._WSI_SUFFIXES)
    if not slides:
        return {}
    try:
        s = openslide.OpenSlide(str(slides[0]))
        mx = float(s.properties[openslide.PROPERTY_NAME_MPP_X])
        my = float(s.properties[openslide.PROPERTY_NAME_MPP_Y])
        s.close()
    except (KeyError, TypeError, ValueError, OSError):
        return {}
    if mx > 0 and my > 0:
        return {"mpp": [mx, my]}
    return {}


def _detect_ct(root: Path) -> dict:
    """读该文件夹第一例 CT NIfTI 的 voxel spacing → {"voxel_mm": [sx, sy, sz]}。读不出 → {}。"""
    import nibabel as nib

    vols = sorted(p for p in root.glob("ct_*.nii.gz"))
    if not vols:
        return {}
    try:
        img = nib.load(str(vols[0]))
        sx, sy, sz = (float(v) for v in img.header.get_zooms()[:3])
    except (KeyError, TypeError, ValueError, OSError, IndexError):
        return {}
    if sx > 0 and sy > 0 and sz > 0:
        return {"voxel_mm": [sx, sy, sz]}
    return {}


def detect(root: Path, modality: str) -> dict:
    """按模态从数据文件探测嵌入标定。未知/不支持模态或读不出 → {}（→ needs_calibration）。"""
    if modality == "pathology":
        return _detect_wsi(root)
    if modality == "ct_abdomen":
        return _detect_ct(root)
    return {}  # carotid_imt / fetal_hc：标定结构复杂，暂不自动探测
