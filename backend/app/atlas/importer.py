"""导入编排（SDD 03 §6.1 / §6.2 / §10）：候选暂存 → 用户确认 → 落图 + 写表。

- **暂存区** ``<ATLAS_ROOT>/staging/<import_id>/``：PDF / 网页解析出的候选图（PNG）+ ``meta.json``。
  前端拿 ``import_id`` + ``figure_index`` 回填到创建请求，避免二次上传大图。
- **创建**：每条 ``ExemplarInput`` 指向暂存候选或直接携带图片字节；落原图 → 裁剪 → 写表。
  幂等由 :class:`AtlasStore` 保证；``describe_status`` 初始 ``pending``
  （描述由前端/CLI 调 runtime 后写回）。
"""

from __future__ import annotations

import base64
import json
import shutil
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from . import parse_pdf, parse_web
from .images import ImageStore, Roi
from .store import AtlasError, AtlasStore, NewExemplar

STAGING_DIR = "staging"


@dataclass
class StagedFigure:
    index: int
    file: str  # 相对 staging/<import_id>/
    width: int
    height: int
    caption: str
    nearby: list[str]
    locator: dict[str, Any]  # {"page": n} 或 {"url": ...}


@dataclass
class ImportSession:
    import_id: str
    source_type: str  # textbook | web
    origin: dict[str, Any]  # {"filename": ...} 或 {"url": ...}
    figures: list[StagedFigure] = field(default_factory=list)


@dataclass
class ExemplarInput:
    """创建一条案例的输入（router 的 pydantic 模型转换而来）。"""

    roi: Roi
    tags: Sequence[str]
    source_type: str
    source: Mapping[str, Any]
    egress: str = "local-only"
    egress_consent: Mapping[str, Any] | None = None
    caption: str | None = None
    notes: str | None = None
    geometry: Sequence[Sequence[float]] | None = None
    # 图片来源二选一
    import_id: str | None = None
    figure_index: int | None = None
    image_base64: str | None = None


class Importer:
    def __init__(self, root: Path, store: AtlasStore, images: ImageStore):
        self.root = Path(root)
        self.store = store
        self.images = images
        self.staging = self.root / STAGING_DIR

    # --- 暂存 -----------------------------------------------------------------

    def _new_session(
        self, source_type: str, origin: Mapping[str, Any]
    ) -> tuple[ImportSession, Path]:
        sid = uuid.uuid4().hex
        d = self.staging / sid
        d.mkdir(parents=True, exist_ok=True)
        return ImportSession(import_id=sid, source_type=source_type, origin=dict(origin)), d

    def _persist(self, sess: ImportSession, d: Path) -> ImportSession:
        (d / "meta.json").write_text(
            json.dumps(
                {
                    "import_id": sess.import_id,
                    "source_type": sess.source_type,
                    "origin": sess.origin,
                    "figures": [f.__dict__ for f in sess.figures],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        return sess

    def stage_pdf(self, pdf_bytes: bytes, filename: str) -> ImportSession:
        figs = parse_pdf.extract_figures(pdf_bytes)  # 抛 NoFiguresFound
        sess, d = self._new_session("textbook", {"filename": filename})
        for f in figs:
            name = f"{f.index:04d}.png"
            (d / name).write_bytes(f.png)
            sess.figures.append(
                StagedFigure(
                    f.index, name, f.width, f.height, f.caption, f.nearby, {"page": f.page}
                )
            )
        return self._persist(sess, d)

    def stage_url(self, url: str, *, client=None) -> ImportSession:
        figs = parse_web.extract_figures(url, client=client)  # 抛 FetchBlocked / FetchFailed
        if not figs:
            raise parse_pdf.NoFiguresFound("页面内未找到可用图片")
        sess, d = self._new_session("web", {"url": url})
        for f in figs:
            name = f"{f.index:04d}.png"
            (d / name).write_bytes(f.png)
            sess.figures.append(
                StagedFigure(f.index, name, f.width, f.height, f.caption, f.nearby, {"url": f.url})
            )
        return self._persist(sess, d)

    def load_session(self, import_id: str) -> ImportSession:
        d = self.staging / import_id
        meta = d / "meta.json"
        if not import_id.isalnum() or not meta.is_file():
            raise AtlasError("NOT_FOUND", f"导入会话不存在：{import_id}")
        m = json.loads(meta.read_text(encoding="utf-8"))
        return ImportSession(
            import_id=m["import_id"],
            source_type=m["source_type"],
            origin=m["origin"],
            figures=[StagedFigure(**f) for f in m["figures"]],
        )

    def staged_png(self, import_id: str, figure_index: int) -> bytes:
        sess = self.load_session(import_id)
        for f in sess.figures:
            if f.index == figure_index:
                return (self.staging / import_id / f.file).read_bytes()
        raise AtlasError("NOT_FOUND", f"候选图不存在：{import_id}#{figure_index}")

    def discard_session(self, import_id: str) -> None:
        d = self.staging / import_id
        if import_id.isalnum() and d.is_dir():
            shutil.rmtree(d, ignore_errors=True)

    # --- 创建 -----------------------------------------------------------------

    def create(
        self, inputs: Sequence[ExemplarInput], *, import_batch_id: str | None = None
    ) -> list[dict[str, Any]]:
        """返回 ``[{exemplar_id, created}]``（顺序对应输入）。

        任一条校验失败整批不写（先校验后落盘）。
        """
        batch = import_batch_id or uuid.uuid4().hex
        prepared: list[NewExemplar] = []
        for i, inp in enumerate(inputs):
            png = self._resolve_png(inp, i)
            image_ref, sha, _size = self.images.save_original(png)
            try:
                crop_ref = self.images.save_crop(image_ref, sha, inp.roi)
            except ValueError as exc:
                raise AtlasError("BAD_ROI", f"第 {i} 项：{exc}") from exc
            prepared.append(
                NewExemplar(
                    image_ref=image_ref,
                    image_sha256=sha,
                    roi=tuple(int(v) for v in inp.roi),  # type: ignore[arg-type]
                    tags=inp.tags,
                    source_type=inp.source_type,  # type: ignore[arg-type]
                    source=inp.source,
                    import_batch_id=batch,
                    crop_ref=crop_ref,
                    geometry=inp.geometry,
                    caption=inp.caption,
                    notes=inp.notes,
                    describe_status="pending",
                    egress=inp.egress,  # type: ignore[arg-type]
                    egress_consent=inp.egress_consent,
                )
            )
        results = self.store.create(prepared)
        self.store.optimize()
        return [{"exemplar_id": eid, "created": created} for eid, created in results]

    def _resolve_png(self, inp: ExemplarInput, i: int) -> bytes:
        if inp.import_id is not None and inp.figure_index is not None:
            return self.staged_png(inp.import_id, inp.figure_index)
        if inp.image_base64:
            try:
                return base64.b64decode(inp.image_base64, validate=True)
            except Exception as exc:  # noqa: BLE001
                raise AtlasError("BAD_IMAGE", f"第 {i} 项：image_base64 无法解码") from exc
        raise AtlasError("BAD_IMAGE", f"第 {i} 项：需提供 import_id+figure_index 或 image_base64")
