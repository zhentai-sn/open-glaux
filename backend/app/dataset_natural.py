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

from pathlib import Path

from PIL import Image

from . import config, upload_store

MODALITY = "natural_image"
_JPEG_MAGIC = b"\xff\xd8\xff"
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

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


def _entries() -> list[tuple[str, Path, str]]:
    """全部可见图像：``(image_id, 绝对路径, 所属源展示名)``，按 §5.3 的稳定顺序。"""
    out: list[tuple[str, Path, str]] = []
    for src in _sources():
        root = Path(src.root)
        if _is_builtin_demo(src):
            for image_id, filename in ASSETS.items():  # 声明顺序
                out.append((image_id, root / filename, "Natural images"))
            continue
        for path in sorted(root.iterdir(), key=lambda p: p.name):  # 源内按文件名
            if upload_store.is_supported_file(path):
                out.append((upload_store.image_id(src.id, path.name), path, src.name))
    return out


def _find(image_id: str) -> tuple[Path, str]:
    for candidate, path, center in _entries():
        if candidate == image_id:
            return path, center
    raise FileNotFoundError(f"未知通用图像：{image_id}")


def _read_bytes(path: Path) -> bytes:
    """读原始字节并按魔数确认仍是受支持的图（落盘后被替换/截断也拦得住）。"""
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise FileNotFoundError(f"通用图像不存在：{path.name}") from exc
    if not (data.startswith(_JPEG_MAGIC) or data.startswith(_PNG_MAGIC)):
        raise FileNotFoundError(f"通用图像格式无效：{path.name}")
    return data


def media_type(path: Path) -> str:
    return "image/png" if path.suffix.lower() == ".png" else "image/jpeg"


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
            if image.format not in ("JPEG", "PNG"):
                raise FileNotFoundError(f"通用图像格式无效：{path.name}")
            size = image.size
            image.verify()
            return size
    except (OSError, ValueError) as exc:
        raise FileNotFoundError(f"通用图像不存在或损坏：{path.name}") from exc


def image_size(image_id: str) -> tuple[int, int]:
    """返回 (width, height)，供统一 Annotation 越界校验。"""
    path, _ = _find(image_id)
    return _probe(path)
