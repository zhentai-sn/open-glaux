"""P6 楔子：CT 体积数据集封装——列表 / NIfTI serve / labelmap 路径 / voxel spacing / 画笔编辑 patch。

镜像 :mod:`dataset` / :mod:`hc_dataset` 的形态：纯数据 IO（nibabel 在主进程允许——非重模型）。
重模型（TotalSegmentator）走 :mod:`segment_ts` 隔离子进程。

P6 v0：``data/ct/`` 下 ship 的 NIfTI demo 案例，ID 形如 ``ct_001``，命名规则：
- ``<id>.nii.gz`` —— 原始 CT 输入
- ``<id>_<method>.nii.gz`` —— 分割 labelmap（TotalSegmentator 输出），落 ``TS_CACHE/``
"""

from __future__ import annotations

import re
import threading
from functools import lru_cache

import nibabel as nib
import numpy as np

from . import config, segment_ts


_ID_RE = re.compile(r"^ct_\d{3}$")


# --- 画笔编辑并发守卫（U4 / review ①）---------------------------------------
# 后端单进程多线程（FastAPI 同步 handler 跑线程池）——per-(volume,method) 乐观并发：
# last_edit_seq 计数器 + 一把锁把「校验 base_seq → patch → 自增」整段原子化。
# 这同时修掉 patch_labelmap 裸 read-modify-write 的丢更新竞态（两笔并发不再互相覆盖）。
_edit_lock = threading.Lock()
_edit_seq: dict[tuple[str, str], int] = {}


class StaleEditError(RuntimeError):
    """并发画笔编辑：客户端 base_seq 落后于服务端 last_edit_seq——拒收（被他人超越）。"""

    def __init__(self, volume_id: str, base_seq: int, current_seq: int):
        self.volume_id = volume_id
        self.base_seq = base_seq
        self.current_seq = current_seq
        super().__init__(
            f"编辑冲突：{volume_id} base_seq={base_seq} 落后于服务端 seq={current_seq}"
            f"——已被他人编辑超越，请以最新 labelmap 为基重试"
        )


def current_edit_seq(volume_id: str, method: str = "totalsegmentator_v2") -> int:
    """当前 per-(volume,method) 编辑序号（客户端拉 labelmap 时随附，编辑时回传作 base_seq）。"""
    with _edit_lock:
        return _edit_seq.get((volume_id, method), 0)


def reset_edit_seq(volume_id: str | None = None, method: str = "totalsegmentator_v2") -> None:
    """清空编辑序号——测试隔离用；volume_id=None 清全部。"""
    with _edit_lock:
        if volume_id is None:
            _edit_seq.clear()
        else:
            _edit_seq.pop((volume_id, method), None)


def _root():
    """当前生效的 CT 数据根（注册表驱动）——无 active 源 → None（列空/404）。"""
    from . import datasource_registry as reg

    return reg.resolve_root("ct_abdomen")


def list_ids() -> list[str]:
    """当前 CT 源下所有形如 ``ct_001.nii.gz`` 的 volume id 列表。"""
    root = _root()
    if root is None or not root.is_dir():
        return []
    out: list[str] = []
    for p in sorted(root.glob("ct_*.nii.gz")):
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
    root = _root()
    p = (root / f"{volume_id}.nii.gz") if root else None
    if p is None or not p.is_file():
        raise FileNotFoundError(f"CT 体积不存在：{volume_id}（root={root}）")
    return nib.load(str(p))


def nifti_path(volume_id: str) -> str:
    """原始 NIfTI 路径（前端 /api/volume/{id} 流式返回用）。"""
    root = _root()
    p = (root / f"{volume_id}.nii.gz") if root else None
    if p is None or not p.is_file():
        raise FileNotFoundError(f"CT 体积不存在：{volume_id}（root={root}）")
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
    # nibabel 体素轴序是 (X, Y, Z)；前端 VolumeViewer 沿 Z（末轴）切轴状位、PNG 宽=X 高=Y。
    # 必须沿轴 2 切（arr[:, :, z]），而非旧代码的 arr[z]（切轴 0=X=矢状面，patch 错平面 + 尺寸不符 422）。
    X, Y, Z = arr.shape

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
        if img.size != (X, Y):  # PIL size=(width,height)=(X,Y)
            raise ValueError(
                f"mask 尺寸 {img.size} != labelmap 轴状位 slice 尺寸 ({X}, {Y})——硬拒绝"
            )
        # np.asarray(img) → (height, width)=(Y, X)；转置到 (X, Y) 对齐 arr[:, :, z]
        mask_xy = np.asarray(img, dtype=bool).T
        sl = arr[:, :, z]  # 轴状位切片（view，写回生效）
        if mode == "erase":
            sl[mask_xy] = 0
        else:  # paint
            sl[mask_xy] = class_id

    # 写回（覆盖同 vid+method 路径）
    new_nib = nib.Nifti1Image(arr.astype(np.int32), labelmap.affine, labelmap.header)
    new_path = commit_labelmap(volume_id, new_nib, method)
    return new_path, arr


def guarded_patch_labelmap(
    volume_id: str,
    slices: list[dict],
    base_seq: int | None,
    method: str = "totalsegmentator_v2",
    class_id_to_role: dict[int, str] | None = None,
) -> tuple[str, np.ndarray, int]:
    """并发安全的 patch：校验 base_seq → patch（原子）→ 自增 seq。返回 (path, arr, new_seq)。

    - ``base_seq`` 为客户端拉 labelmap 时随附的序号；``None`` 表示不做乐观并发校验
      （向后兼容单笔编辑），但仍在锁内串行化，避免 read-modify-write 丢更新。
    - ``base_seq`` 落后于服务端当前 seq → :class:`StaleEditError`（端点转 409）。
    - 校验 → patch → 自增全程持锁，保证同 (volume,method) 的并发编辑互斥。
    """
    key = (volume_id, method)
    with _edit_lock:
        cur = _edit_seq.get(key, 0)
        if base_seq is not None and base_seq != cur:
            raise StaleEditError(volume_id, base_seq, cur)
        new_path, arr = patch_labelmap(
            volume_id, slices, method=method, class_id_to_role=class_id_to_role
        )
        _edit_seq[key] = cur + 1
        return new_path, arr, cur + 1
