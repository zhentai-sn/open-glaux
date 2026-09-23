"""``DETECTORS``：动作轴注册表（SDD 10 §8.2），键为 ``TaskPlugin.adapter_kind``。

不变量：``set(p.adapter_kind for p in REGISTRY.values()) == set(DETECTORS)``。
增删一个几何族 = 增删这里一行 + ``REGISTRY`` 里对应的任务行。
"""

from __future__ import annotations

from .base import Detector, DetectorUnavailable, calibration_result
from .contour import ContourDetector
from .volume import VolumeDetector
from .wall_pair import WallPairDetector
from .wsi import WsiDetector

DETECTORS: dict[str, Detector] = {
    d.kind: d
    for d in (WallPairDetector(), ContourDetector(), VolumeDetector(), WsiDetector())
}

__all__ = ["DETECTORS", "Detector", "DetectorUnavailable", "calibration_result"]
