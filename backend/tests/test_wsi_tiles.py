"""P7 U2 测试：OpenSlide 瓦片服务 + DZI + region + MPP（用 ship 的 slide_001.svs）。

覆盖：/slides 元信息、DZI XML、瓦片 JPEG + 缓存命中、region、thumbnail、MPP 硬拒绝、
白名单 404、主进程无 torch 不变量。
"""

from __future__ import annotations

import importlib.util

import pytest
from fastapi.testclient import TestClient

from app import config, dataset_wsi
from app.main import app

client = TestClient(app)

pytestmark = pytest.mark.skipif(
    not config.wsi_data_available(),
    reason="需 ship 的 data/wsi/slide_*（openslide 数据）",
)


def test_main_process_has_no_torch():
    """护城河不变量：主进程绝不 import torch（OpenSlide 是数据 IO 库，不违反）。"""
    assert importlib.util.find_spec("torch") is None


def test_slides_lists_slide_001():
    r = client.get("/slides")
    assert r.status_code == 200
    items = r.json()
    ids = {it["id"] for it in items}
    assert "slide_001" in ids
    meta = next(it for it in items if it["id"] == "slide_001")
    assert meta["modality"] == "pathology"
    assert meta["cf"] is None
    assert meta["mpp_um"] is not None and len(meta["mpp_um"]) == 2
    assert all(v > 0 for v in meta["mpp_um"])
    assert meta["dims"] is not None and len(meta["dims"]) == 2


def test_dzi_descriptor_xml():
    r = client.get("/wsi/slide_001/dzi")
    assert r.status_code == 200
    assert "xml" in r.headers["content-type"]
    body = r.text
    assert "<Image" in body
    assert 'TileSize="256"' in body
    assert 'Overlap="1"' in body


def test_tile_jpeg_and_cache_hit(tmp_path, monkeypatch):
    """瓦片 JPEG magic；二次请求走磁盘缓存（缓存文件存在）。"""
    monkeypatch.setattr(config, "WSI_CACHE", tmp_path / "tiles")
    dataset_wsi._deepzoom.cache_clear()  # 确保用新 cache 路径
    dz = dataset_wsi._deepzoom("slide_001")
    top = dz.level_count - 1  # 最大层 = 全分辨率

    r = client.get(f"/wsi/slide_001/tile/{top}/0/0")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/jpeg"
    assert r.content[:2] == b"\xff\xd8"  # JPEG magic

    # 缓存落盘
    cache_file = tmp_path / "tiles" / "slide_001" / str(top) / "0_0.jpeg"
    assert cache_file.is_file()

    # 二次请求内容一致（缓存命中）
    r2 = client.get(f"/wsi/slide_001/tile/{top}/0/0")
    assert r2.status_code == 200
    assert r2.content == r.content


def test_tile_out_of_range_404():
    r = client.get("/wsi/slide_001/tile/999/0/0")
    assert r.status_code == 404


def test_region_jpeg():
    r = client.get("/wsi/slide_001/region", params={"x": 0, "y": 0, "w": 256, "h": 256})
    assert r.status_code == 200
    assert r.content[:2] == b"\xff\xd8"


def test_region_out_of_bounds_422():
    w, h = dataset_wsi.dims("slide_001")
    r = client.get(
        "/wsi/slide_001/region",
        params={"x": w - 10, "y": 0, "w": 1000, "h": 100},  # 越出右边界
    )
    assert r.status_code == 422


def test_thumbnail_jpeg():
    r = client.get("/wsi/slide_001/thumbnail")
    assert r.status_code == 200
    assert r.content[:2] == b"\xff\xd8"


def test_mpp_reads_positive():
    mx, my = dataset_wsi.mpp("slide_001")
    assert mx > 0 and my > 0


def test_unknown_slide_404():
    for path in [
        "/wsi/slide_999/dzi",
        "/wsi/slide_999/thumbnail",
        "/wsi/nonexist/tile/5/0/0",
    ]:
        assert client.get(path).status_code == 404


def test_dims_match_openslide():
    import openslide

    s = openslide.OpenSlide(str(dataset_wsi._slide_path("slide_001")))
    assert dataset_wsi.dims("slide_001") == (int(s.dimensions[0]), int(s.dimensions[1]))
