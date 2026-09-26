"""通用图像（``natural_image``）的列图与安全取图。

两类来源，同一条 ``/images`` / ``/image/{id}`` 契约（SDD 08 §5.3）：

- **内置演示**（SDD 07 冻结）：``NATURAL_ROOT`` 下的 4 张照片，固定 ID → 固定文件名。
- **导入源**（SDD 08）：用户上传或导入的目录，ID 由 ``upload_store.image_id`` 确定性派生。

两条路径共享同一条安全边界：**HTTP 层拿到的 image_id 永远不参与路径拼接**——内置走白名单字典，
导入源走「枚举目录 + 比对哈希」。用户给什么字符串都无法指向白名单/源目录之外的文件。

可见性由数据源注册表决定（SDD 08 §7 规则 1）：只有 ``status=active`` 的源才列图、才可取图。
故示例未加载时内置照片不出现，也取不到——与文件栏空态一致，不存在「列表里没有但直连能拿」。
"""

from __future__ import annotations

import time
from pathlib import Path

from PIL import Image

from . import config, upload_store

MODALITY = "natural_image"
_JPEG_MAGIC = b"\xff\xd8\xff"
_EXIF_ORIENTATION = 0x0112
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
# 经典 TIFF（小端 / 大端）；BigTIFF 不受理——普通单帧图用不到，且 PIL 支持有限（SDD 08 §7 规则 5）
_TIFF_MAGICS = (b"II*\x00", b"MM\x00*")
_MAGICS = (_JPEG_MAGIC, _PNG_MAGIC, *_TIFF_MAGICS)
_PIL_FORMATS = ("JPEG", "PNG", "TIFF")
_TIFF_SUFFIXES = (".tif", ".tiff")

# 内置演示资产：顺序即文件栏顺序与 API 稳定顺序（SDD 07 §4.1，ID 已冻结，勿改）。
ASSETS: dict[str, str] = {
    "natural_cat": "cat.jpg",
    "natural_coffee": "coffee.jpg",
    "natural_car": "car.jpg",
    "natural_dog": "dog.jpg",
}


def _sources() -> list:
    """当前 active 的 natural_image 源（builtin 在前，与注册表排序一致）。"""
    from . import datasource_registry as reg

    return [s for s in reg.sources_for(MODALITY) if s.status == "active"]


def _is_builtin_demo(source) -> bool:
    """是否是 SDD 07 那组固定白名单资产（按 root 认，不按 id 认，便于测试覆写路径）。"""
    return Path(source.root) == Path(config.NATURAL_ROOT)


# 导入源的目录列举缓存，键为 (root, 目录 mtime_ns)：增删、改名文件会改目录 mtime，缓存随之失效；
# 文件内容变化不影响 id↔路径映射，取图时仍逐次 _probe 校验。mtime 有时钟粒度，同一刻度内的
# 后续改动不改 mtime，故目录 mtime 距今不足 _RACY_NS 时不入缓存（同 git 的 racy 判定）。
_LISTINGS: dict[str, tuple[tuple[str, int], list[tuple[str, Path]], dict[str, Path]]] = {}
_RACY_NS = 2_000_000_000


def _listing(src) -> tuple[list[tuple[str, Path]], dict[str, Path]]:
    """某个源的 ``[(image_id, 路径)]``（稳定顺序）与 ``{image_id: 路径}``。"""
    root = Path(src.root)
    if _is_builtin_demo(src):
        items = [(image_id, root / filename) for image_id, filename in ASSETS.items()]  # 声明顺序
        return items, dict(items)
    try:
        key = (str(root), root.stat().st_mtime_ns)
        hit = _LISTINGS.get(src.id)
        if hit is not None and hit[0] == key:
            return hit[1], hit[2]
        paths = sorted(root.iterdir(), key=lambda p: p.name)  # 源内按文件名
    except OSError:
        return [], {}
    items = [
        (upload_store.image_id(src.id, p.name), p)
        for p in paths
        if upload_store.is_supported_file(p)
    ]
    index = dict(items)
    if time.time_ns() - key[1] > _RACY_NS:
        _LISTINGS[src.id] = (key, items, index)
    else:
        _LISTINGS.pop(src.id, None)
    return items, index


def _center(src) -> str:
    return "Natural images" if _is_builtin_demo(src) else src.name


def _path_in(src, image_id: str) -> Path:
    """在指定源内按 id 查路径；源非 active 或 id 不在其列举里即 404（§7 规则 1）。"""
    path = _listing(src)[1].get(image_id) if src.status == "active" else None
    if path is None:
        raise FileNotFoundError(f"未知通用图像：{image_id}")
    return path


def _entries() -> list[tuple[str, Path, str]]:
    """全部可见图像：``(image_id, 绝对路径, 所属源展示名)``，按 §5.3 的稳定顺序。"""
    out: list[tuple[str, Path, str]] = []
    for src in _sources():
        center = _center(src)
        out.extend((image_id, path, center) for image_id, path in _listing(src)[0])
    return out


def _find(image_id: str) -> tuple[Path, str]:
    for src in _sources():
        path = _listing(src)[1].get(image_id)
        if path is not None:
            return path, _center(src)
    raise FileNotFoundError(f"未知通用图像：{image_id}")


def _read_bytes(path: Path) -> bytes:
    """读原始字节并按魔数确认仍是受支持的图（落盘后被替换/截断也拦得住）。"""
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise FileNotFoundError(f"通用图像不存在：{path.name}") from exc
    if not data.startswith(_MAGICS):
        raise FileNotFoundError(f"通用图像格式无效：{path.name}")
    return data


def media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".png":
        return "image/png"
    return "image/tiff" if suffix in _TIFF_SUFFIXES else "image/jpeg"


def list_ids() -> list[str]:
    """只暴露当前存在且可完整校验的图像，保持 §5.3 的稳定顺序。"""
    out: list[str] = []
    for image_id, path, _ in _entries():
        try:
            _probe(path)
        except FileNotFoundError:
            continue
        out.append(image_id)
    return out


def image_meta(image_id: str) -> dict:
    path, center = _find(image_id)
    return {
        "id": image_id,
        "center": center,
        "cf": None,
        "methods": [],
        "modality": MODALITY,
    }


def image_bytes(image_id: str) -> tuple[bytes, str]:
    """返回 ``(字节, media type)``——取图前先过尺寸探测，损坏文件不进响应。"""
    path, _ = _find(image_id)
    _probe(path)
    return _read_bytes(path), media_type(path)


def image_jpeg(image_id: str) -> bytes:
    """兼容旧调用点：只取字节。新代码用 :func:`image_bytes` 以拿到正确的 media type。"""
    return image_bytes(image_id)[0]


def _probe(path: Path) -> tuple[int, int]:
    try:
        with Image.open(path) as image:
            if image.format not in _PIL_FORMATS:
                raise FileNotFoundError(f"通用图像格式无效：{path.name}")
            size = image.size
            image.verify()
            return size
    # 超出 PIL 像素上限的图（DecompressionBombError 不是 OSError）按损坏处理，不让取图 500
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise FileNotFoundError(f"通用图像不存在或损坏：{path.name}") from exc


def image_size(image_id: str) -> tuple[int, int]:
    """返回 (width, height)，供统一 Annotation 越界校验。"""
    path, _ = _find(image_id)
    return _probe(path)


# --- SDD 10 数据轴：通用图像 Source -------------------------------------------------
# 上面的函数体零改；list_ids 按数据源分列（上面的 list_ids 是全部 active 源的合并视图）。

from .datasource_registry import DataSource  # noqa: E402
from .schemas import Axis, ObjectMeta  # noqa: E402
from .sources.base import (  # noqa: E402
    SourceBase,
    is_direct_child,
    magic_matches,
    method_refs,
    resources_for,
)


class NaturalSource(SourceBase):
    modality = MODALITY
    kind = "image"
    label = "Natural images"
    formats = (
        (".jpg", _JPEG_MAGIC, 0),
        (".jpeg", _JPEG_MAGIC, 0),
        (".png", _PNG_MAGIC, 0),
        # 普通单层 TIFF；同后缀的切片 TIFF 由 pathology 先认领
        # （SOURCES 顺序，SDD 13 §7.2 规则 5、10）
        *((ext, magic, 0) for ext in _TIFF_SUFFIXES for magic in _TIFF_MAGICS),
    )
    calibration_required = False

    def probe(self, root: Path) -> bool:
        # 通用图像无命名约定（用户上传的什么名字都有），故判后缀而非前缀。
        return root.is_dir() and any(
            upload_store.is_supported_file(p, MODALITY) for p in root.iterdir()
        )

    def builtin_sample(self) -> DataSource:
        # SDD 08 D-4：SDD 07 的 4 张演示照片与其余示例同进同退——否则「空态」永远不为空。
        # 标定为空是常态（通用图像无标定），不代表 needs_calibration。
        return DataSource(
            id="natural-demo",
            name="Natural images · demo",
            modality=self.modality,
            root=config.NATURAL_ROOT,
            origin="builtin",
            calibration={},
        )

    def list_ids(self, source: DataSource) -> list[str]:
        if not Path(source.root).is_dir():
            return []
        out: list[str] = []
        for image_id, path in _listing(source)[0]:
            if not _is_builtin_demo(source) and not upload_store.is_supported_file(path, MODALITY):
                continue
            try:
                _probe(path)
            except FileNotFoundError:
                continue
            out.append(image_id)
        return out

    def object_id_for(self, source: DataSource, path: Path) -> str | None:
        """SDD 13 §6.3：``source.root`` 下一层、后缀与魔数均符、可完整探测尺寸的图 → 对象 id。

        判定与 :meth:`list_ids` 同源（同一后缀过滤 + 同一 ``_probe``），故返回的 id 必在该源的
        列举里。内置演示源按文件名反查 ``ASSETS`` 的冻结 id，与 ``list_ids`` 的 ASSETS 分支一致。
        """
        if not (
            is_direct_child(source, path)
            and upload_store.is_supported_file(path, MODALITY)
            and magic_matches(self.formats, path)
        ):
            return None
        try:
            _probe(path)
        except FileNotFoundError:
            return None
        if _is_builtin_demo(source):
            return next((i for i, name in ASSETS.items() if name == path.name), None)
        return upload_store.image_id(source.id, path.name)

    def describe(self, source: DataSource, object_id: str) -> ObjectMeta:
        path = _path_in(source, object_id)
        w, h = _probe(path)
        return ObjectMeta(
            id=object_id,
            kind=self.kind,
            modality=self.modality,
            source_id=source.id,
            # 内置演示的冻结 ID 本身可读（SDD 07），留空由前端回退到 id；上传源取原始文件名，
            # 其余源取磁盘文件名（SDD 08 §5.3）。
            display_name=(
                "" if _is_builtin_demo(source) else upload_store.display_name(source.root, path)
            ),
            axes=[Axis(name="x", size=w), Axis(name="y", size=h)],
            resources=resources_for(object_id),
            methods=method_refs([]),
            meta={"center": _center(source)},
        )

    def encoded(self, source, object_id, index):
        path = _path_in(source, object_id)
        _probe(path)
        # 浏览器不能直接显示 TIFF：解码后返回 PNG（SDD 10 §5.2）
        if path.suffix.lower() in _TIFF_SUFFIXES:
            return None
        # 带 EXIF 方向的图：浏览器按方向旋转显示，与对象坐标（PIL 原始朝向）不符，改走 render
        with Image.open(path) as im:
            if im.getexif().get(_EXIF_ORIENTATION, 1) != 1:
                return None
        return _read_bytes(path), media_type(path)

    def render(self, source, object_id, index, window):
        with Image.open(_path_in(source, object_id)) as im:
            return im.convert("RGB")

    def derive_id(self, source: DataSource, rel_name: str) -> str:
        return upload_store.image_id(source.id, rel_name)


SOURCE = NaturalSource()
