"""P6 U2 测试：segment_ts（缓存 + 隔离）+ dataset_ct（list/vox_spacing/nifti_path）。"""

from __future__ import annotations

from pathlib import Path
from unittest import mock

import nibabel as nib
import numpy as np
import pytest

from app import config, dataset_ct, segment_ts

# --- dataset_ct ------------------------------------------------------------


def test_list_ids_empty_when_no_data(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CT_ROOT", tmp_path)
    assert dataset_ct.list_ids() == []


def test_list_ids_filters_to_ct_pattern(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CT_ROOT", tmp_path)
    (tmp_path / "ct_001.nii.gz").write_bytes(b"\x00")
    (tmp_path / "ct_002.nii.gz").write_bytes(b"\x00")
    (tmp_path / "ct_xxx.nii.gz").write_bytes(b"\x00")  # 不匹配 _ID_RE
    (tmp_path / "not_ct_001.nii.gz").write_bytes(b"\x00")
    assert dataset_ct.list_ids() == ["ct_001", "ct_002"]


def test_is_ct_and_nifti_path(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CT_ROOT", tmp_path)
    p = tmp_path / "ct_001.nii.gz"
    img = nib.Nifti1Image(np.zeros((4, 4, 4), dtype=np.int32), np.eye(4))
    nib.save(img, p)
    assert dataset_ct.is_ct("ct_001") is True
    assert dataset_ct.is_ct("ct_999") is False
    assert dataset_ct.nifti_path("ct_001") == str(p)


def test_vox_spacing_mm_happy(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CT_ROOT", tmp_path)
    p = tmp_path / "ct_001.nii.gz"
    img = nib.Nifti1Image(np.zeros((4, 4, 4), dtype=np.int32), np.eye(4))
    img.header.set_zooms((0.7, 0.7, 1.25))
    nib.save(img, p)
    sx, sy, sz = dataset_ct.vox_spacing_mm("ct_001")
    assert sx == pytest.approx(0.7, rel=1e-4)
    assert sy == pytest.approx(0.7, rel=1e-4)
    assert sz == pytest.approx(1.25, rel=1e-4)


def test_vox_spacing_mm_rejects_non_positive(monkeypatch):
    """NIfTI header 防御：直接 mock nibabel 返回非正 pixdim 测拒绝路径。
    实际 NIfTI 文件会被 nibabel clamp 到正，文件层测试跳过；用 mock 走代码路径。
    """
    fake_img = mock.MagicMock()
    fake_img.header.get_zooms.return_value = (0.0, 0.5, 1.0)  # 第一个非正
    monkeypatch.setattr(dataset_ct, "_load_nifti", lambda v: fake_img)
    with pytest.raises(ValueError, match="pixdim 非法"):
        dataset_ct.vox_spacing_mm("ct_001")
    fake_img.header.get_zooms.return_value = (-0.5, 0.5, 1.0)  # 负值
    with pytest.raises(ValueError, match="pixdim 非法"):
        dataset_ct.vox_spacing_mm("ct_001")


def test_image_meta_shape(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CT_ROOT", tmp_path)
    p = tmp_path / "ct_001.nii.gz"
    img = nib.Nifti1Image(np.zeros((4, 4, 4), dtype=np.int32), np.eye(4))
    img.header.set_zooms((0.5, 0.5, 1.0))
    nib.save(img, p)
    dataset_ct._load_nifti.cache_clear()
    meta = dataset_ct.image_meta("ct_001")
    assert meta["modality"] == "ct_abdomen"
    assert meta["cf"] is None  # dataset_ct 内部格式，不属于 ObjectMeta API
    assert meta["voxel_spacing_mm"] == [0.5, 0.5, 1.0]
    assert meta["methods"] == ["totalsegmentator_v2"]


# --- segment_ts ------------------------------------------------------------


def test_segment_cache_hit(tmp_path, monkeypatch):
    """缓存命中：直接读，不调子进程。"""
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    cached = tmp_path / "cache" / "ct_001_totalsegmentator_v2.nii.gz"
    cached.parent.mkdir(parents=True)
    nib.save(nib.Nifti1Image(np.zeros((2, 2, 2), dtype=np.int32), np.eye(4)), str(cached))

    with mock.patch.object(segment_ts, "_run_live") as live:
        path, mv = segment_ts.segment("ct_001")
    live.assert_not_called()
    assert path == str(cached)
    assert "cached" in mv


def test_segment_cache_miss_no_live_raises(tmp_path, monkeypatch):
    """缓存未命中 + 隔离环境不可用 → TsSegmentUnavailable（不静默假造）。"""
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    monkeypatch.setattr(config, "CT_ROOT", tmp_path / "ct")
    monkeypatch.setattr(config, "ts_live_available", lambda: False)
    with pytest.raises(segment_ts.TsSegmentUnavailable, match="隔离环境不可用"):
        segment_ts.segment("ct_001")


def test_segment_cache_miss_runs_live_then_reads(tmp_path, monkeypatch):
    """缓存未命中 + 隔离可用 → 调 _run_live（mock），再读缓存。"""
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    monkeypatch.setattr(config, "CT_ROOT", tmp_path / "ct")
    monkeypatch.setattr(config, "ts_live_available", lambda: True)
    cached = tmp_path / "cache" / "ct_001_totalsegmentator_v2.nii.gz"

    def fake_run(volume_id, method, timeout):
        cached.parent.mkdir(parents=True, exist_ok=True)
        nib.save(nib.Nifti1Image(np.zeros((2, 2, 2), dtype=np.int32), np.eye(4)), str(cached))

    with mock.patch.object(segment_ts, "_run_live", side_effect=fake_run) as live:
        path, mv = segment_ts.segment("ct_001")
    live.assert_called_once_with("ct_001", "totalsegmentator_v2", mock.ANY)
    assert path == str(cached)
    assert "@live" in mv


def test_segment_live_produces_no_cache_raises(tmp_path, monkeypatch):
    """_run_live 跑完但缓存仍不存在 → 显式失败（不静默返回空）。"""
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    monkeypatch.setattr(config, "CT_ROOT", tmp_path / "ct")
    monkeypatch.setattr(config, "ts_live_available", lambda: True)

    with mock.patch.object(segment_ts, "_run_live"):
        with pytest.raises(segment_ts.TsSegmentUnavailable, match="现算未产出"):
            segment_ts.segment("ct_001")


def test_segment_unsupported_method_raises():
    with pytest.raises(segment_ts.TsSegmentUnavailable, match="仅支持 totalsegmentator_v2"):
        segment_ts.segment("ct_001", method="some_other")


def test_segment_main_process_has_no_torch():
    """主进程断言：torch 永远不在 FastAPI 主进程。"""
    import importlib.util
    assert importlib.util.find_spec("torch") is None


def test_run_live_argv_and_minimal_env(tmp_path, monkeypatch):
    """_run_live 走 argv 列表 + 最小 env（与 caroSegDeep / CSM 同模板）。"""
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    monkeypatch.setattr(config, "CT_ROOT", tmp_path / "ct")
    monkeypatch.setattr(config, "TS_PYTHON", Path("/fake/python"))
    monkeypatch.setattr(config, "TS_DRIVER", Path("/fake/run.py"))
    # input 不存在 → 显式失败
    with pytest.raises(segment_ts.TsSegmentUnavailable, match="CT 体积不存在"):
        segment_ts._run_live("ct_999", "totalsegmentator_v2", 600.0)

    # input 存在 → 调 subprocess.run with argv list + minimal env
    in_path = tmp_path / "ct" / "ct_001.nii.gz"
    in_path.parent.mkdir(parents=True)
    nib.save(nib.Nifti1Image(np.zeros((2, 2, 2), dtype=np.int32), np.eye(4)), str(in_path))

    captured = {}
    def fake_run(cmd, **kw):
        captured["cmd"] = cmd
        captured["env"] = kw["env"]
        captured["kwargs"] = kw

    with mock.patch("app.segment_ts.subprocess.run", side_effect=fake_run):
        segment_ts._run_live("ct_001", "totalsegmentator_v2", 600.0)

    cmd = captured["cmd"]
    assert cmd[0] == "/fake/python"
    assert cmd[1] == "/fake/run.py"
    assert "--input" in cmd and str(in_path) in cmd
    assert "--output" in cmd
    assert "--method" in cmd and "totalsegmentator_v2" in cmd
    # env 最小化：CUDA off / MPL Agg / PATH limited
    env = captured["env"]
    assert env["MPLBACKEND"] == "Agg"
    assert env["CUDA_VISIBLE_DEVICES"] == "-1"
    assert env["PATH"] == "/usr/bin:/bin"
    # kwargs 防护
    assert captured["kwargs"]["timeout"] == 600.0
    assert captured["kwargs"]["capture_output"] is True
    assert captured["kwargs"]["check"] is False
    assert captured["kwargs"]["text"] is True


def test_labelmap_path_helper(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "cache")
    p = segment_ts.labelmap_path("ct_001", "totalsegmentator_v2")
    assert str(p).endswith("ct_001_totalsegmentator_v2.nii.gz")
