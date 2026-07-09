"""标定层（U3）：像素→mm 的分层来源与硬拒绝.

优先级（计划决策 #4）：
① CUBS 自带 CF（已解决）
② DICOM ``SequenceOfUltrasoundRegions``（接口留位，延后实现）
③ 屏幕标尺自动检测（接口留位，延后实现）
④ 用户点两下标尺（手动）
⑤ 都失败 → **硬拒绝**（绝不静默输出无标定的假 IMT）

P6 扩展：CT 模态走 ``voxel_spacing``——``value`` 是 ``(sx, sy, sz)`` mm/voxel tuple，
由 NIfTI header ``pixdim[1:4]`` 解析。读不出/非正 → 硬拒绝（与 CUBS 路径同模板）。
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Union

from glaux_core.errors import HardReject


class CFSource(str, Enum):
    CUBS = "cubs"
    DICOM = "dicom"
    RULER = "ruler"
    MANUAL_CLICK = "manual_click"
    VOXEL_SPACING = "voxel_spacing"  # P6：CT 体素物理尺寸（mm/voxel，3 元 tuple）


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
    cf: float = 0.0  # US 路径便利字段；CT 路径为 0
    value: Union[float, tuple[float, float, float]] = 0.0


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
    if not all(isinstance(v, (int, float)) and v > 0 for v in voxel_spacing_mm):
        raise HardReject(f"CT voxel_spacing 非正/非数：{voxel_spacing_mm!r}")
    sx, sy, sz = float(voxel_spacing_mm[0]), float(voxel_spacing_mm[1]), float(voxel_spacing_mm[2])
    return CalibrationResult(
        source=CFSource.VOXEL_SPACING,
        value=(sx, sy, sz),
        provenance={"voxel_spacing_mm": [sx, sy, sz], "source": "nifti_pixdim"},
    )
