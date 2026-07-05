"""U7：产物 / provenance / 队列 CSV / overlay / 记忆捕获。"""

import csv

import numpy as np

from glaux_imt.artifacts.cohort import COLUMNS, write_cohort_csv
from glaux_imt.artifacts.overlay import render_overlay
from glaux_imt.artifacts.result import Provenance, SubjectResult
from glaux_imt.io.boundaries import Boundary
from glaux_imt.memory.capture import (
    CorrectionEvent,
    MemoryRecord,
    load_record,
    save_record,
)
from glaux_imt.segmentation.base import ROI


def _result(subject="clin_0001", image_id="clin_0001_R"):
    prov = Provenance(
        inputs={"image_id": image_id, "cf": 0.06, "cf_source": "cubs", "center": "Cyprus"},
        model_version="stub@0",
        params={"roi": [75, 225]},
        created_at="2026-07-05T00:00:00Z",
    )
    return SubjectResult(
        subject=subject,
        image_id=image_id,
        mean_mm=0.48,
        max_mm=0.55,
        confidence="confident",
        roi=(75, 225),
        provenance=prov,
        side="R",
        center="Cyprus",
    )


def test_subject_result_roundtrip():
    r = _result()
    r2 = SubjectResult.from_dict(r.to_dict())
    assert r2 == r
    assert r2.provenance.inputs["cf"] == 0.06


def test_cohort_csv_one_row_per_subject(tmp_path):
    results = [_result("clin_0001", "clin_0001_R"), _result("clin_0002", "clin_0002_L")]
    path = write_cohort_csv(results, tmp_path / "cohort.csv")
    with path.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == 2
    assert list(rows[0].keys()) == COLUMNS
    assert rows[0]["mean_mm"] == "0.480000"
    assert rows[0]["cf_source"] == "cubs"


def test_render_overlay_draws_colored_pixels():
    img = np.zeros((60, 80), dtype=np.uint8)
    x = np.arange(20.0, 60.0)
    li = Boundary("LI", x, np.full_like(x, 30.0))
    ma = Boundary("MA", x, np.full_like(x, 38.0))
    out = render_overlay(img, li, ma, ROI(x0=20, x1=60))
    arr = np.asarray(out)
    assert arr.shape == (60, 80, 3)
    # 出现非灰（R≠G 或 G≠B）像素，说明画上了彩色边界/ROI
    assert bool((arr[..., 0] != arr[..., 1]).any())


def test_memory_record_correction_attaches_and_roundtrips(tmp_path):
    rec = MemoryRecord(
        intent="测远壁 CCA IMT",
        pipeline={"steps": ["calibrate", "segment", "measure"]},
        result=_result().to_dict(),
        provenance={"model_version": "stub@0"},
    )
    rec.add_correction(
        CorrectionEvent(kind="drag_boundary", detail={"point": 12, "dy": -2.0},
                        created_at="2026-07-05T00:01:00Z")
    )
    assert rec.result_image_id == "clin_0001_R"
    assert len(rec.corrections) == 1

    path = save_record(rec, tmp_path / "mem.json")
    back = load_record(path)
    assert back.intent == "测远壁 CCA IMT"
    assert back.corrections[0].kind == "drag_boundary"
    assert back.result["image_id"] == "clin_0001_R"
