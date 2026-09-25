"""P6 楔子：CT 体积数据集封装——列表 / NIfTI serve / labelmap 路径 / voxel spacing / 画笔编辑 patch。

镜像 :mod:`dataset` / :mod:`hc_dataset` 的形态：纯数据 IO（nibabel 在主进程允许——非重模型）。
重模型（TotalSegmentator）走 :mod:`segment_ts` 隔离子进程。

对象 id 与文件（SDD 13 §7.2 规则 10–12、D-25）：
- 内置示例源（``ct-demo``，``data/ct/``）保留既有约定：``<id>.nii.gz``，id 形如 ``ct_001``。
- 导入源与项目源不看文件名前缀：``source.root`` 下一层的 NIfTI-1 单文件（``.nii.gz`` / ``.nii``），
  id 为 ``ct-<源哈希8>-<文件名哈希8>``。
- 按 id 取文件一律经 :func:`_path_of`（``resolve_object`` → 所属数据源 → 源目录内定位），
  不经「首个活动源」的全局根，内置源与导入源、项目源并存互不遮蔽。
- ``<id>_<method>.nii.gz`` —— 分割 labelmap（TotalSegmentator 输出），落 ``TS_CACHE/``
"""

from __future__ import annotations

import gzip
import re
import threading
import zlib
from functools import lru_cache
from pathlib import Path

import nibabel as nib
import numpy as np

from . import segment_ts

MODALITY = "ct_abdomen"
_ID_RE = re.compile(r"^ct_\d{3}$")
_BUILTIN_SUFFIX = ".nii.gz"
#: NIfTI-1 单文件头：``sizeof_hdr`` = 348，偏移 344 处魔数 ``n+1\0``（SDD 13 §7.2 规则 10）。
_NIFTI1_HDR = 348
_NIFTI1_MAGIC = b"n+1\x00"
_NIFTI1_MAGIC_OFFSET = 344
_GZIP_MAGIC = b"\x1f\x8b"


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


def _is_builtin_demo(source) -> bool:
    """内置示例源（``ct-demo``）保留 ``ct_\\d{3}`` 文件名约定与既有 id（SDD 13 §7.2 规则 11）。

    按 ``origin`` 认：内置源只由 ``builtin_sample`` 给出，``root`` 是 ``config.CT_ROOT`` 的
    实时视图；即便导入源指向同一目录，其对象 id 仍按文件派生，不与内置 id 相撞。
    """
    return source.origin == "builtin"


def _nifti_name(name: str) -> bool:
    """后缀是 ``.nii`` 或 ``.nii.gz``（只看文件名，不读内容）。"""
    lower = name.lower()
    return lower.endswith(".nii") or lower.endswith(".nii.gz")


def _is_nifti1(path: Path) -> bool:
    """文件头是 NIfTI-1 单文件头（SDD 13 §7.2 规则 10）。

    ``.nii.gz`` 先认 gzip 魔数，再解压读前 348 字节；``.nii`` 直接读。``sizeof_hdr`` 按大小端
    任一为 348 且偏移 344 处为 ``n+1\\0`` 才算通过。读不了、截断、解压失败都算不符。
    """
    try:
        with path.open("rb") as fh:
            magic = fh.read(len(_GZIP_MAGIC))
        if path.name.lower().endswith(".gz"):
            if magic != _GZIP_MAGIC:
                return False
            with gzip.open(path, "rb") as fh:
                head = fh.read(_NIFTI1_HDR)
        else:
            with path.open("rb") as fh:
                head = fh.read(_NIFTI1_HDR)
    except (OSError, EOFError, zlib.error):
        return False
    if len(head) < _NIFTI1_HDR:
        return False
    sizeof_hdr = head[:4]
    off = _NIFTI1_MAGIC_OFFSET
    return head[off : off + len(_NIFTI1_MAGIC)] == _NIFTI1_MAGIC and _NIFTI1_HDR in (
        int.from_bytes(sizeof_hdr, "little"),
        int.from_bytes(sizeof_hdr, "big"),
    )


def _files(root: Path) -> list[Path]:
    """目录下一层按后缀认得的 NIfTI 文件（不读内容），按文件名排序。"""
    if not root.is_dir():
        return []
    return sorted(
        (p for p in root.iterdir() if p.is_file() and _nifti_name(p.name)),
        key=lambda p: p.name,
    )


def _builtin_id(name: str) -> str | None:
    """内置约定的文件名 → id：``ct_001.nii.gz`` → ``ct_001``；不符约定为 None。"""
    if not name.endswith(_BUILTIN_SUFFIX):
        return None
    stem = name[: -len(_BUILTIN_SUFFIX)]
    return stem if _ID_RE.match(stem) else None


def object_id(source_id: str, rel_name: str) -> str:
    """导入源与项目源的对象 id：``ct-<源哈希8>-<文件名哈希8>``（SDD 13 §7.2 规则 11、D-25）。"""
    from .sources.base import derive_object_id

    return derive_object_id("ct", source_id, rel_name)


def _entries(source) -> list[tuple[str, Path]]:
    """该源下的 ``(对象 id, 路径)``，只按文件名得出、不读内容；内置源按既有约定。"""
    root = Path(source.root)
    if _is_builtin_demo(source):
        if not root.is_dir():
            return []
        out = []
        for p in sorted(root.glob("ct_*.nii.gz")):
            oid = _builtin_id(p.name)
            if oid is not None:
                out.append((oid, p))
        return out
    return [(object_id(source.id, p.name), p) for p in _files(root)]


@lru_cache(maxsize=256)
def _locate(root: str, source_id: str, volume_id: str) -> Path:
    """非内置源目录内按派生 id 反查文件。只缓存命中（未命中抛异常，lru_cache 不缓存）。

    每次 ``meta`` 都要取显示名，缓存免得逐请求扫目录；数据源增删时随 ``invalidate`` 清空。
    """
    for p in _files(Path(root)):
        if object_id(source_id, p.name) == volume_id:
            return p
    raise FileNotFoundError(f"CT 体积不存在：{volume_id}（source={source_id}）")


def _file_of(source, volume_id: str) -> Path:
    """在给定数据源目录内按 id 定位文件；找不到 → :class:`FileNotFoundError`。"""
    if not _is_builtin_demo(source):
        p = _locate(str(source.root), source.id, volume_id)
        if not p.is_file():  # 文件在进程内被移走：丢弃陈旧命中再查一次
            _locate.cache_clear()
            p = _locate(str(source.root), source.id, volume_id)
        return p
    p = Path(source.root) / f"{volume_id}{_BUILTIN_SUFFIX}"
    if _ID_RE.match(volume_id) and p.is_file():
        return p
    raise FileNotFoundError(f"CT 体积不存在：{volume_id}（source={source.id}）")


def _path_of(volume_id: str) -> Path:
    """按对象 id 取 NIfTI 路径：``resolve_object`` 找到所属数据源，再在该源目录内定位。

    SDD 13 §7.2 规则 12：不经「首个活动源」的全局根。

    未知 id、非 CT 对象、文件已不在 → :class:`FileNotFoundError`（端点转 404）。
    """
    from . import datasource_registry as reg

    try:
        ref = reg.resolve_object(volume_id)
    except LookupError as e:
        raise FileNotFoundError(f"CT 体积不存在：{volume_id}") from e
    if ref.modality != MODALITY:
        raise FileNotFoundError(f"不是 CT 体积：{volume_id}（{ref.modality}）")
    return _file_of(ref.datasource, volume_id)


def list_ids() -> list[str]:
    """全部 active CT 源的 volume id（合并视图，同 id 首个源胜出，与 ``resolve_object`` 一致）。"""
    from . import datasource_registry as reg

    out: list[str] = []
    seen: set[str] = set()
    for ds in reg.active_sources(MODALITY):
        for oid in SOURCE.list_ids(ds):
            if oid not in seen:
                seen.add(oid)
                out.append(oid)
    return out


def is_ct(image_id: str) -> bool:
    """是否是本数据集内的 CT volume id。"""
    try:
        return image_id in set(list_ids())
    except Exception:
        return False


@lru_cache(maxsize=8)
def _load_nifti(volume_id: str) -> nib.Nifti1Image:
    """读 NIfTI（lru_cache 避免重复 IO；后端单进程多请求时省时间）。

    缓存以对象 id 为键：派生 id 已含源哈希，不同源的同名文件不会串（数据源增删时经
    ``invalidate`` 清空）。``.nii`` 与 ``.nii.gz`` 都由 nibabel 按文件名识别。
    """
    return nib.load(str(_path_of(volume_id)))


def nifti_path(volume_id: str) -> str:
    """原始 NIfTI 路径（``raw`` 表征与 TotalSegmentator 输入共用）。"""
    return str(_path_of(volume_id))


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
        "cf": None,  # CT 走 voxel_spacing，不是 cubs_cf
        "methods": ["totalsegmentator_v2"],
        "voxel_spacing_mm": [sx, sy, sz],
    }


# --- 画笔编辑 patch (U4) ---------------------------------------------------


def labelmap_nib(volume_id: str, method: str = "totalsegmentator_v2") -> nib.Nifti1Image:
    """读 labelmap NIfTI 句柄（callers 改完要调 commit_labelmap 写回）。"""
    path = segment_ts.labelmap_path(volume_id, method)
    return nib.load(str(path))


def commit_labelmap(
    volume_id: str, labelmap: nib.Nifti1Image, method: str = "totalsegmentator_v2"
) -> str:
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

    - ``slices``: 形如 ``[{"z": 80, "mask_png_ref": "data:..."}]``；
      每条包含 (z, mask_png, class_id, mode)。
    - 原 labelmap + 掩膜 union → 写新 labelmap（同缓存键覆盖）→ 返回 ndarray。
    - class_id 必须在 VolumeMask.classes 内（class_id_to_role 提供）——否则 ValueError 硬拒绝。
    - z 越界（< 0 或 >= Z 维）→ ValueError 硬拒绝，不静默接受。
    """
    if not slices:
        # 无 slices → 不改 labelmap，但确保缓存存在（否则端点返 404 误导调用方）
        labelmap = labelmap_nib(volume_id, method)
        return str(segment_ts.labelmap_path(volume_id, method)), np.asarray(
            labelmap.dataobj
        ).astype(np.int32, copy=False)

    labelmap = labelmap_nib(volume_id, method)
    arr = np.asarray(labelmap.dataobj).astype(np.int32, copy=False)
    # nibabel 体素轴序是 (X, Y, Z)；前端 VolumeViewer 沿 Z（末轴）切轴状位、PNG 宽=X 高=Y。
    # 必须沿轴 2 切（arr[:, :, z]），而非旧代码的 arr[z]
    # （切轴 0=X=矢状面，patch 错平面 + 尺寸不符 422）。
    X, Y, Z = arr.shape

    # 验证：所有 class_id 在白名单内（防止 paint class_id=999 这种越权）
    if class_id_to_role is None:
        from glaux_core.tasks import LIVER_KIDNEY_CLASSES

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


# --- SDD 10 数据轴：CT Source -------------------------------------------------------
# 标定探测由 datasource_detect 迁入 detect_calibration。SDD 13 P2：按数据源列举、按文件派生 id。

from PIL import Image  # noqa: E402

from .datasource_registry import DataSource  # noqa: E402
from .schemas import Axis, Calibration, ObjectMeta  # noqa: E402
from .sources.base import (  # noqa: E402
    SourceBase,
    is_direct_child,
    magic_matches,
    method_refs,
    resources_for,
    suffix_matches,
)


class CtSource(SourceBase):
    modality = MODALITY
    kind = "volume"
    label = "Abdominal CT"
    #: 项目识别用（SDD 13 §7.2 规则 10）；``.nii.gz`` 在此只认 gzip 魔数，NIfTI-1 头由
    #: :func:`_is_nifti1` 解压后再认。
    formats = ((".nii.gz", _GZIP_MAGIC, 0), (".nii", _NIFTI1_MAGIC, _NIFTI1_MAGIC_OFFSET))
    #: 医学卷不走浏览器上传（SDD 08 D-5；SDD 13 §7.2 规则 13、D-23）。
    browser_upload = False
    supports_window = True
    default_window = (400.0, 40.0)  # 腹部软组织窗 (ww, wl)
    caches = (_load_nifti, _locate)

    def probe(self, root: Path) -> bool:
        # 只看后缀、不看文件名前缀（SDD 13 §7.2 规则 7）；Path("a.nii.gz").suffix == ".gz"，
        # 故按 name 判复合后缀（见 _nifti_name）。
        return bool(_files(root))

    def builtin_sample(self) -> DataSource:
        from . import config

        return DataSource(
            id="ct-demo",
            name="CT abdomen · demo",
            modality=self.modality,
            root=config.CT_ROOT,
            origin="builtin",
            calibration={"voxel_mm": "nifti header"},
            provider="wasserth · TotalSegmentator",
            license="Apache-2.0",
            desc="腹部 CT NIfTI demo · voxel 标定",
        )

    def list_ids(self, source: DataSource) -> list[str]:
        """只列 ``source.root`` 下一层（SDD 13 §7.2 规则 7）。

        内置源沿用既有约定（按文件名，不读内容）；其余源逐个确认 NIfTI-1 头，损坏或改名的
        文件不进列表。
        """
        entries = _entries(source)
        if _is_builtin_demo(source):
            return [oid for oid, _ in entries]
        return [oid for oid, path in entries if _is_nifti1(path)]

    def object_id_for(self, source: DataSource, path: Path) -> str | None:
        """SDD 13 §6.3：``source.root`` 下一层、后缀与魔数均符、NIfTI-1 头可读的文件 → 对象 id。

        判定与 :meth:`list_ids` 同源（同一 ``_entries`` 命名 + 同一 ``_is_nifti1``）。内置源只认
        ``ct_\\d{3}.nii.gz``，其余文件名返回 None。
        """
        if not (
            is_direct_child(source, path)
            and suffix_matches(self.formats, path.name)
            and magic_matches(self.formats, path)
            and _is_nifti1(path)
        ):
            return None
        if _is_builtin_demo(source):
            return _builtin_id(path.name)
        return object_id(source.id, path.name)

    def derive_id(self, source: DataSource, rel_name: str) -> str:
        """纯派生的对象 id（不读内容；项目列目录回填用）。内置源按约定，不符约定则不可派生。"""
        if _is_builtin_demo(source):
            oid = _builtin_id(rel_name)
            if oid is None:
                raise NotImplementedError(f"内置 CT 源不含 {rel_name}")
            return oid
        return object_id(source.id, rel_name)

    def describe(self, source: DataSource, object_id: str) -> ObjectMeta:
        rec = image_meta(object_id)
        sx, sy, sz = rec["voxel_spacing_mm"]
        # nibabel 体素轴序 (X, Y, Z)；轴状位切片 PNG 宽 = X、高 = Y（见 patch_labelmap）。
        nx, ny, nz = shape(object_id)
        # 派生 id 不可读，显示名取文件名；内置 id 即可读名，保持既有输出。
        display = "" if _is_builtin_demo(source) else _file_of(source, object_id).name
        return ObjectMeta(
            id=object_id,
            kind=self.kind,
            modality=self.modality,
            source_id=source.id,
            display_name=display,
            axes=[Axis(name="x", size=nx, spacing=sx, unit="mm"),
                  Axis(name="y", size=ny, spacing=sy, unit="mm"),
                  Axis(name="z", size=nz, spacing=sz, unit="mm")],
            calibration=Calibration(kind="voxel_mm", value=[sx, sy, sz], source="nifti_header"),
            resources=resources_for(object_id, raw=True),
            methods=method_refs(rec["methods"], agent=tuple(rec["methods"])),
            meta={"center": rec["center"]},
        )

    def render(self, source, object_id, index, window):
        ww, wl = window or self.default_window
        sl = np.asarray(_load_nifti(object_id).dataobj[:, :, index.z], dtype=np.float32)
        lo = wl - ww / 2
        gray = np.clip((sl - lo) / ww * 255.0, 0, 255).astype(np.uint8)
        return Image.fromarray(gray.T, mode="L")  # (X, Y) → 行 = Y、列 = X

    def raw(self, source, object_id):
        return Path(nifti_path(object_id)), "application/octet-stream"

    def detect_calibration(self, root: Path) -> dict:
        """读该文件夹第一例合法 NIfTI 的 voxel spacing → {"voxel_mm": [sx, sy, sz]}。读不出 → {}。

        不依赖文件名前缀（SDD 13 §7.2 规则 7）；结果只作源级提示，对象级标定取各自的头（D-24）。
        """
        vols = [p for p in _files(root) if _is_nifti1(p)]
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


SOURCE = CtSource()
