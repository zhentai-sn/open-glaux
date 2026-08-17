"""Atlas REST（SDD 03 §5.2 / §15）。

导入暂存 → 创建 → 检索 → 描述写回 → 下架/恢复/删除门禁 → 引用回写。
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


# --- 导入暂存 ------------------------------------------------------------------


def test_import_pdf_then_create_from_staged_figure():
    r = client.post("/atlas/imports/pdf", files={"file": ("book.pdf", _pdf(), "application/pdf")})
    assert r.status_code == 200, r.text
    sess = r.json()
    assert sess["source_type"] == "textbook" and len(sess["figures"]) == 1
    fig = sess["figures"][0]
    assert fig["caption"].startswith("图 3-1") and fig["locator"] == {"page": 1}
    # 候选缩略图可取
    img = client.get(f"/atlas/imports/{sess['import_id']}/figures/{fig['index']}")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    # 用候选引用创建
    r = client.post(
        "/atlas/exemplars",
        json={
            "items": [
                {
                    "roi": [5, 5, 50, 40],
                    "tags": ["tem", "edd"],
                    "source_type": "textbook",
                    "source": {"book": "B", "page": 1},
                    "caption": fig["caption"],
                    "import_id": sess["import_id"],
                    "figure_index": fig["index"],
                }
            ]
        },
    )
    assert r.status_code == 200, r.text
    eid = r.json()[0]["exemplar_id"]
    ex = client.get(f"/atlas/exemplars/{eid}").json()
    assert (
        ex["source_type"] == "textbook"
        and ex["egress"] == "local-only"
        and ex["describe_status"] == "pending"
    )
    assert client.get(f"/atlas/exemplars/{eid}/crop").headers["content-type"] == "image/png"
    assert client.delete(f"/atlas/imports/{sess['import_id']}").json()["ok"] is True
    assert client.get(f"/atlas/imports/{sess['import_id']}").status_code == 404


def test_import_scanned_or_text_pdf_is_422_no_residue():
    import pymupdf

    doc = pymupdf.open()
    doc.new_page().insert_text((50, 50), "text only")
    r = client.post(
        "/atlas/imports/pdf", files={"file": ("scan.pdf", doc.tobytes(), "application/pdf")}
    )
    assert r.status_code == 422 and r.json()["detail"]["code"] == "NO_FIGURES_FOUND"
    assert client.get("/atlas/exemplars").json() == []


def test_import_url_private_is_400_and_no_request(monkeypatch):
    called = {"n": 0}

    def fake_extract(url, client=None):
        called["n"] += 1
        return []

    monkeypatch.setattr(parse_web, "extract_figures", fake_extract)
    # 走真实守卫：字面私网 IP 直接拒绝（不需要 DNS）——parse_web.extract_figures 内部才调 _get，
    # 但守卫在 _get 之前；此处用 monkeypatch 证明 router 对 FetchBlocked 的映射。
    monkeypatch.setattr(
        service.get().importer,
        "stage_url",
        lambda url, client=None: (_ for _ in ()).throw(
            parse_web.FetchBlocked("拒绝内网/保留地址：10.0.0.5")
        ),
    )
    r = client.post("/atlas/imports/url", json={"url": "https://10.0.0.5/page"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "FETCH_BLOCKED"
    assert called["n"] == 0


def test_import_url_success_stages_figures(monkeypatch):
    from app.atlas.parse_web import WebFigure

    monkeypatch.setattr(
        parse_web,
        "extract_figures",
        lambda url, client=None: [WebFigure(0, url + "/a.png", _png(), 120, 80, "Fig A", ["ctx"])],
    )
    r = client.post("/atlas/imports/url", json={"url": "https://site.example/page"})
    assert r.status_code == 200, r.text
    sess = r.json()
    assert sess["source_type"] == "web" and sess["figures"][0]["locator"]["url"].endswith("a.png")


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
    r = client.post("/atlas/exemplars", json={"items": [_item(image_base64=None)]})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "BAD_IMAGE"


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

    r = client.put(f"/atlas/exemplars/{c}/collection", json={"collection": " 肾脏 / IgA "})
    assert r.status_code == 200 and r.json()["collection"] == "肾脏/IgA"
    r = client.get("/atlas/exemplars", params={"collection": "肾脏/IgA"})
    assert sorted(e["exemplar_id"] for e in r.json()) == sorted([b, c])
    assert (
        client.put("/atlas/exemplars/nope/collection", json={"collection": "x"}).status_code == 404
    )
