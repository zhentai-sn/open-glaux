"""教科书 PDF 抽图（SDD 03 §4.1 / §6.1 / D-8）：PyMuPDF 抽**嵌入图** + 同页最近文本块作图注候选。

只处理文字版 PDF；扫描版（整页一张图、无文本）不在范围——抽不到合格嵌入图时抛 ``NoFiguresFound``。
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field

from PIL import Image

MIN_SIDE_PX = 64  # 过滤图标 / 装饰线
MAX_FIGURES = 200
CAPTION_MAX_CHARS = 400


class NoFiguresFound(Exception):
    code = "NO_FIGURES_FOUND"


@dataclass
class FigureCandidate:
    index: int
    page: int  # 1-based
    png: bytes
    width: int
    height: int
    caption: str
    bbox: tuple[float, float, float, float] | None = None  # 页面坐标（pt）
    nearby: list[str] = field(default_factory=list)


def _is_flat(im: Image.Image) -> bool:
    """纯色/近纯色（装饰块）判定：极值差很小。"""
    g = im.convert("L")
    lo, hi = g.getextrema()
    return (hi - lo) < 8


def _nearest_caption(page, rect) -> tuple[str, list[str]]:
    """同页文本块中，优先图正下方、其次最近的块；返回 ``(caption, nearby[])``。"""
    blocks = [b for b in page.get_text("blocks") if b[6] == 0 and (b[4] or "").strip()]
    if not blocks:
        return "", []
    cx = (rect.x0 + rect.x1) / 2

    def _score(b) -> tuple[int, float]:
        bx0, by0, bx1, by1, text = b[0], b[1], b[2], b[3], b[4]
        below = by0 >= rect.y1 - 2
        horiz_overlap = not (bx1 < rect.x0 or bx0 > rect.x1)
        dist = abs(by0 - rect.y1) if below else min(abs(by1 - rect.y0), abs(by0 - rect.y1))
        starts_like_fig = text.lstrip()[:3].lower() in (
            "fig",
            "图 ",
            "图1",
            "图2",
        ) or text.lstrip().startswith("图")
        rank = 0 if (below and horiz_overlap) else 1 if horiz_overlap else 2
        if starts_like_fig:
            rank -= 1
        return (rank, dist + abs(((bx0 + bx1) / 2) - cx) * 0.1)

    ranked = sorted(blocks, key=_score)
    caption = " ".join(ranked[0][4].split())[:CAPTION_MAX_CHARS]
    nearby = [" ".join(b[4].split())[:CAPTION_MAX_CHARS] for b in ranked[1:4]]
    return caption, nearby


def extract_figures(pdf_bytes: bytes, *, min_side: int = MIN_SIDE_PX) -> list[FigureCandidate]:
    import pymupdf  # 延迟导入：让缺 pymupdf 的环境仍可 import 本包

    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    out: list[FigureCandidate] = []
    seen_xref: set[int] = set()
    try:
        for pno in range(doc.page_count):
            page = doc[pno]
            for info in page.get_images(full=True):
                xref = info[0]
                if xref in seen_xref:
                    continue
                seen_xref.add(xref)
                try:
                    pix = pymupdf.Pixmap(doc, xref)
                    if pix.n - pix.alpha >= 4:  # CMYK 等 → RGB
                        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                    png = pix.tobytes("png")
                except Exception:  # noqa: BLE001 - 单张损坏图跳过
                    continue
                im = Image.open(io.BytesIO(png))
                im.load()
                if min(im.size) < min_side or _is_flat(im):
                    continue
                rects = page.get_image_rects(xref)
                rect = rects[0] if rects else None
                caption, nearby = _nearest_caption(page, rect) if rect is not None else ("", [])
                out.append(
                    FigureCandidate(
                        index=len(out),
                        page=pno + 1,
                        png=png,
                        width=im.size[0],
                        height=im.size[1],
                        caption=caption,
                        bbox=(rect.x0, rect.y0, rect.x1, rect.y1) if rect is not None else None,
                        nearby=nearby,
                    )
                )
                if len(out) >= MAX_FIGURES:
                    break
            if len(out) >= MAX_FIGURES:
                break
    finally:
        doc.close()
    if not out:
        raise NoFiguresFound("未识别到嵌入图（扫描版 PDF 不支持，可手动截图导入）")
    return out
