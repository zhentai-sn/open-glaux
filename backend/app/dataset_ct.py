"""P6 楔子：CT 体积数据集封装——列表 / NIfTI serve / labelmap 路径 / voxel spacing / 画笔编辑 patch。

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

from . import config, segment_ts


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


# --- 画笔编辑 patch (U4) ---------------------------------------------------

def labelmap_nib(volume_id: str, method: str = "totalsegmentator_v2") -> nib.Nifti1Image:
    """读 labelmap NIfTI 句柄（callers 改完要调 commit_labelmap 写回）。"""
    path = segment_ts.labelmap_path(volume_id, method)
    return nib.load(str(path))


def commit_labelmap(volume_id: str, labelmap: nib.Nifti1Image, method: str = "totalsegmentator_v2") -> str:
    """写回 labelmap 到缓存（覆盖同 vid+method 路径）。返回 path。"""
    out = segment_ts.labelmap_path(volume_id, method)
    nib.save(labelmap, str(out))
    return str(out)


def patch_labelmap(
    volume_id: str,
    slices: list[dict],
    method: str = "totalsegmentator_v2",
    class_id_to_role: dict[int, str] | None = None,
) -> tuple[str, np.ndarray]:
    """画笔编辑 → patch labelmap → 返回 (新缓存路径, 修改后的 labelmap ndarray)。

    - ``slices``: 形如 ``[{"z": 80, "mask_png_ref": "data:..."}]``；每条 (z, mask_png, class_id, mode)。
    - 原 labelmap + 掩膜 union → 写新 labelmap（同缓存键覆盖）→ 返回 ndarray。
    - class_id 必须在 VolumeMask.classes 内（class_id_to_role 提供）——否则 ValueError 硬拒绝。
    - z 越界（< 0 或 >= Z 维）→ ValueError 硬拒绝，不静默接受。
    """
    if not slices:
        # 无 slices → 不改 labelmap，但确保缓存存在（否则端点返 404 误导调用方）
        labelmap = labelmap_nib(volume_id, method)
        return str(segment_ts.labelmap_path(volume_id, method)), np.asarray(labelmap.dataobj).astype(np.int32, copy=False)

    labelmap = labelmap_nib(volume_id, method)
    arr = np.asarray(labelmap.dataobj).astype(np.int32, copy=False)
    Z, Y, X = arr.shape

    # 验证：所有 class_id 在白名单内（防止 paint class_id=999 这种越权）
    if class_id_to_role is None:
        from glaux_orchestrator.tasks import LIVER_KIDNEY_CLASSES
        class_id_to_role = {c.class_id: c.role for c in LIVER_KIDNEY_CLASSES}  # type: ignore[name-defined]
    valid_class_ids = set(class_id_to_role.keys())
    for s in slices:
        if s.get("class_id", 0) not in valid_class_ids:
            raise ValueError(
                f"paint/erase class_id={s.get('class_id')} 不在 VolumeMask 白名单内"
                f"（{sorted(valid_class_ids)}）——硬拒绝"
            )
        z = int(s.get("z", -1))
        if z < 0 or z >= Z:
            raise ValueError(f"z={z} 越界（labelmap Z={Z}）——硬拒绝")

    # 解码 PNG 掩膜 + 应用
    import base64
    import io
    from PIL import Image  # Pillow 是常见栈；主进程允许

    for s in slices:
        z = int(s["z"])
        class_id = int(s["class_id"])
        mode = s.get("mode", "paint")
        png_b64 = s.get("mask_png_ref", "")
        if not png_b64.startswith("data:image/png;base64,"):
            raise ValueError("mask_png_ref 必须 data:image/png;base64,... 格式")
        b = base64.b64decode(png_b64.split(",", 1)[1])
        img = Image.open(io.BytesIO(b)).convert("L")
        if img.size != (X, Y):
            raise ValueError(
                f"mask 尺寸 {img.size} != labelmap slice 尺寸 ({X}, {Y})——硬拒绝"
            )
        mask = np.asarray(img, dtype=bool)
        if mode == "erase":
            arr[z][mask] = 0
        else:  # paint
            arr[z][mask] = class_id

    # 写回（覆盖同 vid+method 路径）
    new_nib = nib.Nifti1Image(arr.astype(np.int32), labelmap.affine, labelmap.header)
    new_path = commit_labelmap(volume_id, new_nib, method)
    return new_path, arr
