"""队列聚合 CSV（U7）：每受试者一行。"""

from __future__ import annotations

import csv
from collections.abc import Sequence
from pathlib import Path

from glaux_imt.artifacts.result import SubjectResult

COLUMNS = [
    "subject",
    "image_id",
    "side",
    "center",
    "mean_mm",
    "max_mm",
    "confidence",
    "roi_x0",
    "roi_x1",
    "model_version",
    "cf",
    "cf_source",
    "created_at",
]


def cohort_row(r: SubjectResult) -> dict:
    prov = r.provenance
    return {
        "subject": r.subject,
        "image_id": r.image_id,
        "side": r.side or "",
        "center": r.center or "",
        "mean_mm": f"{r.mean_mm:.6f}",
        "max_mm": f"{r.max_mm:.6f}",
        "confidence": r.confidence,
        "roi_x0": r.roi[0],
        "roi_x1": r.roi[1],
        "model_version": prov.model_version,
        "cf": prov.inputs.get("cf", ""),
        "cf_source": prov.inputs.get("cf_source", ""),
        "created_at": prov.created_at,
    }


def write_cohort_csv(results: Sequence[SubjectResult], path: Path) -> Path:
    """写队列 CSV（列稳定），返回路径。"""
    path = Path(path)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNS)
        writer.writeheader()
        for r in results:
            writer.writerow(cohort_row(r))
    return path
