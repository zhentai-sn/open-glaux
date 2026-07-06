"""§5 契约的八个端点——M0 mock 实现，形状即最终契约。

M1 计划（不改形状，只换实现）：
  /interpret → glaux_orchestrator.intent
  /run       → glaux_orchestrator.run_spec
  /measure   → glaux_imt.measurement.pdm.imt（共同支撑 + 对称 PDM）
  /images    → glaux_imt.io.cubs.read_dataset
  /image     → 真实 tiff→PNG
  /models    → ModelAdapter 注册表
  /segment   → caroSegDeep 隔离子进程（主进程仍无 TF）
  /correction→ 记忆层 schema (U7)
"""

from __future__ import annotations

from fastapi import APIRouter, Response

from .. import mock
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

router = APIRouter()


@router.post("/interpret", response_model=IntentResult, tags=["intent"])
def interpret(req: InterpretRequest) -> IntentResult:
    """NL(+image) → 三态守卫。非 in_scope 不带 spec、不碰内核。"""
    return mock.classify(req.nl, image_id=req.image_id, cubs_cf=req.cubs_cf)


@router.post("/run", response_model=TaskResult, tags=["run"])
def run(spec: TaskSpec) -> TaskResult:
    """规范驱动内核：标定→分割→对称 PDM 测量。缺标定应硬拒绝（M1 接内核）。"""
    cf = spec.cubs_cf or mock.CF_CANONICAL
    roi = spec.roi
    li, ma = mock.segment_boundaries(roi)
    m = mock.measure(li, ma, cf)
    return TaskResult(
        **m,
        cf=cf,
        cf_source="cubs",
        model_version="caroSegDeep@mock",
        roi=roi,
    )


@router.post("/measure", response_model=IMTResult, tags=["measure"])
def measure(req: MeasureRequest) -> IMTResult:
    """权威测量口径（共同支撑 + 对称 PDM）——拖拽修正松手后取此值。"""
    m = mock.measure(req.li, req.ma, req.cf)
    return IMTResult(**m)


@router.get("/images", response_model=list[ImageMeta], tags=["dataset"])
def images(job: str | None = None) -> list[ImageMeta]:
    return mock.dataset()


@router.get("/image/{image_id}", tags=["dataset"])
def image(image_id: str) -> Response:
    """灰度 B-mode PNG（M0：示意渲染；M1：真实 tiff→PNG）。"""
    return Response(content=mock.synthetic_png(image_id), media_type="image/png")


@router.get("/models", response_model=list[ModelInfo], tags=["models"])
def models() -> list[ModelInfo]:
    return mock.models()


@router.post("/segment", response_model=SegmentResult, tags=["segment"])
def segment(req: SegmentRequest) -> SegmentResult:
    """分割适配器——M1 经 caroSegDeep 隔离子进程；主进程无 TF 依赖。"""
    li, ma = mock.segment_boundaries(req.roi)
    return SegmentResult(li=li, ma=ma, model_version=f"{req.model}@mock")


@router.post("/correction", response_model=CorrectionResult, tags=["correction"])
def correction(req: CorrectionRequest) -> CorrectionResult:
    """人工修正回流记忆层（M1 落 U7 schema）。"""
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
