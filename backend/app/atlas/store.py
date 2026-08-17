"""LanceDB 案例表 + 引用记录表（SDD 03 §7.2 / §7.7 / §9 / §10 / §11）。

- ``exemplars``：一条记录 = 一图上的一条标记（同一 ``image_ref`` 可多条）。
- ``exemplar_refs``：runtime 回写"该案例被某次会话引用"，硬删除前查询。

设计取舍：
- 嵌套对象（``description`` / ``source`` / ``geometry`` / ``egress_consent``）以 JSON 字符串列存放，
  取出时反序列化——LanceDB 对 struct 列的过滤/更新支持有限，JSON 列最稳且 schema 演进零迁移。
- 检索文本合成为 ``search_text`` 列并建 FTS(ngram) 索引；写入后新行无需重建索引即可被检索
  （开工前已核实）；``optimize()`` 由调用方按批次触发以合并索引。
- 幂等键 ``dedupe_key = sha256(source_type | canonical(source) | image_sha256 | roi)``。
"""

from __future__ import annotations

import hashlib
import json
import logging
import uuid
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

import pyarrow as pa

from .text import build_search_text, normalize_collection, normalize_tag, normalize_tags

log = logging.getLogger("glaux.atlas")

Egress = Literal["shareable", "local-only"]
Status = Literal["active", "retired"]
SourceType = Literal["textbook", "web", "dataset"]
DescribeStatus = Literal["done", "pending", "skipped"]

SEARCH_LIMIT_DEFAULT = 10

_EXEMPLARS_SCHEMA = pa.schema(
    [
        ("exemplar_id", pa.string()),
        ("dedupe_key", pa.string()),
        ("image_ref", pa.string()),
        ("crop_ref", pa.string()),
        ("image_sha256", pa.string()),
        ("roi", pa.list_(pa.int32(), 4)),
        ("geometry_json", pa.string()),
        ("tags", pa.list_(pa.string())),
        ("tags_raw", pa.list_(pa.string())),
        ("caption", pa.string()),
        ("notes", pa.string()),
        ("description_json", pa.string()),
        ("describe_status", pa.string()),
        ("search_text", pa.string()),
        ("source_type", pa.string()),
        ("source_json", pa.string()),
        ("egress", pa.string()),
        ("egress_consent_json", pa.string()),
        ("status", pa.string()),
        ("created_at", pa.string()),
        ("import_batch_id", pa.string()),
        ("collection", pa.string()),
        ("collection_key", pa.string()),
    ]
)

# v1.1 追加的列（旧库 open 时补列，缺省空串 = 根目录）
_ADDED_COLUMNS: dict[str, str] = {"collection": "''", "collection_key": "''"}

_REFS_SCHEMA = pa.schema(
    [
        ("exemplar_id", pa.string()),
        ("trace_id", pa.string()),
        ("referenced_at", pa.string()),
    ]
)


class AtlasError(Exception):
    """带机器可读 ``code`` 的领域错误（router 映射为 HTTP 状态）。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class NewExemplar:
    """一次导入中的一条待写入记录（图已落盘）。"""

    image_ref: str
    image_sha256: str
    roi: tuple[int, int, int, int]
    tags: Sequence[str]
    source_type: SourceType
    source: Mapping[str, Any]
    import_batch_id: str
    crop_ref: str | None = None
    geometry: Sequence[Sequence[float]] | None = None  # 多边形点集 [[x,y],...]
    caption: str | None = None
    notes: str | None = None
    description: Mapping[str, Any] | None = None
    describe_status: DescribeStatus = "pending"
    egress: Egress = "local-only"
    egress_consent: Mapping[str, Any] | None = None
    collection: str | None = None  # 图册路径原文（v1.1）；None/"" = 根目录


@dataclass
class Exemplar:
    exemplar_id: str
    image_ref: str
    crop_ref: str | None
    image_sha256: str
    roi: tuple[int, int, int, int]
    geometry: list[list[float]] | None
    tags: list[str]
    tags_raw: list[str]
    caption: str | None
    notes: str | None
    description: dict[str, Any] | None
    describe_status: str
    source_type: str
    source: dict[str, Any]
    egress: str
    egress_consent: dict[str, Any] | None
    status: str
    created_at: str
    import_batch_id: str
    collection: str = ""  # 图册路径原文（v1.1）
    collection_key: str = ""  # 归一键
    score: float | None = None  # 仅 search 结果携带
    matched_tags: list[str] = field(default_factory=list)  # 仅 search 结果携带

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _canonical(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def dedupe_key(
    source_type: str, source: Mapping[str, Any], image_sha256: str, roi: Sequence[int]
) -> str:
    raw = "|".join(
        [source_type, _canonical(source), image_sha256, ",".join(str(int(v)) for v in roi)]
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _q(s: str) -> str:
    """SQL 字面量转义（LanceDB where 用 SQL 子集；单引号翻倍）。"""
    return "'" + s.replace("'", "''") + "'"


def _row_to_exemplar(r: Mapping[str, Any]) -> Exemplar:
    def _j(k: str) -> Any:
        v = r.get(k)
        return json.loads(v) if isinstance(v, str) and v else None

    roi = tuple(int(v) for v in r["roi"])
    return Exemplar(
        exemplar_id=r["exemplar_id"],
        image_ref=r["image_ref"],
        crop_ref=r.get("crop_ref") or None,
        image_sha256=r["image_sha256"],
        roi=roi,  # type: ignore[arg-type]
        geometry=_j("geometry_json"),
        tags=list(r.get("tags") or []),
        tags_raw=list(r.get("tags_raw") or []),
        caption=r.get("caption") or None,
        notes=r.get("notes") or None,
        description=_j("description_json"),
        describe_status=r.get("describe_status") or "pending",
        source_type=r["source_type"],
        source=_j("source_json") or {},
        egress=r["egress"],
        egress_consent=_j("egress_consent_json"),
        status=r["status"],
        created_at=r["created_at"],
        import_batch_id=r["import_batch_id"],
        collection=r.get("collection") or "",
        collection_key=r.get("collection_key") or "",
        score=float(r["_score"]) if r.get("_score") is not None else None,
    )


def collection_where(collection: str | None, *, exact: bool = False) -> str | None:
    """图册过滤子句：``exact`` 时精确等于；否则等于该路径或其子路径（前缀 ``key/``）。

    ``collection`` 为 None → 不过滤；为空串且非 exact → 根目录 = 全部，也不过滤；
    为空串且 exact → 只要"未分册"。
    """
    if collection is None:
        return None
    _, key = normalize_collection(collection)
    if exact:
        return f"collection_key = {_q(key)}"
    if not key:
        return None
    return f"(collection_key = {_q(key)} OR starts_with(collection_key, {_q(key + '/')}))"


class AtlasStore:
    """单进程内的 LanceDB 访问器；``root`` 下建 ``db/``。线程安全交给 LanceDB（单写者假设）。"""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.db_dir = self.root / "db"
        self._db = None
        self._exemplars = None
        self._refs = None
        self._fts_ready = False

    # --- 生命周期 -------------------------------------------------------------

    def open(self) -> AtlasStore:
        import lancedb  # 延迟导入：让不装 lancedb 的环境仍能 import 本包（router 侧做 503 守卫）

        self.db_dir.mkdir(parents=True, exist_ok=True)
        self._db = lancedb.connect(str(self.db_dir))
        names = set(self._db.list_tables().tables)
        self._exemplars = (
            self._db.open_table("exemplars")
            if "exemplars" in names
            else self._db.create_table("exemplars", schema=_EXEMPLARS_SCHEMA)
        )
        self._refs = (
            self._db.open_table("exemplar_refs")
            if "exemplar_refs" in names
            else self._db.create_table("exemplar_refs", schema=_REFS_SCHEMA)
        )
        self._migrate_columns()
        self._ensure_fts()
        return self

    def _migrate_columns(self) -> None:
        """旧库补列（v1.1 ``collection``）：缺列则 ``add_columns`` 填空串，不重建表。"""
        have = set(self.exemplars.schema.names)
        missing = {k: v for k, v in _ADDED_COLUMNS.items() if k not in have}
        if missing:
            self.exemplars.add_columns(missing)
            log.info("Atlas exemplars 表补列：%s", ", ".join(missing))

    @property
    def exemplars(self):
        if self._exemplars is None:
            raise RuntimeError("AtlasStore 未 open()")
        return self._exemplars

    @property
    def refs(self):
        if self._refs is None:
            raise RuntimeError("AtlasStore 未 open()")
        return self._refs

    def _ensure_fts(self) -> None:
        """FTS(ngram 2–3) 索引：中英文皆可分词（simple 分词器对中文失效——开工前核实）。

        空表上建索引在部分版本会失败，故推迟到首次有数据后再建（见 ``create``）。
        """
        if self._fts_ready:
            return
        try:
            if self.exemplars.count_rows() == 0:
                return
            from lancedb.index import FTS

            existing = {idx.columns[0] for idx in self.exemplars.list_indices()}
            if "search_text" not in existing:
                self.exemplars.create_index(
                    "search_text",
                    config=FTS(
                        base_tokenizer="ngram",
                        ngram_min_length=2,
                        ngram_max_length=3,
                        prefix_only=False,
                    ),
                )
            self._fts_ready = True
        except Exception as exc:  # pragma: no cover - 索引失败不应阻塞写入
            log.warning("Atlas FTS 索引创建失败（检索退化为无索引扫描）：%s", exc)

    def optimize(self) -> None:
        """合并小文件与索引增量；导入批次结束时调用。"""
        try:
            self.exemplars.optimize()
        except Exception as exc:  # pragma: no cover
            log.warning("Atlas optimize 失败：%s", exc)

    # --- 写入（幂等） -----------------------------------------------------------

    def create(self, items: Iterable[NewExemplar]) -> list[tuple[str, bool]]:
        """批量写入。返回 ``[(exemplar_id, created)]``；命中幂等键者返回已有 id、``created=False``。

        ``egress="shareable"`` 必须携带 ``egress_consent``（SDD D-16），
        否则抛 ``AtlasError("CONSENT_REQUIRED")``。
        """
        out: list[tuple[str, bool]] = []
        rows: list[dict[str, Any]] = []
        for it in items:
            if it.egress == "shareable" and not it.egress_consent:
                raise AtlasError("CONSENT_REQUIRED", "egress=shareable 必须附带 egress_consent")
            if it.egress not in ("shareable", "local-only"):
                raise AtlasError("BAD_EGRESS", f"非法 egress: {it.egress}")
            tags, tags_raw = normalize_tags(it.tags)
            if not tags:
                raise AtlasError("TAGS_REQUIRED", "至少一个非空标签")
            key = dedupe_key(it.source_type, it.source, it.image_sha256, it.roi)
            existing = self._find_by_dedupe(key)
            if existing:
                out.append((existing, False))
                continue
            eid = str(uuid.uuid4())
            coll, coll_key = normalize_collection(it.collection)
            rows.append(
                {
                    "exemplar_id": eid,
                    "dedupe_key": key,
                    "image_ref": it.image_ref,
                    "crop_ref": it.crop_ref or "",
                    "image_sha256": it.image_sha256,
                    "roi": [int(v) for v in it.roi],
                    "geometry_json": _canonical(it.geometry) if it.geometry else "",
                    "tags": tags,
                    "tags_raw": tags_raw,
                    "caption": it.caption or "",
                    "notes": it.notes or "",
                    "description_json": _canonical(it.description) if it.description else "",
                    "describe_status": it.describe_status,
                    "search_text": build_search_text(it.caption, it.description, it.notes),
                    "source_type": it.source_type,
                    "source_json": _canonical(it.source),
                    "egress": it.egress,
                    "egress_consent_json": _canonical(it.egress_consent)
                    if it.egress_consent
                    else "",
                    "status": "active",
                    "created_at": _now(),
                    "import_batch_id": it.import_batch_id,
                    "collection": coll,
                    "collection_key": coll_key,
                }
            )
            out.append((eid, True))
        if rows:
            self.exemplars.add(rows)
            self._ensure_fts()
        return out

    def _find_by_dedupe(self, key: str) -> str | None:
        hit = (
            self.exemplars.search()
            .where(f"dedupe_key = {_q(key)}")
            .select(["exemplar_id"])
            .limit(1)
            .to_list()
        )
        return hit[0]["exemplar_id"] if hit else None

    def set_description(
        self, exemplar_id: str, description: Mapping[str, Any] | None, status: DescribeStatus
    ) -> None:
        cur = self.get(exemplar_id)
        if cur is None:
            raise AtlasError("NOT_FOUND", exemplar_id)
        self.exemplars.update(
            where=f"exemplar_id = {_q(exemplar_id)}",
            values={
                "description_json": _canonical(description) if description else "",
                "describe_status": status,
                "search_text": build_search_text(cur.caption, description, cur.notes),
            },
        )

    def set_collection(self, exemplar_id: str, collection: str | None) -> Exemplar:
        """移动到图册（v1.1）：只改路径列，不动 id / 幂等键 / 引用记录。"""
        if self.get(exemplar_id) is None:
            raise AtlasError("NOT_FOUND", exemplar_id)
        coll, key = normalize_collection(collection)
        self.exemplars.update(
            where=f"exemplar_id = {_q(exemplar_id)}",
            values={"collection": coll, "collection_key": key},
        )
        return self.get(exemplar_id)  # type: ignore[return-value]

    def collection_counts(self, status: Status | None = "active") -> list[tuple[str, str, int]]:
        """图册直属计数 ``[(display, key, count)]``，按 key 排序；前端据此拼树、累加子树计数。"""
        q = self.exemplars.search()
        if status:
            q = q.where(f"status = {_q(status)}")
        counts: dict[str, tuple[str, int]] = {}
        for r in q.select(["collection", "collection_key"]).limit(1_000_000).to_list():
            key = r.get("collection_key") or ""
            disp, n = counts.get(key, (r.get("collection") or "", 0))
            counts[key] = (disp, n + 1)
        return sorted(((d, k, n) for k, (d, n) in counts.items()), key=lambda t: t[1])

    # --- 读取 -------------------------------------------------------------------

    def get(self, exemplar_id: str) -> Exemplar | None:
        rows = self.exemplars.search().where(f"exemplar_id = {_q(exemplar_id)}").limit(1).to_list()
        return _row_to_exemplar(rows[0]) if rows else None

    def list(
        self,
        *,
        status: Status | None = "active",
        tags: Sequence[str] | None = None,
        source_type: SourceType | None = None,
        collection: str | None = None,
        collection_exact: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Exemplar]:
        clauses: list[str] = []
        if status:
            clauses.append(f"status = {_q(status)}")
        if source_type:
            clauses.append(f"source_type = {_q(source_type)}")
        cw = collection_where(collection, exact=collection_exact)
        if cw:
            clauses.append(cw)
        norm = [normalize_tag(t) for t in (tags or []) if normalize_tag(t)]
        if norm:
            clauses.append("array_has_any(tags, [" + ", ".join(_q(t) for t in norm) + "])")
        q = self.exemplars.search()
        if clauses:
            q = q.where(" AND ".join(clauses))
        rows = q.limit(limit + offset).to_list()
        rows.sort(key=lambda r: r["created_at"], reverse=True)
        return [_row_to_exemplar(r) for r in rows[offset : offset + limit]]

    def tag_counts(self, status: Status | None = "active") -> list[tuple[str, int]]:
        q = self.exemplars.search()
        if status:
            q = q.where(f"status = {_q(status)}")
        counts: dict[str, int] = {}
        for r in q.select(["tags"]).limit(1_000_000).to_list():
            for t in r["tags"] or []:
                counts[t] = counts.get(t, 0) + 1
        return sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))

    def search(
        self,
        *,
        tags: Sequence[str] | None = None,
        q: str | None = None,
        egress: Literal["shareable", "any"] = "shareable",
        limit: int = SEARCH_LIMIT_DEFAULT,
        collection: str | None = None,
    ) -> list[Exemplar]:
        """SDD §7.2：[图册范围 →] 标签过滤（any）→ FTS(BM25) → 仅 active → egress 过滤 → 排序截断。

        排序键：(命中标签数, 相关度) 降序。

        有标签但无命中时退化为仅文本匹配；``q`` 为空时退化为过滤 + 按 ``created_at`` 倒序。
        """
        limit = max(1, min(int(limit), 50))
        norm = [normalize_tag(t) for t in (tags or []) if normalize_tag(t)]
        base = [f"status = {_q('active')}"]
        if egress == "shareable":
            base.append(f"egress = {_q('shareable')}")
        elif egress != "any":
            raise AtlasError("BAD_EGRESS", f"非法 egress 过滤: {egress}")
        cw = collection_where(collection)
        if cw:
            base.append(cw)

        def _run(with_tags: bool) -> list[dict[str, Any]]:
            clauses = list(base)
            if with_tags and norm:
                clauses.append("array_has_any(tags, [" + ", ".join(_q(t) for t in norm) + "])")
            where = " AND ".join(clauses)
            if q and q.strip():
                qq = self.exemplars.search(q.strip(), query_type="fts", fts_columns="search_text")
                # 取多一些再重排（命中标签数优先）
                return qq.where(where).limit(limit * 3).to_list()
            rows = self.exemplars.search().where(where).limit(limit * 3).to_list()
            rows.sort(key=lambda r: r["created_at"], reverse=True)
            return rows

        rows = _run(with_tags=True)
        if not rows and norm:
            rows = _run(with_tags=False)

        norm_set = set(norm)
        out: list[Exemplar] = []
        for r in rows:
            ex = _row_to_exemplar(r)
            ex.matched_tags = [t for t in ex.tags if t in norm_set]
            out.append(ex)
        out.sort(key=lambda e: e.created_at, reverse=True)  # 次序基线：新者在前
        out.sort(
            key=lambda e: (-len(e.matched_tags), -(e.score or 0.0))
        )  # 稳定排序：命中标签数 > 相关度
        return out[:limit]

    # --- 状态与删除门禁 -----------------------------------------------------------

    def retire(self, exemplar_id: str) -> None:
        self._set_status(exemplar_id, "retired")

    def restore(self, exemplar_id: str) -> None:
        self._set_status(exemplar_id, "active")

    def _set_status(self, exemplar_id: str, status: Status) -> None:
        if self.get(exemplar_id) is None:
            raise AtlasError("NOT_FOUND", exemplar_id)
        self.exemplars.update(where=f"exemplar_id = {_q(exemplar_id)}", values={"status": status})

    def delete(self, exemplar_id: str) -> None:
        """硬删除记录（不删图像文件：同图可能被其他记录引用；孤儿图清理另行处理）。

        被会话引用过 → ``AtlasError("REFERENCED")``，只能下架（SDD §7.7）。
        """
        if self.get(exemplar_id) is None:
            raise AtlasError("NOT_FOUND", exemplar_id)
        if self.is_referenced(exemplar_id):
            raise AtlasError("REFERENCED", "该案例已被会话引用，只能下架不能删除")
        self.exemplars.delete(f"exemplar_id = {_q(exemplar_id)}")

    # --- 引用记录 ---------------------------------------------------------------

    def mark_referenced(self, exemplar_ids: Sequence[str], trace_id: str) -> int:
        ids = [i for i in dict.fromkeys(exemplar_ids) if i]
        if not ids:
            return 0
        now = _now()
        self.refs.add([{"exemplar_id": i, "trace_id": trace_id, "referenced_at": now} for i in ids])
        return len(ids)

    def is_referenced(self, exemplar_id: str) -> bool:
        hit = (
            self.refs.search()
            .where(f"exemplar_id = {_q(exemplar_id)}")
            .select(["exemplar_id"])
            .limit(1)
            .to_list()
        )
        return bool(hit)
