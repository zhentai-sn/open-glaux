"""Glaux IMT 科学内核.

CUBS 颈动脉 IMT 首个楔子的 headless 内核：读取 → 标定 → 表征 →
分割（模型无关适配器）→ PDM 测量 → 验证 → 结构化产物 → 评测。

环境四层的首个实例——表征 / 动作 / 验证 / 记忆。详见
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
