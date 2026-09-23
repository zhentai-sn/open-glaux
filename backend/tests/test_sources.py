"""SDD 10 W1：数据轴收敛——SOURCES 不变量、ObjectMeta 形状、resolve_object、合成源、删源。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import datasource_registry as reg
from app import schemas, upload_store
from app.main import app
from app.schemas import Index, ObjectMeta
from app.sources import SOURCES
from app.sources.base import backfill_legacy

client = TestClient(app)

KINDS = {"image", "volume", "slide", "video"}
AXIS_ORDER = {
    "image": ["x", "y"],
    "volume": ["x", "y", "z"],
    "slide": ["x", "y", "level"],
    "video": ["x", "y", "t"],
}


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    """导入白名单根与落盘清单指向 tmp；注册表清空。"""
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    reg.init()
    yield tmp_path
    reg._SOURCES.clear()
    reg.invalidate_index()


def _natural_folder(root, name="pics", size=(320, 200)):
    folder = root / name
    folder.mkdir()
    Image.new("RGB", size, (10, 20, 30)).save(folder / "a.png")
    return folder


# --- SOURCES 不变量 -------------------------------------------------------------


def test_modalities_is_tuple_of_sources():
    assert reg.MODALITIES == tuple(SOURCES)


@pytest.mark.parametrize("modality", list(SOURCES))
def test_every_source_satisfies_protocol(modality):
    src = SOURCES[modality]
    assert src.modality == modality and src.kind in KINDS and src.label
    for name in ("probe", "list_ids", "is_mine", "meta", "frame", "raw", "tile",
                 "detect_calibration", "builtin_sample", "invalidate"):
        assert callable(getattr(src, name)), name
    for ext, magic, offset in src.formats:
        assert ext.startswith(".") and magic and offset >= 0


def test_datasources_carry_kind_label_importable():
    rows = client.get("/datasources").json()
    assert rows
    for row in rows:
        src = SOURCES[row["modality"]]
        assert row["kind"] == src.kind
        assert row["label"] == src.label and row["label_key"] == f"modality.{row['modality']}"
        assert row["importable"] == [ext for ext, _, _ in src.formats]


def test_upload_magic_table_derives_from_formats():
    """受理表只有一处来源：每个 Source 的 formats。"""
    for modality, src in SOURCES.items():
        for ext, magic, offset in src.formats:
            head = b"\0" * offset + magic + b"\0" * 8
            verdict, _ = upload_store.classify(f"f{ext}", head, 10)
            assert verdict == "accept" and upload_store.modality_of(f"f{ext}") == modality
    assert upload_store.classify("f.tiff", b"II*\0", 10) == ("reject", "unsupported_type")


# --- ObjectMeta 形状 --------------------------------------------------------------


def _listed():
    """当前环境里每个有对象的模态各取第一个对象。"""
    out = []
    for modality in SOURCES:
        rows = client.get("/images", params={"modality": modality}).json()
        if rows:
            out.append(rows[0])
    return out


def test_object_meta_shape_per_kind():
    rows = _listed()
    assert rows, "至少应有一个模态有对象（开发者模式下有合成源）"
    for row in rows:
        obj = ObjectMeta(**row)
        assert [a.name for a in obj.axes] == AXIS_ORDER[obj.kind], obj.id
        assert all(a.size > 0 for a in obj.axes)
        assert obj.resources["frame"] == f"/objects/{obj.id}/frame"
        assert ("tiles" in obj.resources) == (obj.kind == "slide")
        assert obj.streams == [] or obj.kind == "video"
        assert obj.source_id in {s.id for s in reg.list_all()}


def test_backfill_is_single_truth_and_idempotent():
    for row in _listed():
        obj = ObjectMeta(**row)
        once = backfill_legacy(obj)
        assert backfill_legacy(once) == once
        # 子类写过渡字段也会被覆盖：服务端只有一套真相（D-10）
        tampered = obj.model_copy(update={"cf": 123.0, "dims": [1, 1], "mpp_um": [9.0, 9.0]})
        assert backfill_legacy(tampered) == once


def test_check_index():
    obj = ObjectMeta(
        id="v", kind="volume", modality="ct_abdomen", source_id="s",
        axes=[{"name": "x", "size": 4}, {"name": "y", "size": 4}, {"name": "z", "size": 3}],
        resources={"frame": "/objects/v/frame"},
    )
    obj.check_index(Index(z=2))
    with pytest.raises(ValueError):
        obj.check_index(Index(z=3))
    with pytest.raises(ValueError):
        obj.check_index(Index(t=0))  # 请求的轴不存在


# --- resolve_object -------------------------------------------------------------


def test_resolve_object_is_consistent_with_listing():
    for row in _listed():
        ref = reg.resolve_object(row["id"])
        assert (ref.object_id, ref.kind, ref.modality) == (row["id"], row["kind"], row["modality"])
        assert ref.datasource.id == row["source_id"]


def test_resolve_object_unknown_raises_and_image_404():
    with pytest.raises(LookupError):
        reg.resolve_object("no_such_object")
    for oid in ("no_such_object", "ct_999", "../etc/passwd", "tech_99999"):
        assert client.get(f"/image/{oid}").status_code == 404


def test_resolve_object_same_result_via_index_or_fallback(isolated):
    """索引只是加速手段：索引建好后才落盘的文件经 is_mine 兜底解析，结果与重建索引后一致。"""
    folder = _natural_folder(isolated)
    src = reg.register_folder(folder, "natural_image")
    reg.resolve_object(upload_store.image_id(src.id, "a.png"))  # 建立索引
    Image.new("RGB", (8, 8)).save(folder / "b.png")  # 绕过注册表直接改盘
    late = upload_store.image_id(src.id, "b.png")
    via_fallback = reg.resolve_object(late)
    reg.invalidate_index()
    via_index = reg.resolve_object(late)
    assert (via_fallback.datasource, via_fallback.kind, via_fallback.modality) == (
        via_index.datasource, via_index.kind, via_index.modality,
    )


def test_removed_source_objects_404(isolated):
    src = reg.register_folder(_natural_folder(isolated), "natural_image")
    oid = upload_store.image_id(src.id, "a.png")
    assert client.get(f"/image/{oid}").status_code == 200
    assert reg.remove(src.id)
    assert client.get(f"/image/{oid}").status_code == 404


def test_image_serves_first_frame_of_volume():
    rows = client.get("/images", params={"modality": "ct_abdomen"}).json()
    if not rows:
        pytest.skip("需 data/ct demo volume")
    r = client.get(f"/image/{rows[0]['id']}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    x, y = rows[0]["axes"][0]["size"], rows[0]["axes"][1]["size"]
    from io import BytesIO

    assert Image.open(BytesIO(r.content)).size == (x, y)


def test_image_on_slide_is_422():
    rows = client.get("/images", params={"modality": "pathology"}).json()
    if not rows:
        pytest.skip("需 data/wsi demo slide")
    assert client.get(f"/image/{rows[0]['id']}").status_code == 422  # slide 需显式 level


def test_frame_roi_and_size_produce_reference_frame(isolated):
    src = reg.register_folder(_natural_folder(isolated, size=(400, 200)), "natural_image")
    oid = upload_store.image_id(src.id, "a.png")
    ref = reg.resolve_object(oid)
    roi = schemas.Region(kind="box", x0=100, y0=50, x1=300, y1=150)
    data, mime, frame = ref.source.frame(ref.datasource, oid, Index(), roi=roi, size=100)
    assert mime == "image/png"
    assert (frame.origin, frame.scale, frame.width, frame.height) == ((100.0, 50.0), 0.5, 100, 50)
    with pytest.raises(ValueError):
        ref.source.frame(ref.datasource, oid, Index(), roi=schemas.Region(
            kind="box", x0=0, y0=0, x1=401, y1=10))


# --- 合成源（D-17）--------------------------------------------------------------


def test_product_mode_without_data_has_no_synthetic(isolated, monkeypatch):
    monkeypatch.setenv("GLAUX_DEV_MODE", "0")
    reg.init()
    assert client.get("/datasources").json() == []
    for modality in SOURCES:
        assert client.get("/images", params={"modality": modality}).json() == []
    assert client.get("/image/tech_437").status_code == 404


def test_dev_mode_synthetic_active_only_without_real_source(isolated, probe_only):
    probe_only(lambda m: False)  # 内置真实根全无数据
    by_id = {s["id"]: s for s in client.get("/datasources").json()}
    assert by_id["synthetic-us"]["status"] == "active"
    assert by_id["synthetic-hc"]["status"] == "active"
    rows = client.get("/images", params={"modality": "carotid_imt"}).json()
    assert rows and {r["source_id"] for r in rows} == {"synthetic-us"}
    assert client.get(f"/image/{rows[0]['id']}").status_code == 200
    assert client.get("/image/tech_999").status_code == 404  # 未在合成队列中 → 404，不吞

    probe_only(lambda m: True)  # 真实根有数据 → 合成源让位，同 id 不会指向两个对象
    by_id = {s["id"]: s for s in client.get("/datasources").json()}
    assert by_id["synthetic-us"]["status"] == "empty"
    assert by_id["synthetic-hc"]["status"] == "empty"


def test_synthetic_sources_never_persisted(isolated, probe_only):
    probe_only(lambda m: False)
    reg.register_folder(_natural_folder(isolated), "natural_image")
    import json

    payload = json.loads((isolated / "sources.json").read_text())
    assert all(not s["id"].startswith("synthetic-") for s in payload["sources"])


# --- 删源用例（SDD 10 §15.1 J、D-14）----------------------------------------------


@pytest.mark.parametrize("dropped", ["natural_image", "video", "pathology"])
def test_dropping_a_source_removes_modality_everywhere(dropped, monkeypatch):
    """等价于注释掉 app/sources/__init__.py 的一行登记。"""
    formats = SOURCES[dropped].formats
    monkeypatch.delitem(SOURCES, dropped)
    remaining = dict(SOURCES)
    reg.invalidate_index()
    assert dropped not in reg.MODALITIES
    assert dropped not in {s["modality"] for s in client.get("/datasources").json()}
    assert client.get("/images", params={"modality": dropped}).status_code == 422  # 未注册模态
    assert all(upload_store.modality_of(f"f{ext}") != dropped for ext, _, _ in formats)
    caps = client.get("/capabilities").json()
    dataset_ids = {c["id"] for c in caps if c["kind"] == "dataset"}
    assert dataset_ids == {f"dataset:{s.id}" for s in reg.list_all()}
    # 其余模态照常
    for modality in remaining:
        assert client.get("/images", params={"modality": modality}).status_code == 200
