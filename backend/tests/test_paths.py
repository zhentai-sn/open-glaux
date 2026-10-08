"""SDD 13 §7.1 规则 8–9：路径写法转换与显示写法（纯字符串，不碰文件系统）。"""

from __future__ import annotations

import pytest

from app import paths


@pytest.fixture(autouse=True)
def posix_backend(monkeypatch):
    monkeypatch.setattr(paths, "native_windows", lambda: False)


@pytest.fixture
def wsl(monkeypatch):
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")


@pytest.fixture
def not_wsl(monkeypatch):
    monkeypatch.delenv("WSL_DISTRO_NAME", raising=False)


# --- to_posix ---------------------------------------------------------------


def test_posix_passthrough(not_wsl):
    assert paths.to_posix("/home/u/data") == "/home/u/data"
    assert paths.to_posix("  /home/u/data/  ") == "/home/u/data/"  # 尾斜杠留给 resolve 折叠
    assert paths.to_posix("~/data") == "~/data"


@pytest.mark.parametrize(
    "raw",
    [
        r"C:\cases\liver",
        r"c:\cases\liver\\",
        "C:/cases/liver",
        "C:/cases/liver/",
        r"\\wsl.localhost\Ubuntu\mnt\c\cases\liver",
        r"\\wsl$\ubuntu\mnt\c\cases\liver",
        "//wsl.localhost/UBUNTU/mnt/c/cases/liver",
        "/mnt/c/cases/liver",
    ],
)
def test_three_spellings_same_posix(wsl, raw):
    """同一目录的三种写法（含大小写、分隔符变体）落到同一 POSIX 路径。"""
    out = paths.to_posix(raw)
    # POSIX 写法原样返回，由 resolve 统一；其余写法转换后已无尾斜杠
    assert out.rstrip("/") == "/mnt/c/cases/liver"


def test_drive_root(wsl):
    assert paths.to_posix("D:") == "/mnt/d"
    assert paths.to_posix("D:\\") == "/mnt/d"


def test_wsl_unc_to_root(wsl):
    assert paths.to_posix(r"\\wsl.localhost\Ubuntu\home\u\a") == "/home/u/a"
    assert paths.to_posix(r"\\wsl.localhost\Ubuntu") == "/"


def test_wsl_unc_other_distro_rejected(wsl):
    with pytest.raises(ValueError, match="发行版"):
        paths.to_posix(r"\\wsl.localhost\Debian\home\u")


@pytest.mark.parametrize("raw", [r"C:\a\b", r"\\wsl.localhost\Ubuntu\home"])
def test_windows_spellings_rejected_outside_wsl(not_wsl, raw):
    with pytest.raises(ValueError, match="不在 WSL"):
        paths.to_posix(raw)


@pytest.mark.parametrize("raw", ["", "   ", "relative/dir", r"\\server\share\x"])
def test_unconvertible(wsl, raw):
    with pytest.raises(ValueError):
        paths.to_posix(raw)


# --- display ----------------------------------------------------------------


def test_display_mnt_as_windows(wsl):
    assert paths.display("/mnt/c/cases/liver") == "C:\\cases\\liver"
    assert paths.display("/mnt/d") == "D:\\"
    assert paths.display("/home/u/a") == "/home/u/a"
    assert paths.display("/mnt/wsl/x") == "/mnt/wsl/x"  # 非单字母挂载点不是盘符


def test_display_outside_wsl_is_posix(not_wsl):
    assert paths.display("/mnt/c/cases") == "/mnt/c/cases"


def test_display_round_trip(wsl):
    assert paths.to_posix(paths.display("/mnt/e/x/y")) == "/mnt/e/x/y"


@pytest.mark.parametrize("raw", [r"C:\cases\中文 目录", "c:/cases/中文 目录/"])
def test_native_windows_drive_path(not_wsl, monkeypatch, raw):
    monkeypatch.setattr(paths, "native_windows", lambda: True)
    assert paths.to_posix(raw) == "C:\\cases\\中文 目录"
