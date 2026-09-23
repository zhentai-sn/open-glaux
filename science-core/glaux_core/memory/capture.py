"""回合与轨迹的入口（U7）：结构化捕获.

结构化捕获 `意图 → 流程 → 结果 → 人工校正 → provenance`，可沉淀为案例（纲领 §六 回合与轨迹）。
校正事件挂到对应结果。
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class CorrectionEvent:
    """一次无代码修正：拖边界 / 挪 ROI / 对象级接受或拒绝。"""

    kind: str  # drag_boundary | move_roi | accept | reject
    detail: dict = field(default_factory=dict)
    created_at: str = ""  # 调用方注入

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class MemoryRecord:
    """一次运行的完整轨迹，供回流。"""

    intent: str  # NL 目标 / 任务规范摘要
    pipeline: dict = field(default_factory=dict)  # 步骤 + 参数
    result: dict = field(default_factory=dict)  # SubjectResult.to_dict()
    provenance: dict = field(default_factory=dict)
    corrections: list[CorrectionEvent] = field(default_factory=list)

    def add_correction(self, event: CorrectionEvent) -> None:
        self.corrections.append(event)

    @property
    def result_image_id(self) -> str | None:
        return self.result.get("image_id")

    def to_dict(self) -> dict:
        return {
            "intent": self.intent,
            "pipeline": self.pipeline,
            "result": self.result,
            "provenance": self.provenance,
            "corrections": [c.to_dict() for c in self.corrections],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MemoryRecord":
        return cls(
            intent=d.get("intent", ""),
            pipeline=dict(d.get("pipeline", {})),
            result=dict(d.get("result", {})),
            provenance=dict(d.get("provenance", {})),
            corrections=[
                CorrectionEvent(
                    kind=c["kind"],
                    detail=dict(c.get("detail", {})),
                    created_at=c.get("created_at", ""),
                )
                for c in d.get("corrections", [])
            ],
        )


def save_record(record: MemoryRecord, path: Path) -> Path:
    path = Path(path)
    path.write_text(json.dumps(record.to_dict(), ensure_ascii=False, indent=2))
    return path


def load_record(path: Path) -> MemoryRecord:
    return MemoryRecord.from_dict(json.loads(Path(path).read_text()))
