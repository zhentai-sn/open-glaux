"""Atlas CLI（SDD 03 §6.2 / D-15）：标注数据集批量导入——COCO / YOLO / LabelMe（多边形 + 检测框）。

    uv run python -m app.atlas.cli import-dataset <dir> --format coco --tags tem edd \\
        --source-name "MN-EDD-v1" --license "CC BY 4.0" \\
        [--shareable --i-confirm-egress] [--describe]

- 幂等：重跑同一命令不产生重复记录（store 幂等键）。
- ``--shareable`` 必须同时给 ``--i-confirm-egress``（D-16 勾选协议在 CLI 的等价物）。
- ``--describe``：CLI 进程直接调 agent-runtime ``/agent-api/v1/atlas/describe``；连接凭据取
  环境变量 ``GLAUX_VLM_PROVIDER / GLAUX_VLM_MODEL / GLAUX_VLM_BASE_URL / GLAUX_VLM_API_KEY``，
  **不经 backend**。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from collections.abc import Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from .. import config
from .importer import ExemplarInput
from .store import Exemplar

IMG_SUFFIXES = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp")


@dataclass
class Sample:
    image_path: Path
    roi: tuple[int, int, int, int]
    polygon: list[list[float]] | None
    label: str
    locator: dict


def _bbox_of(points: Sequence[Sequence[float]]) -> tuple[int, int, int, int]:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
    return (int(x0), int(y0), max(1, int(round(x1 - x0))), max(1, int(round(y1 - y0))))


# --- 三种格式 → Sample -------------------------------------------------------------


def _iter_coco(root: Path) -> Iterator[Sample]:
    ann_files = sorted(root.glob("**/*.json"))
    for af in ann_files:
        try:
            data = json.loads(af.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(data, dict) or "annotations" not in data or "images" not in data:
            continue
        cats = {c["id"]: c.get("name", str(c["id"])) for c in data.get("categories", [])}
        imgs = {i["id"]: i for i in data["images"]}
        for a in data["annotations"]:
            im = imgs.get(a.get("image_id"))
            if not im:
                continue
            p = _find_image(root, af.parent, im.get("file_name", ""))
            if p is None:
                continue
            seg = a.get("segmentation")
            poly = None
            if isinstance(seg, list) and seg and isinstance(seg[0], list) and len(seg[0]) >= 6:
                flat = seg[0]
                poly = [[float(flat[i]), float(flat[i + 1])] for i in range(0, len(flat) - 1, 2)]
            if poly:
                roi = _bbox_of(poly)
            elif a.get("bbox"):
                x, y, w, h = a["bbox"]
                roi = (int(x), int(y), max(1, int(round(w))), max(1, int(round(h))))
            else:
                continue
            yield Sample(
                p,
                roi,
                poly,
                cats.get(a.get("category_id"), "object"),
                {"coco": af.name, "ann_id": a.get("id")},
            )


def _iter_yolo(root: Path) -> Iterator[Sample]:
    names: list[str] = []
    for cand in ("classes.txt", "obj.names", "names.txt"):
        f = root / cand
        if f.is_file():
            names = [ln.strip() for ln in f.read_text(encoding="utf-8").splitlines() if ln.strip()]
            break
    from PIL import Image

    for txt in sorted(root.glob("**/*.txt")):
        if txt.name in ("classes.txt", "obj.names", "names.txt"):
            continue
        img = None
        for suf in IMG_SUFFIXES:
            cand = txt.with_suffix(suf)
            if cand.is_file():
                img = cand
                break
            alt = Path(str(txt).replace("/labels/", "/images/")).with_suffix(suf)
            if alt.is_file():
                img = alt
                break
        if img is None:
            continue
        with Image.open(img) as im:
            W, H = im.size
        for ln, line in enumerate(txt.read_text(encoding="utf-8").splitlines()):
            parts = line.split()
            if len(parts) < 5:
                continue
            try:
                cid = int(float(parts[0]))
                vals = [float(v) for v in parts[1:]]
            except ValueError:
                continue
            label = names[cid] if 0 <= cid < len(names) else str(cid)
            if len(vals) == 4:  # 检测框 cx cy w h（归一化）
                cx, cy, w, h = vals
                roi = (
                    int((cx - w / 2) * W),
                    int((cy - h / 2) * H),
                    max(1, int(w * W)),
                    max(1, int(h * H)),
                )
                poly = None
            else:  # 分割多边形 x1 y1 x2 y2 ...（归一化）
                poly = [[vals[i] * W, vals[i + 1] * H] for i in range(0, len(vals) - 1, 2)]
                roi = _bbox_of(poly)
            yield Sample(img, roi, poly, label, {"yolo": txt.name, "line": ln})


def _iter_labelme(root: Path) -> Iterator[Sample]:
    for jf in sorted(root.glob("**/*.json")):
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if not isinstance(data, dict) or "shapes" not in data:
            continue
        p = _find_image(root, jf.parent, data.get("imagePath", ""))
        if p is None:
            continue
        for i, sh in enumerate(data["shapes"]):
            pts = sh.get("points") or []
            st = sh.get("shape_type", "polygon")
            if st == "rectangle" and len(pts) == 2:
                (x0, y0), (x1, y1) = pts
                roi = (
                    int(min(x0, x1)),
                    int(min(y0, y1)),
                    max(1, int(abs(x1 - x0))),
                    max(1, int(abs(y1 - y0))),
                )
                poly = None
            elif st == "polygon" and len(pts) >= 3:
                poly = [[float(a), float(b)] for a, b in pts]
                roi = _bbox_of(poly)
            else:
                continue
            yield Sample(p, roi, poly, sh.get("label", "object"), {"labelme": jf.name, "shape": i})


def _find_image(root: Path, near: Path, file_name: str) -> Path | None:
    if not file_name:
        return None
    for base in (near, root, root / "images", near / "images"):
        c = base / file_name
        if c.is_file():
            return c
    hits = list(root.glob(f"**/{Path(file_name).name}"))
    return hits[0] if hits else None


ITERATORS = {"coco": _iter_coco, "yolo": _iter_yolo, "labelme": _iter_labelme}


# --- 描述（可选，走 runtime） -------------------------------------------------------------


def _describe_via_runtime(png: bytes, hint: str) -> dict | None:
    """凭据来自环境变量；缺失即跳过。返回 description JSON 或 None。"""
    import httpx

    provider = os.environ.get("GLAUX_VLM_PROVIDER")
    model = os.environ.get("GLAUX_VLM_MODEL")
    if not provider or not model:
        return None
    body = {
        "image_base64": base64.b64encode(png).decode("ascii"),
        "mime_type": "image/png",
        "hint": hint,
        "connection": {
            "provider": provider,
            "model": model,
            "base_url": os.environ.get("GLAUX_VLM_BASE_URL") or None,
            "api_key": os.environ.get("GLAUX_VLM_API_KEY") or None,
        },
    }
    try:
        r = httpx.post(
            f"{config.AGENT_RUNTIME_URL}/agent-api/v1/atlas/describe", json=body, timeout=120
        )
        r.raise_for_status()
        return r.json().get("description")
    except Exception as exc:  # noqa: BLE001
        print(f"  ! describe 失败：{exc}", file=sys.stderr)
        return None


# --- 主流程 -----------------------------------------------------------------------


def import_dataset(
    root: Path,
    *,
    fmt: str,
    tags: Sequence[str],
    source_name: str,
    license_: str,
    shareable: bool,
    confirm_egress: bool,
    describe: bool,
    limit: int | None = None,
) -> list[dict]:
    from . import service

    if shareable and not confirm_egress:
        raise SystemExit(
            "--shareable 必须同时给 --i-confirm-egress（确认有权将图发往第三方模型服务）"
        )
    it: Iterable[Sample] = ITERATORS[fmt](root)
    svc = service.get()
    consent = (
        {
            "confirmed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "statement_version": "v1",
            "via": "cli",
        }
        if shareable
        else None
    )
    inputs: list[ExemplarInput] = []
    metas: list[Sample] = []
    for n, s in enumerate(it):
        if limit is not None and n >= limit:
            break
        png = s.image_path.read_bytes()
        inputs.append(
            ExemplarInput(
                roi=s.roi,
                tags=[*tags, s.label],
                source_type="dataset",
                source={
                    "dataset": source_name,
                    "license": license_,
                    "file": s.image_path.name,
                    **s.locator,
                },
                egress="shareable" if shareable else "local-only",
                egress_consent=consent,
                caption=s.label,
                geometry=s.polygon,
                image_base64=base64.b64encode(png).decode("ascii"),
            )
        )
        metas.append(s)
    if not inputs:
        print("未找到任何标注样本", file=sys.stderr)
        return []
    results = svc.importer.create(inputs)
    created = sum(1 for r in results if r["created"])
    print(f"导入 {len(results)} 条（新建 {created}，已存在 {len(results) - created}）")
    if describe:
        for r, s in zip(results, metas, strict=True):
            if not r["created"]:
                continue
            ex: Exemplar | None = svc.store.get(r["exemplar_id"])
            if ex is None:
                continue
            png = svc.images.read(ex.crop_ref or ex.image_ref)
            desc = _describe_via_runtime(png, hint=f"标签：{', '.join(ex.tags_raw)}")
            svc.store.set_description(ex.exemplar_id, desc, "done" if desc else "pending")
    else:
        for r in results:
            if r["created"]:
                svc.store.set_description(r["exemplar_id"], None, "skipped")
    return results


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="glaux-atlas")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("import-dataset", help="导入标注数据集目录")
    p.add_argument("dir", type=Path)
    p.add_argument("--format", choices=sorted(ITERATORS), required=True)
    p.add_argument("--tags", nargs="+", required=True)
    p.add_argument("--source-name", required=True)
    p.add_argument("--license", dest="license_", default="unknown")
    p.add_argument("--shareable", action="store_true")
    p.add_argument("--i-confirm-egress", action="store_true")
    p.add_argument("--describe", action="store_true")
    p.add_argument("--limit", type=int)
    args = ap.parse_args(argv)
    if args.cmd == "import-dataset":
        import_dataset(
            args.dir,
            fmt=args.format,
            tags=args.tags,
            source_name=args.source_name,
            license_=args.license_,
            shareable=args.shareable,
            confirm_egress=args.i_confirm_egress,
            describe=args.describe,
            limit=args.limit,
        )
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
