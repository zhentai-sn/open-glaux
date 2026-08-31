"""统一标注 REST（SDD 04 §8.2/§7.3/§13）——``/annotations`` CRUD + base_seq + on_commit。

- 几何**范围**校验在此（dims 知识在数据层，不在存储层）：坐标越出图像 dims → 422；
- ``on_commit`` 钩子（注册表声明，如 WSI bbox → run_task）在创建成功后派发：
  钩子失败**不回滚标注**（已 201），响应附 ``hook_error``（SDD 04 §7.3）；
  钩子成功时响应附 ``hook_result``（TaskOutput dict），前端经既有回流通道呈现。
"""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .. import config
from ..annotations.store import AnnotationError, AnnotationStore, validate_primitive

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
    z: int | None = Field(default=None, ge=0, description="CT 逐切片层号；2D/WSI 为 null")
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


# --- dims 解析（范围校验用；未知对象 → None → 跳过校验） -----------------------


def _dims_for(image_id: str) -> tuple[int, int] | None:
    """某对象的像素尺寸 (width, height)：WSI level-0 / CT 单层 / US tiff；不认识 → None。"""
    # 通用图像两类前缀：natural_*（SDD 07 内置白名单）与 nat-*（SDD 08 导入源）。
    # 两者都必须走真实尺寸校验——漏掉 nat- 会让上传图掉进下面的 best-effort 分支（dims=None →
    # 跳过范围校验），于是越界 bbox 被静默接受，正是 SDD 07 §7.11 禁止的降级。
    if image_id.startswith(("natural_", "nat-")):
        try:
            from .. import dataset_natural

            return dataset_natural.image_size(image_id)
        except FileNotFoundError as exc:
            raise AnnotationError("INVALID_GEOMETRY", f"通用图像不存在或损坏：{image_id}") from exc
    try:
        from .. import dataset_wsi

        if dataset_wsi.is_wsi(image_id):
            return dataset_wsi.dims(image_id)
    except Exception:  # noqa: BLE001 - 数据层不可用即跳过校验
        pass
    try:
        from .. import dataset_ct

        if dataset_ct.is_ct(image_id):
            _z, y, x = dataset_ct.shape(image_id)
            return (x, y)
    except Exception:  # noqa: BLE001
        pass
    try:
        # glob 的 pattern 由 image_id 拼成——形如 "/api/image/x" 的越界值会让 Path.glob
        # 抛 NotImplementedError（绝对模式不支持），整个包起来，未知对象一律走 best-effort。
        for p in config.IMAGES_DIR.glob(f"{image_id}.tif*"):
            try:
                from PIL import Image

                with Image.open(p) as im:
                    return im.size  # (width, height)
            except Exception:  # noqa: BLE001
                pass
    except Exception:  # noqa: BLE001 - 非法 id 不该 500，交给结构校验/best-effort
        return None
    return None


def _check_within_dims(image_id: str, prim: dict) -> None:
    dims = _dims_for(image_id)
    if dims is None:
        return  # 未知对象 → best-effort 不拦（结构校验已在 store）
    w, h = dims
    kind = prim["kind"]
    if kind == "bbox":
        ok = 0 <= prim["x0"] < prim["x1"] <= w and 0 <= prim["y0"] < prim["y1"] <= h
    elif kind == "polyline":
        ok = all(0 <= x <= w and 0 <= y <= h for x, y in prim["points"])
    else:
        return  # mask 无几何坐标
    if not ok:
        raise AnnotationError(
            "INVALID_GEOMETRY", f"几何越出图像 dims（{w}x{h}）：{prim['kind']}"
        )


# --- on_commit 钩子（SDD 04 §7.3）--------------------------------------------


def _plugin_for(image_id: str):
    """对象 id → 任务插件（决定 on_commit 声明）；不认识 → None。"""
    try:
        from glaux_core.tasks import REGISTRY, TaskType
    except Exception:  # noqa: BLE001 - science-core 不可用
        return None
    try:
        from .. import dataset_wsi

        if dataset_wsi.is_wsi(image_id):
            return REGISTRY[TaskType.NUCLEI_DETECTION]
    except Exception:  # noqa: BLE001
        pass
    return None


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
) -> dict:
    """列出某对象（可选 z 层）的全部标注。"""
    return {"annotations": get_store().list(image_id, z)}


@router.post("/annotations", status_code=201, tags=["annotations"])
def create_annotation(body: AnnotationIn) -> dict:
    """创建标注（服务端分配 id，seq=1）；成功后按注册表派发 on_commit 钩子。"""
    kind = body.primitive.get("kind", "")
    try:
        prim = validate_primitive(kind, body.primitive)
        _check_within_dims(body.image_id, prim)
        ann = get_store().create(
            image_id=body.image_id,
            z=body.z,
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
    out: dict = {"annotation": ann}
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
    out: dict = {"annotation": ann}
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
