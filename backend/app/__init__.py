"""Glaux IDE 后端——FastAPI 薄壳。"""

from importlib import metadata as _metadata


def _resolve_version() -> str:
    """读取 Backend 的发行包元数据；源码未安装时明确标记未知。"""

    try:
        return _metadata.version("glaux-backend")
    except _metadata.PackageNotFoundError:
        return "unknown"


__version__ = _resolve_version()
