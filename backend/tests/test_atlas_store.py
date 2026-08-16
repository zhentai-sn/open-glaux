"""Atlas 存储层（T1）：幂等键、标签归一、FTS 检索、egress/status 过滤、下架/恢复/删除门禁。

对应 SDD 03 §15：同图同 ROI 重复导入同 id；标签归一检索一致；search 只返 active 且按 egress 过滤；
下架不可检索、恢复可检索；被引用过的不可硬删；检索链路不加载 torch。
"""

from __future__ import annotations

import io
import sys

import pytest
from PIL import Image

from app.atlas.images import ImageStore, clamp_roi
from app.atlas.store import AtlasError, AtlasStore, NewExemplar
from app.atlas.text import build_search_text, normalize_tag, normalize_tags


def _png(w: int = 64, h: int = 48, val: int = 120) -> bytes:
    im = Image.new("L", (w, h), val)
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


@pytest.fixture
def store(tmp_path):
    return AtlasStore(tmp_path / "atlas").open()


@pytest.fixture
def images(tmp_path):
    return ImageStore(tmp_path / "atlas")


def _new(images: ImageStore, **kw) -> NewExemplar:
    ref, sha, _ = images.save_original(kw.pop("png", _png()))
    base = dict(
        image_ref=ref,
        image_sha256=sha,
        roi=(4, 4, 20, 16),
        tags=["TEM", "电子致密物"],
        source_type="textbook",
        source={"book": "肾脏病理学", "page": 12},
        import_batch_id="b1",
        caption="上皮下电子致密物沉积",
    )
    base.update(kw)
    return NewExemplar(**base)


# --- 纯函数 ------------------------------------------------------------------


def test_normalize_tag_trim_fullwidth_casefold():
    assert normalize_tag("  电子致密物 ") == "电子致密物"
    assert normalize_tag("ＴＥＭ") == "tem"  # 全角 → 半角 + casefold
    assert normalize_tag("Tem") == normalize_tag("TEM")
    tags, raw = normalize_tags(["TEM", " tem", "电子致密物", ""])
    assert tags == ["tem", "电子致密物"] and raw == ["TEM", "电子致密物"]


def test_build_search_text_takes_only_sdd_fields():
    d = {
        "modality": "TEM",
        "summary": "上皮下沉积",
        "findings": [{"name": "电子致密物", "location": "上皮下"}],
        "extra": {"magnification": "x8000", "nested": ["a", {"b": "c"}]},
        "pattern": "颗粒状",
    }
    t = build_search_text("图注", d, "备注")
    assert "图注" in t and "上皮下沉积" in t and "电子致密物" in t and "x8000" in t and "c" in t
    assert "TEM" not in t and "颗粒状" not in t and "备注" in t


def test_clamp_roi():
    assert clamp_roi((-5, -5, 20, 20), (10, 10)) == (0, 0, 10, 10)
    with pytest.raises(ValueError):
        clamp_roi((50, 50, 5, 5), (10, 10))


# --- 图像落盘 -----------------------------------------------------------------


def test_image_store_dedupes_and_crops(images):
    ref1, sha1, size = images.save_original(_png())
    ref2, sha2, _ = images.save_original(_png())
    assert ref1 == ref2 and sha1 == sha2 and size == (64, 48)
    crop = images.save_crop(ref1, sha1, (4, 4, 20, 16))
    with Image.open(images.abs_path(crop)) as im:
        assert im.size == (20, 16)
    assert images.save_crop(ref1, sha1, (4, 4, 20, 16)) == crop


# --- 写入幂等 -----------------------------------------------------------------


def test_create_is_idempotent_on_source_sha_roi(store, images):
    a = store.create([_new(images)])
    b = store.create([_new(images)])
    assert a[0][1] is True and b[0][1] is False and a[0][0] == b[0][0]
    # 不同 ROI 视为不同标记（同图多标记）
    c = store.create([_new(images, roi=(30, 10, 10, 10))])
    assert c[0][1] is True and c[0][0] != a[0][0]
    assert store.exemplars.count_rows() == 2


def test_shareable_requires_consent(store, images):
    with pytest.raises(AtlasError) as ei:
        store.create([_new(images, egress="shareable")])
    assert ei.value.code == "CONSENT_REQUIRED"
    ok = store.create(
        [
            _new(
                images,
                egress="shareable",
                egress_consent={"confirmed_at": "2026-08-16T00:00:00Z", "statement_version": "v1"},
            )
        ]
    )
    ex = store.get(ok[0][0])
    assert ex.egress == "shareable" and ex.egress_consent["statement_version"] == "v1"


def test_tags_required(store, images):
    with pytest.raises(AtlasError) as ei:
        store.create([_new(images, tags=["  ", ""])])
    assert ei.value.code == "TAGS_REQUIRED"


# --- 检索 -------------------------------------------------------------------


def _seed(store, images):
    consent = {"confirmed_at": "2026-08-16T00:00:00Z", "statement_version": "v1"}
    ids = {}
    ids["sub_epi"] = store.create(
        [
            _new(
                images,
                png=_png(val=10),
                roi=(1, 1, 5, 5),
                caption="上皮下电子致密物沉积",
                tags=["TEM", "EDD"],
                egress="shareable",
                egress_consent=consent,
            )
        ]
    )[0][0]
    ids["sub_endo"] = store.create(
        [
            _new(
                images,
                png=_png(val=20),
                roi=(1, 1, 5, 5),
                caption="内皮下电子致密物",
                tags=["tem"],
                egress="shareable",
                egress_consent=consent,
            )
        ]
    )[0][0]
    ids["mesangial"] = store.create(
        [
            _new(
                images,
                png=_png(val=30),
                roi=(1, 1, 5, 5),
                caption="系膜区增宽",
                tags=["TEM"],
                egress="shareable",
                egress_consent=consent,
            )
        ]
    )[0][0]
    ids["local"] = store.create(
        [
            _new(
                images,
                png=_png(val=40),
                roi=(1, 1, 5, 5),
                caption="电子致密物 教科书局部图",
                tags=["tem", "edd"],
                egress="local-only",
            )
        ]
    )[0][0]
    return ids


def test_search_text_chinese_ngram_and_tag_ranking(store, images):
    ids = _seed(store, images)
    got = store.search(tags=["EDD"], q="电子致密物", egress="any")
    got_ids = [e.exemplar_id for e in got]
    # SDD §7.2：有标签命中时按标签过滤（sub_epi、local 含 EDD 且文本命中）；
    # 仅文本命中的 sub_endo 不进
    assert set(got_ids) == {ids["sub_epi"], ids["local"]}
    # 无标签约束时，文本命中三条、系膜不含关键词
    text_only = [e.exemplar_id for e in store.search(q="电子致密物", egress="any")]
    assert set(text_only) == {ids["sub_epi"], ids["local"], ids["sub_endo"]}


def test_search_tag_normalization_consistent(store, images):
    _seed(store, images)
    a = [e.exemplar_id for e in store.search(tags=["电子致密物"], egress="any")]
    b = [e.exemplar_id for e in store.search(tags=["电子致密物 "], egress="any")]
    c = [e.exemplar_id for e in store.search(tags=["ＥＤＤ"], egress="any")]
    d = [e.exemplar_id for e in store.search(tags=["edd"], egress="any")]
    assert a == b and c == d and len(d) == 2


def test_search_egress_filters_local_only(store, images):
    ids = _seed(store, images)
    shareable = {e.exemplar_id for e in store.search(q="电子致密物", egress="shareable")}
    assert ids["local"] not in shareable and ids["sub_epi"] in shareable
    anyq = {e.exemplar_id for e in store.search(q="电子致密物", egress="any")}
    assert ids["local"] in anyq


def test_search_falls_back_to_text_when_tags_miss(store, images):
    ids = _seed(store, images)
    got = [e.exemplar_id for e in store.search(tags=["不存在的标签"], q="系膜", egress="any")]
    assert got == [ids["mesangial"]]


def test_search_without_query_lists_recent_filtered(store, images):
    ids = _seed(store, images)
    got = store.search(tags=["edd"], egress="any")
    assert {e.exemplar_id for e in got} == {ids["sub_epi"], ids["local"]}


def test_search_limit_cap(store, images):
    _seed(store, images)
    assert len(store.search(egress="any", limit=999)) <= 50


# --- 状态与删除门禁 ---------------------------------------------------------------


def test_retire_hides_from_search_and_restore_brings_back(store, images):
    ids = _seed(store, images)
    store.retire(ids["sub_epi"])
    assert ids["sub_epi"] not in {e.exemplar_id for e in store.search(q="电子致密物", egress="any")}
    assert store.get(ids["sub_epi"]).status == "retired"
    assert ids["sub_epi"] in {e.exemplar_id for e in store.list(status="retired")}
    store.restore(ids["sub_epi"])
    assert ids["sub_epi"] in {e.exemplar_id for e in store.search(q="电子致密物", egress="any")}


def test_delete_blocked_when_referenced(store, images):
    ids = _seed(store, images)
    assert store.mark_referenced([ids["sub_epi"], ids["sub_epi"], ""], trace_id="t-1") == 1
    with pytest.raises(AtlasError) as ei:
        store.delete(ids["sub_epi"])
    assert ei.value.code == "REFERENCED"
    store.delete(ids["mesangial"])  # 从未被引用 → 可硬删
    assert store.get(ids["mesangial"]) is None
    with pytest.raises(AtlasError):
        store.delete("nope")


def test_set_description_updates_search_text(store, images):
    ids = _seed(store, images)
    assert store.get(ids["mesangial"]).describe_status == "pending"
    store.set_description(
        ids["mesangial"],
        {"summary": "系膜基质增多", "findings": [{"name": "系膜增生"}], "extra": {}},
        "done",
    )
    ex = store.get(ids["mesangial"])
    assert ex.describe_status == "done" and ex.description["summary"] == "系膜基质增多"
    assert ids["mesangial"] in {e.exemplar_id for e in store.search(q="系膜增生", egress="any")}


def test_tag_counts(store, images):
    _seed(store, images)
    counts = dict(store.tag_counts())
    assert counts["tem"] == 4 and counts["edd"] == 2


def test_reopen_persists(tmp_path, images):
    s1 = AtlasStore(tmp_path / "atlas").open()
    eid = s1.create([_new(images)])[0][0]
    s2 = AtlasStore(tmp_path / "atlas").open()
    assert s2.get(eid) is not None
    assert s2.create([_new(images)])[0] == (eid, False)


def test_search_path_does_not_import_torch(store, images):
    _seed(store, images)
    store.search(q="电子致密物", egress="any")
    assert "torch" not in sys.modules and "tensorflow" not in sys.modules


# --- 图册 collection（v1.1，SDD 03 D-20 / §7.5a / §15 v1.1） -----------------------------


def test_normalize_collection_segments_fullwidth_and_case():
    from app.atlas.text import normalize_collection

    assert normalize_collection(None) == ("", "")
    assert normalize_collection("  ") == ("", "")
    d, k = normalize_collection(" 肾脏 / 膜性肾病 ／ EDD ")
    assert d == "肾脏/膜性肾病/EDD"
    assert k == "肾脏/膜性肾病/edd"
    assert normalize_collection("肾脏／膜性肾病")[1] == normalize_collection("肾脏/膜性肾病")[1]
    assert normalize_collection("Kidney/MN")[1] == normalize_collection("kidney/mn")[1]
    assert normalize_collection("//a//b/")[0] == "a/b"


def test_collection_prefix_filter_counts_and_move(store, images):
    ((a, _),) = store.create([_new(images, png=_png(val=1), collection="肾脏/膜性肾病/EDD")])
    ((b, _),) = store.create([_new(images, png=_png(val=2), collection="肾脏／膜性肾病")])
    ((c, _),) = store.create([_new(images, png=_png(val=3), collection="肾脏/IgA")])
    ((d, _),) = store.create([_new(images, png=_png(val=4))])  # 根目录

    ids = lambda rows: sorted(e.exemplar_id for e in rows)  # noqa: E731
    assert ids(store.list(collection="肾脏/膜性肾病")) == sorted([a, b])
    assert ids(store.list(collection="肾脏")) == sorted([a, b, c])
    assert ids(store.list(collection="肾脏/膜性肾病/EDD")) == [a]
    assert ids(store.list(collection="")) == sorted([a, b, c, d])  # 根 = 全部
    assert ids(store.list(collection="", collection_exact=True)) == [d]  # 未分册
    assert (
        ids(
            store.list(
                collection="肾脏/膜性",
            )
        )
        == []
    )  # 前缀按段而非字符

    # search 也按图册限定范围
    hit = store.search(q="电子致密物", egress="any", collection="肾脏/IgA")
    assert ids(hit) == [c]

    counts = {k: (disp, n) for disp, k, n in store.collection_counts()}
    assert counts["肾脏/膜性肾病/edd"] == ("肾脏/膜性肾病/EDD", 1)
    assert counts["肾脏/膜性肾病"][1] == 1
    assert counts[""][1] == 1

    # 移动：id 不变、幂等键不变（重复导入仍返回同 id）、引用不变
    store.mark_referenced([d], "t1")
    moved = store.set_collection(d, "肾脏/膜性肾病")
    assert moved.exemplar_id == d and moved.collection == "肾脏/膜性肾病"
    assert ids(store.list(collection="肾脏/膜性肾病")) == sorted([a, b, d])
    ((again, created),) = store.create([_new(images, png=_png(val=4), collection="别的图册")])
    assert (again, created) == (d, False)
    assert store.is_referenced(d)


def test_old_table_without_collection_column_is_migrated(tmp_path, images):
    """旧库（v1 schema，无 collection 列）打开时补列，旧案例落在根目录（未分册）。"""
    import lancedb

    from app.atlas import store as store_mod

    root = tmp_path / "atlas"
    (root / "db").mkdir(parents=True)
    old_schema = store_mod._EXEMPLARS_SCHEMA.remove(
        store_mod._EXEMPLARS_SCHEMA.get_field_index("collection_key")
    )
    old_schema = old_schema.remove(old_schema.get_field_index("collection"))
    db = lancedb.connect(str(root / "db"))
    tbl = db.create_table("exemplars", schema=old_schema)
    ref, sha, _ = images.save_original(_png(val=9))
    tbl.add(
        [
            {
                "exemplar_id": "old-1",
                "dedupe_key": "k",
                "image_ref": ref,
                "crop_ref": "",
                "image_sha256": sha,
                "roi": [1, 1, 5, 5],
                "geometry_json": "",
                "tags": ["tem"],
                "tags_raw": ["TEM"],
                "caption": "old",
                "notes": "",
                "description_json": "",
                "describe_status": "pending",
                "search_text": "old",
                "source_type": "textbook",
                "source_json": "{}",
                "egress": "local-only",
                "egress_consent_json": "",
                "status": "active",
                "created_at": "2026-08-15T00:00:00+00:00",
                "import_batch_id": "b0",
            }
        ]
    )
    db.create_table("exemplar_refs", schema=store_mod._REFS_SCHEMA)

    s = AtlasStore(root).open()
    assert "collection" in s.exemplars.schema.names
    ex = s.get("old-1")
    assert ex is not None and ex.collection == "" and ex.collection_key == ""
    assert [e.exemplar_id for e in s.list(collection="", collection_exact=True)] == ["old-1"]
    assert s.collection_counts() == [("", "", 1)]
