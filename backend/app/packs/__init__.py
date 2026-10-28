"""可选模型组件（Model Packs）—— 清单、状态与安装（SDD 25）。

主进程只读取文件系统状态与清单，**不 import 任何重框架**；下载与依赖安装一律由
:mod:`app.packs.installer` 在独立子进程中完成（同 ``segment_proc`` / ``models/*`` 的隔离惯例）。
"""

from .registry import (
    PacksCatalogError,
    PackSpec,
    is_ready,
    list_packs,
    load_catalog,
    pack_root,
    read_progress,
    read_state,
)

__all__ = [
    "PackSpec",
    "PacksCatalogError",
    "is_ready",
    "list_packs",
    "load_catalog",
    "pack_root",
    "read_progress",
    "read_state",
]
