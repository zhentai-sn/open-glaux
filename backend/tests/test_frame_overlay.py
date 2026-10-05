"""SDD 22 §7.3、§15.2：/frame 叠加标注与图例。"""

from __future__ import annotations

import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config, upload_store
from app import datasource_registry as reg
from app.main import app
from app.routers import annotations as ann_router

client = TestClient(app)
TARGET = ""


@pytest.fixture(autouse=True)
def _target(tmp_path, monkeypatch):
    """每个用例一张 800×600 的纯黑通用图像与独立的标注库。"""
    global TARGET
    monkeypatch.setattr(config, "ANNOTATIONS_ROOT", tmp_path / "ann")
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path / "ds"))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "ds" / "sources.json"))
    folder = tmp_path / "ds" / "targets"
    folder.mkdir(parents=True)
    Image.new("RGB", (800, 600), 0).save(folder / "target.png")
    reg.init()
    src = reg.register_folder(folder, "natural_image")
    TARGET = upload_store.image_id(src.id, "target.png")
    ann_router._stores.clear()
    yield
    ann_router._stores.clear()
    reg._SOURCES.clear()
    reg.invalidate_index()


def _annotate(
    primitive: dict, status: str = "suggested", source: str = "agent", label: str = "box"
) -> dict:
    r = client.post(
        "/annotations",
        json={
            "image_id": TARGET,
            "primitive": primitive,
            "status": status,
            "source": source,
            "label": label,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["annotation"]


def _frame(**params):
    r = client.get(f"/objects/{TARGET}/frame", params=params)
    assert r.status_code == 200, r.text
    return r, json.loads(r.headers["X-Glaux-Frame"])


def _lit(data: bytes) -> set[tuple[int, int]]:
    image = Image.open(io.BytesIO(data)).convert("L")
    return {
        (x, y)
        for x in range(image.width)
        for y in range(image.height)
        if image.getpixel((x, y)) > 40
    }


def test_without_overlay_returns_raw_pixels_and_no_legend():
    _annotate({"kind": "bbox", "x0": 100, "y0": 100, "x1": 300, "y1": 200})
    r, _ = _frame()
    assert "X-Glaux-Overlay" not in r.headers
    assert not _lit(r.content)


def test_overlay_draws_shapes_and_lists_legend_in_creation_order():
    box = _annotate({"kind": "bbox", "x0": 100, "y0": 100, "x1": 300, "y1": 200}, label="斑块")
    poly = _annotate(
        {"kind": "polyline", "closed": True, "points": [[500, 300], [700, 300], [600, 500]]},
        status="confirmed",
        source="manual",
    )
    _annotate({"kind": "bbox", "x0": 400, "y0": 50, "x1": 450, "y1": 90}, status="rejected")
    r, frame = _frame(overlay="true")
    legend = json.loads(r.headers["X-Glaux-Overlay"])
    assert [(e["tag"], e["annotation_id"], e["status"]) for e in legend] == [
        ("A1", box["id"], "suggested"),
        ("A2", poly["id"], "confirmed"),
    ]
    assert legend[0]["label"] == "斑块"
    lit = _lit(r.content)
    s = frame["scale"]
    # 框的上边与多边形的底边附近有像素被画上；被驳回的框所在区域保持全黑
    assert any(abs(y - 100 * s) <= 3 and 120 * s <= x <= 280 * s for x, y in lit)
    assert any(abs(y - 300 * s) <= 3 and 520 * s <= x <= 680 * s for x, y in lit)
    assert not any(410 * s <= x <= 440 * s and 60 * s <= y <= 80 * s for x, y in lit)


def test_overlay_follows_the_region_reference_frame():
    _annotate({"kind": "bbox", "x0": 100, "y0": 100, "x1": 300, "y1": 200})
    r, frame = _frame(overlay="true", roi="50,50,350,250", size=1024)
    assert frame["origin"] == [50.0, 50.0] and frame["scale"] == 1.0
    lit = _lit(r.content)
    assert any(abs(x - 50) <= 3 and 70 <= y <= 130 for x, y in lit)  # 框左边在区域内位于 x=50
    assert any(abs(y - 150) <= 3 and 70 <= x <= 230 for x, y in lit)  # 框下边位于 y=150


def test_overlay_with_no_annotations_returns_empty_legend():
    r, _ = _frame(overlay="true")
    assert json.loads(r.headers["X-Glaux-Overlay"]) == []
    assert not _lit(r.content)


def test_overlay_outlines_mask_annotations():
    import base64

    mask = Image.new("L", (800, 600), 0)
    mask.paste(255, (200, 200, 400, 300))
    buf = io.BytesIO()
    mask.save(buf, format="PNG")
    r = client.post(
        "/annotations",
        json={
            "image_id": TARGET,
            "primitive": {"kind": "mask"},
            "mask_png_b64": base64.b64encode(buf.getvalue()).decode(),
            "status": "suggested",
            "source": "agent",
        },
    )
    assert r.status_code == 201, r.text
    r, _ = _frame(overlay="true", roi="0,0,800,600", size=800)
    lit = _lit(r.content)
    assert any(abs(x - 200) <= 2 and 220 <= y <= 280 for x, y in lit)  # 左边缘
    assert not any(250 <= x <= 350 and 230 <= y <= 270 for x, y in lit)  # 内部不填充
