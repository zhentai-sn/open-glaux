"""原图 / 裁剪图落盘（SDD 03 §8 "原图与标记分存"、§9 ``image_ref``/``crop_ref``）。

寻址：``<root>/images/<sha256[:2]>/<sha256>.png``；裁剪图 ``.../<sha256>__<x>_<y>_<w>_<h>.png``。
同一原图被多条标记引用时只落一份；返回值一律为相对 ``root`` 的 POSIX 路径。
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path

from PIL import Image

Roi = tuple[int, int, int, int]  # x, y, w, h（图像像素坐标，左上原点）


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _to_png(data: bytes) -> tuple[bytes, Image.Image]:
    """任意 PIL 可读格式 → PNG bytes（8-bit 灰度或 RGB；丢 alpha）。"""
    im = Image.open(io.BytesIO(data))
    im.load()
    if im.mode in ("1", "I", "I;16", "LA"):
        im = im.convert("L")  # 单通道族（含 16 位 TEM/超声灰度）→ 8 位灰度
    elif im.mode != "L" and im.mode != "RGB":
        im = im.convert("RGB")  # 调色板 / RGBA / CMYK 等 → RGB
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue(), im


def clamp_roi(roi: Roi, size: tuple[int, int]) -> Roi:
    """把 ROI 收进图像边界（宽高至少 1）；与图像无交集或宽高非正时抛 ValueError。"""
    x, y, w, h = (int(v) for v in roi)
    W, H = size
    if w <= 0 or h <= 0 or x >= W or y >= H or x + w <= 0 or y + h <= 0:
        raise ValueError(f"roi {roi} 与图像 {size} 无交集")
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(x + w, W), min(y + h, H)
    return (x0, y0, max(1, x1 - x0), max(1, y1 - y0))


class ImageStore:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.images_dir = self.root / "images"

    def _rel(self, p: Path) -> str:
        return p.relative_to(self.root).as_posix()

    def abs_path(self, rel: str) -> Path:
        return self.root / rel

    def save_original(self, data: bytes) -> tuple[str, str, tuple[int, int]]:
        """落原图（转 PNG）。返回 ``(image_ref, image_sha256, (w, h))``；已存在则直接复用。

        sha256 对**输入字节**计算（而非转码后 PNG），使同一来源文件重复导入稳定命中。
        """
        digest = sha256_of(data)
        png, im = _to_png(data)
        d = self.images_dir / digest[:2]
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{digest}.png"
        if not p.exists():
            p.write_bytes(png)
        return self._rel(p), digest, im.size

    def save_crop(self, image_ref: str, image_sha256: str, roi: Roi) -> str:
        """按 ROI 从已落盘原图裁剪；幂等（同 sha+roi 复用）。"""
        src = self.abs_path(image_ref)
        with Image.open(src) as im:
            im.load()
            x, y, w, h = clamp_roi(roi, im.size)
            crop = im.crop((x, y, x + w, y + h))
            p = src.with_name(f"{image_sha256}__{x}_{y}_{w}_{h}.png")
            if not p.exists():
                crop.save(p, format="PNG")
        return self._rel(p)

    def read(self, rel: str) -> bytes:
        return self.abs_path(rel).read_bytes()
