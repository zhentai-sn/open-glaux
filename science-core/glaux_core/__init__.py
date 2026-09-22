"""Glaux 科学内核.

headless 内核：任务注册表 ``glaux_core.tasks.REGISTRY``，以及各任务的
读取 → 标定 → 表征 → 分割/检测 → 测量 → 验证 → 结构化产物 → 评测。

CUBS 颈动脉 IMT 是第一个实现的任务，其历史计划见
``docs/plans/2026-07-05-001-feat-cubs-imt-pipeline-plan.zh-CN.md``。
"""

from importlib import metadata as _metadata

from glaux_core.errors import CalibrationUnavailable, GlauxError, HardReject

__all__ = ["GlauxError", "CalibrationUnavailable", "HardReject"]


def _resolve_version() -> str:
    """读取 science-core 发行包元数据；源码未安装时明确标记未知。"""

    try:
        return _metadata.version("glaux-core")
    except _metadata.PackageNotFoundError:
        return "unknown"


__version__ = _resolve_version()
