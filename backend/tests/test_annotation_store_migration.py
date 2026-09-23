"""标注库 SQLite 迁移（SDD 10 §9.5 / §15.1 K）——user_version 0 → 1。"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.annotations import store as store_mod
from app.annotations.store import AnnotationStore

#: v0 夹具：迁移前 store.py 的 ``_SCHEMA`` 原文（kind 三值 CHECK，无 user_version）。
_V0_SCHEMA = """
CREATE TABLE IF NOT EXISTS annotations (
    id             TEXT PRIMARY KEY,
    image_id       TEXT NOT NULL,
    z              INTEGER,
    kind           TEXT NOT NULL CHECK(kind IN ('bbox','polyline','mask')),
    primitive_json TEXT NOT NULL,
    label          TEXT NOT NULL DEFAULT '',
    class_id       INTEGER,
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK(status IN ('draft','confirmed','suggested','rejected')),
    source         TEXT NOT NULL DEFAULT 'manual'
                   CHECK(source IN ('manual','model','agent')),
    seq            INTEGER NOT NULL DEFAULT 1,
    mask_ref       TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_annotations_image ON annotations(image_id, z);
"""

_V0_ROWS = [
    ("a1", "ct_001", 3, "bbox", '{"kind": "bbox", "x0": 1.0, "y0": 1.0, "x1": 5.0, "y1": 5.0}',
     "斑块", 2, "confirmed", "manual", 4, None, "2026-01-01T00:00:00+00:00",
     "2026-01-02T00:00:00+00:00"),
    ("a2", "tech_001", None, "polyline",
     '{"kind": "polyline", "closed": true, "points": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0]]}',
     "", None, "suggested", "agent", 1, None, "2026-01-03T00:00:00+00:00",
     "2026-01-03T00:00:00+00:00"),
    ("a3", "tech_001", None, "mask", '{"kind": "mask", "ref": "masks/a3.png"}',
     "lesion", 1, "draft", "model", 2, "masks/a3.png", "2026-01-04T00:00:00+00:00",
     "2026-01-04T00:00:00+00:00"),
]


def _db(root: Path) -> Path:
    return root / "annotations.sqlite"


def _make_v0(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(_db(root))
    conn.executescript(_V0_SCHEMA)
    conn.executemany("INSERT INTO annotations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", _V0_ROWS)
    conn.commit()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 0
    conn.close()


def _raw(root: Path, sql: str, args: tuple = ()) -> list[tuple]:
    conn = sqlite3.connect(_db(root))
    try:
        return conn.execute(sql, args).fetchall()
    finally:
        conn.close()


def _indexes(root: Path) -> dict[str, str]:
    """annotations 表上的显式索引（排除主键自动索引）→ 建索引 SQL。"""
    rows = _raw(
        root,
        "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='annotations'"
        " AND sql IS NOT NULL",
    )
    return dict(rows)


def _version(root: Path) -> int:
    return _raw(root, "PRAGMA user_version")[0][0]


def _table_sql(root: Path) -> str:
    sql = "SELECT sql FROM sqlite_master WHERE type='table' AND name='annotations'"
    return _raw(root, sql)[0][0]


def test_new_database_created_at_current_version(tmp_path):
    AnnotationStore(tmp_path)
    assert _version(tmp_path) == store_mod.SCHEMA_VERSION == 1
    assert "'point'" in _table_sql(tmp_path)
    assert list(_indexes(tmp_path)) == ["idx_annotations_image"]


def test_check_constraint_generated_from_kinds(tmp_path):
    AnnotationStore(tmp_path)
    sql = _table_sql(tmp_path)
    assert f"CHECK(kind IN ({','.join(repr(k) for k in store_mod._KINDS)}))" in sql


def test_v0_database_migrates(tmp_path):
    _make_v0(tmp_path)
    before = _raw(tmp_path, "SELECT * FROM annotations ORDER BY id")
    s = AnnotationStore(tmp_path)

    assert _version(tmp_path) == 1
    # 老数据逐列不变（含 mask 行的 mask_ref、seq、时间戳）
    assert _raw(tmp_path, "SELECT * FROM annotations ORDER BY id") == before
    a1 = s.get("a1")
    assert (a1["z"], a1["seq"], a1["label"], a1["status"]) == (3, 4, "斑块", "confirmed")
    assert s.get("a3")["primitive"]["ref"] == "masks/a3.png"
    assert [a["id"] for a in s.list("tech_001")] == ["a2", "a3"]
    # 新 kind 可写
    p = s.create(image_id="tech_001", kind="point", primitive={"x": 1, "y": 2})
    assert p["primitive"]["kind"] == "point"
    # 索引重建、临时表不残留
    idx = _indexes(tmp_path)
    assert list(idx) == ["idx_annotations_image"]
    assert "(image_id, z)" in idx["idx_annotations_image"]
    names = {n for (n,) in _raw(tmp_path, "SELECT name FROM sqlite_master")}
    assert "annotations_v1" not in names


def test_reopen_does_not_rerun_migration(tmp_path, monkeypatch):
    _make_v0(tmp_path)
    AnnotationStore(tmp_path)
    rowids = _raw(tmp_path, "SELECT rowid, id FROM annotations ORDER BY rowid")

    def _boom(*_a, **_k):
        raise AssertionError("迁移不应再次执行")

    monkeypatch.setattr(store_mod, "_MIGRATE_V0_V1", ("SELECT boom()",))
    monkeypatch.setattr(store_mod, "_table_ddl", _boom)
    s = AnnotationStore(tmp_path)
    assert _version(tmp_path) == 1
    assert _raw(tmp_path, "SELECT rowid, id FROM annotations ORDER BY rowid") == rowids
    assert s.get("a1") is not None


def test_failed_migration_rolls_back(tmp_path, monkeypatch):
    """删表、改名之后再失败：整体回滚，原库仍是 v0 且可读；拒绝启动。"""
    _make_v0(tmp_path)
    before = _raw(tmp_path, "SELECT * FROM annotations ORDER BY id")
    v0_sql = _table_sql(tmp_path)
    steps = store_mod._MIGRATE_V0_V1
    rename = next(i for i, s in enumerate(steps) if s.startswith("ALTER TABLE"))
    monkeypatch.setattr(
        store_mod,
        "_MIGRATE_V0_V1",
        (*steps[: rename + 1], "INSERT INTO no_such_table VALUES (1)", *steps[rename + 1 :]),
    )
    with pytest.raises(sqlite3.OperationalError):
        AnnotationStore(tmp_path)

    assert _version(tmp_path) == 0
    assert _table_sql(tmp_path) == v0_sql
    assert _raw(tmp_path, "SELECT * FROM annotations ORDER BY id") == before
    names = {n for (n,) in _raw(tmp_path, "SELECT name FROM sqlite_master")}
    assert names == {"annotations", "idx_annotations_image", "sqlite_autoindex_annotations_1"}

    # 修复后（撤掉故障注入）可正常升级
    monkeypatch.setattr(store_mod, "_MIGRATE_V0_V1", steps)
    AnnotationStore(tmp_path)
    assert _version(tmp_path) == 1


def test_newer_database_refused(tmp_path):
    tmp_path.mkdir(exist_ok=True)
    conn = sqlite3.connect(_db(tmp_path))
    conn.execute("PRAGMA user_version = 99")
    conn.close()
    with pytest.raises(RuntimeError):
        AnnotationStore(tmp_path)
    assert _version(tmp_path) == 99


def test_point_validation():
    assert store_mod.validate_primitive("point", {"x": "1", "y": 2}) == {
        "kind": "point", "x": 1.0, "y": 2.0,
    }
    for bad in ({}, {"x": 1}, {"x": "a", "y": 1}, {"x": None, "y": 1}):
        with pytest.raises(store_mod.AnnotationError) as ei:
            store_mod.validate_primitive("point", bad)
        assert ei.value.code == "INVALID_GEOMETRY"
