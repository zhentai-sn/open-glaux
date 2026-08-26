"""U1 骨架 smoke：包可导入、异常层次成立。"""

from importlib.metadata import version

import glaux_core
from glaux_core.errors import CalibrationUnavailable, GlauxError, HardReject


def test_package_imports_and_versioned():
    assert glaux_core.__version__ == version("glaux-core")


def test_package_version_is_unknown_when_distribution_metadata_is_missing(monkeypatch):
    def missing(_distribution: str) -> str:
        raise glaux_core._metadata.PackageNotFoundError

    monkeypatch.setattr(glaux_core._metadata, "version", missing)
    assert glaux_core._resolve_version() == "unknown"


def test_exception_hierarchy():
    assert issubclass(CalibrationUnavailable, GlauxError)
    assert issubclass(HardReject, GlauxError)


def test_hard_reject_carries_reason():
    err = HardReject("无 CF 且无点选")
    assert err.reason == "无 CF 且无点选"
    assert "无 CF" in str(err)
