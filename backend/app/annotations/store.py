"""统一标注存储（SDD 04 §8/§9/§10）——stdlib sqlite3 单文件 + mask PNG 外挂。

设计不变量：
- 表结构严格对齐 SDD 04 §9.1（CHECK 约束 + ``(image_id, z)`` 索引）；
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

_KINDS = ("bbox", "polyline", "mask")
_STATUSES = ("draft", "confirmed", "suggested", "rejected")
_SOURCES = ("manual", "model", "agent")

_SCHEMA = """
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
            raise AnnotationError("INVALID_GEOMETRY", "标注多边形须闭合（closed=true）；开放折线归任务管线")
        return {"kind": "polyline", "closed": True, "points": pts}
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
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    # --- 读 ---------------------------------------------------------------

    def get(self, annotation_id: str) -> dict | None:
        row = self._conn.execute(
            "SELECT * FROM annotations WHERE id = ?", (annotation_id,)
        ).fetchone()
        return _row_to_dict(row) if row else None

    def list(self, image_id: str, z: int | None = None) -> list[dict]:
        if z is None:
            rows = self._conn.execute(
                "SELECT * FROM annotations WHERE image_id = ? ORDER BY created_at", (image_id,)
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM annotations WHERE image_id = ? AND z = ? ORDER BY created_at",
                (image_id, z),
            ).fetchall()
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
    ) -> dict:
        cur = self.get(annotation_id)
        if cur is None:
            raise AnnotationError("NOT_FOUND", f"标注不存在：{annotation_id}")
        if cur["seq"] != base_seq:
            raise AnnotationError(
                "CONFLICT", f"base_seq 过期（本地 {base_seq}，服务端 {cur['seq']}）——请刷新后重试"
            )
        kind = cur["primitive"]["kind"]
        new_prim = validate_primitive(kind, primitive) if primitive is not None else cur["primitive"]
        mask_ref = cur.get("mask_ref")
        if primitive is not None and kind == "mask":
            # 换 mask 内容：primitive 携带 mask_png_b64（router 透传）
            mask_ref = self._save_mask(annotation_id, primitive.get("mask_png_b64"))
            new_prim["ref"] = mask_ref
        cur = self._conn.execute(
            """UPDATE annotations
               SET primitive_json = ?, label = ?, class_id = ?, mask_ref = ?,
                   seq = seq + 1, updated_at = ?
               WHERE id = ? AND seq = ?""",
            (
                json.dumps(new_prim),
                cur["label"] if label is None else label,
                cur["class_id"] if class_id is None else class_id,
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
        self._conn.execute("DELETE FROM annotations WHERE id = ? AND seq = ?", (annotation_id, base_seq))
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
