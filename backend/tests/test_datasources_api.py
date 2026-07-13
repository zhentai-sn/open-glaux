"""U2：/datasources 端点 + 导入闭环 + capabilities 数据集卡动态化。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import datasource_registry as reg
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_imported():
    """每测清空导入源（builtin 是实时视图不受影响），避免跨测泄漏。"""
    reg._SOURCES.clear()
    yield
    reg._SOURCES.clear()


def _folder(tmp_path, monkeypatch, name="myslides", with_file=True):
    """在白名单根下造一个数据文件夹，并把落盘清单指向 tmp（隔离）。"""
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    d = tmp_path / name
    d.mkdir()
    if with_file:
        (d / "slide_001.svs").write_bytes(b"stub")
    return d


# --- GET /datasources -------------------------------------------------------


def test_lists_builtins_in_dev_mode():
    r = client.get("/datasources")
    assert r.status_code == 200
    ids = {s["id"] for s in r.json()}
    assert {"cubs-tech", "hc18", "ct-demo", "wsi-demo"} <= ids


def test_source_has_required_fields():
    s = client.get("/datasources").json()[0]
    assert set(s) >= {"id", "name", "modality", "root", "origin", "calibration", "status"}
    assert s["origin"] in ("builtin", "imported", "connector")


# --- POST /datasources 导入 -------------------------------------------------


def test_import_without_calibration_needs_calibration(tmp_path, monkeypatch):
    d = _folder(tmp_path, monkeypatch)
    r = client.post("/datasources", json={"path": str(d), "modality": "pathology"})
    assert r.status_code == 200
    assert r.json()["status"] == "needs_calibration"
    assert r.json()["origin"] == "imported"


def test_import_with_calibration_active(tmp_path, monkeypatch):
    d = _folder(tmp_path, monkeypatch)
    r = client.post(
        "/datasources",
        json={"path": str(d), "modality": "pathology", "calibration": {"mpp": [0.5, 0.5]}},
    )
    assert r.status_code == 200 and r.json()["status"] == "active"


def test_import_rejects_path_outside_whitelist(tmp_path, monkeypatch):
    allow = tmp_path / "allow"
    allow.mkdir()
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(allow))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "x").write_bytes(b"1")
    r = client.post(
        "/datasources",
        json={"path": str(outside), "modality": "pathology", "calibration": {"mpp": [0.5, 0.5]}},
    )
    assert r.status_code == 422


def test_import_rejects_bad_modality(tmp_path, monkeypatch):
    d = _folder(tmp_path, monkeypatch)
    r = client.post("/datasources", json={"path": str(d), "modality": "mri_brain"})
    assert r.status_code == 422  # pydantic Modality Literal 校验


def test_import_appears_then_removable(tmp_path, monkeypatch):
    d = _folder(tmp_path, monkeypatch)
    src = client.post(
        "/datasources",
        json={"path": str(d), "modality": "pathology", "calibration": {"mpp": [0.5, 0.5]}},
    ).json()
    sid = src["id"]
    # 列表里出现
    assert sid in {s["id"] for s in client.get("/datasources").json()}
    # 可删
    assert client.delete(f"/datasources/{sid}").status_code == 200
    assert sid not in {s["id"] for s in client.get("/datasources").json()}
    # builtin 不可删
    assert client.delete("/datasources/cubs-tech").status_code == 404


# --- capabilities 数据集卡动态化 --------------------------------------------


def test_capabilities_has_builtin_dataset_cards():
    cards = [c for c in client.get("/capabilities").json() if c["kind"] == "dataset"]
    ids = {c["id"] for c in cards}
    assert "dataset:wsi-demo" in ids and "dataset:cubs-tech" in ids


def test_imported_source_shows_as_capability_card(tmp_path, monkeypatch):
    """导入一个源 → capabilities 多一张 dataset 卡（零改代码验证）。"""
    d = _folder(tmp_path, monkeypatch)
    src = client.post(
        "/datasources",
        json={"path": str(d), "modality": "pathology", "calibration": {"mpp": [0.5, 0.5]}},
    ).json()
    cards = {c["id"] for c in client.get("/capabilities").json() if c["kind"] == "dataset"}
    assert f"dataset:{src['id']}" in cards
