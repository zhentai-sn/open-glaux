"""标定层（U3）：像素→mm 的分层来源与硬拒绝.

优先级（计划决策 #4）：
① CUBS 自带 CF（已解决）
② DICOM ``SequenceOfUltrasoundRegions``（接口留位，延后实现）
③ 屏幕标尺自动检测（接口留位，延后实现）
④ 用户点两下标尺（手动）
⑤ 都失败 → **硬拒绝**（绝不静默输出无标定的假 IMT）

P6 扩展：CT 模态走 ``voxel_spacing``——``value`` 是 ``(sx, sy, sz)`` mm/voxel tuple，
由 NIfTI header ``pixdim[1:4]`` 解析。读不出/非正 → 硬拒绝（与 CUBS 路径同模板）。

P7 扩展：病理 WSI 模态走 ``mpp``（microns per pixel）——``value`` 是 ``(mpp_x, mpp_y)``
µm/px tuple，由 OpenSlide ``openslide.mpp-x/y`` 属性解析。读不出/非正 → 硬拒绝。
与 US 的 cf (mm/px) 不可互换：WSI 密度是 count / (ROI 面积 mm²)，面积用 mpp 换算。

SDD 10 扩展：视频模态走 ``time_base``——:func:`resolve_video_calibration` 由容器 fps 构造。

派发入口（SDD 10 §7 规则 7、D-16）：对象标定一律经 :func:`calibration_from_dict` 构造、
经 :func:`resolve_calibration_for` 派发。``Calibration.kind`` 是开放集，已知值
``mm_per_px`` / ``voxel_mm`` / ``mpp_um`` / ``time_base``；未知 kind、缺 kind 或 value 形状
非法一律 :class:`HardReject` 并记 warning 日志，绝不回落为默认标定。
"""

from __future__ import annotations

import logging
import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Union

from glaux_core.errors import HardReject

_log = logging.getLogger("glaux.calibration")


class CFSource(str, Enum):
    CUBS = "cubs"
    DICOM = "dicom"
    RULER = "ruler"
    MANUAL_CLICK = "manual_click"
    VOXEL_SPACING = "voxel_spacing"  # P6：CT 体素物理尺寸（mm/voxel，3 元 tuple）
    MPP = "mpp"  # P7：WSI 像素物理尺寸（µm/px，2 元 tuple (mpp_x, mpp_y)）
    TIME_BASE = "time_base"  # SDD 10：视频时间基（value=fps，float）


@dataclass(frozen=True)
class ManualClick:
    """用户在标尺上点的两点 + 已知物理间距（mm）。"""

    p1: tuple[float, float]
    p2: tuple[float, float]
    known_mm: float


@dataclass(frozen=True)
class CalibrationResult:
    """一次标定的结果 + 来源 + provenance。

    ``cf`` 字段保留以保 US 路径兼容；``value`` 是 v0.4 起的通用字段——
    US 路径 ``float``（mm/px），CT 路径 ``(sx, sy, sz)`` tuple（mm/voxel）。
    任何取数都优先看 ``value``；``cf`` 在 ``source in {CUBS, DICOM, RULER, MANUAL_CLICK}`` 时
    等价于 ``float(value)``。
    """

    source: CFSource
    provenance: dict = field(default_factory=dict)
    cf: float = 0.0  # US 路径便利字段；CT/WSI 路径为 0
    value: Union[float, tuple[float, ...]] = 0.0  # US=float；CT=(sx,sy,sz)；WSI=(mpp_x,mpp_y)


def cf_from_two_clicks(click: ManualClick) -> float:
    """由两点像素距离 + 已知物理间距求 CF（mm/pixel）。"""
    (x1, y1), (x2, y2) = click.p1, click.p2
    dist = math.hypot(x2 - x1, y2 - y1)
    if dist <= 0:
        raise ValueError("两点重合，无法定标")
    if not (click.known_mm > 0):
        raise ValueError("已知物理间距须为正")
    return click.known_mm / dist


def resolve_calibration(
    *,
    cubs_cf: float | None = None,
    manual: ManualClick | None = None,
) -> CalibrationResult:
    """按优先级解析标定；全部不可得则抛 :class:`HardReject`。

    DICOM / 标尺自动检测尚未实现（延后线），当前仅 CUBS CF 与手动点选两档。
    CT 模态走 :func:`resolve_ct_calibration`（NIfTI pixdim）。
    """
    if cubs_cf is not None:
        if not (cubs_cf > 0):
            raise HardReject(f"CUBS CF 非正：{cubs_cf}")
        return CalibrationResult(
            source=CFSource.CUBS, cf=float(cubs_cf), value=float(cubs_cf),
            provenance={"cf": cubs_cf},
        )

    if manual is not None:
        cf = cf_from_two_clicks(manual)
        return CalibrationResult(
            source=CFSource.MANUAL_CLICK, cf=cf, value=cf,
            provenance={"p1": manual.p1, "p2": manual.p2, "known_mm": manual.known_mm},
        )

    raise HardReject(
        "无 CUBS CF、无手动点选，且 DICOM/标尺自动检测未实现——拒绝输出无标定 IMT"
    )


def resolve_ct_calibration(voxel_spacing_mm: tuple[float, float, float]) -> CalibrationResult:
    """CT 标定：voxel_spacing 必正、必有；读不出（None/含零/含负）走 :class:`HardReject`。

    ``voxel_spacing_mm = (sx, sy, sz)``——x 平面、y 平面、z（层厚）方向的体素物理尺寸（mm）。
    与 US 路径的 cubs_cf (mm/px) 不可互换：CT 测量是体素 × voxel_volume_mm3。
    """
    if voxel_spacing_mm is None or len(voxel_spacing_mm) != 3:
        raise HardReject(f"CT 标定形状非法：{voxel_spacing_mm!r}")
    if not all(float(v) > 0 for v in voxel_spacing_mm):
        raise HardReject(f"CT voxel_spacing 非正/非数：{voxel_spacing_mm!r}")
    sx, sy, sz = float(voxel_spacing_mm[0]), float(voxel_spacing_mm[1]), float(voxel_spacing_mm[2])
    return CalibrationResult(
        source=CFSource.VOXEL_SPACING,
        value=(sx, sy, sz),
        provenance={"voxel_spacing_mm": [sx, sy, sz], "source": "nifti_pixdim"},
    )


def resolve_wsi_calibration(mpp_xy: tuple[float, float]) -> CalibrationResult:
    """WSI 标定：MPP (µm/px) 必正、必有；读不出（None/含零/含负）走 :class:`HardReject`。

    ``mpp_xy = (mpp_x, mpp_y)``——x/y 方向每像素的物理尺寸（微米）。来源是 OpenSlide
    的 ``openslide.mpp-x`` / ``openslide.mpp-y`` 属性。与 US 的 cf (mm/px) 不可互换：
    WSI 核密度 = count / (ROI 面积 mm²)，面积 = (w×h) px × mpp_x × mpp_y / 1e6。
    """
    if mpp_xy is None or len(mpp_xy) != 2:
        raise HardReject(f"WSI 标定形状非法：{mpp_xy!r}")
    if not all(float(v) > 0 for v in mpp_xy):
        raise HardReject(f"WSI mpp 非正/非数：{mpp_xy!r}——拒绝输出无标定核密度")
    mx, my = float(mpp_xy[0]), float(mpp_xy[1])
    return CalibrationResult(
        source=CFSource.MPP,
        value=(mx, my),
        provenance={"mpp_xy_um": [mx, my], "source": "openslide.mpp"},
    )


def resolve_video_calibration(fps: float, time_base: Any = None) -> CalibrationResult:
    """视频标定：fps 必正、必有；读不出（None/非数/非正）走 :class:`HardReject`。

    ``time_base`` 为容器时间基（如 ``"1/30000"``），原样记入 provenance，不参与计算。
    """
    try:
        fps_f = float(fps)
    except (TypeError, ValueError):
        raise HardReject(f"视频 fps 非数：{fps!r}") from None
    if not (fps_f > 0) or math.isinf(fps_f):
        raise HardReject(f"视频 fps 非正/非有限：{fps!r}")
    return CalibrationResult(
        source=CFSource.TIME_BASE,
        value=fps_f,
        provenance={"fps": fps, "time_base": time_base, "source": "container"},
    )


def _reject(kind: Any, source: Any, reason: str) -> HardReject:
    _log.warning("calibration rejected: kind=%r source=%r reason=%s", kind, source, reason)
    return HardReject(f"标定无法解析（kind={kind!r}, source={source!r}）：{reason}")


def _positive_number(v: Any) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    f = float(v)
    return f if f > 0 and not math.isinf(f) else None


def calibration_from_dict(d: Mapping[str, Any]) -> CalibrationResult:
    """``Calibration`` dict（``{kind, value, source?, provenance?}``）→ :class:`CalibrationResult`。

    按 ``kind`` 派发（开放集，D-16）：``mm_per_px`` → CUBS 同形（cf=value）；``voxel_mm`` →
    :func:`resolve_ct_calibration`；``mpp_um`` → :func:`resolve_wsi_calibration`；``time_base``
    （value 为 ``{fps, time_base?}``）→ :func:`resolve_video_calibration`。未知/缺失 kind 或
    value 形状非法 → :class:`HardReject`（并记 warning 日志，含 kind 与 source）。
    """
    if not isinstance(d, Mapping):
        raise _reject(None, None, f"标定不是 mapping：{type(d).__name__}")
    kind = d.get("kind")
    source = d.get("source")
    value = d.get("value")
    try:
        if kind == "mm_per_px":
            cf = _positive_number(value)
            if cf is None:
                raise HardReject(f"mm_per_px 须为正数：{value!r}")
            return CalibrationResult(
                source=CFSource.CUBS, cf=cf, value=cf,
                provenance={"cf": value, "source": source},
            )
        if kind == "voxel_mm":
            if isinstance(value, (str, bytes, Mapping)) or not hasattr(value, "__len__"):
                raise HardReject(f"voxel_mm 须为 3 元序列：{value!r}")
            return resolve_ct_calibration(tuple(value))  # type: ignore[arg-type]
        if kind == "mpp_um":
            if isinstance(value, (str, bytes, Mapping)) or not hasattr(value, "__len__"):
                raise HardReject(f"mpp_um 须为 2 元序列：{value!r}")
            return resolve_wsi_calibration(tuple(value))  # type: ignore[arg-type]
        if kind == "time_base":
            if not isinstance(value, Mapping) or "fps" not in value:
                raise HardReject(f"time_base 须为含 fps 的 mapping：{value!r}")
            return resolve_video_calibration(value["fps"], value.get("time_base"))
    except HardReject as e:
        raise _reject(kind, source, str(e)) from e
    except (TypeError, ValueError) as e:
        raise _reject(kind, source, f"value 形状非法：{value!r}（{e}）") from e
    raise _reject(kind, source, "未知或缺失的标定 kind")


def resolve_calibration_for(obj: Any) -> CalibrationResult:
    """对象（``ObjectMeta`` 或带 ``calibration`` 属性者）或 ``Calibration`` 本身 → 标定结果。

    ``calibration`` 为 ``None`` → :class:`HardReject`；pydantic 模型先 ``model_dump()``。
    """
    cal = getattr(obj, "calibration", obj)
    if cal is None:
        raise HardReject("对象无标定（calibration=None）——拒绝输出无标定测量")
    if hasattr(cal, "model_dump"):
        cal = cal.model_dump()
    return calibration_from_dict(cal)
