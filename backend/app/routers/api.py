"""后端契约端点——真实接入（science-core / orchestration / caroSegDeep）。

真实资产不可用时优雅回退 mock（见 mock.py），使无数据环境/CI 也能起。
- /interpret    → orchestrator.intent（真实三态守卫）
- /tasks        → 任务注册表（多模态前端的单一真相源）
- /task/run     → 统一驱动：取数 → 测量 → TaskOutput（多模态通吃）
- /task/detect  → 只出几何原语（不测量）
- /task/measure → 由编辑后的图元重测（泛型替代旧 /measure + /hc/measure）
- /images       → dataset.list_ids（tech_401–500 演示队列）
- /image        → 真实 tiff→PNG（PIL；主进程无 TF）
- /models       → 真实方法注册表（caroSegDeep + 参考方法 + HC）
- /correction   → 记忆层占位（U7 schema 落地在 M2/F11）
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Response

from .. import config, mock
from ..schemas import (
    Capability,
    CorrectionRequest,
    CorrectionResult,
    ImageMeta,
    IntentBackendInfo,
    InterpretRequest,
    IntentResult,
    Modality,
    ModelInfo,
    TaskMeasureRequest,
    TaskSpec,
)

log = logging.getLogger("glaux.api")
router = APIRouter()

# 内核/编排是否可 import（纯 numpy/PIL）；数据端点再叠加 data_available()。
try:
    from glaux_orchestrator.intent import IntentBackendUnavailable

    from .. import dataset, hc_dataset, kernel

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


@router.get("/capabilities", response_model=list[Capability], tags=["capabilities"])
def capabilities() -> list[Capability]:
    """能力注册表——「插件市场」的单一真相源（模型/数据集/skill/连接器/MCP/知识库，按四层分组）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "能力注册表需 science-core（未装配）")
    return [Capability(**c) for c in kernel.capabilities()]


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
