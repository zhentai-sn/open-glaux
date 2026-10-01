"""Atlas REST（SDD 03 §5.2 / §15）。

上传即入库 → 描述写回与自动补字段 → 编辑 / 改 ROI / 追加区域 → 检索 →
下架/恢复/删除门禁 → 引用回写。
"""

from __future__ import annotations

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config
from app.atlas import parse_web, service
from app.main import app


@pytest.fixture(autouse=True)
def _atlas_tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "ATLAS_ROOT", tmp_path / "atlas")
    service.reset()
    yield
    service.reset()


client = TestClient(app)


def _png(w=120, h=80, val=100) -> bytes:
    im = Image.new("L", (w, h), val)
    px = im.load()
    for x in range(0, w, 7):
        px[x, 3] = 20
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _pdf() -> bytes:
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_image(pymupdf.Rect(50, 60, 250, 200), stream=_png())
    page.insert_text(
        (50, 220), "图 3-1 上皮下电子致密物", fontname="china-s"
    )  # 内置 CJK 字体，否则中文缺字形
    return doc.tobytes()


CONSENT = {"confirmed_at": "2026-08-16T00:00:00Z", "statement_version": "v1"}


def _item(**kw):
    base = {
        "roi": [10, 10, 40, 30],
        "tags": ["TEM", "EDD"],
        "source_type": "textbook",
        "source": {"book": "B", "page": 1},
        "caption": "上皮下电子致密物沉积",
        "image_base64": _b64(_png()),
    }
    base.update(kw)
    return base


# --- 上传即入库（v2.0） ---------------------------------------------------------------


def _text_pdf() -> bytes:
    import pymupdf

    doc = pymupdf.open()
    doc.new_page().insert_text((50, 50), "text only")
    return doc.tobytes()


def test_upload_pdf_and_images_direct_to_active():
    files = [
        ("files", ("book.pdf", _pdf(), "application/pdf")),
        ("files", ("a.png", _png(val=40), "image/png")),
        ("files", ("scan.pdf", _text_pdf(), "application/pdf")),
        ("files", ("notes.txt", b"hello", "text/plain")),
    ]
    r = client.post("/atlas/uploads", files=files, data={"collection": "肾脏/EDD"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert [it["file"] for it in out["items"]] == ["book.pdf", "a.png"]
    assert {e["file"]: e["code"] for e in out["errors"]} == {
        "scan.pdf": "NO_FIGURES_FOUND",
        "notes.txt": "UNSUPPORTED_FILE",
    }
    pdf_ex = client.get(f"/atlas/exemplars/{out['items'][0]['exemplar_id']}").json()
    img_ex = client.get(f"/atlas/exemplars/{out['items'][1]['exemplar_id']}").json()
    assert pdf_ex["source_type"] == "textbook" and pdf_ex["source"]["page"] == 1
    assert pdf_ex["caption"].startswith("图 3-1")
    assert img_ex["source_type"] == "upload" and img_ex["source"] == {"filename": "a.png"}
    assert img_ex["roi"] == [0, 0, 120, 80] and img_ex["crop_ref"] is None
    for ex in (pdf_ex, img_ex):
        assert ex["status"] == "active" and ex["tags"] == [] and ex["reviewed"] is False
        assert ex["describe_status"] == "pending" and ex["collection"] == "肾脏/EDD"
        assert ex["egress"] == "local-only"
    # 整图 ROI 的 /crop 回落到原图
    assert client.get(f"/atlas/exemplars/{img_ex['exemplar_id']}/crop").status_code == 200
    # 重复上传同一文件返回已有记录
    again = client.post(
        "/atlas/uploads", files=[("files", ("a.png", _png(val=40), "image/png"))]
    ).json()
    assert again["items"][0] == {
        "exemplar_id": img_ex["exemplar_id"],
        "created": False,
        "file": "a.png",
    }
    # 待描述 / 未确认筛选
    r = client.get("/atlas/exemplars", params={"describe_status": "pending", "reviewed": "false"})
    assert len(r.json()) == 2


def test_upload_too_many_files_rejects_whole_batch(monkeypatch):
    from app.atlas import importer

    monkeypatch.setattr(importer, "MAX_FILES", 2)
    files = [("files", (f"{i}.png", _png(val=50 + i), "image/png")) for i in range(3)]
    r = client.post("/atlas/uploads", files=files)
    assert r.status_code == 413 and r.json()["detail"]["code"] == "UPLOAD_TOO_LARGE"
    assert client.get("/atlas/exemplars").json() == []


def test_upload_url_private_is_400_and_no_request(monkeypatch):
    def blocked(url, client=None):
        raise parse_web.FetchBlocked("拒绝内网/保留地址：10.0.0.5")

    monkeypatch.setattr(parse_web, "extract_figures", blocked)
    r = client.post("/atlas/uploads/url", json={"url": "https://10.0.0.5/page"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "FETCH_BLOCKED"
    assert client.get("/atlas/exemplars").json() == []


def test_upload_url_success_creates_all_figures(monkeypatch):
    from app.atlas.parse_web import WebFigure

    monkeypatch.setattr(
        parse_web,
        "extract_figures",
        lambda url, client=None: [
            WebFigure(0, url + "/a.png", _png(val=60), 120, 80, "Fig A", ["ctx"]),
            WebFigure(1, url + "/b.png", _png(val=61), 120, 80, "", []),
        ],
    )
    r = client.post("/atlas/uploads/url", json={"url": "https://site.example/page"})
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 2
    ex = client.get(f"/atlas/exemplars/{items[0]['exemplar_id']}").json()
    assert ex["source_type"] == "web" and ex["caption"] == "Fig A"
    assert ex["source"] == {
        "url": "https://site.example/page",
        "image_url": "https://site.example/page/a.png",
    }


# --- 描述自动补字段 / 编辑 / 追加区域（v2.0） ---------------------------------------------------

DESC = {
    "modality": "TEM",
    "subject": "肾小球基底膜",
    "findings": [{"name": "电子致密物"}, {"name": "电子致密物"}],
    "pattern": "",
    "summary": "上皮下电子致密物沉积",
    "extra": {},
}


def _upload_one(val=70) -> str:
    r = client.post("/atlas/uploads", files=[("files", (f"{val}.png", _png(val=val), "image/png"))])
    return r.json()["items"][0]["exemplar_id"]


def test_description_fills_tags_and_caption_until_reviewed():
    eid = _upload_one()
    ex = client.put(f"/atlas/exemplars/{eid}/description", json={"description": DESC}).json()
    assert ex["tags_raw"] == ["TEM", "肾小球基底膜", "电子致密物"] and ex["tags"][0] == "tem"
    assert ex["caption"] == "上皮下电子致密物沉积" and ex["reviewed"] is False

    ex = client.patch(
        f"/atlas/exemplars/{eid}", json={"tags": ["EDD"], "caption": "手写图注"}
    ).json()
    assert ex["reviewed"] is True and ex["tags"] == ["edd"]
    ex = client.put(f"/atlas/exemplars/{eid}/description", json={"description": DESC}).json()
    assert ex["tags"] == ["edd"] and ex["caption"] == "手写图注"


def test_patch_fields_consent_and_review_only():
    eid = _upload_one(71)
    r = client.patch(f"/atlas/exemplars/{eid}", json={"egress": "shareable"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "CONSENT_REQUIRED"
    ex = client.get(f"/atlas/exemplars/{eid}").json()
    assert ex["reviewed"] is False  # 失败的修改不置确认
    ex = client.patch(
        f"/atlas/exemplars/{eid}",
        json={
            "egress": "shareable",
            "egress_consent": CONSENT,
            "collection": " 肾脏 / IgA ",
            "source": {"filename": "x.png", "book": "B"},
        },
    ).json()
    assert (
        ex["egress"] == "shareable"
        and ex["collection"] == "肾脏/IgA"
        and ex["source"]["book"] == "B"
    )
    ex = client.patch(f"/atlas/exemplars/{eid}", json={"egress": "local-only"}).json()
    assert ex["egress"] == "local-only" and ex["egress_consent"] is None

    other = _upload_one(72)
    ex = client.patch(f"/atlas/exemplars/{other}", json={"reviewed": True}).json()
    assert ex["reviewed"] is True
    assert client.patch(f"/atlas/exemplars/{other}", json={"reviewed": False}).status_code == 422
    assert client.patch("/atlas/exemplars/nope", json={"reviewed": True}).status_code == 404


def test_patch_roi_recrops_and_resets_description():
    eid = _upload_one(73)
    client.put(f"/atlas/exemplars/{eid}/description", json={"description": DESC})
    ex = client.patch(f"/atlas/exemplars/{eid}", json={"roi": [10, 10, 40, 30]}).json()
    assert ex["roi"] == [10, 10, 40, 30] and ex["crop_ref"].endswith("__10_10_40_30.png")
    assert ex["describe_status"] == "pending" and ex["reviewed"] is True
    crop = Image.open(io.BytesIO(client.get(f"/atlas/exemplars/{eid}/crop").content))
    assert crop.size == (40, 30)
    r = client.patch(f"/atlas/exemplars/{eid}", json={"roi": [500, 500, 5, 5]})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "BAD_ROI"
    # 改回整图：不另存裁剪
    ex = client.patch(f"/atlas/exemplars/{eid}", json={"roi": [0, 0, 120, 80]}).json()
    assert ex["crop_ref"] is None


def test_add_region_inherits_and_is_idempotent():
    eid = _upload_one(74)
    client.patch(f"/atlas/exemplars/{eid}", json={"tags": ["EDD"], "collection": "肾脏"})
    r = client.post(f"/atlas/exemplars/{eid}/regions", json={"roi": [5, 5, 20, 20]})
    assert r.status_code == 200 and r.json()["created"] is True
    nid = r.json()["exemplar_id"]
    ex = client.get(f"/atlas/exemplars/{nid}").json()
    src = client.get(f"/atlas/exemplars/{eid}").json()
    assert ex["image_ref"] == src["image_ref"] and ex["source"] == src["source"]
    assert ex["tags"] == ["edd"] and ex["collection"] == "肾脏" and ex["reviewed"] is True
    assert ex["roi"] == [5, 5, 20, 20] and ex["describe_status"] == "pending"
    again = client.post(f"/atlas/exemplars/{eid}/regions", json={"roi": [5, 5, 20, 20]}).json()
    assert again == {"exemplar_id": nid, "created": False}


# --- 创建 / 幂等 / 校验 ---------------------------------------------------------------


def test_create_idempotent_and_validations():
    a = client.post("/atlas/exemplars", json={"items": [_item()]}).json()
    b = client.post("/atlas/exemplars", json={"items": [_item()]}).json()
    assert (
        a[0]["created"] is True
        and b[0]["created"] is False
        and a[0]["exemplar_id"] == b[0]["exemplar_id"]
    )
    r = client.post("/atlas/exemplars", json={"items": [_item(egress="shareable")]})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "CONSENT_REQUIRED"
    r = client.post(
        "/atlas/exemplars", json={"items": [_item(egress="shareable", egress_consent=CONSENT)]}
    )
    assert r.status_code == 200
    r = client.post("/atlas/exemplars", json={"items": [_item(roi=[500, 500, 10, 10])]})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "BAD_ROI"
    r = client.post("/atlas/exemplars", json={"items": [_item(image_base64="!!notbase64")]})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "BAD_IMAGE"
    assert (
        client.post("/atlas/exemplars", json={"items": [_item(image_base64=None)]}).status_code
        == 422
    )


# --- 检索 / 标签 --------------------------------------------------------------------


def _seed():
    ids = {}
    ids["a"] = client.post(
        "/atlas/exemplars",
        json={
            "items": [
                _item(image_base64=_b64(_png(val=10)), egress="shareable", egress_consent=CONSENT)
            ]
        },
    ).json()[0]["exemplar_id"]
    ids["b"] = client.post(
        "/atlas/exemplars",
        json={
            "items": [_item(image_base64=_b64(_png(val=20)), caption="系膜区增宽", tags=["tem"])]
        },
    ).json()[0]["exemplar_id"]
    return ids


def test_search_and_tags():
    ids = _seed()
    r = client.get("/atlas/exemplars/search", params={"q": "电子致密物", "egress": "shareable"})
    assert [e["exemplar_id"] for e in r.json()] == [ids["a"]]
    r = client.get("/atlas/exemplars/search", params={"tags": ["ＥＤＤ"], "egress": "any"})
    assert [e["exemplar_id"] for e in r.json()] == [ids["a"]]
    r = client.get("/atlas/exemplars/search", params={"q": "系膜", "egress": "shareable"})
    assert r.json() == []  # b 是 local-only
    r = client.get("/atlas/exemplars/search", params={"q": "系膜", "egress": "any"})
    assert [e["exemplar_id"] for e in r.json()] == [ids["b"]]
    tags = {t["tag"]: t["count"] for t in client.get("/atlas/tags").json()}
    assert tags == {"tem": 2, "edd": 1}


# --- 描述写回 --------------------------------------------------------------------


def test_put_description_updates_status_and_search():
    ids = _seed()
    r = client.put(
        f"/atlas/exemplars/{ids['b']}/description",
        json={
            "description": {
                "modality": "TEM",
                "subject": "系膜",
                "findings": [{"name": "系膜增生"}],
                "pattern": "",
                "summary": "系膜基质增多",
                "extra": {},
            }
        },
    )
    assert r.status_code == 200 and r.json()["describe_status"] == "done"
    r = client.get("/atlas/exemplars/search", params={"q": "系膜增生", "egress": "any"})
    assert [e["exemplar_id"] for e in r.json()] == [ids["b"]]
    r = client.put(
        f"/atlas/exemplars/{ids['b']}/description", json={"description": None, "status": "pending"}
    )
    assert r.json()["describe_status"] == "pending"
    assert (
        client.put("/atlas/exemplars/nope/description", json={"description": None}).status_code
        == 404
    )


# --- 下架 / 恢复 / 删除门禁 / 引用 -------------------------------------------------------------


def test_retire_restore_delete_and_referenced():
    ids = _seed()
    assert client.post(f"/atlas/exemplars/{ids['a']}/retire").json()["status"] == "retired"
    assert (
        client.get("/atlas/exemplars/search", params={"q": "电子致密物", "egress": "any"}).json()
        == []
    )
    assert ids["a"] in {
        e["exemplar_id"]
        for e in client.get("/atlas/exemplars", params={"status": "retired"}).json()
    }
    assert ids["a"] not in {e["exemplar_id"] for e in client.get("/atlas/exemplars").json()}
    assert client.post(f"/atlas/exemplars/{ids['a']}/restore").json()["status"] == "active"
    assert (
        len(
            client.get(
                "/atlas/exemplars/search", params={"q": "电子致密物", "egress": "any"}
            ).json()
        )
        == 1
    )

    r = client.post(
        "/atlas/exemplars/referenced", json={"exemplar_ids": [ids["a"]], "trace_id": "t1"}
    )
    assert r.json()["marked"] == 1
    r = client.delete(f"/atlas/exemplars/{ids['a']}")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "REFERENCED"
    assert client.delete(f"/atlas/exemplars/{ids['b']}").json()["ok"] is True
    assert client.get(f"/atlas/exemplars/{ids['b']}").status_code == 404
    assert client.post("/atlas/exemplars/zzz/retire").status_code == 404


def test_search_path_no_torch():
    import sys

    _seed()
    client.get("/atlas/exemplars/search", params={"q": "x", "egress": "any"})
    assert "torch" not in sys.modules


# --- 图册 collection（v1.1） -----------------------------------------------------------------


def test_collections_endpoint_filter_and_move():
    a = client.post(
        "/atlas/exemplars",
        json={"items": [_item(image_base64=_b64(_png(val=31)), collection="肾脏/膜性肾病/EDD")]},
    ).json()[0]["exemplar_id"]
    b = client.post(
        "/atlas/exemplars",
        json={"items": [_item(image_base64=_b64(_png(val=32)), collection="肾脏／IgA")]},
    ).json()[0]["exemplar_id"]
    c = client.post(
        "/atlas/exemplars", json={"items": [_item(image_base64=_b64(_png(val=33)))]}
    ).json()[0]["exemplar_id"]

    cols = client.get("/atlas/collections").json()
    assert {x["key"]: x["count"] for x in cols} == {"": 1, "肾脏/iga": 1, "肾脏/膜性肾病/edd": 1}
    assert next(x for x in cols if x["key"] == "肾脏/iga")["collection"] == "肾脏/IgA"

    r = client.get("/atlas/exemplars", params={"collection": "肾脏"})
    assert sorted(e["exemplar_id"] for e in r.json()) == sorted([a, b])
    r = client.get("/atlas/exemplars", params={"collection": "", "collection_exact": "true"})
    assert [e["exemplar_id"] for e in r.json()] == [c]
    r = client.get(
        "/atlas/exemplars/search",
        params={"q": "电子致密物", "egress": "any", "collection": "肾脏/膜性肾病"},
    )
    assert [e["exemplar_id"] for e in r.json()] == [a]

    r = client.patch(f"/atlas/exemplars/{c}", json={"collection": " 肾脏 / IgA "})
    assert r.status_code == 200 and r.json()["collection"] == "肾脏/IgA"
    r = client.get("/atlas/exemplars", params={"collection": "肾脏/IgA"})
    assert sorted(e["exemplar_id"] for e in r.json()) == sorted([b, c])
    assert client.patch("/atlas/exemplars/nope", json={"collection": "x"}).status_code == 404
    # 移回根目录
    assert (
        client.patch(f"/atlas/exemplars/{c}", json={"collection": None}).json()["collection"] == ""
    )
