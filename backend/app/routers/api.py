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

import numpy as np
from fastapi import APIRouter, HTTPException, Response

from .. import config, datasource_registry as dsreg, mock
from ..net_guard import UrlNotAllowed, assert_url_allowed
from ..schemas import (
    Capability,
    CorrectionRequest,
    CorrectionResult,
    DataSourceInfo,
    DatasourceImportRequest,
    ImageMeta,
    IntentBackendInfo,
    InterpretRequest,
    IntentResult,
    Modality,
    ModelInfo,
    ModelListResult,
    ProbeRequest,
    TaskMeasureRequest,
    TaskSpec,
    TestResult,
    VlmModelInfo,
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


# P7：WSI 瓦片层独立于 science-core（只需 OpenSlide + numpy）——单独 guard，
# 使病理浏览/瓦片在无 science-core 时也能起；核检测（/task/run）才需 KERNEL_OK。
try:
    from .. import dataset_wsi, segment_wsi

    WSI_OK = True
except Exception as exc:  # pragma: no cover - 缺 openslide 时降级
    log.warning("WSI 数据层不可用（缺 openslide？）：%s", exc)
    dataset_wsi = None  # type: ignore[assignment]
    segment_wsi = None  # type: ignore[assignment]
    WSI_OK = False


def _wsi_ready() -> None:
    """WSI 端点公共守卫：openslide 装配 + 数据就绪，否则 503。"""
    if not WSI_OK:
        raise HTTPException(503, "WSI 模态需 openslide（未装配）")
    if not config.wsi_data_available():
        raise HTTPException(503, f"WSI 数据未就绪：{config.WSI_ROOT} 无 slide_*")


def _has_data() -> bool:
    return KERNEL_OK and config.data_available()


@router.get("/intent/backends", response_model=list[IntentBackendInfo], tags=["intent"])
def intent_backends() -> list[IntentBackendInfo]:
    """意图后端及可用性（rule 恒可用；vlm 需 anthropic + 密钥）。"""
    if KERNEL_OK:
        return [IntentBackendInfo(**b) for b in kernel.intent_backends()]
    return [IntentBackendInfo(id="rule", name="Rule-based", available=True, reason="mock")]


def _guard_endpoint(provider: str, base_url: str | None) -> None:
    """公共守卫——openai_compatible 必须给 base_url；给了则过 SSRF 守卫。"""
    if base_url:
        try:
            assert_url_allowed(base_url)
        except UrlNotAllowed as e:
            raise HTTPException(400, f"base_url 被拒：{e}") from e
    elif provider == "openai_compatible":
        raise HTTPException(400, "openai_compatible 需要 base_url")


def _guard_probe(req: ProbeRequest) -> None:
    _guard_endpoint(req.provider, req.base_url)


@router.post("/interpret", response_model=IntentResult, tags=["intent"])
def interpret(req: InterpretRequest) -> IntentResult:
    if req.backend == "vlm":
        _guard_endpoint(req.provider, req.base_url)  # VLM + 自定义端点 → SSRF 守卫先行
    if KERNEL_OK:
        try:
            return kernel.interpret(
                req.nl, image_id=req.image_id, cubs_cf=req.cubs_cf,
                backend=req.backend, api_key=req.api_key, model=req.model,
                provider=req.provider, base_url=req.base_url,
            )
        except IntentBackendUnavailable as e:
            # VLM 被选中但不可用 → 显式 503（不静默退化到规则）
            raise HTTPException(503, f"意图后端不可用：{e}") from e
        except Exception:  # pragma: no cover
            log.exception("interpret 内核失败，回退 mock")
    return mock.classify(req.nl, image_id=req.image_id, cubs_cf=req.cubs_cf)


@router.post("/intent/vlm/test", response_model=TestResult, tags=["intent"])
def vlm_test(req: ProbeRequest) -> TestResult:
    """连接测试——SSRF 守卫先行，再 ping + 计数（SDD 2026-07-14-001 §5）。"""
    _guard_probe(req)
    if not KERNEL_OK:
        raise HTTPException(503, "内核未就绪")
    return TestResult(**kernel.vlm_test(req.provider, req.base_url, req.api_key))


@router.post("/intent/vlm/models", response_model=ModelListResult, tags=["intent"])
def vlm_models(req: ProbeRequest) -> ModelListResult:
    """拉取模型列表（全列 + 视觉标注）——SSRF 守卫先行。"""
    _guard_probe(req)
    if not KERNEL_OK:
        raise HTTPException(503, "内核未就绪")
    try:
        models = kernel.vlm_models(req.provider, req.base_url, req.api_key)
        return ModelListResult(models=[VlmModelInfo(**m) for m in models])
    except Exception as e:  # noqa: BLE001 - 拉取失败返回空列表 + reason（不 500）
        return ModelListResult(models=[], reason=f"拉取失败：{type(e).__name__}: {e}")


# --- 数据源注册表（表征层 · 文件夹导入） ------------------------------------

@router.get("/datasources", response_model=list[DataSourceInfo], tags=["dataset"])
def datasources() -> list[DataSourceInfo]:
    """已注册数据源清单（builtin / imported）——前端「数据源」视图 + 市场数据集卡的真相源。"""
    return [DataSourceInfo(**s.to_dict()) for s in dsreg.list_all()]


@router.post("/datasources", response_model=DataSourceInfo, tags=["dataset"])
def datasources_import(req: DatasourceImportRequest) -> DataSourceInfo:
    """导入一个文件夹为数据源。路径越界/非法模态/不存在 → 422 硬拒绝。

    缺标定 → ``status=needs_calibration``（跑任务时上层 422，不出假值）。
    """
    from .. import datasource_detect
    try:
        src = dsreg.register_folder(
            req.path, req.modality, calibration=req.calibration, name=req.name,
            detect=datasource_detect.detect,  # 无显式标定时从数据文件探测嵌入标定（U3）
        )
    except dsreg.ImportError_ as e:
        raise HTTPException(422, str(e)) from e
    return DataSourceInfo(**src.to_dict())


@router.delete("/datasources/{source_id}", tags=["dataset"])
def datasources_remove(source_id: str) -> dict:
    """删除一个导入源（builtin 不可删）。"""
    ok = dsreg.remove(source_id)
    if not ok:
        raise HTTPException(404, f"源不存在或不可删（builtin）：{source_id}")
    return {"ok": True, "removed": source_id}


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
    if modality == "pathology":  # P7
        _wsi_ready()
        return [ImageMeta(**dataset_wsi.image_meta(i)) for i in dataset_wsi.list_ids()]
    if not _has_data():
        return mock.dataset()
    return [ImageMeta(**dataset.image_meta(i)) for i in dataset.list_ids()]


@router.get("/volumes", response_model=list[ImageMeta], tags=["dataset"])
def volumes() -> list[ImageMeta]:
    """P6：CT 体积列表——与 /images?modality=ct_abdomen 同源；分端点便于前端 discovery。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    return [ImageMeta(**dataset_ct.image_meta(i)) for i in dataset_ct.list_ids()]


@router.get("/volume/{volume_id}", tags=["dataset"])
def volume_stream(volume_id: str) -> Response:
    """P6：流式返回 CT 原始 NIfTI 字节（前端 CS3D DICOM image loader 走 wadouri:）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    if not dataset_ct.is_ct(volume_id):  # 白名单守卫（同兄弟端点）——防路径穿越 + 错模态
        raise HTTPException(404, f"非 CT volume id：{volume_id}")
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
            f"labelmap 缓存未命中：{volume_id} {method}——先调 POST /volume/{volume_id}/segment",
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
        "seq": dataset_ct.current_edit_seq(volume_id, method),  # 客户端首笔编辑的 base_seq
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
    # 乐观并发：客户端上次见到的编辑序号；落后于服务端 → 409（被他人超越）。
    # None = 不校验（向后兼容单笔编辑），仍在后端锁内串行化。
    base_seq: int | None = None


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
        new_path, new_arr, new_seq = dataset_ct.guarded_patch_labelmap(
            volume_id,
            [s.model_dump() for s in req.slices],
            base_seq=req.base_seq,
            method=req.method,
        )
    except dataset_ct.StaleEditError as e:
        # 并发编辑被超越——409 Conflict，回带服务端当前 seq 供客户端重取重试
        raise HTTPException(409, str(e)) from e
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
        "seq": new_seq,  # 客户端下次编辑回传作 base_seq（乐观并发）
    }


# --- P6 U5：Reproducibility Dice 验证 ----------------------------------------


@router.get("/volume/{volume_id}/verify", tags=["dataset"])
def volume_verify(
    volume_id: str,
    task: str = "totalseg_liver_kidney",
    method: str = "totalsegmentator_v2",
) -> dict:
    """P6 U5：与 ship 的 reference labelmap（TotalSegmentator 公开 demo 预测）算 per-class Dice。

    **非真 GT 比较**——reference 是 TotalSegmentator 官方 demo 的 labelmap；Dice 衡量
    「我们的 pipeline 能否复现上游 demo」，复现好 = 0.95+ 是好信号，复现差 = 排查
    measure/标定/缓存逻辑，**不**代表临床正确性。

    缺 GT 时 422 + 解释。
    """
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    if not dataset_ct.is_ct(volume_id):
        raise HTTPException(404, f"非 CT volume id：{volume_id}")
    from glaux_core.verification.dice import dice_per_class
    from glaux_orchestrator.tasks import LIVER_KIDNEY_CLASSES

    # pred = 当前 labelmap 缓存；ref = ship 的 reproducibility reference
    pred_path = segment_ts.labelmap_path(volume_id, method)
    if not Path(pred_path).is_file():
        raise HTTPException(404, f"labelmap 缓存未命中：{volume_id} {method}——先调 /segment")
    # reproducibility reference 与 CT 同名（不带 method 后缀）放 data/ct/{vid}_ref.nii.gz
    ref_path = config.CT_ROOT / f"{volume_id}_ref.nii.gz"
    if not ref_path.is_file():
        raise HTTPException(
            422,
            f"reproducibility reference 缺失：{ref_path}——"
            f"按 data/ct/README.md 手工下载 TotalSegmentator demo 案例的官方预测作 reference；"
            f"本接口非真 GT 比较",
        )
    import nibabel as nib
    pred = np.asarray(nib.load(str(pred_path)).dataobj).astype(np.int32, copy=False)
    ref = np.asarray(nib.load(str(ref_path)).dataobj).astype(np.int32, copy=False)
    class_ids = [c.class_id for c in LIVER_KIDNEY_CLASSES]
    try:
        per = dice_per_class(pred, ref, class_ids)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    # 翻译 class_id → role/label 给前端
    by_id = {c.class_id: c for c in LIVER_KIDNEY_CLASSES}
    out: dict[str, dict] = {}
    for cid, d in per.items():
        cls = by_id.get(cid)
        if cls is None:
            continue
        out[cls.role] = {
            "dice": d,
            "label_zh": cls.label_zh,
            "label_en": cls.label_en,
            "class_id": cid,
        }
    return {
        "task": task,
        "method": method,
        "per_class": out,
        "mean_dice": sum(v["dice"] for v in out.values()) / max(len(out), 1),
        "note": "reproducibility check vs ship reference（非真 GT）",
    }


# --- P7：病理 WSI 瓦片服务（OpenSlide + DeepZoom；数据 IO，无 science-core 依赖）------

@router.get("/slides", response_model=list[ImageMeta], tags=["dataset"])
def slides() -> list[ImageMeta]:
    """P7：WSI slide 列表——与 /images?modality=pathology 同源；分端点便于前端 discovery。"""
    _wsi_ready()
    return [ImageMeta(**dataset_wsi.image_meta(i)) for i in dataset_wsi.list_ids()]


@router.get("/wsi/{slide_id}/dzi", tags=["dataset"])
def wsi_dzi(slide_id: str) -> Response:
    """P7：DZI XML 描述（金字塔 Width/Height/TileSize/Overlap/Format）——OSD tileSource 源。"""
    _wsi_ready()
    if not dataset_wsi.is_wsi(slide_id):  # 白名单守卫（防路径穿越 + 错模态）
        raise HTTPException(404, f"非 WSI slide id：{slide_id}")
    return Response(content=dataset_wsi.dzi_descriptor(slide_id), media_type="application/xml")


@router.get("/wsi/{slide_id}/tile/{level}/{col}/{row}", tags=["dataset"])
def wsi_tile(slide_id: str, level: int, col: int, row: int) -> Response:
    """P7：DeepZoom 瓦片 JPEG（缓存优先）。坐标是 DeepZoom (level, col, row)。"""
    _wsi_ready()
    if not dataset_wsi.is_wsi(slide_id):
        raise HTTPException(404, f"非 WSI slide id：{slide_id}")
    try:
        data = dataset_wsi.tile(slide_id, level, col, row)
    except ValueError as e:
        raise HTTPException(404, str(e)) from e
    return Response(content=data, media_type="image/jpeg")


@router.get("/wsi/{slide_id}/thumbnail", tags=["dataset"])
def wsi_thumbnail(slide_id: str, max_size: int = 512) -> Response:
    """P7：整片缩略图 JPEG（discovery 卡片 / OSD 导航图）。"""
    _wsi_ready()
    if not dataset_wsi.is_wsi(slide_id):
        raise HTTPException(404, f"非 WSI slide id：{slide_id}")
    return Response(content=dataset_wsi.thumbnail(slide_id, max_size), media_type="image/jpeg")


@router.get("/wsi/{slide_id}/region", tags=["dataset"])
def wsi_region(slide_id: str, x: int, y: int, w: int, h: int, level: int = 0) -> Response:
    """P7：读一块 region → JPEG（level-0 px 坐标；模型抽块 / 调试）。越界 → 422。"""
    _wsi_ready()
    if not dataset_wsi.is_wsi(slide_id):
        raise HTTPException(404, f"非 WSI slide id：{slide_id}")
    from PIL import Image

    try:
        arr = dataset_wsi.read_region(slide_id, x, y, w, h, level)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    import io as _io
    buf = _io.BytesIO()
    Image.fromarray(arr).save(buf, format="JPEG", quality=85)
    return Response(content=buf.getvalue(), media_type="image/jpeg")


@router.get("/wsi/{slide_id}/verify", tags=["dataset"])
def wsi_verify(slide_id: str, method: str = "stardist_he") -> dict:
    """P7 U5：与 ship 的 reference 检测（模型自身在 canonical demo ROI 的输出）算质心匹配 F1。

    **非真 GT 比较**——reference 是模型自身在固定 ROI 的检测；F1 衡量「管线能否复现自身
    ROI 检测」（确定性 + 缓存 → 期望 ≈1.0），不代表临床正确性。缺 reference → 422。
    """
    _wsi_ready()
    if not KERNEL_OK:
        raise HTTPException(503, "WSI 验证需 science-core（未装配）")
    if not dataset_wsi.is_wsi(slide_id):
        raise HTTPException(404, f"非 WSI slide id：{slide_id}")
    import json as _json

    ref_path = config.WSI_ROOT / f"{slide_id}_ref_nuclei.json"
    if not ref_path.is_file():
        raise HTTPException(
            422,
            f"reproducibility reference 缺失：{ref_path}——按 data/wsi/README 手工 ship "
            f"模型在 canonical ROI 的检测作 reference；本接口非真 GT 比较",
        )
    ref = _json.loads(ref_path.read_text())
    roi = tuple(int(v) for v in ref["roi"])
    # 在 reference 的 ROI 上重跑检测（缓存命中即秒回）
    try:
        pred_path, _mv = segment_wsi.segment(slide_id, roi, method)
    except Exception as e:  # 隔离环境不可用 / 子进程失败
        raise HTTPException(503, f"核检测不可用：{e}") from e
    pred = segment_wsi.load_nuclei(pred_path)
    from glaux_core.verification.nuclei import nuclei_reproducibility

    res = nuclei_reproducibility(pred.get("points", []), ref.get("points", []), dist_thresh=8.0)
    res["roi"] = list(roi)
    res["method"] = method
    res["note"] = "reproducibility vs ship reference（模型自身 canonical ROI 检测，非真 GT）"
    return res


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
