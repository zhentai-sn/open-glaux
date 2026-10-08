"""路径写法转换与显示写法（SDD 13 §7.1 规则 8–9、D-15）。

后端按自身平台的文件系统路径打开文件；用户在 Windows 侧复制的路径是盘符写法
（``C:\\a\\b``）或 WSL 网络共享写法（``\\\\wsl.localhost\\<发行版>\\a\\b``、``\\\\wsl$\\…``）。
:func:`to_posix` 在 WSL 下把三种写法统一成 POSIX 路径，原生 Windows 保留盘符路径。
:func:`display` 做反向的显示转换。

两者都只做字符串层面的转换，不碰文件系统；``expanduser`` / ``resolve`` 与存在性校验由调用方做。
WSL 判定只看环境变量 ``WSL_DISTRO_NAME``（WSL 为每个发行版的进程注入它），便于测试打桩。
"""

from __future__ import annotations

import os
import re
from pathlib import Path, PurePosixPath, PureWindowsPath

#: ``C:\…``、``C:/…``、``C:``（盘符根）。
_DRIVE_RE = re.compile(r"^([A-Za-z]):(?:[\\/](.*))?$", re.DOTALL)
#: ``\\wsl.localhost\<发行版>\…``、``\\wsl$\<发行版>\…``；分隔符正反斜杠都接受。
_WSL_UNC_RE = re.compile(r"^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)(?:[\\/](.*))?$",
                         re.IGNORECASE | re.DOTALL)
#: WSL 下 Windows 盘符的挂载点 ``/mnt/<盘符>``。
_MNT_RE = re.compile(r"^/mnt/([a-z])(?:/(.*))?$", re.DOTALL)


def native_windows() -> bool:
    """后端是否原生运行在 Windows。"""
    return os.name == "nt"


def wsl_distro() -> str | None:
    """后端所在的 WSL 发行版名；不在 WSL 中运行时为 ``None``。"""
    return os.environ.get("WSL_DISTRO_NAME") or None


def _join(prefix: str, rest: str | None) -> str:
    """把 Windows 写法的剩余部分（任意分隔符）接到 POSIX 前缀后，折叠重复分隔符与尾斜杠。"""
    parts = [p for p in re.split(r"[\\/]+", rest or "") if p]
    return str(PurePosixPath(prefix, *parts))


def to_posix(raw: str) -> str:
    """把用户输入的路径转成后端文件系统路径（不做 ``resolve``）。

    - POSIX 绝对路径与 ``~`` 开头的路径原样返回（去首尾空白）。
    - ``X:\\…`` / ``X:/…`` → ``/mnt/x/…``，WSL 下转换，原生 Windows 下保留盘符路径。
    - ``\\\\wsl.localhost\\<发行版>\\…`` / ``\\\\wsl$\\<发行版>\\…`` → ``/…``，仅 WSL 下可用，
      且发行版须与后端所在发行版一致（不区分大小写）。

    无法转换（非 WSL 下的 Windows 写法、发行版不一致、其他 UNC 共享、相对路径、空串）
    → :class:`ValueError`，上层映射 422。
    """
    s = (raw or "").strip()
    if not s:
        raise ValueError("路径为空")
    distro = wsl_distro()

    m = _WSL_UNC_RE.match(s)
    if m:
        if distro is None:
            raise ValueError(f"后端不在 WSL 中运行，无法转换 WSL 共享路径：{raw}")
        if m.group(1).casefold() != distro.casefold():
            raise ValueError(f"路径所在发行版 {m.group(1)} 与后端所在发行版 {distro} 不一致：{raw}")
        return _join("/", m.group(2))

    m = _DRIVE_RE.match(s)
    if m:
        if native_windows():
            return str(PureWindowsPath(f"{m.group(1).upper()}:\\", m.group(2) or ""))
        if distro is None:
            raise ValueError(f"后端不在 WSL 中运行，无法转换 Windows 路径：{raw}")
        return _join(f"/mnt/{m.group(1).lower()}", m.group(2))

    if s.startswith(("\\\\", "//")):
        raise ValueError(f"不支持的网络共享路径：{raw}")
    if s.startswith(("/", "~")):
        return s
    raise ValueError(f"须为绝对路径：{raw}")


def display(path: str | Path) -> str:
    """UI 显示写法：WSL 下 ``/mnt/<盘符>/…`` 显示为 ``<盘符>:\\…``，其余路径原样。"""
    s = str(path)
    if wsl_distro() is None:
        return s
    m = _MNT_RE.match(s)
    if not m:
        return s
    rest = (m.group(2) or "").strip("/").replace("/", "\\")
    return f"{m.group(1).upper()}:\\{rest}"
