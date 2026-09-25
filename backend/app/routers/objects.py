"""``/objects`` 表征面（SDD 10 §5.2）：一个对象的元数据与全部表征字节。

五个端点内部一律先过 ``resolve_object``，之后只经 ``ObjectRef.source`` 取数（§6.5），
无任何模态分支。错误语义见 §13：未知 id 404；kind 与端点不符、索引越界、参数非法 422；
超限 413；依赖不可用 503；编辑并发冲突 409。没有 ``GET /objects`` 列表端点（D-5）。

旧表征端点已删除；保留的任务结果端点在 ``routers/api.py``（§5.3）。
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response

from .. import datasource_registry as dsreg
from ..schemas import EditRequest, Index, ObjectMeta, Region
from ..sources.base import FrameTooLarge, ObjectRef

router = APIRouter(prefix="/objects", tags=["objects"])

#: §5.2 冻结取值：输出最长边缺省与上限、roi 面积上限（level-0 / 帧像素）。
SIZE_DEFAULT = 1024
SIZE_MIN, SIZE_MAX = 64, 4096
ROI_MAX_PX = 64_000_000


def resolve(object_id: str) -> tuple[ObjectRef, ObjectMeta]:
    try:
        ref = dsreg.resolve_object(object_id)
    except LookupError as e:
        raise HTTPException(404, f"对象不存在：{object_id}") from e
    try:
        obj = ref.source.meta(ref.datasource, object_id)
    except FileNotFoundError as e:
        raise HTTPException(404, f"对象不存在：{object_id}") from e
    return ref, obj


def _ints(raw: str, n: int, name: str) -> list[int]:
    try:
        vals = [int(v) for v in raw.split(",")]
    except ValueError as e:
        raise HTTPException(422, f"{name} 须为 {n} 个整数：{raw}") from e
    if len(vals) != n:
        raise HTTPException(422, f"{name} 须为 {n} 个整数：{raw}")
    return vals


def _frame_header(frame) -> str:
    return json.dumps(frame.model_dump(mode="json"), separators=(",", ":"), ensure_ascii=False)


# --- 内部函数（端点与 alias 共用） -----------------------------------------------


def raw_bytes(object_id: str) -> tuple[bytes, str]:
    ref, _ = resolve(object_id)
    try:
        got = ref.source.raw(ref.datasource, object_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    if got is None:
        raise HTTPException(422, f"该对象没有此表征：{ref.kind} 无 raw")
    data, mime = got
    return (Path(data).read_bytes() if isinstance(data, Path) else data), mime


def tile_bytes(object_id: str, level: int, col: int, row: int) -> bytes:
    ref, obj = resolve(object_id)
    if "tiles" not in obj.resources:
        raise HTTPException(422, f"该对象没有此表征：{ref.kind} 无瓦片")
    try:
        data = ref.source.tile(ref.datasource, object_id, level, col, row)
    except ValueError as e:  # 层级 / 行列越界
        raise HTTPException(404, str(e)) from e
    if data is None:
        raise HTTPException(422, f"该对象没有此表征：{ref.kind} 无瓦片")
    return data


def apply_edit(object_id: str, req: EditRequest) -> dict:
    from glaux_core.tasks import REGISTRY, TaskType

    from ..dataset_ct import StaleEditError
    from ..detectors import DETECTORS

    ref, obj = resolve(object_id)
    plugin = REGISTRY[TaskType(req.task)]
    if ref.kind not in plugin.object_kinds:
        raise HTTPException(422, f"任务 {req.task} 不适用于 {ref.kind} 对象")
    try:
        out = DETECTORS[plugin.adapter_kind].apply_edit(ref, obj, req)
    except StaleEditError as e:  # 并发编辑被超越——回带服务端当前 seq 供客户端重取重试
        raise HTTPException(409, str(e)) from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(404, f"labelmap 缓存未命中：{req.method}——先跑 /task/run") from e
    if out is None:
        raise HTTPException(422, f"该对象没有此表征：任务 {req.task} 不支持编辑")
    return out


# --- 端点 ------------------------------------------------------------------------


@router.get("/{object_id}", response_model=ObjectMeta)
def object_meta(object_id: str) -> ObjectMeta:
    """对象元数据；与 ``GET /images?modality=`` 的列表元素逐字段等价（同一构造路径）。"""
    return resolve(object_id)[1]


@router.get("/{object_id}/frame")
def object_frame(
    object_id: str,
    z: int | None = None,
    t: int | None = None,
    level: int | None = None,
    roi: str | None = Query(default=None, description="x0,y0,x1,y1（level-0 / 帧像素）"),
    size: int = Query(default=SIZE_DEFAULT, description="输出最长边上限"),
    window: str | None = Query(default=None, description="ww,wl"),
) -> Response:
    """单帧观测 + ``X-Glaux-Frame``（``ReferenceFrame`` 紧凑 JSON）。"""
    ref, obj = resolve(object_id)
    index = Index(z=z, t=t, level=level)
    try:
        obj.check_index(index)  # 请求了该 kind 没有的轴 / 越界 → 422
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    if size > SIZE_MAX:
        raise HTTPException(413, f"size 超过上限 {SIZE_MAX}")
    if size < SIZE_MIN:
        raise HTTPException(422, f"size 须 ≥ {SIZE_MIN}")
    region = None
    if roi is not None:
        x0, y0, x1, y1 = _ints(roi, 4, "roi")
        if not (x0 < x1 and y0 < y1):
            raise HTTPException(422, f"roi 须 x0<x1 且 y0<y1：{roi}")
        if (x1 - x0) * (y1 - y0) > ROI_MAX_PX:
            raise HTTPException(413, "选区过大，请缩小范围或降低分辨率")
        region = Region(kind="box", x0=x0, y0=y0, x1=x1, y1=y1)
    win = None
    if window is not None:
        try:
            ww, wl = (float(v) for v in window.split(","))
        except ValueError as e:
            raise HTTPException(422, f"window 须为 ww,wl：{window}") from e
        if ww <= 0:
            raise HTTPException(422, "窗宽须为正")
        win = (ww, wl) if ref.source.supports_window else None  # 不支持时忽略（§5.2）
    try:
        data, mime, frame = ref.source.frame(
            ref.datasource, object_id, index, roi=region, size=size, window=win
        )
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    except NotImplementedError as e:
        raise HTTPException(422, f"该对象没有此表征：{e}") from e
    except FrameTooLarge as e:
        raise HTTPException(413, f"选区过大，请缩小范围或降低分辨率：{e}") from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    headers = {"X-Glaux-Frame": _frame_header(frame)}
    time_ms = ref.source.frame_time_ms(ref.datasource, object_id, index)
    if time_ms is not None:
        headers["X-Glaux-Frame-Time"] = str(time_ms)
    return Response(content=data, media_type=mime, headers=headers)


@router.get("/{object_id}/raw")
def object_raw(object_id: str) -> Response:
    data, mime = raw_bytes(object_id)
    return Response(content=data, media_type=mime)


@router.get("/{object_id}/clip")
def object_clip(
    object_id: str, start_ms: int, end_ms: int, source_sha256: str | None = None
) -> Response:
    """SDD 11 §9：私有原声短片段及原视频时间映射。"""
    from ..video_clip import ClipTooLarge, VideoSourceChanged

    ref, obj = resolve(object_id)
    if "clip" not in obj.resources:
        raise HTTPException(422, "该对象没有视频片段表征")
    try:
        result = ref.source.clip(ref.datasource, object_id, start_ms, end_ms, source_sha256)
    except FileNotFoundError as exc:
        raise HTTPException(404, "视频源已失效") from exc
    except ClipTooLarge as exc:
        raise HTTPException(413, f"clip_too_large：{exc}") from exc
    except VideoSourceChanged as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if result is None:
        raise HTTPException(422, "该对象没有视频片段表征")
    body, header = result
    return Response(
        content=body,
        media_type="video/mp4",
        headers={"X-Glaux-Clip": json.dumps(header, separators=(",", ":"))},
    )


@router.get("/{object_id}/frame-at")
def object_frame_at(
    object_id: str, time_ms: int, source_sha256: str | None = None
) -> Response:
    """SDD 11 §9：按源 PTS 取最接近的帧及 ReferenceFrame。"""
    from ..video_clip import VideoSourceChanged

    ref, obj = resolve(object_id)
    if "clip" not in obj.resources:
        raise HTTPException(422, "该对象没有视频时间帧表征")
    try:
        result = ref.source.frame_at_time(ref.datasource, object_id, time_ms, source_sha256)
    except FileNotFoundError as exc:
        raise HTTPException(404, "视频源已失效") from exc
    except VideoSourceChanged as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if result is None:
        raise HTTPException(422, "该对象没有视频时间帧表征")
    body, mime, frame, actual_ms, tolerance_ms = result
    return Response(
        content=body,
        media_type=mime,
        headers={
            "X-Glaux-Frame": _frame_header(frame),
            "X-Glaux-Frame-Time": str(actual_ms),
            "X-Glaux-Frame-Tolerance": str(tolerance_ms),
        },
    )


@router.get("/{object_id}/tiles/{level}/{col}/{row}")
def object_tile(object_id: str, level: int, col: int, row: int) -> Response:
    return Response(content=tile_bytes(object_id, level, col, row), media_type="image/jpeg")


@router.post("/{object_id}/edits")
def object_edits(object_id: str, req: EditRequest) -> dict:
    """掩膜编辑（``base_seq`` 乐观并发，冲突 409）→ 按注册表重测；派发 ``Detector.apply_edit``。"""
    return apply_edit(object_id, req)
