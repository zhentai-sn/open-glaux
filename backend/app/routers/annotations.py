"""统一标注 REST（SDD 04 §8.2/§7.3/§13）——``/annotations`` CRUD + base_seq + on_commit。

- 几何**范围**校验在此（dims 知识在数据层，不在存储层）：目标经 ``resolve_object`` 解析，
  未知对象或坐标越出图像 dims → 422；
- ``on_commit`` 钩子（注册表声明，如 WSI bbox → run_task）在创建成功后派发：
  钩子失败**不回滚标注**（已 201），响应附 ``hook_error``（SDD 04 §7.3）；
  钩子成功时响应附 ``hook_result``（TaskOutput dict），前端经既有回流通道呈现。
- 第三轴索引（SDD 10 §9.3/§9.5）：请求用 ``index``（``z`` 为一版 API 别名），落存储列 ``z``；
  响应行同时带 ``z``（列原值）与 ``index``（按对象第三轴命名，见 :func:`_with_index`）。
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import config
from ..annotations.store import AnnotationError, AnnotationStore, validate_primitive
from ..schemas import Index, ObjectMeta

log = logging.getLogger(__name__)

router = APIRouter(tags=["annotations"])

# 惰性装配：按当前 ANNOTATIONS_ROOT 缓存 store（monkeypatch 根目录立即反映，Atlas 范式）。
_stores: dict[Path, AnnotationStore] = {}


def get_store() -> AnnotationStore:
    root = config.ANNOTATIONS_ROOT
    if root not in _stores:
        _stores[root] = AnnotationStore(root)
    return _stores[root]


# --- 请求 schema -------------------------------------------------------------


class AnnotationIn(BaseModel):
    image_id: str = Field(min_length=1)
    index: Index | None = Field(
        default=None,
        description="第三轴索引，至多一个非空：volume=z / video=t / slide=level；2D 对象省略",
    )
    z: int | None = Field(
        default=None,
        ge=0,
        description="index 的过渡别名（W7 删）：对象第三轴取值；与 index 同传时须一致",
    )
    primitive: dict = Field(description="kind 判别几何：bbox / polyline(closed) / mask")
    mask_png_b64: str | None = Field(default=None, description="kind=mask 必填（可带 data: 前缀）")
    label: str = ""
    class_id: int | None = None
    # 建议态标注入口（SDD 02）：agent 产出一律 status=suggested + source=agent，
    # 人工确认后经 PATCH 转 confirmed。store 早已支持这两列，此前只是 REST 层未暴露。
    status: str = Field(default="draft", description="draft / suggested / confirmed / rejected")
    source: str = Field(default="manual", description="manual / model / agent")


class AnnotationPatch(BaseModel):
    base_seq: int = Field(ge=1)
    primitive: dict | None = None
    mask_png_b64: str | None = None
    label: str | None = None
    class_id: int | None = None
    status: str | None = Field(
        default=None, description="确认/驳回建议态标注：confirmed / rejected"
    )


# --- dims 解析（范围校验用） ---------------------------------------------------


def _object_meta(image_id: str) -> ObjectMeta:
    """经 ``resolve_object`` 解析对象元数据，不按 id 前缀猜。

    未知或读不出的对象不得作为标注目标（SDD 07 §7 规则 11：不降级到 best-effort 校验）
    → ``INVALID_GEOMETRY``（422）。
    """
    from .. import datasource_registry as reg

    try:
        ref = reg.resolve_object(image_id)
        return ref.source.meta(ref.datasource, image_id)
    except (LookupError, FileNotFoundError, ValueError, OSError) as exc:
        raise AnnotationError("INVALID_GEOMETRY", f"对象不存在或无法读取：{image_id}") from exc


def _dims_for(image_id: str) -> tuple[int, int]:
    """某对象的像素尺寸 (width, height)，取自 ``ObjectMeta.axes`` 的 x / y 轴（SDD 10 §13）。"""
    obj = _object_meta(image_id)
    return obj.axis("x").size, obj.axis("y").size  # type: ignore[union-attr]


def _check_within_dims(image_id: str, prim: dict) -> None:
    w, h = _dims_for(image_id)
    kind = prim["kind"]
    if kind == "bbox":
        ok = 0 <= prim["x0"] < prim["x1"] <= w and 0 <= prim["y0"] < prim["y1"] <= h
    elif kind == "polyline":
        ok = all(0 <= x <= w and 0 <= y <= h for x, y in prim["points"])
    elif kind == "point":
        ok = 0 <= prim["x"] <= w and 0 <= prim["y"] <= h
    else:
        return  # mask 无几何坐标
    if not ok:
        raise AnnotationError(
            "INVALID_GEOMETRY", f"几何越出图像 dims（{w}x{h}）：{prim['kind']}"
        )


# --- 第三轴索引（SDD 10 §9.3）------------------------------------------------

_THIRD_AXES = tuple(Index.model_fields)  # ("z", "t", "level")


def _third_axis(meta: ObjectMeta) -> str | None:
    """对象的第三轴名（取自 ``axes``，不按 kind 或 id 猜）；2D 对象为 None。"""
    return next((a.name for a in meta.axes if a.name in _THIRD_AXES), None)


def _index_to_column(image_id: str, index: Index | None, z: int | None) -> int | None:
    """把请求的 ``index`` / ``z`` 别名规约为存储列 ``z`` 的值，并用 ``check_index`` 校验。

    - ``index`` 至多一个非空轴；与 ``z`` 同传时取值须相等；
    - 只传 ``z`` 时按对象第三轴解释（volume=z / video=t / slide=level），2D 对象按 ``z`` 轴
      校验而被拒；
    - 两者皆空 → None，不做任何对象解析（2D 与"不绑定层"的标注行为不变）。
    """
    given = {k: v for k, v in (index.model_dump() if index else {}).items() if v is not None}
    if len(given) > 1:
        raise AnnotationError("INVALID_GEOMETRY", f"index 至多指定一个轴：{sorted(given)}")
    value = next(iter(given.values()), None)
    if value is not None and z is not None and value != z:
        raise AnnotationError(
            "INVALID_GEOMETRY", f"index 与别名 z 不一致：{given} vs z={z}"
        )
    if value is None and z is None:
        return None
    meta = _object_meta(image_id)
    probe = Index(**given) if given else Index(**{_third_axis(meta) or "z": z})
    try:
        meta.check_index(probe)
    except ValueError as exc:
        raise AnnotationError("INVALID_GEOMETRY", str(exc)) from exc
    return value if value is not None else z


def _axis_name_for(image_id: str) -> str | None:
    """响应 ``index`` 用的轴名；对象已无法解析时返回 None（见 :func:`_with_index`）。"""
    try:
        return _third_axis(_object_meta(image_id))
    except AnnotationError:
        return None


def _with_index(ann: dict, axis: str | None) -> dict:
    """响应行补 ``index``：按对象第三轴命名 ``z`` 列的值；列为 NULL 时为 ``{}``。

    对象已无法解析（源被移除）时轴名未知，按别名语义回落为 ``{"z": v}``——与同行的
    ``z`` 字段一致，不猜测 t / level。
    """
    v = ann["z"]
    ann["index"] = {} if v is None else {axis or "z": v}
    return ann


# --- on_commit 钩子（SDD 04 §7.3）--------------------------------------------


def _plugin_for(image_id: str):
    """对象 id → 任务插件（决定 on_commit 声明）；不认识或该模态无任务 → None。"""
    try:
        from glaux_core.tasks import REGISTRY
    except Exception:  # noqa: BLE001 - science-core 不可用
        return None
    from .. import datasource_registry as reg

    try:
        modality = reg.resolve_object(image_id).modality
    except LookupError:
        return None
    return next((p for p in REGISTRY.values() if p.modality == modality), None)


def _dispatch_on_commit(ann: dict) -> tuple[dict | None, str | None]:
    """标注落库后按注册表派发钩子。返回 (hook_result, hook_error)——钩子失败不回滚标注。

    建议态（`suggested`）不派发：它还没被人确认，此时跑任务等于让 agent 的猜测直接
    产生 Detection 副作用（SDD 02 非目标"自动确认标注"）。人工确认转 `confirmed`
    时再由确认路径派发。
    """
    if ann.get("status") == "suggested":
        return None, None
    plugin = _plugin_for(ann["image_id"])
    if plugin is None or not plugin.on_commit:
        return None, None
    hook = plugin.on_commit.get(ann["primitive"]["kind"])
    if not hook or hook.get("action") != "run_task":
        return None, None
    try:
        from .. import kernel
        from ..schemas import TaskSpec

        prim = ann["primitive"]
        spec = TaskSpec(
            task=plugin.task.value,  # type: ignore[arg-type]
            image_id=ann["image_id"],
            roi_box=(int(prim["x0"]), int(prim["y0"]), int(prim["x1"]), int(prim["y1"])),
            method=plugin.default_method,
        )
        return kernel.run_task(spec), None
    except Exception as e:  # noqa: BLE001 - 隔离环境不可用等：标注已落库，仅提示
        log.warning("on_commit 钩子失败（标注 %s）：%s", ann["id"], e)
        return None, str(e)


# --- 端点 --------------------------------------------------------------------


def _http_error(e: AnnotationError) -> HTTPException:
    status = {"NOT_FOUND": 404, "CONFLICT": 409, "INVALID_GEOMETRY": 422}.get(e.code, 400)
    return HTTPException(status, detail=f"{e.code}: {e}")


@router.get("/annotations", tags=["annotations"])
def list_annotations(
    image_id: str = Query(min_length=1),
    z: int | None = Query(default=None, ge=0),
    index_from: int | None = Query(default=None, ge=0),
    index_to: int | None = Query(default=None, ge=0),
) -> dict:
    """列出某对象的标注；``z`` 精确匹配第三轴，``index_from``/``index_to`` 为闭区间。

    区间过滤只返回绑定了第三轴取值的标注（``z`` 为 null 的行不在任何区间内）。
    """
    if index_from is not None and index_to is not None and index_from > index_to:
        raise HTTPException(422, detail=f"index_from({index_from}) > index_to({index_to})")
    rows = get_store().list(image_id, z, z_from=index_from, z_to=index_to)
    axis = _axis_name_for(image_id) if rows else None
    return {"annotations": [_with_index(r, axis) for r in rows]}


@router.post("/annotations", status_code=201, tags=["annotations"])
def create_annotation(body: AnnotationIn) -> dict:
    """创建标注（服务端分配 id，seq=1）；成功后按注册表派发 on_commit 钩子。"""
    kind = body.primitive.get("kind", "")
    try:
        prim = validate_primitive(kind, body.primitive)
        _check_within_dims(body.image_id, prim)
        z = _index_to_column(body.image_id, body.index, body.z)
        ann = get_store().create(
            image_id=body.image_id,
            z=z,
            kind=kind,
            primitive=body.primitive,
            label=body.label,
            class_id=body.class_id,
            status=body.status,
            source=body.source,
            mask_png_b64=body.mask_png_b64,
        )
    except AnnotationError as e:
        raise _http_error(e) from e
    out: dict = {"annotation": _with_index(ann, _axis_name_for(ann["image_id"]))}
    hook_result, hook_error = _dispatch_on_commit(ann)
    if hook_result is not None:
        out["hook_result"] = hook_result
    if hook_error is not None:
        out["hook_error"] = hook_error
    return out


@router.patch("/annotations/{annotation_id}", tags=["annotations"])
def update_annotation(annotation_id: str, body: AnnotationPatch) -> dict:
    """更新几何/标签/状态（携带 base_seq；不匹配 → 409 CONFLICT，不落写）。

    建议态确认（`suggested` → `confirmed`）在此补派 `on_commit`——创建时因未确认而
    跳过的钩子，到确认这一刻才该跑（SDD 02：人工确认后才转正式标注）。
    """
    if body.primitive is not None and body.mask_png_b64 is not None:
        body.primitive = {**body.primitive, "mask_png_b64": body.mask_png_b64}
    try:
        before = get_store().get(annotation_id)
        if body.primitive is not None and before is not None:
            _check_within_dims(
                before["image_id"],
                validate_primitive(before["primitive"]["kind"], body.primitive),
            )
        ann = get_store().update(
            annotation_id,
            body.base_seq,
            primitive=body.primitive,
            label=body.label,
            class_id=body.class_id,
            status=body.status,
        )
    except AnnotationError as e:
        raise _http_error(e) from e
    out: dict = {"annotation": _with_index(ann, _axis_name_for(ann["image_id"]))}
    if before is not None and before["status"] == "suggested" and ann["status"] == "confirmed":
        hook_result, hook_error = _dispatch_on_commit(ann)
        if hook_result is not None:
            out["hook_result"] = hook_result
        if hook_error is not None:
            out["hook_error"] = hook_error
    return out


@router.delete("/annotations/{annotation_id}", status_code=204, tags=["annotations"])
def delete_annotation(annotation_id: str, base_seq: int = Query(ge=1)) -> None:
    """删除标注（携带 base_seq；mask 文件连带删除）。"""
    try:
        get_store().delete(annotation_id, base_seq)
    except AnnotationError as e:
        raise _http_error(e) from e


@router.get("/annotations/{annotation_id}/mask", tags=["annotations"])
def get_mask_png(annotation_id: str) -> FileResponse:
    """mask 标注的 PNG 栅格（reload 后前端叠色渲染用）；非 mask 标注 → 404。"""
    row = get_store().get(annotation_id)
    if row is None:
        raise HTTPException(status_code=404, detail="标注不存在")
    ref = row["primitive"].get("ref")
    p = config.ANNOTATIONS_ROOT / ref if ref else None
    if not p or not p.is_file():
        raise HTTPException(status_code=404, detail="非 mask 标注或栅格缺失")
    return FileResponse(p, media_type="image/png")
