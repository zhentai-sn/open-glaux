"""标定层（U3）：像素→mm 的分层来源与硬拒绝.

优先级（计划决策 #4）：
① CUBS 自带 CF（已解决）
② DICOM ``SequenceOfUltrasoundRegions``（接口留位，延后实现）
③ 屏幕标尺自动检测（接口留位，延后实现）
④ 用户点两下标尺（手动）
⑤ 都失败 → **硬拒绝**（绝不静默输出无标定的假 IMT）
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum

from glaux_core.errors import HardReject


class CFSource(str, Enum):
    CUBS = "cubs"
    DICOM = "dicom"
    RULER = "ruler"
    MANUAL_CLICK = "manual_click"


@dataclass(frozen=True)
class ManualClick:
    """用户在标尺上点的两点 + 已知物理间距（mm）。"""

    p1: tuple[float, float]
    p2: tuple[float, float]
    known_mm: float


@dataclass(frozen=True)
class CalibrationResult:
    """一次标定的结果 + 来源 + provenance。"""

    cf: float  # mm/pixel
    source: CFSource
    provenance: dict = field(default_factory=dict)


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
    """
    if cubs_cf is not None:
        if not (cubs_cf > 0):
            raise HardReject(f"CUBS CF 非正：{cubs_cf}")
        return CalibrationResult(cf=cubs_cf, source=CFSource.CUBS, provenance={"cf": cubs_cf})

    if manual is not None:
        cf = cf_from_two_clicks(manual)
        return CalibrationResult(
            cf=cf,
            source=CFSource.MANUAL_CLICK,
            provenance={"p1": manual.p1, "p2": manual.p2, "known_mm": manual.known_mm},
        )

    raise HardReject(
        "无 CUBS CF、无手动点选，且 DICOM/标尺自动检测未实现——拒绝输出无标定 IMT"
    )
