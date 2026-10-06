"""标签目录 REST（SDD 23 §7.1、§9.2）。

作用域由对象解析（所属项目或 ``global``），调用方只传 ``object_id``。目录与标注同库，
合并与删除前的引用检查在同一事务内完成（D-9）。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from ..annotations.store import AnnotationError
from .annotations import get_store, http_error, scope_of

log = logging.getLogger(__name__)

router = APIRouter(tags=["labels"])


class LabelIn(BaseModel):
    model_config = {"extra": "forbid"}
    object_id: str = Field(min_length=1, description="据以解析作用域的对象")
    name: str
    color: str | None = None
    description: str = ""


class LabelPatch(BaseModel):
    model_config = {"extra": "forbid"}
    base_seq: int = Field(ge=1)
    name: str | None = None
    color: str | None = None
    description: str | None = None
    sort: int | None = None


class LabelMerge(BaseModel):
    model_config = {"extra": "forbid"}
    base_seq: int = Field(ge=1)
    into: str = Field(min_length=1)


@router.get("/labels")
def list_labels(object_id: str = Query(min_length=1)) -> dict:
    try:
        scope = scope_of(object_id)
    except AnnotationError as e:
        raise http_error(e) from e
    return {"scope": scope, "labels": get_store().list_labels(scope)}


@router.post("/labels", status_code=201)
def create_label(body: LabelIn) -> dict:
    try:
        scope = scope_of(body.object_id)
        label = get_store().create_label(scope, body.name, body.color, body.description)
    except AnnotationError as e:
        raise http_error(e) from e
    log.info("标签目录 %s：新建 %s", scope, label["id"])
    return {"label": label}


@router.patch("/labels/{label_id}")
def update_label(label_id: str, body: LabelPatch) -> dict:
    try:
        label = get_store().update_label(
            label_id,
            body.base_seq,
            name=body.name,
            color=body.color,
            description=body.description,
            sort=body.sort,
        )
    except AnnotationError as e:
        raise http_error(e) from e
    log.info("标签目录 %s：修改 %s", label["scope"], label_id)
    return {"label": label}


@router.delete("/labels/{label_id}", status_code=204)
def delete_label(label_id: str, base_seq: int = Query(ge=1)) -> None:
    try:
        get_store().delete_label(label_id, base_seq)
    except AnnotationError as e:
        raise http_error(e) from e
    log.info("标签目录：删除 %s", label_id)


@router.post("/labels/{label_id}/merge")
def merge_label(label_id: str, body: LabelMerge) -> dict:
    try:
        label = get_store().merge_label(label_id, body.base_seq, body.into)
    except AnnotationError as e:
        raise http_error(e) from e
    log.info("标签目录 %s：合并 %s → %s", label["scope"], label_id, body.into)
    return {"label": label}
