"""真实 CUBS-tech 数据接入（F5/F6）——列图、tiff→PNG、按方法读边界。

轻量按需：列表只扫文件名/CF 存在性，边界在真正需要时才逐图解析（read_profile），
不像 read_dataset 那样一次性解析 500×N 条边界。
"""

from __future__ import annotations

import io
import re
from functools import lru_cache

from glaux_core.io.boundaries import Boundary  # noqa: E402

# 复用 science-core 的读取器（磁盘格式的单一事实源）。
from glaux_core.io.cubs import load_cf, read_profile  # noqa: E402
from PIL import Image

from . import config

_TECH_RE = re.compile(r"^tech_(\d+)$")

# 模型 id → 边界来源目录名。caroSegDeep 特殊：走缓存 + 隔离子进程（segment_proc）。
CARO = "caroSegDeep"


def _in_demo(image_id: str) -> bool:
    m = _TECH_RE.match(image_id)
    if not m:
        return False
    return config.DEMO_ID_LO <= int(m.group(1)) <= config.DEMO_ID_HI


@lru_cache(maxsize=1)
def list_ids() -> list[str]:
    """演示队列内、且有图有 CF 的 image_id（排序）。"""
    ids = []
    for p in sorted(config.IMAGES_DIR.glob("*.tif*")):
        sid = p.stem
        if _in_demo(sid) and (config.CF_DIR / f"{sid}_CF.txt").is_file():
            ids.append(sid)
    return ids


def cf_of(image_id: str) -> float | None:
    try:
        return load_cf(config.CF_DIR / f"{image_id}_CF.txt")
    except Exception:
        return None


def methods_of(image_id: str) -> list[str]:
    """本图可用的边界方法（on-disk LIMA-Profiles 子目录 + 缓存的 caroSegDeep）。"""
    out: list[str] = []
    if _caro_cached(image_id):
        out.append(CARO)
    if config.SEG_DIR.is_dir():
        for d in sorted(config.SEG_DIR.iterdir()):
            if d.is_dir() and (d / f"{image_id}-LI.txt").is_file():
                out.append(d.name)
    return out


def _caro_cached(image_id: str) -> bool:
    d = config.CSD_CACHE / f"Computerized-{CARO}"
    return (d / f"{image_id}-LI.txt").is_file() and (d / f"{image_id}-MA.txt").is_file()


def image_meta(image_id: str) -> dict:
    return {
        "id": image_id,
        "center": "CUBS-tech",
        "cf": cf_of(image_id),
        "methods": methods_of(image_id),
    }


def image_png(image_id: str) -> bytes:
    """真实灰度 tiff → PNG（主进程无 TF，纯 PIL）。"""
    path = config.IMAGES_DIR / f"{image_id}.tiff"
    with Image.open(path) as im:
        im = im.convert("L")
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return buf.getvalue()


def image_size(image_id: str) -> tuple[int, int]:
    with Image.open(config.IMAGES_DIR / f"{image_id}.tiff") as im:
        return im.size  # (w, h)


def _method_dir(method: str):
    if method == CARO:
        return config.CSD_CACHE / f"Computerized-{CARO}"
    return config.SEG_DIR / method


def load_boundaries(image_id: str, method: str) -> tuple[Boundary, Boundary]:
    """读某方法的 LI/MA 为 Boundary（逐点）。缺失抛 FileNotFoundError。"""
    d = _method_dir(method)
    li_p, ma_p = d / f"{image_id}-LI.txt", d / f"{image_id}-MA.txt"
    if not (li_p.is_file() and ma_p.is_file()):
        raise FileNotFoundError(f"{method} 缺 {image_id} 的 LI/MA：{d}")
    return read_profile(li_p, "LI"), read_profile(ma_p, "MA")


def boundaries_as_points(image_id: str, method: str) -> tuple[list, list]:
    """LI/MA → [[x,y],...]（前端画布叠加用）。"""
    li, ma = load_boundaries(image_id, method)
    return (
        [[float(x), float(y)] for x, y in zip(li.x, li.y)],
        [[float(x), float(y)] for x, y in zip(ma.x, ma.y)],
    )


# --- SDD 10 数据轴：颈动脉超声 Source ------------------------------------------------
# 上面的函数体零改；Source 只把它们装进协议。合成队列（mock）作为开发者模式下显式注册的
# synthetic-us 数据源出现（D-17），不再是任何端点的隐式回退。

from pathlib import Path  # noqa: E402

from . import mock  # noqa: E402
from .datasource_registry import DataSource  # noqa: E402
from .schemas import Axis, Calibration, ObjectMeta  # noqa: E402
from .sources.base import SourceBase, resources_for  # noqa: E402

SYNTHETIC_ID = "synthetic-us"


class CarotidSource(SourceBase):
    modality = "carotid_imt"
    kind = "image"
    label = "Carotid ultrasound"
    caches = (list_ids,)

    def probe(self, root: Path) -> bool:
        return (
            (root / "images").is_dir()
            and (root / "CF").is_dir()
            and (root / "LIMA-Profiles").is_dir()
        )

    def builtin_sample(self) -> DataSource:
        return DataSource(
            id="cubs-tech",
            name="CUBS-tech · carotid US",
            modality=self.modality,
            root=config.DATA_ROOT,
            origin="builtin",
            calibration={"cf": "per-image CF.txt"},
            provider="CREATIS",
            license="CC BY",
            desc="颈动脉超声 · LI/MA 专家标注 · CF 标定",
        )

    def synthetic_sample(self) -> DataSource:
        return DataSource(
            id=SYNTHETIC_ID,
            name="Synthetic · carotid US",
            modality=self.modality,
            root=Path("synthetic"),
            origin="builtin",
            calibration={"cf": "synthetic"},
        )

    def list_ids(self, source: DataSource) -> list[str]:
        if source.synthetic:
            return [rec["id"] for rec in mock.dataset()]
        return list_ids()

    def describe(self, source: DataSource, object_id: str) -> ObjectMeta:
        if source.synthetic:
            rec = next((r for r in mock.dataset() if r["id"] == object_id), None)
            if rec is None:
                raise FileNotFoundError(f"合成颈动脉图不存在：{object_id}")
            (w, h), cal_source = (mock.W, mock.H), "synthetic"
        else:
            rec = image_meta(object_id)
            (w, h), cal_source = image_size(object_id), "cubs_cf"
        cf = rec["cf"]
        unit = "mm" if cf else "px"
        return ObjectMeta(
            id=object_id,
            kind=self.kind,
            modality=self.modality,
            source_id=source.id,
            axes=[Axis(name="x", size=w, spacing=cf, unit=unit),
                  Axis(name="y", size=h, spacing=cf, unit=unit)],
            calibration=(
                Calibration(kind="mm_per_px", value=cf, source=cal_source) if cf else None
            ),
            resources=resources_for(object_id),
            methods=rec["methods"],
            meta={"center": rec["center"]},
        )

    def encoded(self, source, object_id, index):
        if source.synthetic:
            return mock.synthetic_png(object_id), "image/png"
        return image_png(object_id), "image/png"

    def render(self, source, object_id, index, window):
        data, _ = self.encoded(source, object_id, index)
        return Image.open(io.BytesIO(data)).convert("L")


SOURCE = CarotidSource()
