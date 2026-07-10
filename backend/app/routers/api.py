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
from pathlib import Path
from typing import Literal

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

    from .. import dataset, dataset_ct, hc_dataset, kernel, segment_ts

    KERNEL_OK = True
except Exception as exc:  # pragma: no cover - 缺 science-core 时的降级
    log.warning("内核不可用，端点回退 mock：%s", exc)
    KERNEL_OK = False

    class IntentBackendUnavailable(Exception):  # 降级占位，保证 except 名可解析
        ...

    # P6: 缺 science-core 时也让 import 不挂——KERNEL_OK=False 已足以让 ct 端点走 503
    segment_ts = None  # type: ignore[assignment]
    dataset_ct = None  # type: ignore[assignment]


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
    if modality == "ct_abdomen":  # P6
        if not KERNEL_OK:
            raise HTTPException(503, "CT 模态需 science-core（未装配）")
        return [ImageMeta(**dataset_ct.image_meta(i)) for i in dataset_ct.list_ids()]
    if not _has_data():
        return mock.dataset()
    return [ImageMeta(**dataset.image_meta(i)) for i in dataset.list_ids()]


@router.get("/volumes", response_model=list[ImageMeta], tags=["dataset"])
def volumes() -> list[ImageMeta]:
    """P6：CT 体积列表——与 /images?modality=ct_abdomen 同源；分端点便于前端 discovery。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    if not dataset_ct.is_ct.__module__:  # 防御性：import 后再看
        raise HTTPException(503, "CT dataset 模块未装配")
    return [ImageMeta(**dataset_ct.image_meta(i)) for i in dataset_ct.list_ids()]


@router.get("/volume/{volume_id}", tags=["dataset"])
def volume_stream(volume_id: str) -> Response:
    """P6：流式返回 CT 原始 NIfTI 字节（前端 CS3D DICOM image loader 走 wadouri:）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    try:
        path = dataset_ct.nifti_path(volume_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    # 流式给前端；二进制 NIfTI 字节
    with open(path, "rb") as f:
        data = f.read()
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"X-Glaux-Volume-Id": volume_id, "Content-Length": str(len(data))},
    )


@router.get("/volume/{volume_id}/labelmap", tags=["dataset"])
def volume_labelmap(volume_id: str, task: str = "totalseg_liver_kidney", method: str = "totalsegmentator_v2") -> Response:
    """P6：流式返回 labelmap NIfTI 字节（缓存命中直返；未命中 → 422 提示先 POST /volume/{id}/segment）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    if not dataset_ct.is_ct(volume_id):
        raise HTTPException(404, f"非 CT volume id：{volume_id}")
    labelmap_path = segment_ts.labelmap_path(volume_id, method)
    if not Path(labelmap_path).is_file():
        raise HTTPException(
            404,
            f"labelmap 缓存未命中：{volume_id} {method}——先调 POST /volume/{id}/segment",
        )
    with open(labelmap_path, "rb") as f:
        data = f.read()
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={
            "X-Glaux-Volume-Id": volume_id,
            "X-Glaux-Task": task,
            "X-Glaux-Method": method,
            "Content-Length": str(len(data)),
        },
    )


@router.get("/volume/{volume_id}/raw", tags=["dataset"])
def volume_raw(volume_id: str) -> Response:
    """P6：流式返回原始 CT NIfTI 字节——kernel measure 算 HU mean 用、前端画笔参考用。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    if not dataset_ct.is_ct(volume_id):
        raise HTTPException(404, f"非 CT volume id：{volume_id}")
    try:
        path = dataset_ct.nifti_path(volume_id)
    except FileNotFoundError as e:
        raise HTTPException(404, str(e)) from e
    with open(path, "rb") as f:
        data = f.read()
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"X-Glaux-Volume-Id": volume_id, "Content-Length": str(len(data))},
    )


@router.post("/volume/{volume_id}/segment", tags=["dataset"])
def volume_segment(volume_id: str, task: str = "totalseg_liver_kidney", method: str = "totalsegmentator_v2") -> dict:
    """P6 U2/U4：触发子进程跑 TotalSegmentator（缓存命中直返）→ 返回 labelmap URL。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    if not dataset_ct.is_ct(volume_id):
        raise HTTPException(404, f"非 CT volume id：{volume_id}")
    try:
        labelmap_path, mv = segment_ts.segment(volume_id, method)
    except segment_ts.TsSegmentUnavailable as e:
        raise HTTPException(503, str(e)) from e
    return {
        "labelmap_ref": f"/api/volume/{volume_id}/labelmap?task={task}&method={method}",
        "model_version": mv,
        "labelmap_path": labelmap_path,
    }


# --- P6 U4：画笔编辑 ---------------------------------------------------------

from pydantic import BaseModel, Field  # noqa: E402  (local import; pydantic 已在 schemas 顶部)


class VolumeMaskEditSliceIn(BaseModel):
    z: int = Field(ge=0, description="z 索引（0..Z-1）")
    class_id: int = Field(description="画/擦哪个器官类（须在 VolumeMask.classes 内）")
    mode: Literal["paint", "erase"] = "paint"
    # base64 PNG 二值掩膜（与 z 切片同尺寸）
    mask_png_ref: str = Field(description="data:image/png;base64,...")


class VolumeMaskEditRequest(BaseModel):
    task: Literal["totalseg_liver_kidney"] = "totalseg_liver_kidney"
    slices: list[VolumeMaskEditSliceIn] = Field(default_factory=list)
    method: str = "totalsegmentator_v2"


@router.post("/volume/{volume_id}/mask-edit", tags=["dataset"])
def volume_mask_edit(volume_id: str, req: VolumeMaskEditRequest) -> dict:
    """P6 U4：画笔编辑回流——patch labelmap + 重 measure + 返回新 metrics。"""
    from glaux_core.contracts import VolumeMask
    from glaux_core.calibration.calibration import resolve_ct_calibration
    from glaux_orchestrator.tasks import REGISTRY as _REG, LIVER_KIDNEY_CLASSES, TaskType as _TT
    from glaux_core.measurement.ct import measure_liver_kidney as _measure_lk

    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    if not dataset_ct.is_ct(volume_id):
        raise HTTPException(404, f"非 CT volume id：{volume_id}")
    try:
        new_path, new_arr = dataset_ct.patch_labelmap(
            volume_id,
            [s.model_dump() for s in req.slices],
            method=req.method,
        )
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(404, f"labelmap 缓存未命中：{req.method}——先调 /segment") from e
    # 重 measure：走 plugin.measure 与 run_task 同形
    try:
        plugin = _REG[_TT(req.task)]
    except KeyError as e:
        raise HTTPException(400, f"未知 task：{req.task}") from e
    if plugin.adapter_kind != "volume":
        raise HTTPException(400, f"task {req.task} 非 volume 任务")
    cal = resolve_ct_calibration(dataset_ct.vox_spacing_mm(volume_id))
    # raw_ref 留 None——画笔编辑只改 labelmap（count）不改 CT 强度（HU），HU mean 不重算；
    # 若未来要重算，需 measure 层支持 URL fetch 或后端在调 measure 前把 raw 落盘。
    vol_prim = VolumeMask(
        id=f"{volume_id}_labelmap",
        ref=f"/api/volume/{volume_id}/labelmap?task={req.task}&method={req.method}",
        classes=LIVER_KIDNEY_CLASSES,
        raw_ref=None,
        path=new_path,
    )
    from glaux_core.contracts import Detection
    det = Detection(primitives=(vol_prim,), model_version="human@edit")
    meas = _measure_lk(det, cal)
    # 序列化（与 run_task 同形，measurement_to_dict）
    from glaux_core.contracts import measurement_to_dict
    metrics_dict = measurement_to_dict(meas)["metrics"]
    return {
        "metrics": metrics_dict,
        "labelmap_ref": f"/api/volume/{volume_id}/labelmap?task={req.task}&method={req.method}",
        "new_labelmap_path": new_path,
        "model_version": "human@edit",
    }


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
