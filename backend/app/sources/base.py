"""数据轴协议（SDD 10 §9.2）：一个模态一个 ``Source``，把既有 ``dataset_*.py`` 的函数装进对象。

``Source`` 只管数据轴——探测、列举、元数据、取帧、原始字节、瓦片、标定探测、内置示例与缓存失效；
不声明任务能力（那是 ``glaux_core.tasks.REGISTRY`` 的事，SDD 10 §7 规则 19）。

``SourceBase`` 提供缺省实现，其中 :meth:`SourceBase.meta` 在子类 :meth:`describe` 之后从
``axes`` / ``calibration`` **单向**回填过渡字段 ``cf`` / ``voxel_spacing_mm`` / ``mpp_um`` /
``dims`` 与 ``center``——服务端只有一套真相（D-10）。子类写这几个字段也会被覆盖。

本模块只依赖 pydantic 契约与 PIL，不 import 任何 ``dataset_*`` 模块，以便后者在模块末尾
继承 :class:`SourceBase` 时不形成循环导入。
"""

from __future__ import annotations

import io
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from ..schemas import Index, ObjectMeta, ReferenceFrame, Region

if TYPE_CHECKING:  # pragma: no cover
    from PIL import Image

    from ..datasource_registry import DataSource


class FrameTooLarge(ValueError):
    """取帧读出的像素超过上限（``/objects/{id}/frame`` 映射 413）。"""


class Source(Protocol):
    """数据轴协议。方法签名以 SDD 10 §9.2 为准，实现方不得增删必选参数。"""

    modality: str
    kind: str
    formats: tuple[tuple[str, bytes, int], ...]

    def probe(self, root: Path) -> bool: ...
    def list_ids(self, source: DataSource) -> list[str]: ...
    def is_mine(self, object_id: str) -> bool: ...
    def meta(self, source: DataSource, object_id: str) -> ObjectMeta: ...
    def frame(
        self,
        source: DataSource,
        object_id: str,
        index: Index,
        *,
        roi: Region | None = None,
        size: int | None = None,
        window: tuple[float, float] | None = None,
    ) -> tuple[bytes, str, ReferenceFrame]: ...
    def raw(self, source: DataSource, object_id: str) -> tuple[Path | bytes, str] | None: ...
    def tile(
        self, source: DataSource, object_id: str, level: int, col: int, row: int
    ) -> bytes | None: ...
    def detect_calibration(self, root: Path) -> dict: ...
    def builtin_sample(self) -> DataSource | None: ...
    def invalidate(self) -> None: ...


@dataclass(frozen=True)
class ObjectRef:
    """``resolve_object`` 的解析结果；后端内部用，不出现在任何响应体中（SDD 10 §4.2）。"""

    source: Source
    datasource: DataSource
    object_id: str
    kind: str
    modality: str


def resources_for(object_id: str, *, raw: bool = False, tiles: bool = False) -> dict[str, str]:
    """``ObjectMeta.resources`` 的 URL 模板（SDD 10 §5.1）。``frame`` 必有。"""
    out = {"frame": f"/objects/{object_id}/frame"}
    if raw:
        out["raw"] = f"/objects/{object_id}/raw"
    if tiles:
        out["tiles"] = f"/objects/{object_id}/tiles/{{level}}/{{col}}/{{row}}"
    return out


#: Calibration.kind → 过渡字段名。只做单向回填，不反推。
_LEGACY_BY_CAL_KIND = {"mm_per_px": "cf", "voxel_mm": "voxel_spacing_mm", "mpp_um": "mpp_um"}


def backfill_legacy(obj: ObjectMeta) -> ObjectMeta:
    """从 axes / calibration / meta 回填过渡字段；对同一对象重复回填结果不变（§10）。"""
    update: dict = {
        "cf": None,
        "voxel_spacing_mm": None,
        "mpp_um": None,
        "dims": None,
        "center": str(obj.meta.get("center", "")),
    }
    cal = obj.calibration
    field = _LEGACY_BY_CAL_KIND.get(cal.kind) if cal is not None else None
    if field == "cf":
        update["cf"] = float(cal.value)  # type: ignore[arg-type, union-attr]
    elif field is not None:
        update[field] = [float(v) for v in cal.value]  # type: ignore[union-attr]
    # 旧 dims 只对 WSI 下发（level-0 宽高，OSD tileSource 用），其余几何族为 null。
    if obj.kind == "slide":
        update["dims"] = [obj.axis("x").size, obj.axis("y").size]  # type: ignore[union-attr]
    return obj.model_copy(update=update)


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class SourceBase:
    """``Source`` 的缺省实现。子类至少实现 ``probe`` / ``list_ids`` / ``describe``。"""

    modality: str = ""
    kind: str = "image"
    formats: tuple[tuple[str, bytes, int], ...] = ()
    #: 模态切换器的服务端兜底文案与 i18n 键（D-22）。
    label: str = ""
    #: 导入时若既无显式标定也探测不出，是否标 ``needs_calibration``。
    #: 通用图像没有标定这回事，空标定是常态而非缺失。
    calibration_required: bool = True
    #: 取帧是否接受窗宽窗位（灰度帧栈）。
    supports_window: bool = False
    default_window: tuple[float, float] | None = None
    #: ``invalidate`` 时要清空的 ``lru_cache`` 包装函数。
    caches: tuple[Callable, ...] = ()

    @property
    def label_key(self) -> str:
        return f"modality.{self.modality}"

    # --- 数据轴 -------------------------------------------------------------

    def probe(self, root: Path) -> bool:
        raise NotImplementedError

    def list_ids(self, source: DataSource) -> list[str]:
        raise NotImplementedError

    def is_mine(self, object_id: str) -> bool:
        """索引未命中时的兜底：在该模态当前 active 的源里现列一次（D-7）。

        只在 ``resolve_object`` 的索引未命中时调用，代价是一次现列；覆盖「数据目录在进程内
        被直接改动、注册表未收到通知」的情形。
        """
        return self.locate(object_id) is not None

    def locate(self, object_id: str) -> DataSource | None:
        """现列 active 源，返回首个列出该 id 的数据源（顺序与注册表一致）。"""
        from ..datasource_registry import active_sources

        for ds in active_sources(self.modality):
            try:
                if object_id in self.list_ids(ds):
                    return ds
            except Exception:  # noqa: BLE001 - 单源读失败不影响其余源的判定
                continue
        return None

    def describe(self, source: DataSource, object_id: str) -> ObjectMeta:
        """子类给出 ``ObjectMeta`` 的长期字段；过渡字段由 :meth:`meta` 回填。"""
        raise NotImplementedError

    def meta(self, source: DataSource, object_id: str) -> ObjectMeta:
        return backfill_legacy(self.describe(source, object_id))

    def raw(self, source: DataSource, object_id: str) -> tuple[Path | bytes, str] | None:
        return None

    def tile(
        self, source: DataSource, object_id: str, level: int, col: int, row: int
    ) -> bytes | None:
        return None

    def detect_calibration(self, root: Path) -> dict:
        return {}

    def builtin_sample(self) -> DataSource | None:
        return None

    def synthetic_sample(self) -> DataSource | None:
        """开发者模式下显式注册的合成源（D-17）。缺省无。"""
        return None

    def invalidate(self) -> None:
        for fn in self.caches:
            fn.cache_clear()  # type: ignore[attr-defined]

    def derive_id(self, source: DataSource, rel_name: str) -> str:
        """服务端派生的对象 id（上传受理回执用）。只有可上传的源实现。"""
        raise NotImplementedError(f"{self.modality} 不接受上传")

    # --- 取帧 ---------------------------------------------------------------

    def encoded(
        self, source: DataSource, object_id: str, index: Index
    ) -> tuple[bytes, str] | None:
        """未裁剪、未缩放、未加窗时的原样字节（可选快路径，保持既有 ``/image`` 字节不变）。"""
        return None

    def render(
        self,
        source: DataSource,
        object_id: str,
        index: Index,
        window: tuple[float, float] | None,
    ) -> Image.Image:
        """解码出一整帧（对象坐标、未缩放）。"""
        raise NotImplementedError(f"{self.kind} 的取帧尚未接入")

    def default_index(self, obj: ObjectMeta, index: Index) -> Index:
        """缺省索引：z / t 缺省取 0；slide 必须显式给 level（SDD 10 §5.2）。"""
        filled = index.model_copy()
        for name in ("z", "t"):
            if getattr(filled, name) is None and obj.axis(name) is not None:
                setattr(filled, name, 0)
        if obj.axis("level") is not None and filled.level is None:
            raise ValueError(f"{obj.id} 是 slide，取帧必须指定 level")
        obj.check_index(filled)
        return filled

    def frame(
        self,
        source: DataSource,
        object_id: str,
        index: Index,
        *,
        roi: Region | None = None,
        size: int | None = None,
        window: tuple[float, float] | None = None,
    ) -> tuple[bytes, str, ReferenceFrame]:
        obj = self.meta(source, object_id)
        index = self.default_index(obj, index)
        width, height = obj.axis("x").size, obj.axis("y").size  # type: ignore[union-attr]
        if roi is None and size is None and window is None:
            fast = self.encoded(source, object_id, index)
            if fast is not None:
                data, mime = fast
                ref = ReferenceFrame(
                    object_id=object_id, index=index, origin=(0, 0), scale=1.0,
                    width=width, height=height,
                )
                return data, mime, ref
        if window is not None and window[0] <= 0:
            raise ValueError(f"窗宽必须为正：{window[0]}")
        win = (window or self.default_window) if self.supports_window else None
        img = self.render(source, object_id, index, win)
        origin = (0.0, 0.0)
        if roi is not None:
            if roi.kind != "box" or None in (roi.x0, roi.y0, roi.x1, roi.y1):
                raise ValueError("roi 必须是 box（x0, y0, x1, y1）")
            if not (0 <= roi.x0 < roi.x1 <= width and 0 <= roi.y0 < roi.y1 <= height):
                raise ValueError(f"roi 越界：({roi.x0},{roi.y0},{roi.x1},{roi.y1})")
            img = img.crop((roi.x0, roi.y0, roi.x1, roi.y1))
            origin = (float(roi.x0), float(roi.y0))
        scale = 1.0
        if size is not None and max(img.size) > size:
            scale = size / max(img.size)
            img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))))
        ref = ReferenceFrame(
            object_id=object_id, index=index, origin=origin, scale=scale,
            width=img.width, height=img.height,
        )
        return _png(img), "image/png", ref
