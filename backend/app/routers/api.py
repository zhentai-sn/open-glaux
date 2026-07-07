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
    HCMeasureRequest,
    HCResult,
    HCRunRequest,
    HCRunResult,
    ImageMeta,
    IMTResult,
    IntentBackendInfo,
    InterpretRequest,
    IntentResult,
    MeasureRequest,
    Modality,
    ModelInfo,
    SegmentRequest,
    SegmentResult,
    TaskMeasureRequest,
    TaskResult,
    TaskSpec,
)

log = logging.getLogger("glaux.api")
router = APIRouter()

# 内核/编排是否可 import（纯 numpy/PIL）；数据端点再叠加 data_available()。
try:
    from glaux_orchestrator.intent import IntentBackendUnavailable

    from .. import dataset, hc_dataset, kernel, segment_proc

    KERNEL_OK = True
except Exception as exc:  # pragma: no cover - 缺 science-core 时的降级
    log.warning("内核不可用，端点回退 mock：%s", exc)
    KERNEL_OK = False

    class IntentBackendUnavailable(Exception):  # 降级占位，保证 except 名可解析
        ...


def _has_data() -> bool:
    return KERNEL_OK and config.data_available()


@router.get("/intent/backends", response_model=list[IntentBackendInfo], tags=["intent"])
def intent_backends() -> list[IntentBackendInfo]:
    """意图后端及可用性（rule 恒可用；vlm 需 anthropic + 密钥）。"""
    if KERNEL_OK:
        return [IntentBackendInfo(**b) for b in kernel.intent_backends()]
    return [IntentBackendInfo(id="rule", name="Rule-based", available=True, reason="mock")]


@router.post("/interpret", response_model=IntentResult, tags=["intent"])
def interpret(req: InterpretRequest) -> IntentResult:
    if KERNEL_OK:
        try:
            return kernel.interpret(
                req.nl, image_id=req.image_id, cubs_cf=req.cubs_cf,
                backend=req.backend, api_key=req.api_key, model=req.model,
            )
        except IntentBackendUnavailable as e:
            # VLM 被选中但不可用 → 显式 503（不静默退化到规则）
            raise HTTPException(503, f"意图后端不可用：{e}") from e
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
def images(job: str | None = None, modality: Modality = "carotid_imt") -> list[ImageMeta]:
    if modality == "fetal_hc":
        if not KERNEL_OK:
            raise HTTPException(503, "HC 模态需 science-core（未装配）")
        return [ImageMeta(**hc_dataset.image_meta(i)) for i in hc_dataset.list_ids()]
    if not _has_data():
        return mock.dataset()
    return [ImageMeta(**dataset.image_meta(i)) for i in dataset.list_ids()]


@router.get("/image/{image_id}", tags=["dataset"])
def image(image_id: str) -> Response:
    if KERNEL_OK and hc_dataset.is_hc(image_id):  # 合成 HC 图（无需外部数据）
        return Response(content=hc_dataset.image_png(image_id), media_type="image/png")
    if not _has_data():
        return Response(content=mock.synthetic_png(image_id), media_type="image/png")
    try:
        return Response(content=dataset.image_png(image_id), media_type="image/png")
    except FileNotFoundError as e:
        raise HTTPException(404, f"图像不存在：{image_id}") from e


# --- 胎儿头围（HC）模态端点 -------------------------------------------------

@router.post("/hc/run", response_model=HCRunResult, tags=["hc"])
def hc_run(req: HCRunRequest) -> HCRunResult:
    """HC 规范驱动：合成图 → 真椭圆检测 → Ramanujan 周长 → 对真值偏差。"""
    if not KERNEL_OK:
        raise HTTPException(503, "HC 模态需 science-core（未装配）")
    if not hc_dataset.is_hc(req.image_id):
        raise HTTPException(422, f"非 HC 图像 id：{req.image_id}")
    cf = req.cubs_cf or hc_dataset.cf_of(req.image_id)
    try:
        return kernel.hc_run(req.image_id, cf, roi=tuple(req.roi) if req.roi else None)
    except Exception as e:  # 检测失败（亮环不足等）→ 显式失败，不出假 HC
        raise HTTPException(503, f"HC 检测不可用：{e}") from e


@router.post("/hc/measure", response_model=HCResult, tags=["hc"])
def hc_measure(req: HCMeasureRequest) -> HCResult:
    """由轮廓点算头围——用户编辑颅骨轮廓后即时重测。"""
    if not KERNEL_OK:
        raise HTTPException(503, "HC 模态需 science-core（未装配）")
    try:
        return kernel.hc_measure(req.points, req.cf)
    except ValueError as e:
        raise HTTPException(422, f"HC 测量失败：{e}") from e


@router.get("/tasks", tags=["tasks"])
def tasks() -> list[dict]:
    """任务注册表——前端据此渲染模态切换/工具栏/测量字段，不再硬编码 if 模态。

    这是多模态前端的**单一真相源**：viewer 引擎、工具集、度量字段、overlay 画法全从这里来。
    """
    if not KERNEL_OK:
        raise HTTPException(503, "任务注册表需 science-core（未装配）")
    return kernel.tasks()


# --- 统一驱动端点（多模态·P2.0；与旧端点并存，P2.5 删旧） -------------------

@router.post("/task/run", tags=["task"])
def task_run(spec: TaskSpec) -> dict:
    """统一驱动：取数 → 测量 → TaskOutput（度量字典 + 待绘 primitives + 金标准对比）。

    多模态通吃（IMT/HC/…）：桥接子进程/缓存流到统一信封。缺标定→422，检测不可用→503。
    """
    if not KERNEL_OK:
        raise HTTPException(503, "统一驱动需 science-core（未装配）")
    try:
        return kernel.run_task(spec)
    except ValueError as e:  # 缺标定 / 缺 image_id / 测量前置不满足 → 硬拒绝
        raise HTTPException(422, str(e)) from e
    except Exception as e:  # 分割/检测不可用（子进程/隔离环境/缓存缺失）
        raise HTTPException(503, f"检测/运行不可用：{e}") from e


@router.post("/task/detect", tags=["task"])
def task_detect(spec: TaskSpec) -> dict:
    """只检测几何原语（不测量）——供渲染/未测状态。返回 Detection（primitives + model_version）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "统一检测需 science-core（未装配）")
    try:
        return kernel.detect_task(spec)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except Exception as e:
        raise HTTPException(503, f"检测不可用：{e}") from e


@router.post("/task/measure", tags=["task"])
def task_measure(req: TaskMeasureRequest) -> dict:
    """统一测量：由前端编辑后的图元重测（泛型替代 /measure + /hc/measure）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "统一测量需 science-core（未装配）")
    try:
        return kernel.measure_task(req.task, req.primitives, req.cf)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e


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
