"""上传端点 POST /uploads/images（SDD 08 §15 后端第 1–8 项）。

每条用例都把 GLAUX_DATASETS_ROOT 指到 tmp_path，故落盘与注册表都在临时目录里，
不碰用户真实的 ~/glaux_datasets。
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config
from app import datasource_registry as reg
from app.main import app

client = TestClient(app)


def _jpeg(size=(8, 8)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (120, 30, 30)).save(buf, format="JPEG")
    return buf.getvalue()


def _png(size=(8, 8)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (30, 120, 30)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _isolated_root(tmp_path, monkeypatch):
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    reg.init()
    yield
    reg.init()


def _post(files, name: str | None = None):
    data = {"name": name} if name else None
    return client.post("/uploads/images", files=files, data=data)


def test_upload_two_jpegs(tmp_path):
    r = _post(
        [("files", ("a.jpg", _jpeg(), "image/jpeg")), ("files", ("b.jpg", _jpeg(), "image/jpeg"))],
        name="批次一",
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["accepted"]) == 2
    assert body["rejected"] == []
    assert body["source"]["status"] == "active"
    assert body["source"]["modality"] == "natural_image"
    assert body["source"]["origin"] == "imported"
    # 通用图像没有标定，但不该因此被标 needs_calibration
    assert body["source"]["calibration"] == {}


def test_reject_reasons():
    r = _post(
        [
            ("files", ("ok.jpg", _jpeg(), "image/jpeg")),
            ("files", ("scan.tiff", b"II*\x00rest", "image/tiff")),
            ("files", ("fake.jpg", b"not an image at all", "image/jpeg")),
        ],
        name="混合批",
    )
    assert r.status_code == 200, r.text
    reasons = {x["filename"]: x["reason"] for x in r.json()["rejected"]}
    assert reasons == {"scan.tiff": "unsupported_type", "fake.jpg": "corrupt"}
    assert len(r.json()["accepted"]) == 1


def test_too_large_not_written(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "UPLOAD_MAX_BYTES", 64)
    r = _post([("files", ("big.jpg", _jpeg((200, 200)), "image/jpeg"))], name="超大")
    assert r.status_code == 422  # 全被拒 → 整体 422，不建源
    assert not list((tmp_path / "uploads").glob("*/*")) if (tmp_path / "uploads").exists() else True


def test_too_many_files_rejected_wholesale(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "UPLOAD_MAX_FILES", 2)
    r = _post([("files", (f"{i}.jpg", _jpeg(), "image/jpeg")) for i in range(3)], name="超量")
    assert r.status_code == 422
    # 越限时一个字节都不该落盘
    assert not (tmp_path / "uploads").exists() or not list((tmp_path / "uploads").rglob("*.jpg"))


def test_all_rejected_creates_no_source():
    r = _post([("files", ("x.tiff", b"II*\x00", "image/tiff"))], name="全拒")
    assert r.status_code == 422
    assert [s for s in reg.list_all() if s.origin == "imported"] == []


def test_path_traversal_filename_is_neutralised(tmp_path):
    r = _post([("files", ("../../etc/passwd", _jpeg(), "image/jpeg"))], name="穿越")
    # 无扩展名 → unsupported_type；换个带扩展名的再来一次
    assert r.status_code == 422

    r = _post([("files", ("../../etc/passwd.jpg", _jpeg(), "image/jpeg"))], name="穿越2")
    assert r.status_code == 200, r.text
    accepted = r.json()["accepted"][0]
    assert accepted["filename"] == "../../etc/passwd.jpg"  # 原名只回显
    from app import upload_store as us

    assert us.IMAGE_ID_RE.match(accepted["id"])
    root = tmp_path / "uploads"
    written = list(root.rglob("*.jpg"))
    assert len(written) == 1
    assert written[0].is_relative_to(root)  # 没跑出 uploads/
    assert "passwd" not in written[0].name


def test_repeat_upload_same_name_updates_not_duplicates():
    first = _post([("files", ("a.jpg", _jpeg(), "image/jpeg"))], name="稳定名")
    assert first.status_code == 200
    before = len(reg.list_all())
    second = _post([("files", ("a.jpg", _jpeg(), "image/jpeg"))], name="稳定名")
    assert second.status_code == 200
    assert len(reg.list_all()) == before  # 同名 → 同目录 → 同源，不新增
    assert second.json()["accepted"][0]["id"] == first.json()["accepted"][0]["id"]
    assert second.json()["source"]["id"] == first.json()["source"]["id"]


def test_uploaded_images_listed_and_fetchable():
    up = _post(
        [("files", ("a.jpg", _jpeg(), "image/jpeg")), ("files", ("b.png", _png(), "image/png"))],
        name="可取批",
    )
    assert up.status_code == 200, up.text
    ids = [x["id"] for x in up.json()["accepted"]]

    listed = client.get("/images", params={"modality": "natural_image"})
    assert listed.status_code == 200
    listed_ids = [m["id"] for m in listed.json()]
    for i in ids:
        assert i in listed_ids
    # 重复请求顺序稳定
    again = client.get("/images", params={"modality": "natural_image"}).json()
    assert [m["id"] for m in again] == listed_ids

    for i, expect_type in zip(ids, ("image/jpeg", "image/png"), strict=True):
        got = client.get(f"/image/{i}")
        assert got.status_code == 200, i
        assert got.headers["content-type"] == expect_type
        assert len(got.content) > 0


def test_image_404_after_source_removed():
    up = _post([("files", ("a.jpg", _jpeg(), "image/jpeg"))], name="待删")
    image_id = up.json()["accepted"][0]["id"]
    source_id = up.json()["source"]["id"]
    assert client.get(f"/image/{image_id}").status_code == 200

    assert client.delete(f"/datasources/{source_id}").status_code == 200
    assert client.get(f"/image/{image_id}").status_code == 404
    # 只注销不删文件（D-6）
    assert client.get("/images", params={"modality": "natural_image"}).status_code == 200


def test_unknown_nat_id_404_not_mock():
    """未知 nat-* 必须 404，不能被 mock 合成图吞掉（否则伪造 ID 看似成功）。"""
    r = client.get("/image/nat-deadbeef-cafebabe")
    assert r.status_code == 404
