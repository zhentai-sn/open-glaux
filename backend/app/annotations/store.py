"""统一标注存储（SDD 04 §8/§9/§10）——stdlib sqlite3 单文件 + mask PNG 外挂。

设计不变量：
- 表结构严格对齐 SDD 04 §9.1（CHECK 约束 + ``(image_id, z)`` 索引）；CHECK 取值由
  ``_KINDS``/``_STATUSES``/``_SOURCES`` 生成，不另写一份；
- 库结构版本记在 ``PRAGMA user_version``（当前 ``SCHEMA_VERSION = 2``），打开时单事务升级
  （SDD 10 §9.5）；``z`` 列存对象的当前第三轴取值（volume=z / video=t / slide=level），
  轴名由对象 kind 决定，存储层不知道 kind；
- ``base_seq`` 乐观并发：update/delete 携带的 ``base_seq`` 与当前 ``seq`` 不等 → ``CONFLICT``；
- mask 标注的栅格数据不进表：base64 PNG 落 ``masks/<id>.png``，表内存 ``mask_ref``；
  删标注连带删文件；
- 几何**结构**校验在此（kind 与字段齐备、bbox 区间合法、polygon 点数/闭合），
  坐标**范围**校验（不越图像 dims）在 router——dims 知识不在存储层；
- 领域错误 :class:`AnnotationError` 带机器可读 code（Atlas 范式），router 映射 HTTP；
- 标签目录（SDD 23）与标注同库：``labels`` 表按作用域（``project_id`` 或 ``global``）存放，
  标注以 ``label_id`` 引用；读取时名称与颜色取目录当前值。作用域解析不在存储层。

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
#: 1 = SDD 10 §9.5（kind CHECK 与 ``_KINDS`` 同步，``z`` 列语义为当前第三轴取值）；
#: 2 = SDD 23（``labels`` 表与 ``annotations.label_id``）。
SCHEMA_VERSION = 2

#: 新建标签未给颜色时按目录现有条数轮换取色（SDD 23 §7.1 规则 5）。
PALETTE = (
    "#E4572E", "#17BEBB", "#FFC914", "#2E86AB", "#76B041", "#A23B72",
    "#F18F01", "#3B1F2B", "#6C8EAD", "#C73E1D", "#59CD90", "#8E7DBE",
)
NAME_MAX = 64
DESCRIPTION_MAX = 500


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

#: v1 → v2：标签目录（SDD 23 §9.1）。``name_key`` 为去空白后 casefold 的名称，作用域内唯一。
_MIGRATE_V1_V2: tuple[str, ...] = (
    """CREATE TABLE labels (
    id          TEXT PRIMARY KEY,
    scope       TEXT NOT NULL,
    name        TEXT NOT NULL,
    name_key    TEXT NOT NULL,
    color       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort        INTEGER NOT NULL,
    seq         INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    UNIQUE(scope, name_key)
)""",
    "ALTER TABLE annotations ADD COLUMN label_id TEXT",
    "CREATE INDEX idx_annotations_label ON annotations(label_id)",
)

#: v0 → v1 的语句序列（单事务内顺序执行；任何一步失败整体回滚）。
_MIGRATE_V0_V1: tuple[str, ...] = (
    _table_ddl("annotations_v1"),
    f"INSERT INTO annotations_v1 ({_COLUMNS}) SELECT {_COLUMNS} FROM annotations",
    "DROP TABLE annotations",
    "ALTER TABLE annotations_v1 RENAME TO annotations",
    *_INDEXES,
)


#: 未指定参数的占位（区别于显式 ``None``）。
KEEP = object()


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
            f"{_SELECT_ANN} WHERE a.id = ?", (annotation_id,)
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
        sql = f"{_SELECT_ANN} WHERE a.image_id = ?"
        args: list = [image_id]
        for op, value in (("=", z), (">=", z_from), ("<=", z_to)):
            if value is not None:
                sql += f" AND a.z {op} ?"
                args.append(value)
        rows = self._conn.execute(sql + " ORDER BY a.created_at", args).fetchall()
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
        label_id: str | None = None,
    ) -> dict:
        if label_id is not None:
            label = self._label_row(label_id)["name"]
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
                status, source, seq, mask_ref, created_at, updated_at, label_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)""",
            (
                ann_id, image_id, z, kind, json.dumps(prim), label, class_id,
                status, source, mask_ref, now, now, label_id,
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
        label_id: str | None | object = KEEP,
    ) -> dict:
        """``label_id`` 缺省 :data:`KEEP` 不改，``None`` 清除引用；给 id 时 ``label`` 写入目录名称。

        """
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
        new_label_id = cur["label_id"] if label_id is KEEP else label_id
        if label_id is not KEEP and label_id is not None:
            label = self._label_row(label_id)["name"]  # type: ignore[arg-type]
        elif label is None:
            label = cur["label_stored"]
        mask_ref = cur.get("mask_ref")
        if primitive is not None and kind == "mask":
            # 换 mask 内容：primitive 携带 mask_png_b64（router 透传）
            mask_ref = self._save_mask(annotation_id, primitive.get("mask_png_b64"))
            new_prim["ref"] = mask_ref
        cur = self._conn.execute(
            """UPDATE annotations
               SET primitive_json = ?, label = ?, class_id = ?, status = ?, mask_ref = ?,
                   label_id = ?, seq = seq + 1, updated_at = ?
               WHERE id = ? AND seq = ?""",
            (
                json.dumps(new_prim),
                label,
                cur["class_id"] if class_id is None else class_id,
                cur["status"] if status is None else status,
                mask_ref, new_label_id, _now(), annotation_id, base_seq,
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

    # --- 标签目录（SDD 23 §7.1）-------------------------------------------

    def label_scope(self, label_id: str) -> str:
        return self._label_row(label_id)["scope"]

    def list_labels(self, scope: str) -> list[dict]:
        """作用域内的标签，按 ``sort`` 排序；``count`` 为引用它的非驳回标注条数。"""
        rows = self._conn.execute(
            """SELECT l.*, (SELECT COUNT(*) FROM annotations a
                              WHERE a.label_id = l.id AND a.status != 'rejected') AS count
               FROM labels l WHERE l.scope = ? ORDER BY l.sort, l.created_at""",
            (scope,),
        ).fetchall()
        return [_label_to_dict(r) for r in rows]

    def get_label(self, label_id: str) -> dict:
        row = self._conn.execute(
            """SELECT l.*, (SELECT COUNT(*) FROM annotations a
                              WHERE a.label_id = l.id AND a.status != 'rejected') AS count
               FROM labels l WHERE l.id = ?""",
            (label_id,),
        ).fetchone()
        if row is None:
            raise AnnotationError("NOT_FOUND", f"标签不存在：{label_id}")
        return _label_to_dict(row)

    def find_label(self, scope: str, name: str) -> dict | None:
        """按名称（去空白、不区分大小写）在作用域内精确查找。"""
        row = self._conn.execute(
            "SELECT id FROM labels WHERE scope = ? AND name_key = ?", (scope, _name_key(name))
        ).fetchone()
        return self.get_label(row["id"]) if row else None

    def create_label(
        self, scope: str, name: str, color: str | None = None, description: str = ""
    ) -> dict:
        name = _clean_name(name)
        description = _clean_description(description)
        existing = self.find_label(scope, name)
        if existing is not None:
            raise LabelExists(existing)
        n = self._conn.execute(
            "SELECT COUNT(*), COALESCE(MAX(sort), -1) FROM labels WHERE scope = ?", (scope,)
        ).fetchone()
        color = _clean_color(color) if color else PALETTE[n[0] % len(PALETTE)]
        label_id = f"lbl-{uuid.uuid4().hex[:8]}"
        now = _now()
        self._conn.execute(
            """INSERT INTO labels (id, scope, name, name_key, color, description, sort,
                                    seq, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)""",
            (label_id, scope, name, _name_key(name), color, description, n[1] + 1, now, now),
        )
        self._conn.commit()
        return self.get_label(label_id)

    def update_label(
        self,
        label_id: str,
        base_seq: int,
        *,
        name: str | None = None,
        color: str | None = None,
        description: str | None = None,
        sort: int | None = None,
    ) -> dict:
        cur = self._label_row(label_id)
        if cur["seq"] != base_seq:
            raise _stale_label(base_seq, cur["seq"])
        new_name = cur["name"] if name is None else _clean_name(name)
        if name is not None:
            other = self.find_label(cur["scope"], new_name)
            if other is not None and other["id"] != label_id:
                raise LabelExists(other)
        res = self._conn.execute(
            """UPDATE labels SET name = ?, name_key = ?, color = ?, description = ?, sort = ?,
                                  seq = seq + 1, updated_at = ?
               WHERE id = ? AND seq = ?""",
            (
                new_name, _name_key(new_name),
                cur["color"] if color is None else _clean_color(color),
                cur["description"] if description is None else _clean_description(description),
                cur["sort"] if sort is None else int(sort),
                _now(), label_id, base_seq,
            ),
        )
        if res.rowcount == 0:
            raise AnnotationError("CONFLICT", "并发写入冲突——请刷新后重试")
        self._conn.commit()
        return self.get_label(label_id)

    def delete_label(self, label_id: str, base_seq: int) -> None:
        """有非驳回标注引用时拒绝（``IN_USE``，SDD 23 §7.1 规则 7）；驳回标注的引用一并清除。"""
        cur = self.get_label(label_id)
        if cur["seq"] != base_seq:
            raise _stale_label(base_seq, cur["seq"])
        if cur["count"] > 0:
            raise LabelInUse(cur["count"])
        with self._conn:
            self._conn.execute(
                "UPDATE annotations SET label_id = NULL WHERE label_id = ?", (label_id,)
            )
            self._conn.execute("DELETE FROM labels WHERE id = ? AND seq = ?", (label_id, base_seq))

    def merge_label(self, label_id: str, base_seq: int, into: str) -> dict:
        """把 ``label_id`` 的全部标注改为引用 ``into`` 并删除前者；同一事务（§7.1 规则 8）。"""
        src = self._label_row(label_id)
        dst = self._label_row(into)
        if src["seq"] != base_seq:
            raise _stale_label(base_seq, src["seq"])
        if label_id == into:
            raise AnnotationError("INVALID_LABEL", "不能合并到自身")
        if src["scope"] != dst["scope"]:
            raise AnnotationError("INVALID_LABEL", "只能合并同一目录内的标签")
        now = _now()
        with self._conn:
            self._conn.execute(
                """UPDATE annotations SET label_id = ?, label = ?, seq = seq + 1, updated_at = ?
                   WHERE label_id = ?""",
                (into, dst["name"], now, label_id),
            )
            self._conn.execute("DELETE FROM labels WHERE id = ?", (label_id,))
        return self.get_label(into)

    # --- 内部 -------------------------------------------------------------

    def _label_row(self, label_id: str) -> sqlite3.Row:
        row = self._conn.execute("SELECT * FROM labels WHERE id = ?", (label_id,)).fetchone()
        if row is None:
            raise AnnotationError("INVALID_LABEL", f"标签不存在：{label_id}")
        return row

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
    if not has_table:
        steps: tuple[str, ...] = (_table_ddl("annotations"), *_INDEXES, *_MIGRATE_V1_V2)
    elif version == 0:
        steps = (*_MIGRATE_V0_V1, *_MIGRATE_V1_V2)
    else:
        steps = _MIGRATE_V1_V2
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


#: 标注读取一律带目录名称与颜色（SDD 23 §7.1 规则 6：名称取目录当前值）。
_SELECT_ANN = (
    "SELECT a.*, l.name AS label_name, l.color AS label_color "
    "FROM annotations a LEFT JOIN labels l ON l.id = a.label_id"
)


class LabelExists(AnnotationError):
    """作用域内已有同名标签；带上已有标签，调用方可直接选用（SDD 23 §10）。"""

    def __init__(self, label: dict):
        super().__init__("LABEL_EXISTS", f"已有同名标签：{label['name']}")
        self.label = label


class LabelInUse(AnnotationError):
    def __init__(self, count: int):
        super().__init__("LABEL_IN_USE", f"有 {count} 条标注使用该标签，可合并到其他标签")
        self.count = count


def _stale_label(base_seq: int, seq: int) -> AnnotationError:
    return AnnotationError("CONFLICT", f"标签 base_seq 过期（本地 {base_seq}，服务端 {seq}）")


def _name_key(name: str) -> str:
    return name.strip().casefold()


def _clean_name(name: str) -> str:
    name = (name or "").strip()
    if not 1 <= len(name) <= NAME_MAX:
        raise AnnotationError("INVALID_LABEL", f"标签名称长度须 1～{NAME_MAX}")
    return name


def _clean_description(text: str) -> str:
    text = (text or "").strip()
    if len(text) > DESCRIPTION_MAX:
        raise AnnotationError("INVALID_LABEL", f"标签说明最多 {DESCRIPTION_MAX} 字符")
    return text


def _clean_color(color: str) -> str:
    c = (color or "").strip()
    if len(c) != 7 or c[0] != "#" or any(ch not in "0123456789abcdefABCDEF" for ch in c[1:]):
        raise AnnotationError("INVALID_LABEL", f"颜色须为 #RRGGBB：{color!r}")
    return c.upper()


def _label_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "scope": row["scope"],
        "name": row["name"],
        "color": row["color"],
        "description": row["description"],
        "sort": row["sort"],
        "seq": row["seq"],
        "count": row["count"],
    }


def _row_to_dict(row: sqlite3.Row) -> dict:
    prim = json.loads(row["primitive_json"])
    prim.setdefault("id", row["id"])
    prim.setdefault("role", row["kind"])
    linked = row["label_id"] is not None and row["label_name"] is not None
    return {
        "id": row["id"],
        "image_id": row["image_id"],
        "z": row["z"],
        "primitive": prim,
        "label": row["label_name"] if linked else row["label"],
        "label_id": row["label_id"] if linked else None,
        "label_color": row["label_color"] if linked else None,
        "label_stored": row["label"],
        "class_id": row["class_id"],
        "status": row["status"],
        "source": row["source"],
        "seq": row["seq"],
        "mask_ref": row["mask_ref"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
