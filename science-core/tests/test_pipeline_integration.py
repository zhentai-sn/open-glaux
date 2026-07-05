"""端到端集成：读 CUBS → 标定 → 分割(桩) → PDM 测量 → 产物 → 队列 CSV。

无 mock，真实组合各层——证明环境四层贯通（硬拒绝路径也一并验证）。
"""

import csv

import numpy as np
import pytest
from PIL import Image

from eval.harness import bland_altman
from glaux_imt.artifacts.cohort import write_cohort_csv
from glaux_imt.artifacts.result import Provenance, SubjectResult
from glaux_imt.calibration.calibration import resolve_calibration
from glaux_imt.errors import HardReject
from glaux_imt.io import cubs
from glaux_imt.measurement.pdm import imt
from glaux_imt.segmentation.base import SegmentationRequest
from glaux_imt.segmentation.stub import ConstantThicknessAdapter


def _build_cubs(root):
    images, cf, seg = root / "IMAGES", root / "CF", root / "SEGMENTATIONS"
    images.mkdir(parents=True)
    cf.mkdir()
    for image_id in ("clin_0001_L", "clin_0002_R"):
        Image.new("L", (200, 120)).save(images / f"{image_id}.tiff")
        (cf / f"{image_id}_CF.txt").write_text("0.060000\n")
        x = np.arange(40.0, 160.0)
        (seg / "Manual-A1").mkdir(parents=True, exist_ok=True)
        _p(seg / "Manual-A1" / f"{image_id}-LI.txt", x, np.full_like(x, 50.0))
        _p(seg / "Manual-A1" / f"{image_id}-MA.txt", x, np.full_like(x, 58.0))  # 8px 金标准
    (root / "clin.csv").write_text(
        "﻿;Patient ID;age\nNicolaides - Cyprus;clin_0001;65\nGhiadoni - Pisa;clin_0002;70\n"
    )
    return dict(
        images_dir=images, cf_dir=cf, segmentations_dir=seg, clinical_csv=root / "clin.csv"
    )


def _p(path, x, y):
    path.write_text(
        " ".join(f"{v:.6f}" for v in x) + "\n" + " ".join(f"{v:.6f}" for v in y) + "\n"
    )


def test_full_pipeline_read_to_cohort(tmp_path):
    records = cubs.read_dataset(**_build_cubs(tmp_path))
    adapter = ConstantThicknessAdapter(li_y=50.0, thickness_px=8.0)

    results, preds, refs = [], {}, {}
    for rec in records:
        cal = resolve_calibration(cubs_cf=rec.cf)  # CUBS CF 档
        image = np.asarray(Image.open(rec.image_path))
        seg = adapter.segment(SegmentationRequest(image=image))
        meas = imt(seg.li, seg.ma, cf=cal.cf)

        # 金标准（A1）复算 IMT 作参照
        gold = rec.annotations["Manual-A1"]
        ref = imt(gold.li, gold.ma, cf=cal.cf)

        results.append(
            SubjectResult(
                subject=rec.subject,
                image_id=rec.image_id,
                mean_mm=meas.mean_mm,
                max_mm=meas.max_mm,
                confidence="confident",
                roi=(seg.roi_used.x0, seg.roi_used.x1),
                provenance=Provenance(
                    inputs={"image_id": rec.image_id, "cf": cal.cf, "cf_source": cal.source.value},
                    model_version=seg.model_version,
                    created_at="2026-07-05T00:00:00Z",
                ),
                side=rec.side,
                center=rec.center,
            )
        )
        preds[rec.image_id] = meas.mean_mm
        refs[rec.image_id] = ref.mean_mm

    # 桩厚度 == 金标准厚度（都 8px）→ 完美一致
    ba = bland_altman(list(preds.values()), list(refs.values()))
    assert ba.bias_um == pytest.approx(0.0, abs=1e-6)

    path = write_cohort_csv(results, tmp_path / "cohort.csv")
    with path.open(encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == 2
    assert rows[0]["mean_mm"] == "0.480000"  # 8px × 0.06
    assert {r["center"] for r in rows} == {"Cyprus", "Pisa"}


def test_pipeline_hard_rejects_when_no_calibration(tmp_path):
    paths = _build_cubs(tmp_path)
    # 删掉 CF → cf=None → 标定层硬拒绝，绝不静默输出无标定 IMT
    for f in (paths["cf_dir"]).glob("*.txt"):
        f.unlink()
    records = cubs.read_dataset(**paths)
    rec = records[0]
    assert rec.cf is None
    with pytest.raises(HardReject):
        resolve_calibration(cubs_cf=rec.cf)
