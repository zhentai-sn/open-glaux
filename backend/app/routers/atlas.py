"""Atlas · 图谱 REST（SDD 03 §5.2；前缀 ``/atlas``）。

- 上传即入库：``POST /uploads``（multipart）· ``POST /uploads/url``
- 案例：``POST /exemplars``（批量创建，幂等；CLI 与测试用）· ``GET /exemplars`` ·
  ``GET /exemplars/search`` · ``GET /exemplars/{id}`` · ``GET /exemplars/{id}/image|crop`` ·
  ``PATCH /exemplars/{id}`` · ``POST /exemplars/{id}/regions`` ·
  ``PUT /exemplars/{id}/description`` · ``POST /exemplars/{id}/retire|restore`` ·
  ``DELETE /exemplars/{id}`` · ``POST /exemplars/referenced``
- ``GET /tags``（频次，供编辑联想）· ``GET /collections``

错误码 → HTTP：NOT_FOUND 404 · CONSENT_REQUIRED/BAD_* 422 · REFERENCED 409 · UPLOAD_TOO_LARGE 413 ·
NO_FIGURES_FOUND 422 · FETCH_BLOCKED 400 · FETCH_FAILED 502 · Atlas 不可用 503。
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, File, Form, HTTPException, Query, Response, UploadFile
from pydantic import BaseModel, Field

from ..atlas import service
from ..atlas.importer import ExemplarInput, UploadResult
from ..atlas.importer import UploadFile as AtlasUpload
from ..atlas.parse_pdf import NoFiguresFound
from ..atlas.parse_web import FetchBlocked, FetchFailed
from ..atlas.store import AtlasError

log = logging.getLogger("glaux.atlas.api")
router = APIRouter(prefix="/atlas", tags=["atlas"])

_HTTP_BY_CODE = {
    "NOT_FOUND": 404,
    "REFERENCED": 409,
    "UPLOAD_TOO_LARGE": 413,
    "CONSENT_REQUIRED": 422,
    "BAD_EGRESS": 422,
    "BAD_FIELD": 422,
    "BAD_ROI": 422,
    "BAD_IMAGE": 422,
    "NO_FIGURES_FOUND": 422,
    "FETCH_BLOCKED": 400,
    "FETCH_FAILED": 502,
}

SourceTypeLit = Literal["upload", "textbook", "web", "dataset"]


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


class UploadUrlRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)
    collection: str | None = None


class UploadItemOut(BaseModel):
    exemplar_id: str
    created: bool
    file: str


class UploadErrorOut(BaseModel):
    file: str
    code: str
    message: str


class UploadOut(BaseModel):
    batch_id: str
    items: list[UploadItemOut]
    errors: list[UploadErrorOut]


class ExemplarIn(BaseModel):
    roi: tuple[int, int, int, int]
    tags: list[str] = Field(default_factory=list)
    source_type: SourceTypeLit
    source: dict[str, Any]
    egress: Literal["shareable", "local-only"] = "local-only"
    egress_consent: dict[str, Any] | None = None
    caption: str | None = None
    notes: str | None = None
    geometry: list[list[float]] | None = None
    image_base64: str = Field(min_length=1)
    collection: str | None = None


class CreateExemplarsRequest(BaseModel):
    items: list[ExemplarIn] = Field(min_length=1, max_length=200)
    import_batch_id: str | None = None


class CreateResult(BaseModel):
    exemplar_id: str
    created: bool


class PatchIn(BaseModel):
    """字段子集（未出现的字段不改）；``reviewed`` 只接受 true（§7.8 第 4 条：不可回退）。"""

    roi: tuple[int, int, int, int] | None = None
    tags: list[str] | None = None
    caption: str | None = None
    notes: str | None = None
    source: dict[str, Any] | None = None
    collection: str | None = None
    egress: Literal["shareable", "local-only"] | None = None
    egress_consent: dict[str, Any] | None = None
    reviewed: Literal[True] | None = None


class RegionIn(BaseModel):
    roi: tuple[int, int, int, int]


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


# --- 上传即入库 ------------------------------------------------------------------


def _upload_out(res: UploadResult) -> UploadOut:
    return UploadOut(
        batch_id=res.batch_id,
        items=[UploadItemOut(**it) for it in res.items],
        errors=[UploadErrorOut(**e) for e in res.errors],
    )


@router.post("/uploads", response_model=UploadOut)
async def upload_files(
    files: list[UploadFile] = File(...), collection: str | None = Form(default=None)
) -> UploadOut:
    svc = _svc()
    payload = [AtlasUpload(f.filename or "upload", await f.read()) for f in files]
    try:
        return _upload_out(svc.importer.upload_files(payload, collection=collection))
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc


@router.post("/uploads/url", response_model=UploadOut)
def upload_url(req: UploadUrlRequest) -> UploadOut:
    svc = _svc()
    try:
        return _upload_out(svc.importer.upload_url(req.url, collection=req.collection))
    except (FetchBlocked, FetchFailed, NoFiguresFound) as exc:
        raise _err(exc.code, str(exc)) from exc
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc


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
            image_base64=it.image_base64,
            collection=it.collection,
            reviewed=True,  # 字段由调用方显式给出（SDD 03 §9 reviewed）
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
    source_type: SourceTypeLit | None = None,
    collection: str | None = None,
    collection_exact: bool = False,
    describe_status: Literal["done", "pending", "skipped"] | None = None,
    reviewed: bool | None = None,
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
            describe_status=describe_status,
            reviewed=reviewed,
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


@router.patch("/exemplars/{exemplar_id}")
def patch_exemplar(exemplar_id: str, body: PatchIn) -> dict:
    """改字段子集并置已确认（SDD 03 §7.8 第 4、5 条）；改 ROI 时重裁并让描述回到 pending。"""
    svc = _svc()
    changes = body.model_dump(exclude_unset=True)
    changes.pop("reviewed", None)
    roi = changes.pop("roi", None)
    try:
        if roi is not None:
            svc.importer.set_roi(exemplar_id, roi)
        return svc.store.update(exemplar_id, changes).to_dict()
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc


@router.post("/exemplars/{exemplar_id}/regions", response_model=CreateResult)
def add_region(exemplar_id: str, body: RegionIn) -> CreateResult:
    svc = _svc()
    try:
        return CreateResult(**svc.importer.add_region(exemplar_id, body.roi))
    except AtlasError as exc:
        raise _err(exc.code, str(exc)) from exc


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
