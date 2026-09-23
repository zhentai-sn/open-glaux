"""统一标注存储（SDD 04 §8/§9/§10）——stdlib sqlite3 单文件 + mask PNG 外挂。

设计不变量：
- 表结构严格对齐 SDD 04 §9.1（CHECK 约束 + ``(image_id, z)`` 索引）；CHECK 取值由
  ``_KINDS``/``_STATUSES``/``_SOURCES`` 生成，不另写一份；
- 库结构版本记在 ``PRAGMA user_version``（当前 ``SCHEMA_VERSION = 1``），打开时单事务升级
  （SDD 10 §9.5）；``z`` 列存对象的当前第三轴取值（volume=z / video=t / slide=level），
  轴名由对象 kind 决定，存储层不知道 kind；
- ``base_seq`` 乐观并发：update/delete 携带的 ``base_seq`` 与当前 ``seq`` 不等 → ``CONFLICT``；
- mask 标注的栅格数据不进表：base64 PNG 落 ``masks/<id>.png``，表内存 ``mask_ref``；
  删标注连带删文件；
- 几何**结构**校验在此（kind 与字段齐备、bbox 区间合法、polygon 点数/闭合），
  坐标**范围**校验（不越图像 dims）在 router——dims 知识不在存储层；
- 领域错误 :class:`AnnotationError` 带机器可读 code（Atlas 范式），router 映射 HTTP。

纯 stdlib（sqlite3），主进程零新依赖（SDD 04 计划 §1.3-4）。
"""

from __future__ import annotations

import base64
import binascii
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

_KINDS = ("bbox", "polyline", "mask", "point")
_STATUSES = ("draft", "confirmed", "suggested", "rejected")
_SOURCES = ("manual", "model", "agent")

#: 库结构版本（``PRAGMA user_version``）。0 = 无版本标记的首版库（kind 三值 CHECK）；
#: 1 = SDD 10 §9.5（kind CHECK 与 ``_KINDS`` 同步，``z`` 列语义为当前第三轴取值）。
SCHEMA_VERSION = 1


def _in_list(values: tuple[str, ...]) -> str:
    return ",".join(f"'{v}'" for v in values)


def _table_ddl(name: str) -> str:
    """建表 DDL——CHECK 取值由常量生成，常量是唯一事实源。"""
    return f"""CREATE TABLE {name} (
    id             TEXT PRIMARY KEY,
    image_id       TEXT NOT NULL,
    z              INTEGER,
    kind           TEXT NOT NULL CHECK(kind IN ({_in_list(_KINDS)})),
    primitive_json TEXT NOT NULL,
    label          TEXT NOT NULL DEFAULT '',
    class_id       INTEGER,
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK(status IN ({_in_list(_STATUSES)})),
    source         TEXT NOT NULL DEFAULT 'manual'
                   CHECK(source IN ({_in_list(_SOURCES)})),
    seq            INTEGER NOT NULL DEFAULT 1,
    mask_ref       TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
)"""


_COLUMNS = (
    "id, image_id, z, kind, primitive_json, label, class_id, "
    "status, source, seq, mask_ref, created_at, updated_at"
)
_INDEXES = ("CREATE INDEX idx_annotations_image ON annotations(image_id, z)",)

#: v0 → v1 的语句序列（单事务内顺序执行；任何一步失败整体回滚）。
_MIGRATE_V0_V1: tuple[str, ...] = (
    _table_ddl("annotations_v1"),
    f"INSERT INTO annotations_v1 ({_COLUMNS}) SELECT {_COLUMNS} FROM annotations",
    "DROP TABLE annotations",
    "ALTER TABLE annotations_v1 RENAME TO annotations",
    *_INDEXES,
)


class AnnotationError(Exception):
    """带机器可读 ``code`` 的领域错误（router 映射为 HTTP 状态）。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_primitive(kind: str, primitive: dict) -> dict:
    """几何结构校验（SDD 04 §13 INVALID_GEOMETRY）——返回规整后的 primitive dict。"""
    if kind not in _KINDS:
        raise AnnotationError("INVALID_GEOMETRY", f"未知标注 kind：{kind!r}（应为 {_KINDS}）")
    if kind == "bbox":
        try:
            x0, y0, x1, y1 = (float(primitive[k]) for k in ("x0", "y0", "x1", "y1"))
        except (KeyError, TypeError, ValueError) as e:
            raise AnnotationError("INVALID_GEOMETRY", f"bbox 需 x0/y0/x1/y1 数值字段：{e}") from e
        if x1 <= x0 or y1 <= y0:
            raise AnnotationError("INVALID_GEOMETRY", f"bbox 区间非法：({x0}, {y0}) → ({x1}, {y1})")
        return {"kind": "bbox", "x0": x0, "y0": y0, "x1": x1, "y1": y1}
    if kind == "polyline":
        pts = primitive.get("points")
        if not isinstance(pts, list) or len(pts) < 3:
            raise AnnotationError("INVALID_GEOMETRY", "polygon 至少 3 个点")
        try:
            pts = [[float(x), float(y)] for x, y in pts]
        except (TypeError, ValueError) as e:
            raise AnnotationError("INVALID_GEOMETRY", f"polygon 点坐标非法：{e}") from e
        if not primitive.get("closed", True):
            raise AnnotationError(
                "INVALID_GEOMETRY", "标注多边形须闭合（closed=true）；开放折线归任务管线"
            )
        return {"kind": "polyline", "closed": True, "points": pts}
    if kind == "point":
        try:
            x, y = float(primitive["x"]), float(primitive["y"])
        except (KeyError, TypeError, ValueError) as e:
            raise AnnotationError("INVALID_GEOMETRY", f"point 需 x/y 数值字段：{e}") from e
        return {"kind": "point", "x": x, "y": y}
    # mask：几何在 PNG 里，primitive 只带 ref（由 store 落盘后填）
    return {"kind": "mask"}


class AnnotationStore:
    """单进程内的 SQLite 标注访问器；``root`` 下建 ``annotations.sqlite`` + ``masks/``。"""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.masks = self.root / "masks"
        self.root.mkdir(parents=True, exist_ok=True)
        self.masks.mkdir(exist_ok=True)
        self._conn = sqlite3.connect(self.root / "annotations.sqlite", check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        try:
            _ensure_schema(self._conn)
        except Exception:
            self._conn.close()
            raise

    # --- 读 ---------------------------------------------------------------

    def get(self, annotation_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM annotations WHERE id = ?", (annotation_id,)
        ).fetchone()
        return _row_to_dict(row) if row else None

    def list(
        self,
        image_id: str,
        z: int | None = None,
        *,
        z_from: int | None = None,
        z_to: int | None = None,
    ) -> list[dict]:
        """某对象的标注；``z`` 精确匹配，``z_from``/``z_to`` 为闭区间（均作用于第三轴列）。

        区间过滤排除 ``z IS NULL`` 的行（未绑定索引的标注不属于任何层/帧）。
        """
        sql = "SELECT * FROM annotations WHERE image_id = ?"
        args: list = [image_id]
        for op, value in (("=", z), (">=", z_from), ("<=", z_to)):
            if value is not None:
                sql += f" AND z {op} ?"
                args.append(value)
        rows = self._conn.execute(sql + " ORDER BY created_at", args).fetchall()
        return [_row_to_dict(r) for r in rows]

    # --- 写 ---------------------------------------------------------------

    def create(
        self,
        *,
        image_id: str,
        kind: str,
        primitive: dict,
        z: int | None = None,
        label: str = "",
        class_id: int | None = None,
        status: str = "draft",
        source: str = "manual",
        mask_png_b64: str | None = None,
    ) -> dict:
        if status not in _STATUSES:
            raise AnnotationError("INVALID_GEOMETRY", f"非法 status：{status!r}")
        if source not in _SOURCES:
            raise AnnotationError("INVALID_GEOMETRY", f"非法 source：{source!r}")
        prim = validate_primitive(kind, primitive)
        ann_id = uuid.uuid4().hex
        mask_ref = None
        if kind == "mask":
            mask_ref = self._save_mask(ann_id, mask_png_b64)
            prim["ref"] = mask_ref
        now = _now()
        self._conn.execute(
            """INSERT INTO annotations
               (id, image_id, z, kind, primitive_json, label, class_id,
                status, source, seq, mask_ref, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)""",
            (
                ann_id, image_id, z, kind, json.dumps(prim), label, class_id,
                status, source, mask_ref, now, now,
            ),
        )
        self._conn.commit()
        return self.get(ann_id)  # type: ignore[return-value]

    def update(
        self,
        annotation_id: str,
        base_seq: int,
        *,
        primitive: dict | None = None,
        label: str | None = None,
        class_id: int | None = None,
        status: str | None = None,
    ) -> dict:
        cur = self.get(annotation_id)
        if cur is None:
            raise AnnotationError("NOT_FOUND", f"标注不存在：{annotation_id}")
        if cur["seq"] != base_seq:
            raise AnnotationError(
                "CONFLICT", f"base_seq 过期（本地 {base_seq}，服务端 {cur['seq']}）——请刷新后重试"
            )
        if status is not None and status not in _STATUSES:
            raise AnnotationError("INVALID_GEOMETRY", f"非法 status：{status!r}")
        kind = cur["primitive"]["kind"]
        new_prim = (
            validate_primitive(kind, primitive) if primitive is not None else cur["primitive"]
        )
        mask_ref = cur.get("mask_ref")
        if primitive is not None and kind == "mask":
            # 换 mask 内容：primitive 携带 mask_png_b64（router 透传）
            mask_ref = self._save_mask(annotation_id, primitive.get("mask_png_b64"))
            new_prim["ref"] = mask_ref
        cur = self._conn.execute(
            """UPDATE annotations
               SET primitive_json = ?, label = ?, class_id = ?, status = ?, mask_ref = ?,
                   seq = seq + 1, updated_at = ?
               WHERE id = ? AND seq = ?""",
            (
                json.dumps(new_prim),
                cur["label"] if label is None else label,
                cur["class_id"] if class_id is None else class_id,
                cur["status"] if status is None else status,
                mask_ref, _now(), annotation_id, base_seq,
            ),
        )
        if cur.rowcount == 0:  # 读后写窗口内被并发改写
            raise AnnotationError("CONFLICT", "并发写入冲突——请刷新后重试")
        self._conn.commit()
        return self.get(annotation_id)  # type: ignore[return-value]

    def delete(self, annotation_id: str, base_seq: int) -> None:
        row = self._conn.execute(
            "SELECT seq, mask_ref FROM annotations WHERE id = ?", (annotation_id,)
        ).fetchone()
        if row is None:
            raise AnnotationError("NOT_FOUND", f"标注不存在：{annotation_id}")
        if row["seq"] != base_seq:
            raise AnnotationError(
                "CONFLICT", f"base_seq 过期（本地 {base_seq}，服务端 {row['seq']}）——请刷新后重试"
            )
        self._conn.execute(
            "DELETE FROM annotations WHERE id = ? AND seq = ?", (annotation_id, base_seq)
        )
        self._conn.commit()
        # mask 文件连带删除（ref 是独立列，不在 primitive 里）
        if row["mask_ref"]:
            p = self.root / row["mask_ref"]
            if p.is_file():
                p.unlink()

    # --- 内部 -------------------------------------------------------------

    def _save_mask(self, annotation_id: str, png_b64: str | None) -> str:
        if not png_b64:
            raise AnnotationError("INVALID_GEOMETRY", "mask 标注须携带 mask_png_b64")
        try:
            data = base64.b64decode(png_b64.split(",")[-1])
        except (binascii.Error, ValueError) as e:
            raise AnnotationError("INVALID_GEOMETRY", f"mask_png_b64 解码失败：{e}") from e
        if data[:8] != b"\x89PNG\r\n\x1a\n":
            raise AnnotationError("INVALID_GEOMETRY", "mask_png_b64 非 PNG 数据")
        rel = f"masks/{annotation_id}.png"
        (self.root / rel).write_bytes(data)
        return rel


def _ensure_schema(conn: sqlite3.Connection) -> None:
    """按 ``PRAGMA user_version`` 建库或升级（SDD 10 §9.5）；已是当前版本则不做任何事。

    升级在单个显式事务内完成（建新表 → 拷数据 → 删旧表 → 改名 → 重建索引 → 置版本号），
    任一步失败整体回滚并抛出：拒绝启动，原库保持原样，不做部分迁移。
    """
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version == SCHEMA_VERSION:
        return
    if version > SCHEMA_VERSION:
        raise RuntimeError(
            f"标注库版本 {version} 高于本程序支持的 {SCHEMA_VERSION}——拒绝以旧程序打开新库"
        )
    has_table = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'annotations'"
    ).fetchone()
    if has_table:
        steps: tuple[str, ...] = _MIGRATE_V0_V1
    else:
        steps = (_table_ddl("annotations"), *_INDEXES)
    # 显式事务：sqlite3 模块的隐式事务不包 DDL，这里接管事务边界。
    saved = conn.isolation_level
    conn.isolation_level = None
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for stmt in steps:
                conn.execute(stmt)
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.isolation_level = saved


def _row_to_dict(row: sqlite3.Row) -> dict:
    prim = json.loads(row["primitive_json"])
    prim.setdefault("id", row["id"])
    prim.setdefault("role", row["kind"])
    return {
        "id": row["id"],
        "image_id": row["image_id"],
        "z": row["z"],
        "primitive": prim,
        "label": row["label"],
        "class_id": row["class_id"],
        "status": row["status"],
        "source": row["source"],
        "seq": row["seq"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
