"""``/fs`` 目录选择器（SDD 13 §9.1）：快捷根与单层子目录列举。

只列目录、只列一层，不读文件内容；路径参数接受三种写法（:func:`app.paths.to_posix`）。
整个 router 只接受回环来源（§7.1 规则 3）。错误语义：非回环或无读权限 403；不存在 404；
非目录或写法无法转换 422。
"""

from __future__ import annotations

import os
import string
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import config, paths
from .. import datasource_registry as dsreg
from ..schemas import DirEntry, DirListing
from .loopback import require_loopback

router = APIRouter(prefix="/fs", tags=["fs"], dependencies=[Depends(require_loopback)])


def _visible(name: str) -> bool:
    return not name.startswith(".")


def _has_children(path: Path) -> bool:
    """是否含至少一个非隐藏子目录；找到第一个即停。读不了（权限等）按 ``False``。"""
    try:
        with os.scandir(path) as it:
            for e in it:
                try:
                    if _visible(e.name) and e.is_dir():
                        return True
                except OSError:
                    continue
    except OSError:
        return False
    return False


def _entry(path: Path, name: str | None = None) -> DirEntry:
    return DirEntry(
        name=name or path.name or str(path),
        path=str(path),
        display_path=paths.display(path),
        has_children=_has_children(path),
    )


def _resolve(raw: str) -> Path:
    """写法转换 → ``expanduser`` → ``resolve``；无法转换 → 422。"""
    try:
        return dsreg.normalize_project_path(raw)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


@router.get("/roots", response_model=list[DirEntry])
def fs_roots() -> list[DirEntry]:
    """快捷根：主目录、``GLAUX_DATASETS_ROOT``、WSL 下存在的各 ``/mnt/<盘符>``；不存在的跳过。"""
    candidates: list[tuple[Path, str | None]] = [
        (config.HOME, None),
        (dsreg.datasets_root(), None),
    ]
    if paths.wsl_distro() is not None:
        for letter in string.ascii_lowercase:
            candidates.append((Path("/mnt") / letter, f"{letter.upper()}:"))
    out: list[DirEntry] = []
    seen: set[str] = set()
    for p, name in candidates:
        try:
            p = p.expanduser().resolve()
            if not p.is_dir():
                continue
        except OSError:
            continue
        if str(p) in seen:
            continue
        seen.add(str(p))
        out.append(_entry(p, name))
    return out


@router.get("/dirs", response_model=DirListing)
def fs_dirs(path: str = Query(..., description="绝对路径，接受三种写法")) -> DirListing:
    """列出 ``path`` 下一层子目录（跳过 ``.`` 开头），按名称不区分大小写排序。"""
    p = _resolve(path)
    try:
        if not p.exists():
            raise HTTPException(404, f"路径不存在：{p}")
        if not p.is_dir():
            raise HTTPException(422, f"路径不是目录：{p}")
        entries: list[DirEntry] = []
        with os.scandir(p) as it:
            for e in it:
                if not _visible(e.name):
                    continue
                try:
                    if not e.is_dir():
                        continue
                except OSError:
                    continue
                entries.append(_entry(p / e.name, e.name))
    except PermissionError as e:
        raise HTTPException(403, f"无读权限：{p}") from e
    except OSError as e:
        raise HTTPException(422, f"目录无法读取：{p}（{e}）") from e
    entries.sort(key=lambda d: d.name.casefold())
    parent = None if p.parent == p else str(p.parent)
    return DirListing(path=str(p), display_path=paths.display(p), parent=parent, entries=entries)
