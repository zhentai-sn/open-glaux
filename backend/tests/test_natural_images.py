"""SDD 07：自然图像列表、固定白名单取图与任务隔离。"""

from __future__ import annotations

from fastapi.testclient import TestClient
from PIL import Image

from app import dataset_natural
from app.main import app
from app.routers import annotations

client = TestClient(app)


def test_natural_images_have_stable_metadata():
    r = client.get("/images", params={"modality": "natural_image"})
    assert r.status_code == 200
    rows = r.json()
    assert [row["id"] for row in rows] == [
        "natural_cat",
        "natural_coffee",
        "natural_car",
        "natural_dog",
    ]
    assert all(
        row["center"] == "Natural images"
        and row["cf"] is None
        and row["methods"] == []
        and row["modality"] == "natural_image"
        for row in rows
    )


def test_natural_images_return_jpeg_bytes():
    for image_id in dataset_natural.ASSETS:
        r = client.get(f"/image/{image_id}")
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/jpeg"
        assert r.content.startswith(b"\xff\xd8\xff")


def test_unknown_natural_id_never_falls_back_to_mock():
    r = client.get("/image/natural_unknown")
    assert r.status_code == 404
    assert client.get("/image/natural_..%2F..%2Fetc%2Fpasswd").status_code == 404


def test_missing_or_invalid_asset_is_not_listed(tmp_path, monkeypatch):
    monkeypatch.setattr(dataset_natural.config, "NATURAL_ROOT", tmp_path)
    (tmp_path / "cat.jpg").write_bytes(b"not a jpeg")
    (tmp_path / "coffee.jpg").write_bytes(b"\xff\xd8\xfftruncated")
    Image.new("RGB", (4, 3), "white").save(tmp_path / "car.jpg", format="JPEG")

    assert dataset_natural.list_ids() == ["natural_car"]
    assert client.get("/image/natural_cat").status_code == 404
    assert client.get("/image/natural_coffee").status_code == 404


def test_natural_image_is_not_a_registered_task():
    tasks = client.get("/tasks").json()
    assert "natural_image" not in {task["modality"] for task in tasks}


def test_natural_annotation_uses_real_image_dimensions(tmp_path, monkeypatch):
    monkeypatch.setattr(annotations.config, "ANNOTATIONS_ROOT", tmp_path / "annotations")
    annotations._stores.clear()

    bad = client.post(
        "/annotations",
        json={
            "image_id": "natural_coffee",
            "primitive": {"kind": "bbox", "x0": 0, "y0": 0, "x1": 9999, "y1": 9999},
            "label": "coffee cup",
            "status": "suggested",
            "source": "agent",
        },
    )
    assert bad.status_code == 422

    good = client.post(
        "/annotations",
        json={
            "image_id": "natural_coffee",
            "primitive": {"kind": "bbox", "x0": 300, "y0": 150, "x1": 850, "y1": 650},
            "label": "coffee cup",
            "status": "suggested",
            "source": "agent",
        },
    )
    assert good.status_code == 201
    assert good.json()["annotation"]["status"] == "suggested"


def test_unknown_natural_image_cannot_receive_annotations(tmp_path, monkeypatch):
    monkeypatch.setattr(annotations.config, "ANNOTATIONS_ROOT", tmp_path / "annotations")
    annotations._stores.clear()

    response = client.post(
        "/annotations",
        json={
            "image_id": "natural_unknown",
            "primitive": {"kind": "bbox", "x0": 0, "y0": 0, "x1": 10, "y1": 10},
            "label": "unknown",
        },
    )

    assert response.status_code == 422
    assert client.get("/annotations", params={"image_id": "natural_unknown"}).json() == {
        "annotations": []
    }
