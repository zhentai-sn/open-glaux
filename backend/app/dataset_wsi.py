"""P7 楔子：病理 WSI 数据集封装——列表 / OpenSlide 读 / DeepZoom 瓦片 / MPP 标定 / region 抽块。

镜像 :mod:`dataset_ct` 的形态：纯数据 IO（OpenSlide 在主进程允许——数据 IO C 库，同 nibabel，
非重模型）。重模型（核分割 StarDist/HoVerNet）走 :mod:`segment_wsi` 隔离子进程。

对象 id 与文件（SDD 13 §7.2 规则 10–12、D-25）：
- 内置示例源（``wsi-demo``，``data/wsi/``）保留既有约定 ``slide_<3 位数字>.<后缀>``，id 形如
  ``slide_001``。
- 导入源与项目源不看文件名前缀：``source.root`` 下一层、单文件 TIFF 族且 OpenSlide 能识别格式
  的切片，id 为 ``wsi-<源哈希8>-<文件名哈希8>``。多文件格式（``.mrxs``、``.vms``）不接受。
- 按 id 取文件一律经 :func:`_path_of`（``resolve_object`` → 所属数据源 → 源目录内定位）。

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
from pathlib import Path

import numpy as np

from . import config

MODALITY = "pathology"
_ID_RE = re.compile(r"^slide_\d{3}$")

#: 单文件 TIFF 族（SDD 13 §7.2 规则 10）；顺序即内置源同名多后缀时的取用顺序。
_SUFFIXES = (".svs", ".tif", ".tiff", ".ndpi", ".scn", ".bif")
#: TIFF 与 BigTIFF 的大小端魔数；同一后缀四行，``magic_matches`` 任一命中即符。
_TIFF_MAGICS = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")

TILE_SIZE = 256
OVERLAP = 1
TILE_FORMAT = "jpeg"


def _is_builtin_demo(source) -> bool:
    """内置示例源（``wsi-demo``）保留 ``slide_\\d{3}`` 文件名约定与既有 id（SDD 13 §7.2 规则 11）。

    按 ``origin`` 认，理由同 :func:`app.dataset_ct._is_builtin_demo`。
    """
    return source.origin == "builtin"


def _slide_name(name: str) -> bool:
    """后缀属单文件 TIFF 族（只看文件名，不读内容）。"""
    return Path(name).suffix.lower() in _SUFFIXES


def _detect_format(path: Path) -> str | None:
    """OpenSlide 能识别的格式名；缺库、读不了或不认识 → None。

    SDD 13 §7.2 规则 10：WSI 以 OpenSlide 能识别格式为准。
    """
    if not _openslide_ok():
        return None
    import openslide

    try:
        return openslide.OpenSlide.detect_format(str(path))
    except Exception:  # noqa: BLE001 - 损坏文件或 libopenslide 报错都视为不认识
        return None


def _files(root: Path) -> list[Path]:
    """目录下一层按后缀认得的切片文件（不读内容），按文件名排序。"""
    if not root.is_dir():
        return []
    return sorted(
        (p for p in root.iterdir() if p.is_file() and _slide_name(p.name)),
        key=lambda p: p.name,
    )


def object_id(source_id: str, rel_name: str) -> str:
    """导入源与项目源的对象 id：``wsi-<源哈希8>-<文件名哈希8>``（SDD 13 §7.2 规则 11、D-25）。"""
    from .sources.base import derive_object_id

    return derive_object_id("wsi", source_id, rel_name)


def _entries(source) -> list[tuple[str, Path]]:
    """该源下的 ``(对象 id, 路径)``，只按文件名得出、不读内容；内置源按既有约定。"""
    root = Path(source.root)
    if _is_builtin_demo(source):
        out: list[tuple[str, Path]] = []
        seen: set[str] = set()
        for p in _files(root):
            if _ID_RE.match(p.stem) and p.stem not in seen:
                seen.add(p.stem)
                out.append((p.stem, p))
        return out
    return [(object_id(source.id, p.name), p) for p in _files(root)]


@lru_cache(maxsize=256)
def _locate(root: str, source_id: str, slide_id: str) -> Path:
    """非内置源目录内按派生 id 反查文件。只缓存命中（未命中抛异常，lru_cache 不缓存）。

    瓦片请求每次都经 ``meta`` 取显示名，缓存免得逐请求扫目录；数据源增删时随 ``invalidate`` 清空。
    """
    for p in _files(Path(root)):
        if object_id(source_id, p.name) == slide_id:
            return p
    raise FileNotFoundError(f"WSI slide 不存在：{slide_id}（source={source_id}）")


def _file_of(source, slide_id: str) -> Path:
    """在给定数据源目录内按 id 定位切片；找不到 → :class:`FileNotFoundError`。"""
    if not _is_builtin_demo(source):
        p = _locate(str(source.root), source.id, slide_id)
        if not p.is_file():  # 文件在进程内被移走：丢弃陈旧命中再查一次
            _locate.cache_clear()
            p = _locate(str(source.root), source.id, slide_id)
        return p
    if _ID_RE.match(slide_id):
        for suf in _SUFFIXES:
            p = Path(source.root) / f"{slide_id}{suf}"
            if p.is_file():
                return p
    raise FileNotFoundError(f"WSI slide 不存在：{slide_id}（source={source.id}）")


def _path_of(slide_id: str) -> Path:
    """按对象 id 取切片路径：``resolve_object`` 找到所属数据源，再在该源目录内定位（§7.2 规则 12）。

    未知 id、非病理对象、文件已不在 → :class:`FileNotFoundError`（端点转 404）。
    """
    from . import datasource_registry as reg

    try:
        ref = reg.resolve_object(slide_id)
    except LookupError as e:
        raise FileNotFoundError(f"WSI slide 不存在：{slide_id}") from e
    if ref.modality != MODALITY:
        raise FileNotFoundError(f"不是 WSI slide：{slide_id}（{ref.modality}）")
    return _file_of(ref.datasource, slide_id)


def list_ids() -> list[str]:
    """全部 active WSI 源的 slide id（合并视图，同 id 首个源胜出，与 ``resolve_object`` 一致）。"""
    from . import datasource_registry as reg

    out: list[str] = []
    seen: set[str] = set()
    for ds in reg.active_sources(MODALITY):
        for oid in SOURCE.list_ids(ds):
            if oid not in seen:
                seen.add(oid)
                out.append(oid)
    return out


def is_wsi(slide_id: str) -> bool:
    """是否是本数据集内的 WSI slide id（白名单守卫，防路径穿越 + 错模态）。"""
    try:
        return slide_id in set(list_ids())
    except Exception:
        return False


@lru_cache(maxsize=4)
def _open(slide_id: str):
    """打开 OpenSlide（lru_cache 避免重复打开；后端单进程多请求时省句柄）。"""
    import openslide

    return openslide.OpenSlide(str(_path_of(slide_id)))


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
# openslide 缺失时 probe 为 False（可选依赖缺失是状态，不是错误）。
# slide 取帧按 OpenSlide level（强制）+ level-0 roi 读块（SDD 10 §5.2）。
# SDD 13 P2：按数据源列举、按文件派生 id；上面的读函数都经 _path_of 取文件。

from .datasource_registry import DataSource  # noqa: E402
from .schemas import Axis, Calibration, ObjectMeta  # noqa: E402
from .sources.base import (  # noqa: E402
    FrameTooLarge,
    SourceBase,
    is_direct_child,
    magic_matches,
    method_refs,
    resources_for,
    suffix_matches,
)

#: 单次取帧在目标 level 上读出的像素上限（与 SDD 10 §5.2 的 64 Mpx 同值）。
MAX_READ_PX = 64_000_000


def fit_level(slide_id: str, need: float) -> int:
    """按输出尺寸选层：降采样不超过 ``need``（区域长边 / 输出长边）的最粗一层，缺省 level 0。

    读出的像素至少铺满输出尺寸，再由 ``frame`` 缩到 ``size``；
    不在过粗的层上裁出小图（SDD 22 §7.1）。
    """
    downs = _open(slide_id).level_downsamples
    return max((i for i, d in enumerate(downs) if d <= max(need, 1.0)), default=0)


def _openslide_ok() -> bool:
    try:
        import openslide  # noqa: F401
    except Exception:  # noqa: BLE001 - 缺库或缺 libopenslide
        return False
    return True


class WsiSource(SourceBase):
    modality = MODALITY
    kind = "slide"
    label = "Pathology WSI"
    #: 项目识别用（SDD 13 §7.2 规则 10）：每个后缀四行魔数，最终以 OpenSlide 能否识别为准。
    formats = tuple((ext, magic, 0) for ext in _SUFFIXES for magic in _TIFF_MAGICS)
    #: 医学切片不走浏览器上传（SDD 08 D-5；SDD 13 §7.2 规则 13、D-23）。
    browser_upload = False
    caches = (_open, _deepzoom, _locate)

    def probe(self, root: Path) -> bool:
        # 只看后缀、不看文件名前缀（SDD 13 §7.2 规则 7）；不读内容，与既有内置源探测同代价。
        return _openslide_ok() and bool(_files(root))

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
        """只列 ``source.root`` 下一层（SDD 13 §7.2 规则 7）。

        内置源沿用既有约定（按文件名，不读内容）；其余源逐个校验魔数并交 OpenSlide 识别格式，
        不认识的文件不进列表。
        """
        entries = _entries(source)
        if _is_builtin_demo(source):
            return [oid for oid, _ in entries]
        return [oid for oid, path in entries if self._readable(path)]

    def _readable(self, path: Path) -> bool:
        return magic_matches(self.formats, path) and _detect_format(path) is not None

    def object_id_for(self, source: DataSource, path: Path) -> str | None:
        """SDD 13 §6.3：``source.root`` 下一层、后缀与魔数均符、OpenSlide 能识别的切片 → 对象 id。

        判定与 :meth:`list_ids` 同源（同一 ``_entries`` 命名 + 同一 ``_readable``）。内置源只认
        ``slide_\\d{3}.<后缀>``，其余文件名返回 None。
        """
        if not (
            is_direct_child(source, path)
            and suffix_matches(self.formats, path.name)
            and self._readable(path)
        ):
            return None
        if _is_builtin_demo(source):
            return path.stem if _ID_RE.match(path.stem) else None
        return object_id(source.id, path.name)

    def derive_id(self, source: DataSource, rel_name: str) -> str:
        """纯派生的对象 id（不读内容；项目列目录回填用）。内置源按约定，不符约定则不可派生。"""
        if _is_builtin_demo(source):
            stem = Path(rel_name).stem
            if not _ID_RE.match(stem):
                raise NotImplementedError(f"内置 WSI 源不含 {rel_name}")
            return stem
        return object_id(source.id, rel_name)

    def describe(self, source: DataSource, object_id: str) -> ObjectMeta:
        rec = image_meta(object_id)
        w, h = rec["dims"]
        mpp_um = rec["mpp_um"]
        slide = _open(object_id)
        spacing = (mpp_um[0], mpp_um[1]) if mpp_um else (None, None)
        unit = "um" if mpp_um else "px"
        # 派生 id 不可读，显示名取文件名；内置 id 即可读名，保持既有输出。
        display = "" if _is_builtin_demo(source) else _file_of(source, object_id).name
        return ObjectMeta(
            id=object_id,
            kind=self.kind,
            modality=self.modality,
            source_id=source.id,
            display_name=display,
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
        w, h = obj.axis("x").size, obj.axis("y").size
        x0, y0, x1, y1 = (0, 0, w, h) if roi is None else (roi.x0, roi.y0, roi.x1, roi.y1)
        if index.level is None and size is not None:
            # 未指定层：按输出尺寸选层（SDD 10 §5.2）
            need = max(x1 - x0, y1 - y0) / size
            index = index.model_copy(update={"level": fit_level(object_id, need)})
        index = self.default_index(obj, index)
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
        """读该文件夹第一张可识别切片的 OpenSlide mpp → {"mpp": [mx, my]}。读不出 → {}。

        不依赖文件名前缀（SDD 13 §7.2 规则 7）；mpp 逐张不同，结果只作源级提示，对象级标定
        取各切片自身属性（D-24）。
        """
        if not _openslide_ok():
            return {}
        import openslide

        slides = [p for p in _files(root) if self._readable(p)]
        if not slides:
            return {}
        try:
            s = openslide.OpenSlide(str(slides[0]))
            try:
                mx = float(s.properties[openslide.PROPERTY_NAME_MPP_X])
                my = float(s.properties[openslide.PROPERTY_NAME_MPP_Y])
            finally:
                s.close()
        except Exception:  # noqa: BLE001 - 缺属性、非法值或 OpenSlide 读失败都视为无标定
            return {}
        if mx > 0 and my > 0:
            return {"mpp": [mx, my]}
        return {}


SOURCE = WsiSource()
