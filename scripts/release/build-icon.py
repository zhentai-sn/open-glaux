"""Export the existing OwlLogo SVG as Windows icon assets (Pillow + CairoSVG)."""
from pathlib import Path
import re

import cairosvg
from PIL import Image

root = Path(__file__).resolve().parents[2]
source = (root / "frontend/src/components/OwlLogo.tsx").read_text()
shapes = re.findall(r"<(?:circle|path)\b[^>]+/>", source)
if len(shapes) != 5:
    raise ValueError("OwlLogo geometry changed; review the desktop icon export.")
geometry = "\n".join(shapes)
geometry = geometry.replace('strokeWidth=', 'stroke-width=').replace('strokeLinecap=', 'stroke-linecap=')
geometry = geometry.replace('style={{ fill: "var(--li)" }}', 'fill="#ddd6fe"')
svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <!-- Generated from frontend/src/components/OwlLogo.tsx by scripts/release/build-icon.py. -->
  <rect x="12" y="12" width="232" height="232" rx="52" fill="#7c4dd6"/>
  <svg x="24" y="24" width="208" height="208" viewBox="0 0 24 24" fill="none" stroke="#ffffff">
    {geometry}
  </svg>
</svg>
'''
assets = root / "launcher/windows"
(assets / "glaux.svg").write_text(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to=str(assets / "glaux.png"), output_width=1024, output_height=1024)
with Image.open(assets / "glaux.png") as image:
    image.save(assets / "glaux.ico", sizes=[(s, s) for s in (16, 20, 24, 32, 40, 48, 64, 128, 256)])
    image.resize((256, 256), Image.Resampling.LANCZOS).save(assets / "glaux.png")
