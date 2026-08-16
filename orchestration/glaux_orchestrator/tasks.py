"""兼容垫片——任务注册表已于 2026-08-16 迁入 :mod:`glaux_core.tasks`。

见 ``docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md`` P1。此处仅重导出，
供 :mod:`glaux_orchestrator.intent` 过渡使用；随意图层在 P3 一并删除。新代码请直接
``from glaux_core.tasks import ...``。
"""

from glaux_core.tasks import (
    LIVER_KIDNEY_CLASSES,
    NUCLEI_CLASSES,
    REGISTRY,
    MetricDef,
    OverlaySpec,
    TaskPlugin,
    TaskSpec,
    TaskType,
    ToolDef,
    measure_hc,
    measure_imt,
    plugin_to_view,
    task_for_signals,
)

__all__ = [
    "LIVER_KIDNEY_CLASSES",
    "NUCLEI_CLASSES",
    "REGISTRY",
    "MetricDef",
    "OverlaySpec",
    "TaskPlugin",
    "TaskSpec",
    "TaskType",
    "ToolDef",
    "measure_hc",
    "measure_imt",
    "plugin_to_view",
    "task_for_signals",
]
