"""标签目录与标注汇总（SDD 23 §7.1–§7.4、§15.1、§15.3）。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config, upload_store
from app import datasource_registry as reg
from app.main import app
from app.routers import annotations as ann_router
from app.routers.loopback import require_loopback

client = TestClient(app)

GLOBAL_OBJ = ""
PROJECT_OBJ = ""


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    """一个未归属对象（全局目录）+ 一个项目内对象（项目目录）。"""
    global GLOBAL_OBJ, PROJECT_OBJ
    monkeypatch.setattr(config, "ANNOTATIONS_ROOT", tmp_path / "ann")
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path / "ds"))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "ds" / "sources.json"))
    app.dependency_overrides[require_loopback] = lambda: None
    folder = tmp_path / "ds" / "loose"
    folder.mkdir(parents=True)
    Image.new("RGB", (800, 600), 0).save(folder / "a.png")
    reg.init()
    src = reg.register_folder(folder, "natural_image")
    GLOBAL_OBJ = upload_store.image_id(src.id, "a.png")
    proj = tmp_path / "proj"
    proj.mkdir()
    Image.new("RGB", (400, 300), 0).save(proj / "b.png")
    prj, _ = reg.register_project(proj)
    r = client.post(f"/projects/{prj.id}/objects", json={"path": "b.png"})
    assert r.status_code == 200, r.text
    PROJECT_OBJ = r.json()["id"]
    ann_router._stores.clear()
    yield
    app.dependency_overrides.pop(require_loopback, None)
    ann_router._stores.clear()
    reg._SOURCES.clear()
    reg._PROJECTS.clear()
    reg.invalidate_index()


def _label(obj: str, name: str, **kw) -> dict:
    r = client.post("/labels", json={"object_id": obj, "name": name, **kw})
    assert r.status_code == 201, r.text
    return r.json()["label"]


def _bbox(obj: str, x0=0, y0=0, x1=10, y1=20, **kw) -> dict:
    r = client.post(
        "/annotations",
        json={
            "image_id": obj,
            "primitive": {"kind": "bbox", "x0": x0, "y0": y0, "x1": x1, "y1": y1},
            **kw,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()["annotation"]


def test_scopes_are_isolated_and_names_unique_case_insensitively():
    g = _label(GLOBAL_OBJ, "Nucleus")
    p = _label(PROJECT_OBJ, "nucleus")  # 不同作用域可同名
    assert g["scope"] == "global" and p["scope"].startswith("prj-")
    assert [
        lb["id"] for lb in client.get("/labels", params={"object_id": GLOBAL_OBJ}).json()["labels"]
    ] == [g["id"]]
    dup = client.post("/labels", json={"object_id": GLOBAL_OBJ, "name": "  NUCLEUS "})
    assert dup.status_code == 409
    assert dup.json()["detail"]["label"]["id"] == g["id"]  # 带回已有标签，前端直接选用
    assert g["color"].startswith("#") and len(g["color"]) == 7


def test_label_id_must_belong_to_object_scope():
    p = _label(PROJECT_OBJ, "折叠")
    r = client.post(
        "/annotations",
        json={
            "image_id": GLOBAL_OBJ,
            "primitive": {"kind": "bbox", "x0": 0, "y0": 0, "x1": 5, "y1": 5},
            "label_id": p["id"],
        },
    )
    assert r.status_code == 422


def test_rename_reflects_on_annotations_and_text_autolinks():
    lb = _label(GLOBAL_OBJ, "斑块")
    a = _bbox(GLOBAL_OBJ, label_id=lb["id"])
    assert (a["label"], a["label_id"], a["label_color"]) == ("斑块", lb["id"], lb["color"])
    linked = _bbox(GLOBAL_OBJ, label=" 斑块 ")  # 只给文本：按目录名称自动关联
    assert linked["label_id"] == lb["id"]
    loose = _bbox(GLOBAL_OBJ, label="主动脉")
    assert loose["label_id"] is None and loose["label"] == "主动脉"

    r = client.patch(
        f"/labels/{lb['id']}", json={"base_seq": 1, "name": "钙化斑块", "color": "#112233"}
    )
    assert r.status_code == 200, r.text
    rows = {
        x["id"]: x
        for x in client.get("/annotations", params={"image_id": GLOBAL_OBJ}).json()["annotations"]
    }
    assert rows[a["id"]]["label"] == "钙化斑块" and rows[a["id"]]["label_color"] == "#112233"
    assert "label_stored" not in rows[a["id"]] and "mask_ref" not in rows[a["id"]]


def test_patch_sets_and_clears_label_id():
    lb = _label(GLOBAL_OBJ, "肝")
    a = _bbox(GLOBAL_OBJ)
    r = client.patch(f"/annotations/{a['id']}", json={"base_seq": a["seq"], "label_id": lb["id"]})
    assert r.json()["annotation"]["label_id"] == lb["id"]
    r = client.patch(f"/annotations/{a['id']}", json={"base_seq": a["seq"] + 1, "label_id": None})
    after = r.json()["annotation"]
    assert after["label_id"] is None and after["label"] == "肝"  # 文本留作历史名称


def test_delete_refused_while_in_use_and_merge_moves_annotations():
    a_lbl = _label(GLOBAL_OBJ, "A")
    b_lbl = _label(GLOBAL_OBJ, "B")
    ann = _bbox(GLOBAL_OBJ, label_id=a_lbl["id"])
    r = client.delete(f"/labels/{a_lbl['id']}", params={"base_seq": 1})
    assert r.status_code == 409 and r.json()["detail"]["count"] == 1

    r = client.post(f"/labels/{a_lbl['id']}/merge", json={"base_seq": 1, "into": b_lbl["id"]})
    assert r.status_code == 200, r.text
    assert r.json()["label"]["count"] == 1
    row = client.get("/annotations", params={"image_id": GLOBAL_OBJ}).json()["annotations"][0]
    assert (row["id"], row["label_id"], row["label"]) == (ann["id"], b_lbl["id"], "B")
    ids = [
        lb["id"] for lb in client.get("/labels", params={"object_id": GLOBAL_OBJ}).json()["labels"]
    ]
    assert ids == [b_lbl["id"]]
    # 合并已完成后重放：源标签已不存在
    again = client.post(f"/labels/{a_lbl['id']}/merge", json={"base_seq": 1, "into": b_lbl["id"]})
    assert again.status_code == 422


def test_merge_across_scopes_and_stale_seq_rejected():
    g = _label(GLOBAL_OBJ, "X")
    p = _label(PROJECT_OBJ, "Y")
    assert (
        client.post(f"/labels/{g['id']}/merge", json={"base_seq": 1, "into": p["id"]}).status_code
        == 422
    )
    assert client.patch(f"/labels/{g['id']}", json={"base_seq": 9, "name": "Z"}).status_code == 409
    other = _label(GLOBAL_OBJ, "W")
    assert (
        client.patch(f"/labels/{other['id']}", json={"base_seq": 1, "name": "x"}).status_code == 409
    )


def test_delete_unused_label():
    lb = _label(GLOBAL_OBJ, "临时")
    assert client.delete(f"/labels/{lb['id']}", params={"base_seq": 1}).status_code == 204
    assert client.get("/labels", params={"object_id": GLOBAL_OBJ}).json()["labels"] == []


def test_summary_groups_counts_and_areas():
    fold = _label(GLOBAL_OBJ, "折叠")
    _bbox(GLOBAL_OBJ, 0, 0, 10, 20, label_id=fold["id"])  # 200
    _bbox(GLOBAL_OBJ, 0, 0, 5, 5, label_id=fold["id"], status="confirmed")  # 25
    _bbox(GLOBAL_OBJ, 0, 0, 5, 5, label_id=fold["id"], status="suggested", source="agent")
    _bbox(GLOBAL_OBJ, 0, 0, 5, 5, label_id=fold["id"], status="rejected")
    _bbox(GLOBAL_OBJ, 0, 0, 2, 2, label="主动脉")  # 4
    _bbox(GLOBAL_OBJ, 0, 0, 3, 3)  # 9
    s = client.get("/annotations/summary", params={"image_id": GLOBAL_OBJ}).json()
    assert s["unit"] == "px" and s["area_unit"] == "px2"
    kinds = [(g["kind"], g["name"], g["count"], g["area"], g["suggested"]) for g in s["groups"]]
    assert kinds == [
        ("catalog", "折叠", 2, 225.0, 1),
        ("uncatalogued", "主动脉", 1, 4.0, 0),
        ("unlabeled", "", 1, 9.0, 0),
    ]
    assert s["total"] == {"count": 4, "area": 238.0, "suggested": 1}
    assert client.get("/labels", params={"object_id": GLOBAL_OBJ}).json()["labels"][0]["count"] == 3


def test_annotations_carry_measures():
    a = _bbox(GLOBAL_OBJ, 0, 0, 10, 20)
    assert a["measures"] == {"area": 200.0, "perimeter": 60.0, "unit": "px", "area_unit": "px2"}
