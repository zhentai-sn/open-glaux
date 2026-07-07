"""U4：分割适配器契约 / ROI / caroSegDeep 接缝显式报错 / 端到端到 IMT。"""

import numpy as np
import pytest

from glaux_core.measurement.pdm import imt
from glaux_core.segmentation.base import (
    Compute,
    ROI,
    SegmentationBackendUnavailable,
    SegmentationRequest,
)
from glaux_core.segmentation.carosegdeep import CaroSegDeepAdapter
from glaux_core.segmentation.roi import auto_far_wall_roi, resolve_roi
from glaux_core.segmentation.stub import ConstantThicknessAdapter


def _img(h=200, w=300):
    return np.zeros((h, w), dtype=np.uint8)


def test_stub_adapter_contract_returns_two_boundaries():
    adapter = ConstantThicknessAdapter(li_y=100.0, thickness_px=8.0)
    res = adapter.segment(SegmentationRequest(image=_img()))
    assert res.li.name == "LI" and res.ma.name == "MA"
    assert len(res.li) == len(res.ma) > 0
    assert res.model_version.startswith("stub")


def test_missing_roi_triggers_auto_detection():
    adapter = ConstantThicknessAdapter()
    res = adapter.segment(SegmentationRequest(image=_img(w=300)))
    # 居中 50% 列带
    assert res.roi_used.x0 == 75 and res.roi_used.x1 == 225


def test_manual_roi_is_respected():
    adapter = ConstantThicknessAdapter()
    roi = ROI(x0=10, x1=40)
    res = adapter.segment(SegmentationRequest(image=_img(), roi=roi))
    assert res.roi_used == roi
    assert res.li.x.min() == 10 and res.li.x.max() == 39


def test_auto_far_wall_roi_within_bounds():
    roi = auto_far_wall_roi(_img(w=300), fraction=0.5)
    assert 0 <= roi.x0 < roi.x1 <= 300


def test_resolve_roi_prefers_manual():
    roi = ROI(x0=5, x1=9)
    assert resolve_roi(_img(), roi) is roi


def test_roi_rejects_degenerate_span():
    with pytest.raises(ValueError):
        ROI(x0=10, x1=10)


def test_compute_flag_carried_in_meta():
    adapter = ConstantThicknessAdapter()
    res = adapter.segment(SegmentationRequest(image=_img(), compute=Compute.REMOTE))
    assert res.meta["compute"] == "remote"


def test_carosegdeep_without_backend_raises_loud_not_silent(tmp_path):
    adapter = CaroSegDeepAdapter(
        fw_weights=tmp_path / "FW.h5", imc_weights=tmp_path / "IMC.h5"
    )
    # 权重缺失 → 显式报错（绝不静默返回空曲线）
    with pytest.raises(SegmentationBackendUnavailable):
        adapter.segment(SegmentationRequest(image=_img()))


def test_stub_segmentation_feeds_pdm_end_to_end():
    # 动作层 → 测量层贯通：桩出 8px 厚，CF=0.06 → 0.48mm
    adapter = ConstantThicknessAdapter(thickness_px=8.0)
    res = adapter.segment(SegmentationRequest(image=_img()))
    r = imt(res.li, res.ma, cf=0.06)
    assert r.mean_mm == pytest.approx(0.48, abs=1e-9)
