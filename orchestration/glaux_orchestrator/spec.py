"""意图层的规范类型——``IntentResult`` / ``Scope``。

``TaskType`` / ``TaskSpec`` 已于 2026-08-16 迁入 :mod:`glaux_core.tasks`（科学内核的确定性入口
契约归内核所有，见 ``docs/designs/2026-08-16-001-retire-orchestration.zh-CN.md`` P1）；此处
仅重导出以兼容 :mod:`glaux_orchestrator.intent`。本模块随意图层在 P3 一并退役。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from glaux_core.tasks import TaskSpec, TaskType

__all__ = ["IntentResult", "Scope", "TaskSpec", "TaskType"]


class Scope(str, Enum):
    """意图相对内核能力的落域——沿用硬拒绝哲学，绝不把不确定静默跑成错结果。"""

    IN_SCOPE = "in_scope"        # 能映射到确定的 TaskSpec
    AMBIGUOUS = "ambiguous"      # 是医学测量意图但目标不明 → 需澄清
    OUT_OF_SCOPE = "out_of_scope"  # 超出当前已注册任务 → 拒绝
    CHAT = "chat"                # 非测量意图（问候/元问题/闲聊）→ 自由对话回复（reason 即回复）


@dataclass(frozen=True)
class IntentResult:
    """NL→规范的结果。``IN_SCOPE`` 时 ``spec`` 非空；否则 ``spec`` 为 None 且给出原因。"""

    scope: Scope
    spec: TaskSpec | None
    reason: str
    backend: str = "rule-based"

    def __post_init__(self) -> None:
        if self.scope is Scope.IN_SCOPE and self.spec is None:
            raise ValueError("IN_SCOPE 必须携带 TaskSpec")
        if self.scope is not Scope.IN_SCOPE and self.spec is not None:
            raise ValueError("非 IN_SCOPE 不应携带 TaskSpec（不静默错跑）")
