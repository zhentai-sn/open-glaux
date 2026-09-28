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

import hashlib
import io
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

from .. import config
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
    browser_upload: bool

    def probe(self, root: Path) -> bool: ...
    def list_ids(self, source: DataSource) -> list[str]: ...
    def is_mine(self, object_id: str) -> bool: ...
    def object_id_for(self, source: DataSource, path: Path) -> str | None: ...
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
    def clip(
        self, source: DataSource, object_id: str, start_ms: int, end_ms: int,
        source_sha256: str | None = None,
    ) -> tuple[bytes, dict] | None: ...
    def frame_at_time(
        self, source: DataSource, object_id: str, time_ms: int,
        source_sha256: str | None = None,
    ) -> tuple[bytes, str, ReferenceFrame, int, int] | None: ...
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


def method_refs(names: list[str], *, gold: tuple[str, ...] = (),
                agent: tuple[str, ...] = ()) -> list[dict]:
    """方法名 → ``[{name, role}]``；不在 gold / agent 中的一律为 reference。"""
    def role(n: str) -> str:
        return "gold" if n in gold else "agent" if n in agent else "reference"

    return [{"name": n, "role": role(n)} for n in names]


def suffix_matches(formats: tuple[tuple[str, bytes, int], ...], name: str) -> bool:
    """文件名是否以 ``formats`` 中任一后缀结尾（不区分大小写；多段后缀如 ``.nii.gz`` 同样适用）。

    只看文件名、不读内容——SDD 13 §7.2 规则 2 列目录时标注候选模态即用此判定。
    """
    lower = name.lower()
    return any(lower.endswith(ext.lower()) for ext, _magic, _offset in formats)


def magic_matches(formats: tuple[tuple[str, bytes, int], ...], path: Path) -> bool:
    """按文件名命中的 ``formats`` 行校验文件头魔数；后缀不命中或读不了都算不符。

    同一后缀可声明多行（如 WSI 的 TIFF 与 BigTIFF、大小端四种魔数），任一行命中即符。
    """
    lower = path.name.lower()
    rows = [(magic, off) for ext, magic, off in formats if lower.endswith(ext.lower())]
    if not rows:
        return False
    try:
        with path.open("rb") as fh:
            head = fh.read(max(len(m) + off for m, off in rows))
    except OSError:
        return False
    return any(head[off : off + len(m)] == m for m, off in rows)


def derive_object_id(prefix: str, source_id: str, rel_name: str) -> str:
    """按「数据源 id + 源内文件名」派生对象 id：``<prefix>-<源哈希8>-<文件名哈希8>``。

    同源同文件名恒得同 id；导入源与项目源的 CT、WSI 用它（SDD 13 §7.2 规则 11、D-25），
    与通用图像 ``nat-``、视频 ``vid-`` 同规则。
    """

    def h(text: str) -> str:
        return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]

    return f"{prefix}-{h(source_id)}-{h(rel_name)}"


def is_direct_child(source: DataSource, path: Path) -> bool:
    """``path`` 是否是 ``source.root`` 下一层的普通文件（两边都规范化后比较）。

    ``list_ids(source)`` 只列 ``source.root`` 下一层（SDD 10 D-25），``object_id_for`` 以此
    判定归属，二者因此同源。
    """
    try:
        return path.is_file() and path.parent.resolve() == Path(source.root).resolve()
    except OSError:
        return False


def supports_object_id_for(source: Source) -> bool:
    """该 Source 是否参与按需识别（SDD 13 §7.2 规则 7）：``object_id_for`` 不是缺省实现。"""
    impl = getattr(type(source), "object_id_for", None)
    return impl is not None and impl is not SourceBase.object_id_for


def resources_for(object_id: str, *, raw: bool = False, tiles: bool = False) -> dict[str, str]:
    """``ObjectMeta.resources`` 的 URL 模板（SDD 10 §5.1）。``frame`` 必有。"""
    out = {"frame": f"/objects/{object_id}/frame"}
    if raw:
        out["raw"] = f"/objects/{object_id}/raw"
    if tiles:
        out["tiles"] = f"/objects/{object_id}/tiles/{{level}}/{{col}}/{{row}}"
    return out


#: 无 TaskPlugin 模态的能力位默认集，按 ``Source.kind`` 定表（SDD 10 §9.4）。只作兜底：
#: 模态有 TaskPlugin 时整体取 ``TaskPlugin.capabilities``，两者永不合并。
#: 取值只含模式工具（SDD 04 §7.5 规则 3）；帧轴与窗宽窗位由对象 ``axes`` / ``kind`` 推导。
DEFAULT_CAPABILITIES: dict[str, tuple[str, ...]] = {
    "image": ("bbox", "polygon"),
    "volume": ("bbox", "polygon"),
    "slide": ("bbox", "polygon"),
    "video": ("bbox", "polygon", "brush"),
}


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


class SourceBase:
    """``Source`` 的缺省实现。子类至少实现 ``probe`` / ``list_ids`` / ``describe``。"""

    modality: str = ""
    kind: str = "image"
    formats: tuple[tuple[str, bytes, int], ...] = ()
    #: 是否接受浏览器上传（SDD 13 §7.2 规则 13、D-23）。与 ``formats`` 解耦：``formats`` 是后缀与
    #: 魔数的唯一来源，项目识别总读它；上传受理表与 ``importable`` 只汇总本开关为真的 Source。
    browser_upload: bool = True
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

    def object_id_for(self, source: DataSource, path: Path) -> str | None:
        """文件在此源下的对象 id（SDD 10 §9.2、D-25；SDD 13 按需打开的唯一入口）。

        不属于该源或校验失败返回 ``None``。缺省实现恒为 ``None``：该模态不参与按需识别
        （SDD 13 §7.2 规则 7），判定见 :func:`supports_object_id_for`。
        """
        return None

    def describe(self, source: DataSource, object_id: str) -> ObjectMeta:
        """子类给出 ``ObjectMeta`` 的元数据。"""
        raise NotImplementedError

    def meta(self, source: DataSource, object_id: str) -> ObjectMeta:
        return self.describe(source, object_id)

    def raw(self, source: DataSource, object_id: str) -> tuple[Path | bytes, str] | None:
        return None

    def clip(
        self, source: DataSource, object_id: str, start_ms: int, end_ms: int,
        source_sha256: str | None = None,
    ) -> tuple[bytes, dict] | None:
        return None

    def frame_at_time(
        self, source: DataSource, object_id: str, time_ms: int,
        source_sha256: str | None = None,
    ) -> tuple[bytes, str, ReferenceFrame, int, int] | None:
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

    def upload_max_bytes(self) -> int:
        """浏览器上传的单文件字节上限；运行时读取，便于环境变量与测试覆盖。"""
        return config.UPLOAD_MAX_BYTES

    def validate_upload(self, path: Path, ext: str) -> str | None:
        """落盘前的内容校验（魔数之后）。通过返回 None，否则返回拒绝原因码。"""
        return None

    def frame_time_ms(self, source: DataSource, object_id: str, index: Index) -> int | None:
        """该帧在源媒体中的呈现时间（毫秒，以首帧为零点）；非时间序列对象返回 None。"""
        return None

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
        # 无需裁剪、缩放（size 不小于原图最长边）、加窗时直接回原样字节，省去解码与重编码
        if roi is None and window is None and (size is None or max(width, height) <= size):
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
