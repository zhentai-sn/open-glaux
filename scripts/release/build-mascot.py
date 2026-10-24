"""Redraw the composer mascot in the 2026-10-24 mark language (heart disc + V notch).

Source of truth for the look: docs/designs/2026-10-24-001-owl-mark-rework.zh-CN.md §5-§6.
Output: frontend/src/assets/mascot/mascot-<state>.png — one 8-column strip per state,
each frame 32x32, transparent background, three colours only:

    1  #7c4dd6  disc / body
    2  #f0eafc  eye plate (the same pale the mark uses for its negative eyes)
    3  #2a1b4a  pupil, eyelid, beak

The mascot is the mark's head only — no body, no feet — so it stays as abstract as the
mark. Every state shares one eye plate; only the pupil or eyelid inside it changes.

Run:  python scripts/release/build-mascot.py [--preview]
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/src/assets/mascot"

N = 32
COLS = 8
PURPLE, PALE, DARK = 1, 2, 3
RGBA = {
    0: (0, 0, 0, 0),
    PURPLE: (0x7C, 0x4D, 0xD6, 255),
    PALE: (0xF0, 0xEA, 0xFC, 255),
    DARK: (0x2A, 0x1B, 0x4A, 255),
}

# ---- 几何（32 网格；只有头：面盘 = 椭圆 − 顶部 V 缺口，与 16 网格标识同源） ----
DISC_CX, DISC_CY, DISC_RX, DISC_RY = 16.0, 16.0, 10.8, 10.4
NOTCH = ((13.0, 4.6), (19.0, 4.6), (16.0, 11.0))  # 宽 6.0、深 6.4，耳丘明显
EYE_L, EYE_R, EYE_CY = 11.3, 20.7, 17.2
EYE_R_PLATE = 3.4  # 浅色眼盘半径，约 7×7（与标识同比例：眼宽约为面盘宽的 1/3）


def ell(x: float, y: float, cx: float, cy: float, rx: float, ry: float) -> bool:
    dx, dy = (x - cx) / rx, (y - cy) / ry
    return dx * dx + dy * dy <= 1.0


def tri(x: float, y: float, a, b, c) -> bool:
    def s(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])

    d1, d2, d3 = s((x, y), a, b), s((x, y), b, c), s((x, y), c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


class Canvas:
    def __init__(self) -> None:
        self.g = [[0] * N for _ in range(N)]

    def put(self, x: int, y: int, color: int) -> None:
        if 0 <= x < N and 0 <= y < N:
            self.g[y][x] = color

    def paint(self, pred, color: int) -> None:
        for y in range(N):
            for x in range(N):
                if pred(x + 0.5, y + 0.5):
                    self.g[y][x] = color

    def image(self) -> Image.Image:
        img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
        px = img.load()
        for y in range(N):
            for x in range(N):
                px[x, y] = RGBA[self.g[y][x]]
        return img


def eye(c: Canvas, cx: float, cy: float, mode: str, px: int = 0, py: int = 0) -> None:
    """One eye: pale plate + the acting mark inside it."""
    cx, cy = int(round(cx)), int(round(cy))
    for dx in range(-3, 4):
        for dy in range(-3, 4):
            if ell(dx, dy, 0, 0, EYE_R_PLATE, EYE_R_PLATE):
                c.put(cx + dx, cy + dy, PALE)

    if mode == "open":          # 3×3 瞳，居中
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                c.put(cx + dx + px, cy + dy + py, DARK)
    elif mode == "wide":        # 1×1 瞳，惊讶
        c.put(cx + px, cy + py, DARK)
    elif mode == "closed":      # 一条眼睑
        for dx in (-2, -1, 0, 1, 2):
            c.put(cx + dx, cy, DARK)
    elif mode == "half":        # 眼睑压到下半
        for dx in (-2, -1, 0, 1, 2):
            c.put(cx + dx, cy + 1, DARK)
    elif mode == "happy":       # 弯成 ^
        for dx in (-2, 2):
            c.put(cx + dx, cy + 1, DARK)
        for dx in (-1, 1):
            c.put(cx + dx, cy, DARK)
        c.put(cx, cy - 1, DARK)
    elif mode == "error":       # ×
        for i in (-1, 0, 1):
            c.put(cx + i, cy + i, DARK)
            c.put(cx + i, cy - i, DARK)


def prop(c: Canvas, kind: str, t: int = 0, dx: int = 0, dy: int = 0) -> None:
    """配件：只占用头部四周的留白，同三色，不描边。"""
    if kind == "spinner":       # 思考：三颗点绕圈
        ring = ((29, 4), (31, 6), (29, 8), (27, 6))
        for k in range(3):
            x, y = ring[(t + k) % 4]
            for ddx in (0, 1):
                for ddy in (0, 1):
                    c.put(x + ddx, y + ddy, DARK)
    elif kind == "headphones":  # 输出：头戴式耳机（沿头顶的弧形头梁 + 两只耳罩），随头一起动
        for x in range(5, 28):
            rel = x + 0.5 - 16
            if abs(rel) > 11.4:
                continue
            band = int(round(17 - (11.4 ** 2 - rel ** 2) ** 0.5))
            c.put(x + dx, band + dy, DARK)
            c.put(x + dx, band + 1 + dy, DARK)
        for y in range(12, 20):
            for x in (3, 4, 5):
                c.put(x + dx, y + dy, DARK)
            for x in (26, 27, 28):
                c.put(x + dx, y + dy, DARK)
    elif kind == "question":    # 等待确认：问号
        for x in range(28, 31):
            c.put(x, 3, DARK)
        c.put(31, 4, DARK)
        c.put(30, 5, DARK)
        c.put(29, 6, DARK)
        c.put(29, 8, DARK)
    elif kind == "exclaim":     # 出错：感叹号
        for y in range(3, 8):
            for x in (29, 30):
                c.put(x, y, DARK)
        for x in (29, 30):
            c.put(x, 9, DARK)
    elif kind == "sparkle":     # 开心：一大一小两颗星
        for (cx, cy) in ((3, 5), (28, 4)):
            c.put(cx, cy, DARK)
            c.put(cx - 1, cy, DARK)
            c.put(cx + 1, cy, DARK)
            c.put(cx, cy - 1, DARK)
            c.put(cx, cy + 1, DARK)
        c.put(6, 2, DARK)
        c.put(31, 8, DARK)
    elif kind == "motion":      # 被戳：左右动势线
        for y in (13, 16, 19):
            c.put(1, y, DARK)
            c.put(2, y + 1, DARK)
            c.put(30, y, DARK)
            c.put(29, y + 1, DARK)


def frame(
    dy: int = 0,
    dx: int = 0,
    eyes: str = "open",
    px: int = 0,
    py: int = 0,
    mouth: str = "closed",
    z: bool = False,
    prop_kind: str = "",
    t: int = 0,
) -> Image.Image:
    c = Canvas()

    def disc(x: float, y: float) -> bool:
        sx, sy = x - dx, y - dy
        if not ell(sx, sy, DISC_CX, DISC_CY, DISC_RX, DISC_RY):
            return False
        return not tri(sx, sy, *NOTCH)

    c.paint(disc, PURPLE)

    eye(c, EYE_L + dx, EYE_CY + dy, eyes, px, py)
    eye(c, EYE_R + dx, EYE_CY + dy, eyes, px, py)

    # 喙：closed 小三角 / open 多一行 / flat 一条横线（报错时）
    top = 21 + dy
    if mouth == "flat":
        for x in range(15 + dx, 18 + dx):
            c.put(x, top + 1, DARK)
    else:
        for i in range(3 if mouth == "open" else 2):
            half = 1 if i < 2 else 0
            for x in range(16 - half + dx, 17 + half + dx):
                c.put(x, top + i, DARK)

    if prop_kind:
        prop(c, prop_kind, t, dx, dy)

    # 睡眠 z
    if z:
        for x in range(26, 29):
            c.put(x, 8, DARK)
        c.put(27, 9, DARK)
        c.put(26, 10, DARK)
        for x in range(26, 29):
            c.put(x, 11, DARK)

    return c.image()


# ---- 状态帧表：帧数与 Mascot.tsx 的 MASCOT_TRACKS 一致 ----
STATES: dict[str, list[dict]] = {
    "idle": [
        dict(dy=0), dict(dy=-1), dict(dy=0), dict(dy=1),
    ],
    "blink": [
        dict(eyes="closed"), dict(eyes="closed"),
    ],
    "thinking": [
        dict(px=1, py=-1, prop_kind="spinner", t=0),
        dict(px=1, py=-1, dx=1, prop_kind="spinner", t=1),
        dict(px=-1, py=-1, prop_kind="spinner", t=2),
        dict(px=-1, py=-1, dx=1, prop_kind="spinner", t=3),
    ],
    "typing": [
        dict(prop_kind="headphones", dy=0), dict(prop_kind="headphones", dy=1),
        dict(prop_kind="headphones", dy=0), dict(prop_kind="headphones", dy=1, mouth="open"),
    ],
    "happy": [
        dict(eyes="happy", dy=0, mouth="open", prop_kind="sparkle"),
        dict(eyes="happy", dy=-1, mouth="open", prop_kind="sparkle"),
        dict(eyes="happy", dy=-2, mouth="open", prop_kind="sparkle"),
        dict(eyes="happy", dy=-1, mouth="open", prop_kind="sparkle"),
    ],
    "error": [
        dict(eyes="error", mouth="flat", prop_kind="exclaim"),
        dict(eyes="error", dy=1, mouth="flat", prop_kind="exclaim"),
        dict(eyes="error", mouth="flat", prop_kind="exclaim"),
    ],
    "notification": [
        dict(eyes="wide", prop_kind="question"), dict(eyes="wide", dy=-1, prop_kind="question"),
        dict(eyes="wide", prop_kind="question"),
    ],
    "sleeping": [
        dict(eyes="closed", dy=1, z=True), dict(eyes="closed", dy=1, z=True, dx=1),
    ],
    "waking": [
        dict(eyes="half", dy=1), dict(eyes="half"), dict(eyes="open"),
    ],
    "poke": [
        dict(px=-1, dx=-1, prop_kind="motion"), dict(px=1, dx=1, prop_kind="motion"),
    ],
}


def build(preview: bool = False) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, frames in STATES.items():
        strip = Image.new("RGBA", (N * COLS, N), (0, 0, 0, 0))
        for i, params in enumerate(frames):
            strip.alpha_composite(frame(**params), (i * N, 0))
        strip.save(OUT / f"mascot-{name}.png")
        print(f"mascot-{name}.png frames={len(frames)}")

    if preview:
        out = ROOT / ".dev-logs/mascot-preview.png"
        make_preview().save(out)
        out48 = ROOT / ".dev-logs/mascot-preview-actual.png"
        make_preview_actual().save(out48)
        print(f"preview -> {out}")
        print(f"preview48 -> {out48}")


def make_preview_actual(size: int = 64) -> Image.Image:
    """Actual rendering size (2x of the 32 grid), as the composer shows it."""
    pad, label_w = 12, 96
    max_frames = max(len(v) for v in STATES.values())
    width = label_w + max_frames * (size + pad) + pad
    height = len(STATES) * (size + pad) + pad
    sheet = Image.new("RGBA", (width, height), (250, 249, 245, 255))
    for r, frames in enumerate(STATES.values()):
        y = pad + r * (size + pad)
        for i, params in enumerate(frames):
            img = frame(**params).resize((size, size), Image.Resampling.NEAREST)
            sheet.alpha_composite(img, (label_w + i * (size + pad), y))
    return sheet


def make_preview() -> Image.Image:
    """Every frame at 3x (96px) on a paper card, one row per state."""
    scale, pad, label_w = 3, 10, 96
    max_frames = max(len(v) for v in STATES.values())
    width = label_w + max_frames * (N * scale + pad) + pad
    height = len(STATES) * (N * scale + pad) + pad
    sheet = Image.new("RGBA", (width, height), (250, 249, 245, 255))
    for r, frames in enumerate(STATES.values()):
        y = pad + r * (N * scale + pad)
        for i, params in enumerate(frames):
            img = frame(**params).resize((N * scale, N * scale), Image.Resampling.NEAREST)
            sheet.alpha_composite(img, (label_w + i * (N * scale + pad), y))
    return sheet


if __name__ == "__main__":
    build(preview="--preview" in sys.argv)
