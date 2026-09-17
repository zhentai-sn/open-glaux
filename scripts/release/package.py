#!/usr/bin/env python3
"""Create a source-free launcher ZIP; optionally include locally exported images.tar."""
import argparse
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[2]
launcher = Path(__file__).resolve().parent / "launcher"
# Published path in the ZIP -> source file. Launchers live in scripts/release/launcher but sit next to compose.yaml in the ZIP.
files = {name: root / name for name in ("compose.yaml", "README.md", "README.zh-CN.md", "LICENSE")}
files |= {name: launcher / name for name in ("start.sh", "stop.sh", "start.cmd", "stop.cmd", "start.command", "stop.command")}
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--images", type=Path, help="docker save tar for the two Compose image tags")
parser.add_argument("--output", type=Path, default=root / "dist/glaux-chat.zip")
args = parser.parse_args()
args.output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    for name, source in files.items():
        archive.write(source, f"glaux/{name}")
    if args.images:
        archive.write(args.images, "glaux/images.tar")
print(args.output)
