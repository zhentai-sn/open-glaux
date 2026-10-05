"""SDD 22 §7.3：把对象在当前索引上的标注画到帧图上，供智能体看图复核。

只改返回给智能体的那张图，不改存储与查看器。对象坐标经 ``ReferenceFrame`` 换算到帧像素：
帧像素 = (对象坐标 − origin) × scale。
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from .schemas import ReferenceFrame

#: 状态 → 颜色（RGB）；建议态另画虚线。
_COLORS = {"suggested": (255, 196, 0), "confirmed": (0, 220, 120), "draft": (80, 170, 255)}
_SKIP = {"rejected"}


def overlay_rows(rows: list[dict]) -> list[dict]:
    """参与叠加的标注（去掉已驳回），按创建顺序编号 A1、A2…。"""
    kept = [r for r in rows if r.get("status") not in _SKIP]
    return [{**r, "tag": f"A{i}"} for i, r in enumerate(kept, start=1)]


def legend(rows: list[dict]) -> list[dict]:
    """``X-Glaux-Overlay`` 图例：编号、id、标签、状态、来源。"""
    return [
        {
            "tag": r["tag"],
            "annotation_id": r["id"],
            "label": r.get("label") or "",
            "status": r.get("status") or "",
            "source": r.get("source") or "",
        }
        for r in rows
    ]


def _to_px(frame: ReferenceFrame, x: float, y: float) -> tuple[float, float]:
    ox, oy = frame.origin
    return (x - ox) * frame.scale, (y - oy) * frame.scale


def _dashed(draw: ImageDraw.ImageDraw, a, b, color, width: int, dash: float = 8.0) -> None:
    (x0, y0), (x1, y1) = a, b
    length = max(((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5, 1e-6)
    steps = max(int(length // dash), 1)
    for i in range(0, steps, 2):
        t0, t1 = i / steps, min((i + 1) / steps, 1.0)
        draw.line(
            [
                (x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0),
                (x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1),
            ],
            fill=color,
            width=width,
        )


def _outline(draw, points, color, width: int, dashed: bool) -> None:
    for a, b in zip(points, points[1:] + points[:1]):
        if dashed:
            _dashed(draw, a, b, color, width)
        else:
            draw.line([a, b], fill=color, width=width)


def _mask_edges(
    mask_path: Path, frame: ReferenceFrame, size: tuple[int, int]
) -> Image.Image | None:
    """掩膜外轮廓：取对象中帧覆盖的部分，缩放到帧尺寸后求边缘。"""
    if not mask_path.is_file():
        return None
    with Image.open(mask_path) as raw:
        mask = raw.convert("L")
        ox, oy = frame.origin
        box = (ox, oy, ox + size[0] / frame.scale, oy + size[1] / frame.scale)
        region = mask.crop(tuple(int(round(v)) for v in box)).resize(size, Image.NEAREST)
    binary = region.point(lambda v: 255 if v > 0 else 0)
    return ImageChops.subtract(binary, binary.filter(ImageFilter.MinFilter(3)))


def draw_overlay(
    data: bytes, mime: str, frame: ReferenceFrame, rows: list[dict], masks_root: Path
) -> bytes:
    """把已编号的 ``rows`` 画到帧图上，返回同 MIME 的字节。"""
    image = Image.open(BytesIO(data)).convert("RGB")
    draw = ImageDraw.Draw(image)
    width = max(2, round(max(image.size) / 400))
    for r in rows:
        color = _COLORS.get(r.get("status") or "", (255, 255, 255))
        dashed = r.get("status") == "suggested"
        prim = r.get("primitive") or {}
        kind = prim.get("kind")
        anchor: tuple[float, float] | None = None
        if kind == "bbox":
            a = _to_px(frame, prim["x0"], prim["y0"])
            b = _to_px(frame, prim["x1"], prim["y1"])
            corners = [a, (b[0], a[1]), b, (a[0], b[1])]
            _outline(draw, corners, color, width, dashed)
            anchor = a
        elif kind == "polyline":
            points = [_to_px(frame, x, y) for x, y in prim.get("points", [])]
            if len(points) >= 2:
                _outline(draw, points, color, width, dashed)
                anchor = min(points, key=lambda p: (p[1], p[0]))
        elif kind == "point":
            x, y = _to_px(frame, prim["x"], prim["y"])
            s = width * 4
            draw.line([(x - s, y), (x + s, y)], fill=color, width=width)
            draw.line([(x, y - s), (x, y + s)], fill=color, width=width)
            anchor = (x, y)
        elif kind == "mask" and prim.get("ref"):
            edges = _mask_edges(masks_root / prim["ref"], frame, image.size)
            if edges is not None:
                image.paste(Image.new("RGB", image.size, color), mask=edges)
                bbox = edges.getbbox()
                anchor = (bbox[0], bbox[1]) if bbox else None
        if anchor is not None:
            ax = min(max(anchor[0], 0), image.size[0] - 1)
            ay = min(max(anchor[1] - 14, 0), image.size[1] - 1)
            draw.rectangle([ax, ay, ax + 22, ay + 13], fill=(0, 0, 0))
            draw.text((ax + 2, ay), r["tag"], fill=color)
    out = BytesIO()
    image.save(out, format="JPEG" if mime == "image/jpeg" else "PNG")
    return out.getvalue()
