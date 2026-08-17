"""Atlas · 图谱 REST（SDD 03 §5.2；前缀 ``/atlas``）。

- 导入暂存：``POST /imports/pdf`` · ``POST /imports/url`` · ``GET /imports/{id}`` ·
  ``GET /imports/{id}/figures/{n}``（PNG）· ``DELETE /imports/{id}``
- 案例：``POST /exemplars``（批量创建，幂等）· ``GET /exemplars`` · ``GET /exemplars/search`` ·
  ``GET /exemplars/{id}`` · ``GET /exemplars/{id}/image|crop`` ·
  ``PUT /exemplars/{id}/description`` · ``POST /exemplars/{id}/retire|restore`` ·
  ``DELETE /exemplars/{id}`` · ``POST /exemplars/referenced``
- ``GET /tags``（频次，供导入联想）

错误码 → HTTP：NOT_FOUND 404 · CONSENT_REQUIRED/TAGS_REQUIRED/BAD_* 422 · REFERENCED 409 ·
NO_FIGURES_FOUND 422 · FETCH_BLOCKED 400 · FETCH_FAILED 502 · Atlas 不可用 503。
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, File, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

from ..atlas import service
from ..atlas.importer import ExemplarInput
from ..atlas.parse_pdf import NoFiguresFound
from ..atlas.parse_web import FetchBlocked, FetchFailed
from ..atlas.store import AtlasError

log = logging.getLogger("glaux.atlas.api")
router = APIRouter(prefix="/atlas", tags=["atlas"])

_HTTP_BY_CODE = {
    "NOT_FOUND": 404,
    "REFERENCED": 409,
    "CONSENT_REQUIRED": 422,
    "TAGS_REQUIRED": 422,
    "BAD_EGRESS": 422,
    "BAD_ROI": 422,
    "BAD_IMAGE": 422,
    "NO_FIGURES_FOUND": 422,
    "FETCH_BLOCKED": 400,
    "FETCH_FAILED": 502,
}


def _err(code: str, msg: str) -> HTTPException:
    return HTTPException(_HTTP_BY_CODE.get(code, 400), {"code": code, "message": msg})


def _svc():
    if not service.available():
        raise HTTPException(
            503, {"code": "ATLAS_UNAVAILABLE", "message": "Atlas 需 lancedb（未装配）"}
        )
    try:
        return service.get()
    except Exception as exc:  # noqa: BLE001
        log.exception("Atlas 装配失败")
        raise HTTPException(503, {"code": "ATLAS_UNAVAILABLE", "message": str(exc)}) from exc


# --- 模型 ---------------------------------------------------------------------


class ImportUrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class StagedFigureOut(BaseModel):
    index: int
    width: int
    height: int
    caption: str
    nearby: list[str]
    locator: dict[str, Any]


class ImportSessionOut(BaseModel):
    import_id: str
    source_type: str
    origin: dict[str, Any]
    figures: list[StagedFigureOut]


class ExemplarIn(BaseModel):
    roi: tuple[int, int, int, int]
    tags: list[str] = Field(min_length=1)
    source_type: Literal["textbook", "web", "dataset"]
    source: dict[str, Any]
    egress: Literal["shareable", "local-only"] = "local-only"
    egress_consent: dict[str, Any] | None = None
    caption: str | None = None
    notes: str | None = None
    geometry: list[list[float]] | None = None
    import_id: str | None = None
    figure_index: int | None = None
    image_base64: str | None = None
    collection: str | None = None


class CreateExemplarsRequest(BaseModel):
    items: list[ExemplarIn] = Field(min_length=1, max_length=200)
    import_batch_id: str | None = None


class CreateResult(BaseModel):
    exemplar_id: str
    created: bool


class DescriptionIn(BaseModel):
    description: dict[str, Any] | None
    status: Literal["done", "pending", "skipped"] = "done"


class ReferencedIn(BaseModel):
    exemplar_ids: list[str] = Field(min_length=1)
    trace_id: str = Field(min_length=1)


class TagCount(BaseModel):
    tag: str
    count: int


class CollectionCount(BaseModel):
    collection: str
    key: str
    count: int


class CollectionIn(BaseModel):
    collection: str | None = None


# --- 导入暂存 ------------------------------------------------------------------


def _sess_out(sess) -> ImportSessionOut:
    return ImportSessionOut(
        import_id=sess.import_id,
        source_type=sess.source_type,
        origin=sess.origin,
        figures=[
            StagedFigureOut(
                index=f.index,
                width=f.width,
                height=f.height,
                caption=f.caption,
                nearby=f.nearby,
                locator=f.locator,
            )
            for f in sess.figures
        ],
    )


@router.post("/imports/pdf", response_model=ImportSessionOut)
async def import_pdf(file: UploadFile = File(...)) -> ImportSessionOut:
    svc = _svc()
    data = await file.read()
    if not data:
        raise _err("BAD_IMAGE", "空文件")
    try:
        return _sess_out(svc.importer.stage_pdf(data, file.filename or "upload.pdf"))
    except NoFiguresFound as exc:
        raise _err(exc.code, str(exc)) from exc


@router.post("/imports/url", response_model=ImportSessionOut)
def import_url(req: ImportUrlRequest) -> ImportSessionOut:
    svc = _svc()
    try:
        return _sess_out(svc.importer.stage_url(req.url))
    except FetchBlocked as exc:
        raise _err(exc.code, str(exc)) from exc
    except FetchFailed as exc:
        raise _err(exc.code, str(exc)) from exc
    except NoFiguresFound as exc:
        raise _err(exc.code, str(exc)) from exc


@router.get("/imports/{import_id}", response_model=ImportSessionOut)
def get_import(import_id: str) -> ImportSessionOut:
    svc = _svc()
    try:
        return _sess_out(svc.importer.load_session(import_id))
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc


@router.get("/imports/{import_id}/figures/{index}")
def get_import_figure(import_id: str, index: int) -> Response:
    svc = _svc()
    try:
        return Response(content=svc.importer.staged_png(import_id, index), media_type="image/png")
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc


@router.delete("/imports/{import_id}")
def delete_import(import_id: str) -> dict:
    svc = _svc()
    svc.importer.discard_session(import_id)
    return {"ok": True}


# --- 案例 ---------------------------------------------------------------------


@router.post("/exemplars", response_model=list[CreateResult])
def create_exemplars(req: CreateExemplarsRequest) -> list[CreateResult]:
    svc = _svc()
    inputs = [
        ExemplarInput(
            roi=it.roi,
            tags=it.tags,
            source_type=it.source_type,
            source=it.source,
            egress=it.egress,
            egress_consent=it.egress_consent,
            caption=it.caption,
            notes=it.notes,
            geometry=it.geometry,
            import_id=it.import_id,
            figure_index=it.figure_index,
            image_base64=it.image_base64,
            collection=it.collection,
        )
        for it in req.items
    ]
    try:
        out = svc.importer.create(inputs, import_batch_id=req.import_batch_id)
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc
    return [CreateResult(**o) for o in out]


@router.get("/exemplars")
def list_exemplars(
    status: Literal["active", "retired", "all"] = "active",
    tags: list[str] | None = Query(default=None),
    source_type: Literal["textbook", "web", "dataset"] | None = None,
    collection: str | None = None,
    collection_exact: bool = False,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> list[dict]:
    svc = _svc()
    st = None if status == "all" else status
    return [
        e.to_dict()
        for e in svc.store.list(
            status=st,
            tags=tags,
            source_type=source_type,
            collection=collection,
            collection_exact=collection_exact,
            limit=limit,
            offset=offset,
        )
    ]


@router.get("/exemplars/search")
def search_exemplars(
    q: str | None = None,
    tags: list[str] | None = Query(default=None),
    egress: Literal["shareable", "any"] = "shareable",
    limit: int = Query(default=10, ge=1, le=50),
    collection: str | None = None,
) -> list[dict]:
    svc = _svc()
    try:
        return [
            e.to_dict()
            for e in svc.store.search(
                tags=tags, q=q, egress=egress, limit=limit, collection=collection
            )
        ]
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc


@router.get("/collections", response_model=list[CollectionCount])
def collections(status: Literal["active", "retired", "all"] = "active") -> list[CollectionCount]:
    svc = _svc()
    st = None if status == "all" else status
    return [
        CollectionCount(collection=d, key=k, count=n) for d, k, n in svc.store.collection_counts(st)
    ]


@router.put("/exemplars/{exemplar_id}/collection")
def put_collection(exemplar_id: str, body: CollectionIn) -> dict:
    svc = _svc()
    try:
        return svc.store.set_collection(exemplar_id, body.collection).to_dict()
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc


@router.get("/tags", response_model=list[TagCount])
def tags(status: Literal["active", "retired", "all"] = "active") -> list[TagCount]:
    svc = _svc()
    st = None if status == "all" else status
    return [TagCount(tag=t, count=c) for t, c in svc.store.tag_counts(status=st)]


@router.get("/exemplars/{exemplar_id}")
def get_exemplar(exemplar_id: str) -> dict:
    svc = _svc()
    ex = svc.store.get(exemplar_id)
    if ex is None:
        raise _err("NOT_FOUND", exemplar_id)
    return ex.to_dict()


def _png_of(exemplar_id: str, which: Literal["image", "crop"]) -> Response:
    svc = _svc()
    ex = svc.store.get(exemplar_id)
    if ex is None:
        raise _err("NOT_FOUND", exemplar_id)
    ref = ex.image_ref if which == "image" else (ex.crop_ref or ex.image_ref)
    try:
        return Response(content=svc.images.read(ref), media_type="image/png")
    except FileNotFoundError as exc:
        raise _err("NOT_FOUND", f"图像文件缺失：{ref}") from exc


@router.get("/exemplars/{exemplar_id}/image")
def exemplar_image(exemplar_id: str) -> Response:
    return _png_of(exemplar_id, "image")


@router.get("/exemplars/{exemplar_id}/crop")
def exemplar_crop(exemplar_id: str) -> Response:
    return _png_of(exemplar_id, "crop")


@router.put("/exemplars/{exemplar_id}/description")
def put_description(exemplar_id: str, body: DescriptionIn) -> dict:
    svc = _svc()
    try:
        svc.store.set_description(exemplar_id, body.description, body.status)
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc
    return svc.store.get(exemplar_id).to_dict()  # type: ignore[union-attr]


@router.post("/exemplars/{exemplar_id}/retire")
def retire(exemplar_id: str) -> dict:
    svc = _svc()
    try:
        svc.store.retire(exemplar_id)
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc
    return {"ok": True, "status": "retired"}


@router.post("/exemplars/{exemplar_id}/restore")
def restore(exemplar_id: str) -> dict:
    svc = _svc()
    try:
        svc.store.restore(exemplar_id)
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc
    return {"ok": True, "status": "active"}


@router.delete("/exemplars/{exemplar_id}")
def delete_exemplar(exemplar_id: str) -> dict:
    svc = _svc()
    try:
        svc.store.delete(exemplar_id)
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc
    return {"ok": True}


@router.post("/exemplars/referenced")
def mark_referenced(body: ReferencedIn) -> dict:
    svc = _svc()
    n = svc.store.mark_referenced(body.exemplar_ids, body.trace_id)
    return {"ok": True, "marked": n}
