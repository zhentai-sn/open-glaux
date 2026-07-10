"""P6 U4 测试：画笔编辑回流（patch_labelmap + /volume/{id}/mask-edit 端点）。"""

from __future__ import annotations

import base64
import io
import os
from unittest import mock

import nibabel as nib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config, dataset_ct
from app.main import app

client = TestClient(app)


# --- helpers ---------------------------------------------------------------


def _png_b64_mask(mask: np.ndarray) -> str:
    """二维 bool mask → base64 PNG（前端 U4 提交格式：data:image/png;base64,...）。"""
    assert mask.dtype == bool
    img = Image.fromarray((mask * 255).astype(np.uint8), mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _seed_labelmap(tmp_path, monkeypatch, Z=10, Y=10, X=10, vox=(0.5, 0.5, 1.5)):
    """造 CT 体积 + 假 labelmap，落 tmp_path 模拟 data/ct/ + TS_CACHE/，返回 (volume_id, method, ct_path, lbl_path)。"""
    monkeypatch.setattr(config, "CT_ROOT", tmp_path / "ct")
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    volume_id = "ct_001"
    method = "totalsegmentator_v2"

    # CT 原始
    ct_arr = np.random.RandomState(0).normal(40, 50, (Z, Y, X)).astype(np.float32)
    ct_img = nib.Nifti1Image(ct_arr, np.eye(4))
    ct_img.header.set_zooms(vox)
    ct_path = tmp_path / "ct" / f"{volume_id}.nii.gz"
    ct_path.parent.mkdir(parents=True)
    nib.save(ct_img, str(ct_path))

    # labelmap：肝=1 中心 6×6×6，双肾=2/3 各角 2×2×2
    lbl = np.zeros((Z, Y, X), dtype=np.int32)
    lbl[2:8, 2:8, 2:8] = 1
    lbl[0:2, 0:2, 0:2] = 2
    lbl[0:2, 8:10, 8:10] = 3
    lbl_img = nib.Nifti1Image(lbl, np.eye(4))
    lbl_img.header.set_zooms(vox)
    lbl_path = config.TS_CACHE / f"{volume_id}_{method}.nii.gz"
    lbl_path.parent.mkdir(parents=True)
    nib.save(lbl_img, str(lbl_path))

    dataset_ct._load_nifti.cache_clear()
    return volume_id, method, str(ct_path), str(lbl_path)


# --- patch_labelmap 单测 --------------------------------------------------


def test_patch_labelmap_erase_reduces_liver(tmp_path, monkeypatch):
    """erase 一片肝 → labelmap 肝区减少。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch, Z=10, Y=10, X=10)
    # z=5 切肝中心，擦 4×4 中间
    mask = np.zeros((10, 10), dtype=bool)
    mask[3:7, 3:7] = True
    new_path, new_arr = dataset_ct.patch_labelmap(
        volume_id,
        [{"z": 5, "class_id": 1, "mode": "erase", "mask_png_ref": _png_b64_mask(mask)}],
        method=method,
    )
    assert new_path.endswith("ct_001_totalsegmentator_v2.nii.gz")
    # 肝原 216 体素，擦 4×4=16 → 200
    assert (new_arr == 1).sum() == pytest.approx(200)


def test_patch_labelmap_paint_grows_liver(tmp_path, monkeypatch):
    """paint 一片背景 → labelmap 肝区增加。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    # z=0 上方（非肝区）画一片肝
    mask = np.zeros((10, 10), dtype=bool)
    mask[8:10, 8:10] = True
    _, new_arr = dataset_ct.patch_labelmap(
        volume_id,
        [{"z": 0, "class_id": 1, "mode": "paint", "mask_png_ref": _png_b64_mask(mask)}],
        method=method,
    )
    assert (new_arr == 1).sum() == pytest.approx(216 + 4)


def test_patch_labelmap_rejects_unknown_class(tmp_path, monkeypatch):
    """class_id=999 不在白名单 → ValueError 硬拒绝。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    mask = np.zeros((10, 10), dtype=bool)
    mask[0, 0] = True
    with pytest.raises(ValueError, match="不在 VolumeMask 白名单内"):
        dataset_ct.patch_labelmap(
            volume_id,
            [{"z": 5, "class_id": 999, "mode": "paint", "mask_png_ref": _png_b64_mask(mask)}],
            method=method,
        )


def test_patch_labelmap_rejects_z_out_of_bounds(tmp_path, monkeypatch):
    """z >= Z 越界 → ValueError。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    mask = np.zeros((10, 10), dtype=bool)
    with pytest.raises(ValueError, match="越界"):
        dataset_ct.patch_labelmap(
            volume_id,
            [{"z": 999, "class_id": 1, "mode": "paint", "mask_png_ref": _png_b64_mask(mask)}],
            method=method,
        )


def test_patch_labelmap_rejects_malformed_png(tmp_path, monkeypatch):
    """mask_png_ref 非 data: URL → ValueError。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    with pytest.raises(ValueError, match="data:image/png;base64"):
        dataset_ct.patch_labelmap(
            volume_id,
            [{"z": 5, "class_id": 1, "mode": "paint", "mask_png_ref": "not a data url"}],
            method=method,
        )


def test_patch_labelmap_rejects_size_mismatch(tmp_path, monkeypatch):
    """mask 尺寸 != labelmap slice 尺寸 → ValueError。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    mask = np.zeros((20, 20), dtype=bool)  # 不对
    with pytest.raises(ValueError, match="尺寸"):
        dataset_ct.patch_labelmap(
            volume_id,
            [{"z": 5, "class_id": 1, "mode": "paint", "mask_png_ref": _png_b64_mask(mask)}],
            method=method,
        )


def test_patch_labelmap_empty_slices_noop(tmp_path, monkeypatch):
    """slices 空 → 不改 labelmap，返回缓存路径。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    path, arr = dataset_ct.patch_labelmap(volume_id, [], method=method)
    assert path.endswith("ct_001_totalsegmentator_v2.nii.gz")
    assert (arr == 1).sum() == 216  # 原样


# --- /volume/{id}/mask-edit 端点 ----------------------------------------


def test_mask_edit_endpoint_happy_path(tmp_path, monkeypatch):
    """端点 patch → 重 measure → 返回新 metrics（v0: raw_ref=None，HU mean 不重算）。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    # 擦 z=5 肝中心 4×4
    mask = np.zeros((10, 10), dtype=bool)
    mask[3:7, 3:7] = True
    body = {
        "task": "totalseg_liver_kidney",
        "method": method,
        "slices": [{"z": 5, "class_id": 1, "mode": "erase", "mask_png_ref": _png_b64_mask(mask)}],
    }
    r = client.post(f"/volume/{volume_id}/mask-edit", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "liver_volume_mm3" in data["metrics"]
    # voxel=(0.5,0.5,1.5) → 1 voxel = 0.375 mm³；200 体素 = 75 mm³
    assert data["metrics"]["liver_volume_mm3"]["value"] == pytest.approx(200 * 0.375, rel=1e-3)
    # HU mean 不在 mask-edit 响应里（v0 raw_ref 留 None）
    assert "liver_hu_mean" not in data["metrics"]
    assert data["labelmap_ref"].endswith("labelmap?task=totalseg_liver_kidney&method=totalsegmentator_v2")
    assert data["model_version"] == "human@edit"


def test_mask_edit_endpoint_rejects_unknown_class(tmp_path, monkeypatch):
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    mask = np.zeros((10, 10), dtype=bool)
    body = {
        "task": "totalseg_liver_kidney",
        "slices": [{"z": 5, "class_id": 999, "mode": "paint", "mask_png_ref": _png_b64_mask(mask)}],
    }
    r = client.post(f"/volume/{volume_id}/mask-edit", json=body)
    assert r.status_code == 422
    assert "白名单" in r.json()["detail"]


def test_mask_edit_endpoint_rejects_bad_task(tmp_path, monkeypatch):
    """task 不在 Literal 列表 → pydantic 422 校验拒绝（快且早于 handler）。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    r = client.post(f"/volume/{volume_id}/mask-edit", json={"task": "far_wall_cca_imt", "slices": []})
    assert r.status_code == 422


def test_mask_edit_endpoint_rejects_non_ct_id(tmp_path, monkeypatch):
    r = client.post("/volume/ct_999/mask-edit", json={"task": "totalseg_liver_kidney", "slices": []})
    # 422 校验失败 / 404 找不到 / 422 backend raise——皆可；只要求 4xx
    assert 400 <= r.status_code < 500
