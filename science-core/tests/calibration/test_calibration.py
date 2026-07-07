"""U3：标定三档 + 硬拒绝——断言绝不静默输出无标定结果。"""

import math

import pytest

from glaux_core.calibration.calibration import (
    CFSource,
    ManualClick,
    cf_from_two_clicks,
    resolve_calibration,
)
from glaux_core.errors import HardReject


def test_cubs_cf_direct():
    r = resolve_calibration(cubs_cf=0.0833)
    assert r.source is CFSource.CUBS
    assert r.cf == pytest.approx(0.0833)


def test_cubs_cf_nonpositive_hard_rejects():
    with pytest.raises(HardReject):
        resolve_calibration(cubs_cf=0.0)


def test_manual_two_clicks():
    # 两点相距 10px，已知 1mm → CF=0.1
    click = ManualClick(p1=(0.0, 0.0), p2=(6.0, 8.0), known_mm=1.0)
    assert cf_from_two_clicks(click) == pytest.approx(0.1)
    r = resolve_calibration(manual=click)
    assert r.source is CFSource.MANUAL_CLICK
    assert r.cf == pytest.approx(0.1)
    assert r.provenance["known_mm"] == 1.0


def test_manual_coincident_points_raise():
    with pytest.raises(ValueError):
        cf_from_two_clicks(ManualClick(p1=(3.0, 3.0), p2=(3.0, 3.0), known_mm=1.0))


def test_all_sources_absent_hard_rejects():
    # 命门断言：无 CF、无点选 → 硬拒绝，不返回任何结果
    with pytest.raises(HardReject):
        resolve_calibration()


def test_cubs_takes_priority_over_manual():
    r = resolve_calibration(
        cubs_cf=0.06,
        manual=ManualClick(p1=(0.0, 0.0), p2=(10.0, 0.0), known_mm=1.0),
    )
    assert r.source is CFSource.CUBS
    assert r.cf == pytest.approx(0.06)
