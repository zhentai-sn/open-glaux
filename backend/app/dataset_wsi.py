"""P7 楔子：病理 WSI 数据集封装——列表 / OpenSlide 读 / DeepZoom 瓦片 / MPP 标定 / region 抽块。

镜像 :mod:`dataset_ct` 的形态：纯数据 IO（OpenSlide 在主进程允许——数据 IO C 库，同 nibabel，
非重模型）。重模型（核分割 StarDist/HoVerNet）走 :mod:`segment_wsi` 隔离子进程。

P7 v0：``data/wsi/`` 下 ship 的 vendor 格式 slide（``.svs`` 等），ID 形如 ``slide_001``。
瓦片经 ``openslide.deepzoom.DeepZoomGenerator`` 动态生成（DZI 协议）+ 落盘缓存
（``WSI_CACHE/{id}/{dz_level}/{col}_{row}.jpeg``）。

坐标系（三套，钉死）：
- OpenSlide **level-0 px**（全分辨率）——ROI / 质心存储的真相坐标；``read_region`` 用。
- DeepZoom **level**（DZI 瓦片编号，与 OpenSlide level 反向：dz level 0 = 1×1 缩略，
  最大 dz level = 全分辨率）——仅瓦片路由用。``limit_bounds=False`` 保证 dz 最大层 dims
  == OpenSlide level-0 dims，三套坐标不产生偏移。
"""

from __future__ import annotations

import io
import re
from functools import lru_cache

import numpy as np

from . import config

_ID_RE = re.compile(r"^slide_\d{3}$")

TILE_SIZE = 256
OVERLAP = 1
TILE_FORMAT = "jpeg"


def _root():
    """当前生效的 WSI 数据根（注册表驱动）——无 active 源 → None（列空/404）。"""
    from . import datasource_registry as reg

    return reg.resolve_root("pathology")


def _slide_path(slide_id: str):
    """定位 slide 文件（按已知 vendor 后缀在当前 WSI 源根下找 ``{id}.<suffix>``）。"""
    root = _root()
    if root is not None:
        for suf in config._WSI_SUFFIXES:
            p = root / f"{slide_id}{suf}"
            if p.is_file():
                return p
    raise FileNotFoundError(f"WSI slide 不存在：{slide_id}（root={root}）")


def list_ids() -> list[str]:
    """当前 WSI 源下所有形如 ``slide_001.svs`` 的 slide id 列表。"""
    root = _root()
    if root is None or not root.is_dir():
        return []
    out: list[str] = []
    for p in sorted(root.glob("slide_*")):
        if p.suffix.lower() in config._WSI_SUFFIXES and _ID_RE.match(p.stem):
            out.append(p.stem)
    return out


def is_wsi(slide_id: str) -> bool:
    """是否是本数据集内的 WSI slide id（白名单守卫，防路径穿越 + 错模态）。"""
    try:
        return bool(_ID_RE.match(slide_id)) and slide_id in set(list_ids())
    except Exception:
        return False


@lru_cache(maxsize=4)
def _open(slide_id: str):
    """打开 OpenSlide（lru_cache 避免重复打开；后端单进程多请求时省句柄）。"""
    import openslide

    return openslide.OpenSlide(str(_slide_path(slide_id)))


@lru_cache(maxsize=4)
def _deepzoom(slide_id: str):
    """DeepZoomGenerator（limit_bounds=False → dz 最大层 == level-0，坐标不偏移）。"""
    from openslide.deepzoom import DeepZoomGenerator

    return DeepZoomGenerator(
        _open(slide_id), tile_size=TILE_SIZE, overlap=OVERLAP, limit_bounds=False
    )


def dims(slide_id: str) -> tuple[int, int]:
    """level-0 尺寸 (width, height) px。"""
    w, h = _open(slide_id).dimensions
    return int(w), int(h)


def mpp(slide_id: str) -> tuple[float, float]:
    """MPP (mpp_x, mpp_y) µm/px——读 OpenSlide ``openslide.mpp-x/y`` 属性。

    读不出/非正 → :class:`ValueError`（硬拒绝模板同 calibration 层；不出无标定假密度）。
    """
    import openslide

    props = _open(slide_id).properties
    try:
        mx = float(props[openslide.PROPERTY_NAME_MPP_X])
        my = float(props[openslide.PROPERTY_NAME_MPP_Y])
    except (KeyError, TypeError, ValueError) as e:
        raise ValueError(f"WSI {slide_id} 缺 MPP 属性（openslide.mpp-x/y）：{e}") from e
    if not (mx > 0 and my > 0):
        raise ValueError(f"WSI {slide_id} MPP 非正：({mx}, {my})")
    return mx, my


def tile(slide_id: str, level: int, col: int, row: int) -> bytes:
    """取一块 DeepZoom 瓦片 JPEG 字节（缓存优先：命中直读，未命中生成 + 落盘）。"""
    cache_dir = config.WSI_CACHE / slide_id / str(level)
    cache_path = cache_dir / f"{col}_{row}.{TILE_FORMAT}"
    if cache_path.is_file():
        return cache_path.read_bytes()

    dz = _deepzoom(slide_id)
    if not (0 <= level < dz.level_count):
        raise ValueError(f"DeepZoom level 越界：{level}（level_count={dz.level_count}）")
    cols, rows = dz.level_tiles[level]
    if not (0 <= col < cols and 0 <= row < rows):
        raise ValueError(f"瓦片坐标越界：({col},{row})（level {level} tiles={cols}×{rows}）")
    img = dz.get_tile(level, (col, row))  # PIL RGB
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    data = buf.getvalue()
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path.write_bytes(data)
    return data


def read_region(slide_id: str, x: int, y: int, w: int, h: int, level: int = 0) -> np.ndarray:
    """读一块 region → RGB ndarray (h, w, 3)。坐标是 level-0 px（OpenSlide 原生语义）。

    模型抽块（segment_wsi）+ ``/wsi/{id}/region`` 端点复用。越界/非正尺寸 → ValueError。
    """
    W, H = dims(slide_id)
    if w <= 0 or h <= 0:
        raise ValueError(f"region 尺寸非正：({w}, {h})")
    if x < 0 or y < 0 or x + w > W or y + h > H:
        raise ValueError(f"region 越界：({x},{y},{w},{h}) 超出 slide {W}×{H}")
    img = _open(slide_id).read_region((int(x), int(y)), int(level), (int(w), int(h)))
    return np.asarray(img.convert("RGB"), dtype=np.uint8)


def image_meta(slide_id: str) -> dict:
    """数据集元信息——与 /images 端点 shape 对齐（modality 恒 "pathology"）。

    MPP 读不出时 mpp_um 置 None（前端仍可浏览；跑核检测时 measure 会硬拒绝）。
    """
    try:
        mx, my = mpp(slide_id)
        mpp_um = [mx, my]
    except ValueError:
        mpp_um = None
    w, h = dims(slide_id)
    return {
        "id": slide_id,
        "center": "Pathology",
        "modality": "pathology",
        "cf": None,  # WSI 走 mpp，不是 cubs_cf
        "methods": ["stardist_he"],
        "mpp_um": mpp_um,
        "dims": [w, h],
    }


# --- SDD 10 数据轴：病理 WSI Source -------------------------------------------------
# 上面的函数体零改。openslide 缺失时 probe 为 False（可选依赖缺失是状态，不是错误）。
# slide 取帧按 OpenSlide level（强制）+ level-0 roi 读块（SDD 10 §5.2）。

from pathlib import Path  # noqa: E402

from .datasource_registry import DataSource  # noqa: E402
from .schemas import Axis, Calibration, ObjectMeta  # noqa: E402
from .sources.base import FrameTooLarge, SourceBase, method_refs, resources_for  # noqa: E402

#: 单次取帧在目标 level 上读出的像素上限（与 SDD 10 §5.2 的 64 Mpx 同值）。
MAX_READ_PX = 64_000_000


def _openslide_ok() -> bool:
    try:
        import openslide  # noqa: F401
    except Exception:  # noqa: BLE001 - 缺库或缺 libopenslide
        return False
    return True


class WsiSource(SourceBase):
    modality = "pathology"
    kind = "slide"
    label = "Pathology WSI"
    caches = (_open, _deepzoom)

    def probe(self, root: Path) -> bool:
        return (
            _openslide_ok()
            and root.is_dir()
            and any(p.suffix.lower() in config._WSI_SUFFIXES for p in root.glob("slide_*"))
        )

    def builtin_sample(self) -> DataSource:
        return DataSource(
            id="wsi-demo",
            name="WSI pathology · demo",
            modality=self.modality,
            root=config.WSI_ROOT,
            origin="builtin",
            calibration={"mpp": "openslide props"},
            provider="OpenSlide",
            license="CC BY",
            desc="H&E 全切片 demo · MPP 标定",
        )

    def list_ids(self, source: DataSource) -> list[str]:
        return list_ids()

    def describe(self, source: DataSource, object_id: str) -> ObjectMeta:
        rec = image_meta(object_id)
        w, h = rec["dims"]
        mpp_um = rec["mpp_um"]
        slide = _open(object_id)
        spacing = (mpp_um[0], mpp_um[1]) if mpp_um else (None, None)
        unit = "um" if mpp_um else "px"
        return ObjectMeta(
            id=object_id,
            kind=self.kind,
            modality=self.modality,
            source_id=source.id,
            axes=[Axis(name="x", size=w, spacing=spacing[0], unit=unit),
                  Axis(name="y", size=h, spacing=spacing[1], unit=unit),
                  Axis(name="level", size=int(slide.level_count), unit="factor")],
            calibration=(
                Calibration(kind="mpp_um", value=list(mpp_um), source="openslide_props")
                if mpp_um
                else None
            ),
            resources=resources_for(object_id, tiles=True),
            methods=method_refs(rec["methods"], agent=tuple(rec["methods"])),
            meta={
                "center": rec["center"],
                "level_downsamples": [float(d) for d in slide.level_downsamples],
            },
        )

    def tile(self, source, object_id, level, col, row):
        return tile(object_id, level, col, row)

    def frame(self, source, object_id, index, *, roi=None, size=None, window=None):
        """OpenSlide ``level``（强制）上读 ``roi``（level-0 px，缺省整片）→ PNG + ReferenceFrame。

        ``scale`` = 对象（level-0）坐标 → 返回图像素：1/downsample × 缩放。读出像素数超过
        :data:`MAX_READ_PX` 时 ``ValueError``（端点在此之前按 roi 面积给 413）。
        """
        from .schemas import ReferenceFrame
        from .sources.base import _png

        obj = self.meta(source, object_id)
        index = self.default_index(obj, index)
        w, h = obj.axis("x").size, obj.axis("y").size
        x0, y0, x1, y1 = (0, 0, w, h) if roi is None else (roi.x0, roi.y0, roi.x1, roi.y1)
        if roi is not None and (roi.kind != "box" or not (0 <= x0 < x1 <= w and 0 <= y0 < y1 <= h)):
            raise ValueError(f"roi 越界或非 box：({x0},{y0},{x1},{y1})，slide {w}×{h}")
        down = float(_open(object_id).level_downsamples[index.level])
        rw, rh = max(1, round((x1 - x0) / down)), max(1, round((y1 - y0) / down))
        if rw * rh > MAX_READ_PX:
            raise FrameTooLarge(f"level {index.level} 下读出 {rw}×{rh} 像素，超过上限")
        # OpenSlide read_region：位置是 level-0 坐标，尺寸是目标 level 的像素数
        img = _open(object_id).read_region((int(x0), int(y0)), int(index.level), (rw, rh))
        img = img.convert("RGB")
        scale = 1.0 / down
        if size is not None and max(img.size) > size:
            k = size / max(img.size)
            img = img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))))
            scale *= k
        ref = ReferenceFrame(object_id=object_id, index=index, origin=(float(x0), float(y0)),
                             scale=scale, width=img.width, height=img.height)
        return _png(img), "image/png", ref

    def detect_calibration(self, root: Path) -> dict:
        """读该文件夹第一张 slide 的 OpenSlide mpp → {"mpp": [mx, my]}。读不出 → {}。"""
        if not _openslide_ok():
            return {}
        import openslide

        slides = sorted(
            p for p in root.glob("slide_*") if p.suffix.lower() in config._WSI_SUFFIXES
        )
        if not slides:
            return {}
        try:
            s = openslide.OpenSlide(str(slides[0]))
            mx = float(s.properties[openslide.PROPERTY_NAME_MPP_X])
            my = float(s.properties[openslide.PROPERTY_NAME_MPP_Y])
            s.close()
        except (KeyError, TypeError, ValueError, OSError):
            return {}
        if mx > 0 and my > 0:
            return {"mpp": [mx, my]}
        return {}


SOURCE = WsiSource()
