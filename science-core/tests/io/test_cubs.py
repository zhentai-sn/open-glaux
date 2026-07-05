"""U2：CUBS 读取与标定加载。

用合成的 CUBS 式目录树（tmp_path），复刻已核对的磁盘格式：
tiff 图 / ``CF/<id>_CF.txt`` 标量 / 两行折线 / 分号临床 CSV。
"""

import numpy as np
import pytest
from PIL import Image

from glaux_imt.errors import CalibrationUnavailable
from glaux_imt.io import cubs


def _write_profile(path, x, y):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        " ".join(f"{v:.6f}" for v in x) + " \n"
        + " ".join(f"{v:.6f}" for v in y) + " \n"
    )


def _build_tree(root, *, with_cf=True, methods=("Manual-A1", "Manual-A2")):
    images = root / "IMAGES"
    cf = root / "CF"
    seg = root / "SEGMENTATIONS"
    images.mkdir(parents=True)
    cf.mkdir()
    for image_id in ("clin_0001_L", "clin_0001_R", "tech_383"):
        Image.new("L", (16, 12)).save(images / f"{image_id}.tiff")
        if with_cf:
            (cf / f"{image_id}_CF.txt").write_text("0.060000\n")
        x = np.arange(4.0, 12.0)
        for method in methods:
            _write_profile(seg / method / f"{image_id}-LI.txt", x, np.full_like(x, 30.0))
            _write_profile(seg / method / f"{image_id}-MA.txt", x, np.full_like(x, 36.0))
    csv = root / "ClinicalDatabase-CUBS.csv"
    csv.write_text(
        "﻿;Patient ID;age\n"
        "Nicolaides - Cyprus;clin_0001;65\n"
        "Ghiadoni - Pisa;tech_383;70\n"
    )
    return dict(images_dir=images, cf_dir=cf, segmentations_dir=seg, clinical_csv=csv)


def test_parse_image_id():
    assert cubs.parse_image_id("clin_0006_R") == ("clin_0006", "R")
    assert cubs.parse_image_id("tech_383") == ("tech_383", None)
    with pytest.raises(ValueError):
        cubs.parse_image_id("garbage_x")


def test_load_cf_scalar(tmp_path):
    p = tmp_path / "clin_0001_L_CF.txt"
    p.write_text("0.083300\n")
    assert cubs.load_cf(p) == pytest.approx(0.0833)


def test_load_cf_missing_raises(tmp_path):
    with pytest.raises(CalibrationUnavailable):
        cubs.load_cf(tmp_path / "nope_CF.txt")


def test_load_cf_unparseable_raises(tmp_path):
    p = tmp_path / "bad_CF.txt"
    p.write_text("not-a-number\n")
    with pytest.raises(CalibrationUnavailable):
        cubs.load_cf(p)


def test_read_profile_two_rows(tmp_path):
    p = tmp_path / "clin_0001_L-LI.txt"
    _write_profile(p, [1.0, 2.0, 3.0], [10.0, 11.0, 12.0])
    b = cubs.read_profile(p, "LI")
    assert b.name == "LI"
    np.testing.assert_allclose(b.x, [1, 2, 3])
    np.testing.assert_allclose(b.y, [10, 11, 12])


def test_read_profile_wrong_row_count_raises(tmp_path):
    p = tmp_path / "bad-LI.txt"
    p.write_text("1.0 2.0 3.0\n")  # 只有一行
    with pytest.raises(ValueError):
        cubs.read_profile(p, "LI")


def test_read_dataset_happy(tmp_path):
    paths = _build_tree(tmp_path)
    records = cubs.read_dataset(**paths)
    assert {r.image_id for r in records} == {"clin_0001_L", "clin_0001_R", "tech_383"}
    rec = next(r for r in records if r.image_id == "clin_0001_R")
    assert rec.side == "R"
    assert rec.subject == "clin_0001"
    assert rec.cf == pytest.approx(0.06)
    assert rec.center == "Cyprus"
    assert set(rec.annotations) == {"Manual-A1", "Manual-A2"}
    assert len(rec.annotations["Manual-A1"].li) == 8


def test_read_dataset_center_mapping(tmp_path):
    paths = _build_tree(tmp_path)
    records = cubs.read_dataset(**paths)
    tech = next(r for r in records if r.image_id == "tech_383")
    assert tech.side is None
    assert tech.center == "Pisa"


def test_read_dataset_missing_annotation_is_absent_not_error(tmp_path):
    # 只放 A1，请求 A1+A2 → A2 记为缺席，不崩
    paths = _build_tree(tmp_path, methods=("Manual-A1",))
    records = cubs.read_dataset(
        images_dir=paths["images_dir"],
        cf_dir=paths["cf_dir"],
        segmentations_dir=paths["segmentations_dir"],
        clinical_csv=paths["clinical_csv"],
        methods=["Manual-A1", "Manual-A2"],
    )
    rec = records[0]
    assert "Manual-A1" in rec.annotations
    assert "Manual-A2" not in rec.annotations


def test_read_dataset_missing_cf_is_none_not_raise(tmp_path):
    paths = _build_tree(tmp_path, with_cf=False)
    records = cubs.read_dataset(**paths)
    assert all(r.cf is None for r in records)
