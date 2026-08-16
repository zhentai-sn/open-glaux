"""Atlas CLI：COCO / LabelMe / YOLO 小样本目录导入。

多边形 → roi+geometry；重跑幂等；shareable 需确认。
"""

from __future__ import annotations

import json

import pytest
from PIL import Image

from app import config
from app.atlas import cli, service


@pytest.fixture(autouse=True)
def _atlas_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ATLAS_ROOT", tmp_path / "atlas")
    service.reset()
    yield
    service.reset()


def _write_png(p, w=100, h=80):
    im = Image.new("L", (w, h), 90)
    px = im.load()
    for x in range(0, w, 9):
        px[x, 2] = 10
    im.save(p, "PNG")


def _coco_dir(tmp_path):
    d = tmp_path / "coco"
    (d / "images").mkdir(parents=True)
    _write_png(d / "images" / "img1.png")
    ann = {
        "images": [{"id": 1, "file_name": "img1.png", "width": 100, "height": 80}],
        "categories": [{"id": 7, "name": "EDD"}],
        "annotations": [
            {
                "id": 1,
                "image_id": 1,
                "category_id": 7,
                "segmentation": [[10, 10, 40, 12, 38, 40, 12, 38]],
                "bbox": [10, 10, 30, 30],
            },
            {"id": 2, "image_id": 1, "category_id": 7, "bbox": [50, 20, 20, 15]},
        ],
    }
    (d / "annotations.json").write_text(json.dumps(ann), encoding="utf-8")
    return d


def test_coco_import_polygon_and_bbox_and_rerun_idempotent(tmp_path):
    d = _coco_dir(tmp_path)
    args = [
        "import-dataset",
        str(d),
        "--format",
        "coco",
        "--tags",
        "tem",
        "--source-name",
        "ds1",
        "--license",
        "CC BY 4.0",
    ]
    assert cli.main(args) == 0
    svc = service.get()
    rows = svc.store.list(status="active", limit=10)
    assert len(rows) == 2
    poly = next(r for r in rows if r.geometry)
    assert (
        poly.roi == (10, 10, 30, 30)
        and len(poly.geometry) == 4
        and "edd" in poly.tags
        and "tem" in poly.tags
    )
    assert (
        poly.source_type == "dataset"
        and poly.source["dataset"] == "ds1"
        and poly.egress == "local-only"
    )
    assert poly.describe_status == "skipped"
    assert cli.main(args) == 0
    assert len(svc.store.list(status="active", limit=10)) == 2  # 幂等


def test_shareable_requires_confirm_flag(tmp_path):
    d = _coco_dir(tmp_path)
    base = ["import-dataset", str(d), "--format", "coco", "--tags", "tem", "--source-name", "ds1"]
    with pytest.raises(SystemExit):
        cli.main([*base, "--shareable"])
    assert cli.main([*base, "--shareable", "--i-confirm-egress"]) == 0
    ex = service.get().store.list(limit=1)[0]
    assert ex.egress == "shareable" and ex.egress_consent["via"] == "cli"


def test_labelme_and_yolo(tmp_path):
    lm = tmp_path / "lm"
    lm.mkdir()
    _write_png(lm / "s.png")
    (lm / "s.json").write_text(
        json.dumps(
            {
                "imagePath": "s.png",
                "shapes": [
                    {"label": "GBM", "shape_type": "rectangle", "points": [[5, 5], [45, 25]]},
                    {
                        "label": "EDD",
                        "shape_type": "polygon",
                        "points": [[50, 50], [70, 52], [65, 70]],
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    assert (
        cli.main(
            [
                "import-dataset",
                str(lm),
                "--format",
                "labelme",
                "--tags",
                "tem",
                "--source-name",
                "lm",
            ]
        )
        == 0
    )
    rows = service.get().store.list(limit=10)
    assert {tuple(r.roi) for r in rows} == {(5, 5, 40, 20), (50, 50, 20, 20)}

    yo = tmp_path / "yolo"
    yo.mkdir()
    _write_png(yo / "y.png", 200, 100)
    (yo / "classes.txt").write_text("edd\n", encoding="utf-8")
    (yo / "y.txt").write_text("0 0.5 0.5 0.2 0.4\n0 0.1 0.1 0.3 0.1 0.2 0.3\n", encoding="utf-8")
    assert (
        cli.main(
            ["import-dataset", str(yo), "--format", "yolo", "--tags", "tem", "--source-name", "yo"]
        )
        == 0
    )
    rows = [r for r in service.get().store.list(limit=20) if r.source["dataset"] == "yo"]
    assert (
        len(rows) == 2
        and any(r.roi == (80, 30, 40, 40) for r in rows)
        and any(r.geometry for r in rows)
    )


def test_describe_flag_calls_runtime_when_env_present(tmp_path, monkeypatch):
    d = _coco_dir(tmp_path)
    monkeypatch.setenv("GLAUX_VLM_PROVIDER", "openai")
    monkeypatch.setenv("GLAUX_VLM_MODEL", "gpt-x")
    calls = []

    def fake_post(url, json=None, timeout=None):
        calls.append(url)

        class R:
            def raise_for_status(self):
                pass

            def json(self):
                return {
                    "description": {
                        "modality": "TEM",
                        "subject": "GBM",
                        "findings": [],
                        "pattern": "",
                        "summary": "沉积",
                        "extra": {},
                    }
                }

        return R()

    import httpx

    monkeypatch.setattr(httpx, "post", fake_post)
    assert (
        cli.main(
            [
                "import-dataset",
                str(d),
                "--format",
                "coco",
                "--tags",
                "tem",
                "--source-name",
                "ds1",
                "--describe",
            ]
        )
        == 0
    )
    assert len(calls) == 2 and calls[0].endswith("/agent-api/v1/atlas/describe")
    assert all(r.describe_status == "done" for r in service.get().store.list(limit=10))
