"""P6 U4 测试：画笔编辑内核与旧端点下线。"""

from __future__ import annotations

import base64
import io

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
    """造 CT 体积 + 假 labelmap，模拟 data/ct/ + TS_CACHE/。

    返回 (volume_id, method, ct_path, lbl_path)。
    """
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


def test_patch_labelmap_axial_axis_nonsquare(tmp_path, monkeypatch):
    """回归：labelmap 沿 Z(nibabel 末轴) 切轴状位 + 非方形 mask 需转置对齐。

    立方 labelmap 测试对轴向/转置错误免疫（对称），真机 e2e 才暴露：前端 PNG 宽=X 高=Y、
    沿 Z 切，而旧代码 ``arr[z]`` 切轴 0(=X, 矢状面) + 尺寸校验用错维 → 422 / patch 错平面。
    本测试用三维不同的 labelmap（X=12,Y=8,Z=5）+ 非方形 mask 锁死正确行为。
    """
    monkeypatch.setattr(config, "CT_ROOT", tmp_path / "ct")
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    vid, method = "ct_001", "totalsegmentator_v2"
    X, Y, Z = 12, 8, 5
    (tmp_path / "ct").mkdir(parents=True)
    ct = nib.Nifti1Image(np.zeros((X, Y, Z), dtype=np.float32), np.eye(4))
    ct.header.set_zooms((1.0, 1.0, 1.0))
    nib.save(ct, str(tmp_path / "ct" / f"{vid}.nii.gz"))
    # 肝(=1) 填满 z=3 的整个 X×Y 平面（96 体素），其余 z 空
    lbl = np.zeros((X, Y, Z), dtype=np.int32)
    lbl[:, :, 3] = 1
    (tmp_path / "cache").mkdir(parents=True)
    li = nib.Nifti1Image(lbl, np.eye(4))
    li.header.set_zooms((1.0, 1.0, 1.0))
    nib.save(li, str(config.TS_CACHE / f"{vid}_{method}.nii.gz"))
    dataset_ct._load_nifti.cache_clear()

    # 非方形 mask：擦 z=3 的左半 X（6 列）× 全 Y → 48 体素。mask np 形状 (Y, X)=(8,12)
    m = np.zeros((Y, X), dtype=bool)
    m[:, :6] = True
    _, arr = dataset_ct.patch_labelmap(
        vid,
        [{"z": 3, "class_id": 1, "mode": "erase", "mask_png_ref": _png_b64_mask(m)}],
        method=method,
    )
    # 沿 Z 切正确 → z=3 肝从 96 减到 48；其它 z 不受影响
    assert (arr[:, :, 3] == 1).sum() == 48
    assert (arr == 1).sum() == 48
    # 被擦的是左半 X（x<6），右半保留
    assert (arr[:6, :, 3] == 1).sum() == 0
    assert (arr[6:, :, 3] == 1).sum() == 48


def test_patch_labelmap_empty_slices_noop(tmp_path, monkeypatch):
    """slices 空 → 不改 labelmap，返回缓存路径。"""
    volume_id, method, _, _ = _seed_labelmap(tmp_path, monkeypatch)
    path, arr = dataset_ct.patch_labelmap(volume_id, [], method=method)
    assert path.endswith("ct_001_totalsegmentator_v2.nii.gz")
    assert (arr == 1).sum() == 216  # 原样


# --- W7：旧画笔端点退役 -----------------------------------------------------


def test_legacy_mask_edit_endpoint_removed():
    r = client.post("/volume/ct_001/mask-edit", json={"task": "totalseg_liver_kidney"})
    assert r.status_code == 404


# --- U5: Reproducibility Dice 验证 ----------------------------------------


def test_verify_dice_perfect_overlap(tmp_path, monkeypatch):
    """pred == ref → 每类 Dice 1.0；零空类（class 0 也是非空）按公式 = 1.0。"""
    from glaux_core.verification.dice import dice_per_class
    pred = np.zeros((4, 4, 4), dtype=np.int32)
    pred[1:3, 1:3, 1:3] = 1
    ref = pred.copy()
    out = dice_per_class(pred, ref, [0, 1])
    assert out[1] == pytest.approx(1.0)
    # 零空集合特例：class 0 在 4³ 全空间 56 个背景上两两相等 → Dice 1.0
    # （想要"空 class 返回 0"，需要 class 在 pred 和 ref 都完全没体素）
    assert out[0] == pytest.approx(1.0)


def test_verify_dice_half_overlap():
    """50% 重叠（pred 与 ref 在 class 1 上各 4 体素，重叠 2）→ Dice = 4/8 = 0.5。"""
    from glaux_core.verification.dice import dice_per_class
    pred = np.zeros((4, 4, 4), dtype=np.int32)
    pred[0:1, 0:2, 0:2] = 1  # 1*2*2 = 4 体素
    ref = np.zeros((4, 4, 4), dtype=np.int32)
    ref[0:1, 1:3, 0:2] = 1  # 1*2*2 = 4 体素；与 pred 在 (0,1,0..1) 重叠 2
    out = dice_per_class(pred, ref, [1])
    # |p|=4, |g|=4, |p∩g|=2 → 2*2/(4+4) = 0.5
    assert out[1] == pytest.approx(0.5)


def test_verify_dice_no_overlap():
    from glaux_core.verification.dice import dice_per_class
    pred = np.zeros((4, 4, 4), dtype=np.int32)
    pred[0:2, :, :] = 1
    ref = np.zeros((4, 4, 4), dtype=np.int32)
    ref[2:4, :, :] = 1
    out = dice_per_class(pred, ref, [1])
    assert out[1] == 0.0


def test_verify_dice_empty_class_returns_zero():
    """class 在 pred 与 ref 都没体素 → Dice 0.0（不抛）。"""
    from glaux_core.verification.dice import dice_per_class
    pred = np.zeros((4, 4, 4), dtype=np.int32)  # 全 0
    ref = np.zeros((4, 4, 4), dtype=np.int32)
    out = dice_per_class(pred, ref, [1, 2, 3])
    assert all(v == 0.0 for v in out.values())


def test_verify_dice_shape_mismatch_rejects():
    from glaux_core.verification.dice import dice_per_class
    pred = np.zeros((4, 4, 4), dtype=np.int32)
    ref = np.zeros((5, 5, 5), dtype=np.int32)
    with pytest.raises(ValueError, match="pred shape"):
        dice_per_class(pred, ref, [1])


# /volume/{id}/verify 端点已删（2026-08-16，前端从未接线）；dice_per_class 单测保留在上方。
