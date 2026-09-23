"""SDD 10 W2：动作轴与表征面——DETECTORS 不变量、run_task 公共前缀、/objects 端点族与 alias 等价。"""

from __future__ import annotations

import base64
import io
import json

import pytest
from fastapi.testclient import TestClient
from glaux_core.tasks import REGISTRY
from PIL import Image

from app import config, dataset_ct, schemas
from app import datasource_registry as reg
from app.detectors import DETECTORS
from app.main import app

client = TestClient(app)

PROTOCOL = ("kind", "accepted_regions", "available", "methods", "detect", "reference",
            "apply_edit", "verify")


def _frame(path, **params):
    r = client.get(path, params=params)
    return r, (json.loads(r.headers["X-Glaux-Frame"]) if r.status_code == 200 else None)


def _png_size(data: bytes) -> tuple[int, int]:
    return Image.open(io.BytesIO(data)).size


def _first(modality):
    rows = client.get("/images", params={"modality": modality}).json()
    return rows[0] if rows else None


# --- DETECTORS 不变量 --------------------------------------------------------------


def test_registry_adapter_kinds_equal_detectors():
    assert {p.adapter_kind for p in REGISTRY.values()} == set(DETECTORS)


@pytest.mark.parametrize("kind", list(DETECTORS))
def test_every_detector_satisfies_protocol(kind):
    det = DETECTORS[kind]
    assert det.kind == kind
    assert all(hasattr(det, name) for name in PROTOCOL)
    assert set(det.accepted_regions) <= {"box", "column_window", "slice", "frame_range"}


def test_models_are_aggregated_from_detectors():
    ids = [m["id"] for m in client.get("/models").json()]
    expected = [m.id for p in REGISTRY.values() for m in DETECTORS[p.adapter_kind].methods()]
    assert ids == expected


def test_tasks_carry_object_kinds_trigger_classes():
    rows = {r["task"]: r for r in client.get("/tasks").json()}
    assert len(rows) == len(REGISTRY)
    for r in rows.values():
        assert r["object_kinds"] and r["trigger"] in {"on_open", "on_region", "manual"}
    assert {"voi", "z_scroll"} <= set(rows["totalseg_liver_kidney"]["capabilities"])
    assert "verify" in rows["nuclei_detection"]["capabilities"]
    assert rows["nuclei_detection"]["trigger"] == "on_region"
    assert rows["totalseg_liver_kidney"]["classes"]


def test_modality_and_task_are_registry_validated():
    assert client.get("/images", params={"modality": "mri_brain"}).status_code == 422
    assert client.post("/task/run", json={"task": "nope", "image_id": "x"}).status_code == 422


# --- run_task 公共前缀（§6.3 ①～④） -----------------------------------------------


def test_run_task_unknown_object_is_404():
    r = client.post("/task/run", json={"task": "far_wall_cca_imt", "image_id": "no_such"})
    assert r.status_code == 404


def test_run_task_object_kind_gate():
    """① 几何族不符：CT 任务对 2D 图像 → 422（不比 modality，D-13）。"""
    img = _first("natural_image")
    if img is None:
        pytest.skip("需通用图像示例")
    r = client.post("/task/run", json={"task": "totalseg_liver_kidney", "image_id": img["id"]})
    assert r.status_code == 422 and "不适用" in r.text


def test_run_task_detector_unavailable_is_503(monkeypatch):
    """② Detector 不可用 → 503，不降级为合成结果。"""
    img = _first("carotid_imt")
    monkeypatch.setattr(DETECTORS["wall_pair"], "available", lambda: False)
    r = client.post("/task/run", json={"task": "far_wall_cca_imt", "image_id": img["id"]})
    assert r.status_code == 503


def test_run_task_region_kind_gate():
    """③ 选区类型不符：column_window 对 volume、frame_range 对 image → 422（§15.1 D）。"""
    ct = _first("ct_abdomen")
    if ct is not None:
        r = client.post("/task/run", json={
            "task": "totalseg_liver_kidney", "image_id": ct["id"],
            "region": {"kind": "column_window", "x0": 1, "x1": 5},
        })
        assert r.status_code == 422 and "选区" in r.text
    img = _first("carotid_imt")
    r = client.post("/task/run", json={
        "task": "far_wall_cca_imt", "image_id": img["id"],
        "region": {"kind": "frame_range", "t0": 0, "t1": 3},
    })
    assert r.status_code == 422 and "选区" in r.text


def test_run_task_unknown_calibration_kind_is_422():
    """④ 未知 Calibration.kind → HardReject → 422，不回落缺省标定（D-16）。"""
    img = _first("carotid_imt")
    r = client.post("/task/run", json={
        "task": "far_wall_cca_imt", "image_id": img["id"],
        "calibration": {"kind": "mystery", "value": 1, "source": "test"},
    })
    assert r.status_code == 422


def test_legacy_taskspec_fields_are_mapped_and_counted():
    before = dict(schemas.LEGACY_HITS)
    spec = schemas.TaskSpec(task="nuclei_detection", image_id="x", roi_box=(1, 2, 3, 4))
    assert spec.region.model_dump(exclude_none=True) == {"kind": "box", "x0": 1, "y0": 2,
                                                         "x1": 3, "y1": 4}
    spec = schemas.TaskSpec(image_id="x", cubs_cf=0.05, roi=(10, 20))
    assert spec.calibration.kind == "mm_per_px" and spec.region.kind == "column_window"
    assert schemas.LEGACY_HITS["roi_box"] == before.get("roi_box", 0) + 1
    # 新字段已给出时旧字段整体忽略
    spec = schemas.TaskSpec(image_id="x", roi=(1, 2),
                            region={"kind": "column_window", "x0": 5, "x1": 9})
    assert (spec.region.x0, spec.region.x1) == (5, 9)


# --- /objects 表征面 --------------------------------------------------------------


def test_object_meta_equals_list_element():
    for modality in reg.MODALITIES:
        row = _first(modality)
        if row is not None:
            assert client.get(f"/objects/{row['id']}").json() == row


def test_no_objects_list_endpoint():
    assert client.get("/objects").status_code in (404, 405)


def test_frame_image_reference_frame():
    img = _first("natural_image")
    if img is None:
        pytest.skip("需通用图像示例")
    w, h = img["axes"][0]["size"], img["axes"][1]["size"]
    r, f = _frame(f"/objects/{img['id']}/frame", roi=f"0,0,{w // 2},{h // 2}", size=64)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert f["object_id"] == img["id"] and f["origin"] == [0.0, 0.0] and f["index"] == {
        "z": None, "t": None, "level": None}
    assert max(f["width"], f["height"]) == 64 and _png_size(r.content) == (f["width"], f["height"])
    assert f["scale"] == pytest.approx(64 / max(w // 2, h // 2))


def test_frame_volume_reference_frame():
    ct = _first("ct_abdomen")
    if ct is None:
        pytest.skip("需 data/ct demo volume")
    nz = ct["axes"][2]["size"]
    r, f = _frame(f"/objects/{ct['id']}/frame", z=nz - 1)
    assert r.status_code == 200 and f["index"]["z"] == nz - 1
    assert (f["width"], f["height"]) == (ct["axes"][0]["size"], ct["axes"][1]["size"])
    assert f["origin"] == [0.0, 0.0] and f["scale"] == 1.0
    soft = client.get(f"/objects/{ct['id']}/frame", params={"z": 10}).content
    bone = client.get(f"/objects/{ct['id']}/frame", params={"z": 10, "window": "2000,500"}).content
    assert soft != bone  # 窗宽窗位生效
    assert client.get(f"/objects/{ct['id']}/frame", params={"z": nz}).status_code == 422


def test_frame_slide_requires_level_and_limits_roi():
    slide = _first("pathology")
    if slide is None:
        pytest.skip("需 data/wsi demo slide")
    sid, levels = slide["id"], slide["axes"][2]["size"]
    assert client.get(f"/objects/{sid}/frame").status_code == 422  # slide 强制 level
    coarsest = levels - 1
    r, f = _frame(f"/objects/{sid}/frame", level=coarsest, roi="0,0,2048,1024", size=4096)
    assert r.status_code == 200 and f["index"]["level"] == coarsest and f["origin"] == [0.0, 0.0]
    down = slide["meta"]["level_downsamples"][coarsest]
    assert f["scale"] == pytest.approx(1 / down)
    assert f["width"] == round(2048 / down) and _png_size(r.content) == (f["width"], f["height"])
    r = client.get(f"/objects/{sid}/frame", params={"level": 0, "roi": "0,0,9000,9000"})
    assert r.status_code == 413  # 81 Mpx > 64 Mpx


def test_frame_parameter_errors():
    img = _first("carotid_imt")
    oid = img["id"]
    assert client.get(f"/objects/{oid}/frame", params={"z": 0}).status_code == 422  # image 无 z
    assert client.get(f"/objects/{oid}/frame", params={"level": 0}).status_code == 422
    assert client.get(f"/objects/{oid}/frame", params={"size": 5000}).status_code == 413
    assert client.get(f"/objects/{oid}/frame", params={"size": 10}).status_code == 422
    assert client.get(f"/objects/{oid}/frame", params={"roi": "5,5,1,1"}).status_code == 422
    assert client.get(f"/objects/{oid}/frame", params={"roi": "1,2,3"}).status_code == 422
    assert client.get(f"/objects/{oid}/frame", params={"window": "0,40"}).status_code == 422
    assert client.get("/objects/no_such/frame").status_code == 404


def test_frame_is_deterministic_per_parameters():
    img = _first("carotid_imt")
    a = client.get(f"/objects/{img['id']}/frame", params={"size": 128})
    b = client.get(f"/objects/{img['id']}/frame", params={"size": 128})
    c = client.get(f"/objects/{img['id']}/frame", params={"size": 256})
    assert a.content == b.content and a.headers["X-Glaux-Frame"] == b.headers["X-Glaux-Frame"]
    assert a.content != c.content


def test_representation_kind_mismatch_is_422():
    img = _first("carotid_imt")
    assert client.get(f"/objects/{img['id']}/raw").status_code == 422
    assert client.get(f"/objects/{img['id']}/tiles/0/0/0").status_code == 422
    ct = _first("ct_abdomen")
    if ct is not None:
        assert client.get(f"/objects/{ct['id']}/tiles/0/0/0").status_code == 422


# --- alias 字节等价（§5.3） -------------------------------------------------------


def test_alias_volume_raw_bytes_equal():
    ct = _first("ct_abdomen")
    if ct is None:
        pytest.skip("需 data/ct demo volume")
    assert client.get(f"/volume/{ct['id']}").content == client.get(
        f"/objects/{ct['id']}/raw").content
    assert client.get("/volume/tech_401").status_code == 404  # 非 volume 仍 404


def test_alias_wsi_tile_bytes_equal():
    slide = _first("pathology")
    if slide is None:
        pytest.skip("需 data/wsi demo slide")
    sid = slide["id"]
    assert client.get(f"/wsi/{sid}/tile/9/0/0").content == client.get(
        f"/objects/{sid}/tiles/9/0/0").content
    assert client.get(f"/objects/{sid}/tiles/999/0/0").status_code == 404


def test_alias_lists_equal_images():
    for path, modality in (("/volumes", "ct_abdomen"), ("/slides", "pathology")):
        r = client.get(path)
        if r.status_code == 200:
            assert r.json() == client.get("/images", params={"modality": modality}).json()


# --- /objects/{id}/edits ----------------------------------------------------------


def _seed_ct(tmp_path, monkeypatch):
    import nibabel as nib
    import numpy as np

    monkeypatch.setattr(config, "CT_ROOT", tmp_path / "ct")
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    (tmp_path / "ct").mkdir()
    (tmp_path / "cache").mkdir()
    ct = nib.Nifti1Image(np.full((4, 4, 4), 50.0, dtype=np.float32), np.eye(4))
    ct.header.set_zooms((0.5, 0.5, 2.0))
    nib.save(ct, str(tmp_path / "ct" / "ct_001.nii.gz"))
    lm = nib.Nifti1Image(np.zeros((4, 4, 4), dtype=np.int32), np.eye(4))
    nib.save(lm, str(tmp_path / "cache" / "ct_001_totalsegmentator_v2.nii.gz"))
    dataset_ct._load_nifti.cache_clear()
    dataset_ct.reset_edit_seq()
    reg.invalidate_index()


def _mask_png() -> str:
    buf = io.BytesIO()
    Image.new("L", (4, 4), 255).save(buf, format="PNG")  # PNG 宽 = X、高 = Y
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _edit(base_seq):
    return {"task": "totalseg_liver_kidney", "method": "totalsegmentator_v2",
            "base_seq": base_seq,
            "ops": [{"index": {"z": 1}, "class_id": 1, "mode": "paint", "mask_png": _mask_png()}]}


def test_edits_optimistic_concurrency(tmp_path, monkeypatch):
    _seed_ct(tmp_path, monkeypatch)
    r = client.post("/objects/ct_001/edits", json=_edit(0))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["seq"] == 1 and body["metrics"]["liver_volume_mm3"]["value"] == 16 * 0.5 * 0.5 * 2
    stale = client.post("/objects/ct_001/edits", json=_edit(0))
    assert stale.status_code == 409
    assert dataset_ct.current_edit_seq("ct_001") == 1  # 冲突不产生写
    again = client.post("/objects/ct_001/edits", json=_edit(1))
    # 重放同一 ops：labelmap 与度量不变
    assert again.status_code == 200 and again.json()["metrics"] == body["metrics"]


def test_edits_alias_same_result(tmp_path, monkeypatch):
    _seed_ct(tmp_path, monkeypatch)
    new = client.post("/objects/ct_001/edits", json=_edit(0)).json()
    dataset_ct.reset_edit_seq()
    old = client.post("/volume/ct_001/mask-edit", json={
        "task": "totalseg_liver_kidney", "method": "totalsegmentator_v2", "base_seq": 0,
        "slices": [{"z": 1, "class_id": 1, "mode": "paint", "mask_png_ref": _mask_png()}],
    }).json()
    assert old == new


def test_edits_reject_bad_requests(tmp_path, monkeypatch):
    _seed_ct(tmp_path, monkeypatch)
    bad_class = _edit(0)
    bad_class["ops"][0]["class_id"] = 999
    assert client.post("/objects/ct_001/edits", json=bad_class).status_code == 422
    img = _first("carotid_imt")
    assert client.post(f"/objects/{img['id']}/edits", json=_edit(0)).status_code == 422
    assert client.post("/objects/no_such/edits", json=_edit(0)).status_code == 404
