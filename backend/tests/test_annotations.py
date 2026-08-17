"""统一标注 REST 测试（SDD 04 T2）——CRUD / base_seq 并发 / 几何校验 / mask 落盘 / on_commit。"""

from __future__ import annotations

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config
from app.main import app
from app.routers import annotations as ann_router

client = TestClient(app)


@pytest.fixture(autouse=True)
def _annotations_root(tmp_path, monkeypatch):
    """每个用例独立 ANNOTATIONS_ROOT（Atlas 测试范式）。"""
    monkeypatch.setattr(config, "ANNOTATIONS_ROOT", tmp_path / "ann")
    ann_router._stores.clear()
    yield
    ann_router._stores.clear()


def _png_b64() -> str:
    buf = io.BytesIO()
    Image.new("L", (4, 4), 0).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


# --- CRUD + seq ---------------------------------------------------------------


def test_bbox_crud_roundtrip():
    r = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "bbox", "x0": 10, "y0": 20, "x1": 110, "y1": 90},
        "label": "斑块",
    })
    assert r.status_code == 201, r.text
    ann = r.json()["annotation"]
    assert ann["seq"] == 1 and ann["status"] == "draft" and ann["source"] == "manual"
    assert ann["primitive"]["x1"] == 110.0

    # 列表读回
    r = client.get("/annotations", params={"image_id": "tech_401"})
    assert len(r.json()["annotations"]) == 1

    # 更新（base_seq 匹配）→ seq 递增
    r = client.patch(f"/annotations/{ann['id']}", json={
        "base_seq": 1,
        "primitive": {"kind": "bbox", "x0": 12, "y0": 20, "x1": 110, "y1": 90},
    })
    assert r.status_code == 200, r.text
    assert r.json()["annotation"]["seq"] == 2
    assert r.json()["annotation"]["primitive"]["x0"] == 12.0

    # 删除（base_seq 匹配）→ 204；再读 404
    r = client.delete(f"/annotations/{ann['id']}", params={"base_seq": 2})
    assert r.status_code == 204
    assert client.get("/annotations", params={"image_id": "tech_401"}).json()["annotations"] == []


def test_z_filter_for_ct_slices():
    for z in (3, 5):
        client.post("/annotations", json={
            "image_id": "ct_001", "z": z,
            "primitive": {"kind": "bbox", "x0": 1, "y0": 1, "x1": 5, "y1": 5},
        })
    assert len(client.get("/annotations", params={"image_id": "ct_001"}).json()["annotations"]) == 2
    assert len(client.get("/annotations", params={"image_id": "ct_001", "z": 3}).json()["annotations"]) == 1


# --- base_seq 并发（409）-------------------------------------------------------


def test_stale_base_seq_conflicts():
    ann = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "bbox", "x0": 1, "y0": 1, "x1": 9, "y1": 9},
    }).json()["annotation"]

    r = client.patch(f"/annotations/{ann['id']}", json={"base_seq": 99, "label": "x"})
    assert r.status_code == 409 and "CONFLICT" in r.json()["detail"]

    r = client.delete(f"/annotations/{ann['id']}", params={"base_seq": 99})
    assert r.status_code == 409

    # 冲突不落写：原值仍在
    got = client.get("/annotations", params={"image_id": "tech_401"}).json()["annotations"][0]
    assert got["seq"] == 1


def test_patch_missing_annotation_404():
    r = client.patch("/annotations/nope", json={"base_seq": 1, "label": "x"})
    assert r.status_code == 404 and "NOT_FOUND" in r.json()["detail"]


# --- 几何校验（422）-------------------------------------------------------------


def test_invalid_geometry_rejected():
    # bbox 退化/反向
    r = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "bbox", "x0": 10, "y0": 1, "x1": 10, "y1": 9},
    })
    assert r.status_code == 422 and "INVALID_GEOMETRY" in r.json()["detail"]
    # polygon 不闭合
    r = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "polyline", "closed": False, "points": [[0, 0], [1, 0], [1, 1]]},
    })
    assert r.status_code == 422
    # polygon 点数不足
    r = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "polyline", "points": [[0, 0], [1, 1]]},
    })
    assert r.status_code == 422
    # 未知 kind
    r = client.post("/annotations", json={
        "image_id": "tech_401", "primitive": {"kind": "point"},
    })
    assert r.status_code == 422


def test_out_of_dims_rejected(monkeypatch):
    monkeypatch.setattr(ann_router, "_dims_for", lambda _id: (100, 100))
    r = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "bbox", "x0": 1, "y0": 1, "x1": 200, "y1": 9},
    })
    assert r.status_code == 422 and "dims" in r.json()["detail"]
    # polygon 越界同样拦
    r = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "polyline", "points": [[0, 0], [500, 0], [1, 1]]},
    })
    assert r.status_code == 422


# --- polygon 正常 + mask 落盘 --------------------------------------------------


def test_polygon_roundtrip():
    r = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "polyline", "points": [[0, 0], [10, 0], [10, 10], [0, 10]]},
    })
    assert r.status_code == 201, r.text
    prim = r.json()["annotation"]["primitive"]
    assert prim["closed"] is True and len(prim["points"]) == 4


def test_mask_persist_and_cleanup():
    r = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "mask"},
        "mask_png_b64": _png_b64(),
    })
    assert r.status_code == 201, r.text
    ann = r.json()["annotation"]
    mask_path = config.ANNOTATIONS_ROOT / ann["primitive"]["ref"]
    assert mask_path.is_file()
    # 缺 png → 422
    r2 = client.post("/annotations", json={
        "image_id": "tech_401", "primitive": {"kind": "mask"},
    })
    assert r2.status_code == 422
    # 删除连带删文件
    assert client.delete(f"/annotations/{ann['id']}", params={"base_seq": 1}).status_code == 204
    assert not mask_path.exists()


def test_mask_png_download():
    """GET /annotations/{id}/mask：reload 叠色渲染端点；非 mask → 404。"""
    r = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "mask"},
        "mask_png_b64": _png_b64(),
    })
    assert r.status_code == 201, r.text
    ann = r.json()["annotation"]
    m = client.get(f"/annotations/{ann['id']}/mask")
    assert m.status_code == 200
    assert m.headers["content-type"].startswith("image/png")
    assert m.content[:4] == b"\x89PNG"
    # 非 mask 标注 → 404；不存在 → 404
    b = client.post("/annotations", json={
        "image_id": "tech_401",
        "primitive": {"kind": "bbox", "x0": 1, "y0": 1, "x1": 9, "y1": 9},
    })
    assert client.get(f"/annotations/{b.json()['annotation']['id']}/mask").status_code == 404
    assert client.get("/annotations/nonexistent/mask").status_code == 404


# --- on_commit 钩子（SDD 04 §7.3）----------------------------------------------


class _FakePlugin:
    task = type("T", (), {"value": "nuclei_detection"})()
    default_method = "stardist_he"
    on_commit = {"bbox": {"action": "run_task"}}


def test_on_commit_success_attaches_hook_result(monkeypatch):
    monkeypatch.setattr(ann_router, "_plugin_for", lambda _id: _FakePlugin())
    import app.kernel as kernel

    monkeypatch.setattr(kernel, "run_task", lambda spec: {"task": spec.task, "metrics": {}})
    r = client.post("/annotations", json={
        "image_id": "slide_001",
        "primitive": {"kind": "bbox", "x0": 100, "y0": 100, "x1": 300, "y1": 300},
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["hook_result"]["task"] == "nuclei_detection"
    assert "hook_error" not in body


def test_on_commit_failure_keeps_annotation(monkeypatch):
    """钩子失败不回滚标注（SDD 04 §7.3）——201 + hook_error。"""
    monkeypatch.setattr(ann_router, "_plugin_for", lambda _id: _FakePlugin())
    import app.kernel as kernel

    def _boom(_spec):
        raise RuntimeError("隔离环境不可用")

    monkeypatch.setattr(kernel, "run_task", _boom)
    r = client.post("/annotations", json={
        "image_id": "slide_001",
        "primitive": {"kind": "bbox", "x0": 1, "y0": 1, "x1": 9, "y1": 9},
    })
    assert r.status_code == 201, r.text
    assert "隔离环境不可用" in r.json()["hook_error"]
    assert len(client.get("/annotations", params={"image_id": "slide_001"}).json()["annotations"]) == 1
