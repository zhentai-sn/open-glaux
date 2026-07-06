"""§5 契约的八个端点——M1 真实接入（science-core / orchestration / caroSegDeep）。

真实资产不可用时优雅回退 mock（见 mock.py），使无数据环境/CI 也能起。
- /interpret  → orchestrator.intent（真实三态守卫）
- /run        → 标定(dataset CF) → 分割(segment_proc) → 对齐口径 imt
- /measure    → measurement.pdm.imt（共同支撑 + 对称 PDM）
- /images     → dataset.list_ids（tech_401–500 演示队列）
- /image      → 真实 tiff→PNG（PIL；主进程无 TF）
- /models     → 真实方法注册表（caroSegDeep + 参考方法）
- /segment    → caroSegDeep 缓存优先 + .venv-csd 隔离子进程兜底
- /correction → 记忆层占位（U7 schema 落地在 M2/F11）
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Response

from .. import config, mock
from ..schemas import (
    CorrectionRequest,
    CorrectionResult,
    ImageMeta,
    IMTResult,
    InterpretRequest,
    IntentResult,
    MeasureRequest,
    ModelInfo,
    SegmentRequest,
    SegmentResult,
    TaskResult,
    TaskSpec,
)

log = logging.getLogger("glaux.api")
router = APIRouter()

# 内核/编排是否可 import（纯 numpy/PIL）；数据端点再叠加 data_available()。
try:
    from .. import dataset, kernel, segment_proc

    KERNEL_OK = True
except Exception as exc:  # pragma: no cover - 缺 science-core 时的降级
    log.warning("内核不可用，端点回退 mock：%s", exc)
    KERNEL_OK = False


def _has_data() -> bool:
    return KERNEL_OK and config.data_available()


@router.post("/interpret", response_model=IntentResult, tags=["intent"])
def interpret(req: InterpretRequest) -> IntentResult:
    if KERNEL_OK:
        try:
            return kernel.interpret(req.nl, image_id=req.image_id, cubs_cf=req.cubs_cf)
        except Exception:  # pragma: no cover
            log.exception("interpret 内核失败，回退 mock")
    return mock.classify(req.nl, image_id=req.image_id, cubs_cf=req.cubs_cf)


@router.post("/run", response_model=TaskResult, tags=["run"])
def run(spec: TaskSpec) -> TaskResult:
    """规范驱动：标定 → 分割 → 对齐口径测量。缺标定 → 硬拒绝（422，不出假 IMT）。"""
    if not _has_data():
        cf = spec.cubs_cf or mock.CF_CANONICAL
        li, ma = mock.segment_boundaries(spec.roi)
        return TaskResult(**mock.measure(li, ma, cf), cf=cf, cf_source="cubs",
                          model_version="caroSegDeep@mock", roi=spec.roi)

    if not spec.image_id:
        raise HTTPException(422, "run 需要 image_id")
    cf = spec.cubs_cf if spec.cubs_cf else dataset.cf_of(spec.image_id)
    if not cf:
        raise HTTPException(422, f"标定不可用：{spec.image_id} 无 CF——硬拒绝，不出假 IMT")
    method = spec.method or dataset.CARO
    try:
        li, ma, model_version = segment_proc.segment(spec.image_id, method)
    except (segment_proc.SegmentUnavailable, FileNotFoundError) as e:
        raise HTTPException(503, f"分割不可用：{e}") from e
    m = kernel.measure(li, ma, cf, x_window=tuple(spec.roi) if spec.roi else None)
    xs = [p[0] for p in li]
    roi = spec.roi or (int(min(xs)), int(max(xs)))
    vs_a1 = _vs_a1_um(spec.image_id, m.pdm_mean_mm, cf) if method != "Manual-A1" else 0.0
    return TaskResult(**m.model_dump(), cf=cf, cf_source="cubs",
                      model_version=model_version, roi=roi, vs_a1_um=vs_a1)


def _vs_a1_um(image_id: str, pdm_mm: float, cf: float) -> float | None:
    """与金标准 Manual-A1 的 |bias|（µm）；无 A1 边界则 None。"""
    try:
        li, ma = dataset.boundaries_as_points(image_id, "Manual-A1")
    except FileNotFoundError:
        return None
    a1 = kernel.measure(li, ma, cf)
    return round(abs(pdm_mm - a1.pdm_mean_mm) * 1000, 1)


@router.post("/measure", response_model=IMTResult, tags=["measure"])
def measure(req: MeasureRequest) -> IMTResult:
    if KERNEL_OK:
        try:
            return kernel.measure(req.li, req.ma, req.cf, x_window=req.x_window)
        except Exception:  # pragma: no cover
            log.exception("measure 内核失败，回退 mock")
    return IMTResult(**mock.measure(req.li, req.ma, req.cf))


@router.get("/images", response_model=list[ImageMeta], tags=["dataset"])
def images(job: str | None = None) -> list[ImageMeta]:
    if not _has_data():
        return mock.dataset()
    return [ImageMeta(**dataset.image_meta(i)) for i in dataset.list_ids()]


@router.get("/image/{image_id}", tags=["dataset"])
def image(image_id: str) -> Response:
    if not _has_data():
        return Response(content=mock.synthetic_png(image_id), media_type="image/png")
    try:
        return Response(content=dataset.image_png(image_id), media_type="image/png")
    except FileNotFoundError as e:
        raise HTTPException(404, f"图像不存在：{image_id}") from e


@router.get("/models", response_model=list[ModelInfo], tags=["models"])
def models() -> list[ModelInfo]:
    if not _has_data():
        return mock.models()
    return kernel.models()


@router.post("/segment", response_model=SegmentResult, tags=["segment"])
def segment(req: SegmentRequest) -> SegmentResult:
    """分割/取某方法边界——caroSegDeep 缓存优先 + 隔离子进程；主进程无 TF。"""
    if not _has_data():
        li, ma = mock.segment_boundaries(req.roi)
        return SegmentResult(li=li, ma=ma, model_version=f"{req.model}@mock")
    try:
        li, ma, mv = segment_proc.segment(req.image_id, req.model)
    except (segment_proc.SegmentUnavailable, FileNotFoundError) as e:
        raise HTTPException(503, f"分割不可用：{e}") from e
    return SegmentResult(li=li, ma=ma, model_version=mv)


@router.post("/correction", response_model=CorrectionResult, tags=["correction"])
def correction(req: CorrectionRequest) -> CorrectionResult:
    return CorrectionResult(
        ok=True,
        provenance={
            "image_id": req.image_id,
            "which": req.which,
            "source": "human",
            "n_points": len(req.points),
            "imt_mm": req.imt,
        },
    )
