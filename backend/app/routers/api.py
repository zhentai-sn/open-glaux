"""后端契约端点——真实接入（science-core / caroSegDeep）。

真实资产不可用时优雅回退 mock（见 mock.py），使无数据环境/CI 也能起。
- /tasks        → 任务注册表（多模态前端的单一真相源）
- /task/run     → 统一驱动：取数 → 测量 → TaskOutput（多模态通吃；也是 run_task 工具的执行面）
- /task/measure → 由编辑后的图元重测（泛型替代旧 /measure + /hc/measure）
- /images       → dataset.list_ids（tech_401–500 演示队列）
- /image        → 真实 tiff→PNG（PIL；主进程无 TF）
- /models       → 真实方法注册表（caroSegDeep + 参考方法 + HC）
- /volume/*、/wsi/* → CT / 病理查看器数据面（labelmap、mask-edit、tile、verify）
只保留前端或 agent-runtime 实际调用的端点；孤儿端点已于 2026-08-16 清理。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Response

from .. import config, dataset_natural, mock
from .. import datasource_registry as dsreg
from ..schemas import (
    Capability,
    DatasourceImportRequest,
    DataSourceInfo,
    ImageMeta,
    Modality,
    ModelInfo,
    TaskMeasureRequest,
    TaskSpec,
)

log = logging.getLogger("glaux.api")
router = APIRouter()

# 内核是否可 import（纯 numpy/PIL）；数据端点再叠加 data_available()。
try:
    from .. import dataset, dataset_ct, hc_dataset, kernel, segment_ts

    KERNEL_OK = True
except Exception as exc:  # pragma: no cover - 缺 science-core 时的降级
    log.warning("内核不可用，端点回退 mock：%s", exc)
    KERNEL_OK = False

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


# 意图层已退役（2026-08-16，见 docs/designs/2026-08-16-001-retire-orchestration）：
# /interpret、/intent/backends、/intent/vlm/* 全部移除。NL 由 agent-runtime 的参考智能体理解，
# 经 run_task 工具调 /task/run；连接探测在 /agent-api/v1/connection/*。


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
            req.path,
            req.modality,
            calibration=req.calibration,
            name=req.name,
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
    if modality == "natural_image":
        return [ImageMeta(**dataset_natural.image_meta(i)) for i in dataset_natural.list_ids()]
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
def volume_labelmap(
    volume_id: str, task: str = "totalseg_liver_kidney", method: str = "totalsegmentator_v2"
) -> Response:
    """P6：流式返回 labelmap NIfTI 字节（缓存命中直返；未命中 → 404 提示先跑 /task/run）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    if not dataset_ct.is_ct(volume_id):
        raise HTTPException(404, f"非 CT volume id：{volume_id}")
    labelmap_path = segment_ts.labelmap_path(volume_id, method)
    if not Path(labelmap_path).is_file():
        raise HTTPException(
            404,
            f"labelmap 缓存未命中：{volume_id} {method}——先跑 POST /task/run",
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


# /volume/{id}/raw 与 /volume/{id}/segment 已删（2026-08-16，前端从未调用；分割统一走 /task/run）。


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
    from glaux_core.calibration.calibration import resolve_ct_calibration
    from glaux_core.contracts import VolumeMask
    from glaux_core.measurement.ct import measure_liver_kidney as _measure_lk
    from glaux_core.tasks import LIVER_KIDNEY_CLASSES
    from glaux_core.tasks import REGISTRY as _REG
    from glaux_core.tasks import TaskType as _TT

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


# /volume/{id}/verify（P6 复现 Dice）已删（2026-08-16，前端从未接线）；Dice 逻辑仍在
# glaux_core.verification.dice，参考数据 data/ct/{vid}_ref.nii.gz 保留，需要时补一条路由即可。


# --- P7：病理 WSI 瓦片服务（OpenSlide + DeepZoom；数据 IO，无 science-core 依赖）------


@router.get("/slides", response_model=list[ImageMeta], tags=["dataset"])
def slides() -> list[ImageMeta]:
    """P7：WSI slide 列表——与 /images?modality=pathology 同源；分端点便于前端 discovery。"""
    _wsi_ready()
    return [ImageMeta(**dataset_wsi.image_meta(i)) for i in dataset_wsi.list_ids()]


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


# /wsi/{id}/dzi、/thumbnail、/region 已删（2026-08-16，前端从未调用；
# OSD 走 /tile 自定义 tileSource）。


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
    # 自然图像必须在 mock 回退前按固定前缀截住：未知 natural_* 也应 404，不能被 mock
    # 合成图吞掉，否则伪造 ID 会看似成功且 Agent 实际分割的是另一张图。
    if image_id.startswith("natural_"):
        try:
            return Response(content=dataset_natural.image_jpeg(image_id), media_type="image/jpeg")
        except FileNotFoundError as e:
            raise HTTPException(404, f"图像不存在：{image_id}") from e
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
