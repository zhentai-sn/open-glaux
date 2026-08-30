"""自然图像 SAM 演示集合——固定白名单列图与安全取图。

这组照片只为走查 ``segment_region`` 的通用目标分割链路，不属于 science-core 任务，
没有标定、测量方法或模型适配器。固定 ID → 固定文件名的映射也是路径安全边界：HTTP 层
不能把用户给的 image_id 当路径拼接。
"""

from __future__ import annotations

from PIL import Image

from . import config

MODALITY = "natural_image"
_JPEG_MAGIC = b"\xff\xd8\xff"

# 顺序即文件栏顺序与 API 稳定顺序。
ASSETS: dict[str, str] = {
    "natural_cat": "cat.jpg",
    "natural_coffee": "coffee.jpg",
    "natural_car": "car.jpg",
    "natural_dog": "dog.jpg",
}


def _path(image_id: str):
    try:
        filename = ASSETS[image_id]
    except KeyError as exc:
        raise FileNotFoundError(f"未知自然图像：{image_id}") from exc
    return config.NATURAL_ROOT / filename


def _read_jpeg(image_id: str) -> bytes:
    path = _path(image_id)
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise FileNotFoundError(f"自然图像不存在：{image_id}") from exc
    if not data.startswith(_JPEG_MAGIC):
        raise FileNotFoundError(f"自然图像格式无效：{image_id}")
    return data


def list_ids() -> list[str]:
    """只暴露当前存在且可完整校验为 JPEG 的固定资产，保持映射声明顺序。"""
    out: list[str] = []
    for image_id in ASSETS:
        try:
            image_size(image_id)
        except FileNotFoundError:
            continue
        out.append(image_id)
    return out


def image_meta(image_id: str) -> dict:
    if image_id not in ASSETS:
        raise FileNotFoundError(f"未知自然图像：{image_id}")
    return {
        "id": image_id,
        "center": "Natural images",
        "cf": None,
        "methods": [],
        "modality": MODALITY,
    }


def image_jpeg(image_id: str) -> bytes:
    image_size(image_id)
    return _read_jpeg(image_id)


def image_size(image_id: str) -> tuple[int, int]:
    """返回 (width, height)，供统一 Annotation 越界校验。"""
    path = _path(image_id)
    try:
        with Image.open(path) as image:
            if image.format != "JPEG":
                raise FileNotFoundError(f"自然图像格式无效：{image_id}")
            size = image.size
            image.verify()
            return size
    except (OSError, ValueError) as exc:
        raise FileNotFoundError(f"自然图像不存在或损坏：{image_id}") from exc
