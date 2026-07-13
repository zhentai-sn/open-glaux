"""U3：导入标定自动探测——从数据文件读嵌入标定（OpenSlide mpp / NIfTI voxel）。"""

from __future__ import annotations

import shutil

import pytest
from fastapi.testclient import TestClient

from app import config
from app import datasource_detect as det
from app import datasource_registry as reg
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _clean_imported():
    reg._SOURCES.clear()
    yield
    reg._SOURCES.clear()


# --- detect() 单元（真实数据；缺数据则 skip，同现有 WSI/CT 测试假设）---------


@pytest.mark.skipif(not config.wsi_data_available(), reason="需 data/wsi demo slide")
def test_detect_wsi_reads_mpp():
    cal = det.detect(config.WSI_ROOT, "pathology")
    assert "mpp" in cal and len(cal["mpp"]) == 2 and cal["mpp"][0] > 0


@pytest.mark.skipif(not config.ct_data_available(), reason="需 data/ct demo volume")
def test_detect_ct_reads_voxel():
    cal = det.detect(config.CT_ROOT, "ct_abdomen")
    assert "voxel_mm" in cal and len(cal["voxel_mm"]) == 3 and all(v > 0 for v in cal["voxel_mm"])


def test_detect_unknown_modality_empty(tmp_path):
    assert det.detect(tmp_path, "carotid_imt") == {}  # 复杂标定，暂不探测


def test_detect_empty_folder_no_slides(tmp_path):
    assert det.detect(tmp_path, "pathology") == {}


# --- 端到端：导入自带 mpp 的 WSI 文件夹 → 无需手填标定即 active ---------------


@pytest.mark.skipif(not config.wsi_data_available(), reason="需 data/wsi demo slide")
def test_import_wsi_autodetects_calibration(tmp_path, monkeypatch):
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    folder = tmp_path / "myslides"
    folder.mkdir()
    # 拷一张真实 demo slide（自带 mpp）进白名单目录
    src_slide = next(
        p for p in config.WSI_ROOT.glob("slide_*") if p.suffix.lower() in config._WSI_SUFFIXES
    )
    shutil.copy(src_slide, folder / src_slide.name)

    # 不传 calibration —— 后端应从 slide 自动探测 mpp → active
    r = client.post("/datasources", json={"path": str(folder), "modality": "pathology"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "active"
    assert "mpp" in body["calibration"] and body["calibration"]["mpp"][0] > 0
