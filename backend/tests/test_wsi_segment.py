"""P7 U3 测试：核分割隔离子进程编排（缓存 + ROI 偏移 + 去重）+ kernel wsi 分支。

子进程被 mock（不装 .venv-wsi 也能测主进程逻辑）；真机 StarDist 推理走手动 e2e checkpoint。
覆盖 P7 头号坑：主进程把 ROI-local 质心加偏移到 level-0 + 跨 patch 去重。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import config, kernel, segment_wsi
from app.main import app
from app.segment_wsi import WsiSegmentUnavailable

client = TestClient(app)

pytestmark = pytest.mark.skipif(
    not config.wsi_data_available(),
    reason="需 ship 的 data/wsi/slide_*（openslide 数据）",
)


class _FakeCompleted:
    returncode = 0
    stderr = ""


def _fake_run_factory(roi_local_points, class_ids=None, model_version="fake@test"):
    """构造一个假 subprocess.run：把给定 ROI-local 质心写进 --output 的 centroids.json。"""
    def fake_run(cmd, **kwargs):
        out = cmd[cmd.index("--output") + 1]
        payload = {
            "points": roi_local_points,
            "class_ids": class_ids or [1] * len(roi_local_points),
            "model_version": model_version,
        }
        Path(out).write_text(json.dumps(payload))
        return _FakeCompleted()
    return fake_run


def test_segment_offsets_to_level0_and_dedups(tmp_path, monkeypatch):
    """ROI-local 质心 → 加 ROI 原点偏到 level-0 + 去重（重复对合并）。"""
    monkeypatch.setattr(config, "WSI_SEG_CACHE", tmp_path / "seg")
    monkeypatch.setattr(config, "wsi_live_available", lambda: True)
    # ROI-local：(10,10) 与 (12,11) 是重复（<8px），(200,50) 独立
    pts = [[10.0, 10.0], [12.0, 11.0], [200.0, 50.0]]
    monkeypatch.setattr(segment_wsi.subprocess, "run", _fake_run_factory(pts))

    roi = (100, 100, 612, 612)  # 512×512，在 slide 2220×2967 内
    path, mv = segment_wsi.segment("slide_001", roi, "stardist_he")
    assert "live" in mv
    data = json.loads(Path(path).read_text())
    assert data["n_raw"] == 3
    assert data["n_dedup"] == 2  # 两个近点合并
    assert data["roi"] == [100, 100, 612, 612]
    # 偏移到 level-0：+100,+100
    assert [110.0, 110.0] in data["points"]  # 保留先出现者
    assert [300.0, 150.0] in data["points"]
    assert [112.0, 111.0] not in data["points"]  # 被去重丢弃


def test_segment_cache_hit(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WSI_SEG_CACHE", tmp_path / "seg")
    monkeypatch.setattr(config, "wsi_live_available", lambda: True)
    monkeypatch.setattr(segment_wsi.subprocess, "run", _fake_run_factory([[5.0, 5.0]]))
    roi = (0, 0, 300, 300)
    _p1, mv1 = segment_wsi.segment("slide_001", roi, "stardist_he")
    assert "live" in mv1
    # 二次：缓存命中，不再跑子进程（把 run 换成会炸的，证明没被调）
    def boom(*a, **k):  # noqa: ANN
        raise AssertionError("缓存命中不应再跑子进程")
    monkeypatch.setattr(segment_wsi.subprocess, "run", boom)
    _p2, mv2 = segment_wsi.segment("slide_001", roi, "stardist_he")
    assert "cached" in mv2


def test_segment_unavailable_without_env(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "WSI_SEG_CACHE", tmp_path / "seg")
    monkeypatch.setattr(config, "wsi_live_available", lambda: False)
    with pytest.raises(WsiSegmentUnavailable, match="隔离环境不可用"):
        segment_wsi.segment("slide_001", (0, 0, 300, 300), "stardist_he")


def test_segment_unknown_method(tmp_path, monkeypatch):
    with pytest.raises(WsiSegmentUnavailable, match="仅支持 stardist_he"):
        segment_wsi.segment("slide_001", (0, 0, 300, 300), "hovernet")


def test_segment_subprocess_no_output_raises(tmp_path, monkeypatch):
    """子进程跑了但没产出 centroids.json → WsiSegmentUnavailable（不静默假造）。"""
    monkeypatch.setattr(config, "WSI_SEG_CACHE", tmp_path / "seg")
    monkeypatch.setattr(config, "wsi_live_available", lambda: True)

    def no_output_run(cmd, **kwargs):
        r = _FakeCompleted()
        r.returncode = 1
        r.stderr = "StarDist 权重缺失（模拟）"
        return r
    monkeypatch.setattr(segment_wsi.subprocess, "run", no_output_run)
    with pytest.raises(WsiSegmentUnavailable, match="未产出"):
        segment_wsi.segment("slide_001", (0, 0, 300, 300), "stardist_he")


# --- kernel wsi 分支（/task/run 全链路，子进程 mock）--------------------------


def test_task_run_nuclei_detection(tmp_path, monkeypatch):
    """POST /task/run nuclei_detection → PointSet + 计数/密度 metrics。"""
    monkeypatch.setattr(config, "WSI_SEG_CACHE", tmp_path / "seg")
    monkeypatch.setattr(config, "wsi_live_available", lambda: True)
    # 500 个 ROI-local 质心（无重复）
    pts = [[float(i % 500), float((i * 7) % 500)] for i in range(500)]
    monkeypatch.setattr(segment_wsi.subprocess, "run", _fake_run_factory(pts))

    body = {
        "task": "nuclei_detection",
        "image_id": "slide_001",
        "roi_box": [0, 0, 512, 512],
        "method": "stardist_he",
    }
    r = client.post("/task/run", json=body)
    assert r.status_code == 200, r.text
    out = r.json()
    # primitives 含 point_set
    kinds = {p["kind"] for p in out["primitives"]}
    assert "point_set" in kinds
    m = out["metrics"]
    assert m["nuclei_count"]["value"] > 0
    assert "nuclei_density_mm2" in m
    assert "roi_area_mm2" in m
    # 面积 = 512×512 × 0.499² / 1e6
    assert m["roi_area_mm2"]["value"] == pytest.approx((512 * 512) * 0.499 * 0.499 / 1e6, rel=1e-3)


def test_task_run_nuclei_requires_roi_box(monkeypatch):
    """缺 roi_box → 422（整片推理不可行，硬拒绝）。"""
    monkeypatch.setattr(config, "wsi_live_available", lambda: True)
    body = {"task": "nuclei_detection", "image_id": "slide_001", "method": "stardist_he"}
    r = client.post("/task/run", json=body)
    assert r.status_code == 422
    assert "roi_box" in r.text


def test_wsi_verify_reproduces_reference(monkeypatch):
    """/wsi/{id}/verify：pred==ship reference → F1=1.0（自复现）。"""
    ref_path = config.WSI_ROOT / "slide_001_ref_nuclei.json"
    if not ref_path.is_file():
        pytest.skip("需 ship 的 slide_001_ref_nuclei.json")
    # mock segment → 直接返回 reference 自身（模拟缓存命中同一份检测）
    monkeypatch.setattr(segment_wsi, "segment", lambda sid, roi, method="stardist_he": (str(ref_path), "cached"))
    r = client.get("/wsi/slide_001/verify")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["f1"] == pytest.approx(1.0)
    assert d["count_pred"] == d["count_ref"]
    assert "非真 GT" in d["note"]


def test_task_run_nuclei_wrong_slide_id(monkeypatch):
    monkeypatch.setattr(config, "wsi_live_available", lambda: True)
    body = {
        "task": "nuclei_detection", "image_id": "nonexist",
        "roi_box": [0, 0, 100, 100], "method": "stardist_he",
    }
    r = client.post("/task/run", json=body)
    assert r.status_code == 422
    assert "WSI" in r.text or "slide" in r.text
