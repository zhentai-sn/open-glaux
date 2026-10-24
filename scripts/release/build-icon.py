"""Export the pixel mark in OwlLogo.tsx as icon assets (Pillow only, no SVG rasterizer).

OwlLogo.tsx is the single source: a 16-grid pixel master (rects). This script reads
those rects, builds the app-icon form (paper rounded plate carrying the same purple
owl) and writes:

    launcher/windows/glaux.svg      vector icon form, same 16 grid
    launcher/windows/glaux.png      256 px
    launcher/windows/glaux.ico      16/32/48/64/128/256
    frontend/public/favicon.png     32 px
    frontend/public/icon-512.png    512 px

Every output size is an integer multiple of the 16 grid, so one grid cell maps to a
whole number of pixels and edges stay hard (no resampling anywhere).
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "frontend/src/components/OwlLogo.tsx"
ASSETS = ROOT / "launcher/windows"

TILE = "#f0eafc"     # paper plate: readable on light and dark shells
OWL = "#7c4dd6"      # same purple as the in-app mark
TILE_RADIUS = 3.2  # in grid units

RECT = re.compile(
    r'<rect\s+x=\{(-?\d+)\}\s+y=\{(-?\d+)\}\s+width=\{(\d+)\}\s+height=\{(\d+)\}'
    r'\s+fill="(#[0-9a-fA-F]{6})"\s*/>'
)


def read_master() -> tuple[int, dict[tuple[int, int], str]]:
    text = SOURCE.read_text(encoding="utf-8")
    view = re.search(r'viewBox="0 0 (\d+) (\d+)"', text)
    if not view or view.group(1) != view.group(2):
        raise SystemExit("OwlLogo.tsx must carry a square viewBox")
    size = int(view.group(1))
    cells: dict[tuple[int, int], str] = {}
    for mx, my, mw, mh, fill in RECT.findall(text):
        x, y, w, h = int(mx), int(my), int(mw), int(mh)
        for dy in range(h):
            for dx in range(w):
                cells[(x + dx, y + dy)] = fill.lower()
    if not cells:
        raise SystemExit("no <rect> geometry found in OwlLogo.tsx")
    if any(not (0 <= x < size and 0 <= y < size) for x, y in cells):
        raise SystemExit("OwlLogo.tsx geometry leaves the viewBox")
    return size, cells


def icon_cells(size: int, cells: dict[tuple[int, int], str]) -> dict[tuple[int, int], str]:
    """Icon form: paper rounded plate carrying the purple owl unchanged.

    The eye cells are paper in the master, so they read as holes to the plate colour;
    nothing else about the mark changes between app icon and in-app usage.
    """
    out: dict[tuple[int, int], str] = {}
    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            cx = min(max(px, TILE_RADIUS), size - TILE_RADIUS)
            cy = min(max(py, TILE_RADIUS), size - TILE_RADIUS)
            if (px - cx) ** 2 + (py - cy) ** 2 > TILE_RADIUS**2:
                continue  # outside the rounded corner
            out[(x, y)] = OWL if cells.get((x, y)) == OWL else TILE
    return out


def render(size: int, cells: dict[tuple[int, int], str]) -> Image.Image:
    scale = max(1, size // GRID)
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for (x, y), fill in cells.items():
        draw.rectangle(
            [x * scale, y * scale, (x + 1) * scale - 1, (y + 1) * scale - 1],
            fill=fill,
        )
    return image


def to_svg(size: int, cells: dict[tuple[int, int], str]) -> str:
    """Vector version of the icon form: one path per colour, integer grid units."""
    by_fill: dict[str, list[tuple[int, int, int, int]]] = {}
    for y in range(size):
        x = 0
        while x < size:
            fill = cells.get((x, y))
            if fill is None:
                x += 1
                continue
            w = 1
            while cells.get((x + w, y)) == fill:
                w += 1
            by_fill.setdefault(fill, []).append((x, y, w, 1))
            x += w
    body = []
    for fill, runs in by_fill.items():
        d = " ".join(f"M{x} {y}h{w}v1h-{w}z" for x, y, w, _ in runs)
        body.append(f'  <path fill="{fill}" d="{d}"/>')
    clip = f'  <rect width="{size}" height="{size}" rx="{TILE_RADIUS}" fill="{TILE}"/>'
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" '
        f'viewBox="0 0 {size} {size}" shape-rendering="crispEdges">\n'
        f"  <!-- Generated from frontend/src/components/OwlLogo.tsx by "
        f"scripts/release/build-icon.py. -->\n"
        f"{clip}\n" + "\n".join(body) + "\n</svg>\n"
    )


GRID, MASTER = read_master()
ICON = icon_cells(GRID, MASTER)

ASSETS.mkdir(parents=True, exist_ok=True)
(ASSETS / "glaux.svg").write_text(to_svg(GRID, ICON), encoding="utf-8")

png256 = render(256, ICON)
png256.save(ASSETS / "glaux.png")

ico = render(256, ICON)
ico.save(
    ASSETS / "glaux.ico",
    sizes=[(s, s) for s in (16, 32, 48, 64, 128, 256)],
)

render(32, ICON).save(ROOT / "frontend/public/favicon.png")
render(512, ICON).save(ROOT / "frontend/public/icon-512.png")

print(f"grid={GRID} cells={len(MASTER)} icon_cells={len(ICON)}")
print("wrote launcher/windows/{glaux.svg,glaux.png,glaux.ico}, frontend/public/{favicon.png,icon-512.png}")
