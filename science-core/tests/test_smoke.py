"""U1 骨架 smoke：包可导入、异常层次成立。"""

import glaux_core
from glaux_core.errors import CalibrationUnavailable, GlauxError, HardReject


def test_package_imports_and_versioned():
    assert glaux_core.__version__


def test_exception_hierarchy():
    assert issubclass(CalibrationUnavailable, GlauxError)
    assert issubclass(HardReject, GlauxError)


def test_hard_reject_carries_reason():
    err = HardReject("无 CF 且无点选")
    assert err.reason == "无 CF 且无点选"
    assert "无 CF" in str(err)
