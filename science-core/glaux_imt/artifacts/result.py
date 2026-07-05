"""结构化产物 + provenance（U7）.

每受试者一份可复现、可审计的结果：mean/max IMT(mm) + 置信 + provenance
（输入、CF 来源、模型版本、参数、时间戳）。时间戳由**调用方注入**，纯函数内
不取时钟——便于可复现与测试。
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class Provenance:
    inputs: dict = field(default_factory=dict)  # image_id, cf, cf_source, center…
    model_version: str = ""
    params: dict = field(default_factory=dict)
    created_at: str = ""  # ISO8601，调用方注入

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Provenance":
        return cls(
            inputs=dict(d.get("inputs", {})),
            model_version=d.get("model_version", ""),
            params=dict(d.get("params", {})),
            created_at=d.get("created_at", ""),
        )


@dataclass(frozen=True)
class SubjectResult:
    subject: str
    image_id: str
    mean_mm: float
    max_mm: float
    confidence: str  # "confident" / "unsure"
    roi: tuple[int, int]
    provenance: Provenance
    side: str | None = None
    center: str | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["roi"] = list(self.roi)
        d["provenance"] = self.provenance.to_dict()
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "SubjectResult":
        roi = d["roi"]
        return cls(
            subject=d["subject"],
            image_id=d["image_id"],
            mean_mm=float(d["mean_mm"]),
            max_mm=float(d["max_mm"]),
            confidence=d["confidence"],
            roi=(int(roi[0]), int(roi[1])),
            provenance=Provenance.from_dict(d.get("provenance", {})),
            side=d.get("side"),
            center=d.get("center"),
        )
