"""后端契约端点——真实接入（science-core / caroSegDeep）。

数据轴走 ``SOURCES`` + ``resolve_object``（SDD 10）：无数据的模态返回空列表，未知 id 一律 404，
不回落到合成图；合成数据只作为开发者模式下显式注册的数据源出现（D-17）。
- /tasks        → 任务注册表（多模态前端的单一真相源）
- /task/run     → 统一驱动：取数 → 测量 → TaskOutput（多模态通吃；也是 run_task 工具的执行面）
- /task/measure → 由编辑后的图元重测（泛型替代旧 /measure + /hc/measure）
- /images       → ``SOURCES[modality]`` 列出全部 active 源的对象（ObjectMeta）
- /image        → ``resolve_object`` → ``Source.frame``（缺省索引的一帧）
- /models       → 真实方法注册表（caroSegDeep + 参考方法 + HC）
- /volume/*、/wsi/* → CT / 病理查看器数据面（labelmap、mask-edit、tile、verify）
只保留前端或 agent-runtime 实际调用的端点；孤儿端点已于 2026-08-16 清理。
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Response

from .. import config
from .. import datasource_registry as dsreg
from ..schemas import (
    Capability,
    DatasourceImportRequest,
    DataSourceInfo,
    EditOp,
    EditRequest,
    ImageMeta,
    Index,
    Modality,
    ModelInfo,
    ObjectMeta,
    TaskMeasureRequest,
    TaskSpec,
)
from ..sources import SOURCES
from . import objects

log = logging.getLogger("glaux.api")
router = APIRouter()

# 内核是否可 import（纯 numpy/PIL）；数据端点再叠加 data_available()。
try:
    from .. import dataset_ct, kernel, segment_ts

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


# 意图层已退役（2026-08-16，见 docs/designs/2026-08-16-001-retire-orchestration）：
# /interpret、/intent/backends、/intent/vlm/* 全部移除。NL 由 agent-runtime 的参考智能体理解，
# 经 run_task 工具调 /task/run；连接探测在 /agent-api/v1/connection/*。


# --- 数据源注册表（观测空间 · 文件夹导入） ------------------------------------


@router.get("/datasources", response_model=list[DataSourceInfo], tags=["dataset"])
def datasources() -> list[DataSourceInfo]:
    """已注册数据源清单（builtin / imported）——前端「数据源」视图 + 市场数据集卡的真相源。"""
    return [DataSourceInfo(**s.info()) for s in dsreg.list_all()]


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
    return DataSourceInfo(**src.info())


@router.post("/datasources/samples", response_model=list[DataSourceInfo], tags=["dataset"])
def datasources_load_samples() -> list[DataSourceInfo]:
    """显式加载仓库自带的示例数据源（SDD 08 §5.2）。

    幂等；内置根都没数据时返回空数组而非报错——没有示例是正常状态。
    """
    return [DataSourceInfo(**s.info()) for s in dsreg.register_builtin_samples()]


@router.delete("/datasources/{source_id}", tags=["dataset"])
def datasources_remove(source_id: str) -> dict:
    """删除一个导入源（builtin 不可删）。"""
    ok = dsreg.remove(source_id)
    if not ok:
        raise HTTPException(404, f"源不存在或不可删（builtin）：{source_id}")
    return {"ok": True, "removed": source_id}


@router.get("/images", response_model=list[ObjectMeta], tags=["dataset"])
def images(job: str | None = None, modality: Modality = "carotid_imt") -> list[ObjectMeta]:
    """某模态全部 active 源的对象；同 id 多源时首个源胜出（与 resolve_object 一致）。"""
    return _objects_of(modality)


def _objects_of(modality: str) -> list[ObjectMeta]:
    src = SOURCES.get(modality)
    if src is None:  # 模态合法但其数据模块未装配（缺依赖）→ 空列表，不是错误
        return []
    out: list[ObjectMeta] = []
    seen: set[str] = set()
    for ds in dsreg.active_sources(modality):
        for oid in src.list_ids(ds):
            if oid not in seen:
                seen.add(oid)
                out.append(src.meta(ds, oid))
    return out


@router.get("/volumes", response_model=list[ImageMeta], tags=["dataset"])
def volumes() -> list[ImageMeta]:
    """P6：CT 体积列表——与 /images?modality=ct_abdomen 同源（alias，W7 删）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    return _objects_of("ct_abdomen")


@router.get("/volume/{volume_id}", tags=["dataset"])
def volume_stream(volume_id: str) -> Response:
    """CT 原始 NIfTI 字节——``GET /objects/{id}/raw`` 的 alias（字节等价，W7 删）。"""
    ref, _ = objects.resolve(volume_id)
    if ref.kind != "volume":  # 白名单守卫——防错模态（id 不参与路径拼接）
        raise HTTPException(404, f"非 CT volume id：{volume_id}")
    data, _mime = objects.raw_bytes(volume_id)
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"X-Glaux-Volume-Id": volume_id, "Content-Length": str(len(data))},
    )


@router.get("/volume/{volume_id}/labelmap", tags=["dataset"])
def volume_labelmap(
    volume_id: str, task: str = "totalseg_liver_kidney", method: str = "totalsegmentator_v2"
) -> Response:
    """任务结果字节面（SDD 10 §5.3 有意保留）：labelmap NIfTI；未命中 → 404 提示先跑 /task/run。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    ref, _ = objects.resolve(volume_id)
    if ref.kind != "volume":
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


# --- P6 U4：画笔编辑（alias → POST /objects/{id}/edits，W7 删） -----------------------

from pydantic import BaseModel, Field  # noqa: E402  (local import; pydantic 已在 schemas 顶部)


class VolumeMaskEditSliceIn(BaseModel):
    z: int = Field(ge=0, description="z 索引（0..Z-1）")
    class_id: int = Field(description="画/擦哪个器官类（须在 VolumeMask.classes 内）")
    mode: Literal["paint", "erase"] = "paint"
    # base64 PNG 二值掩膜（与 z 切片同尺寸）
    mask_png_ref: str = Field(description="data:image/png;base64,...")


class VolumeMaskEditRequest(BaseModel):
    task: str = "totalseg_liver_kidney"
    slices: list[VolumeMaskEditSliceIn] = Field(default_factory=list)
    method: str = "totalsegmentator_v2"
    # 乐观并发：客户端上次见到的编辑序号；落后于服务端 → 409（被他人超越）。
    # None = 不校验（向后兼容单笔编辑），仍在后端锁内串行化。
    base_seq: int | None = None


@router.post("/volume/{volume_id}/mask-edit", tags=["dataset"])
def volume_mask_edit(volume_id: str, req: VolumeMaskEditRequest) -> dict:
    """画笔编辑回流——``POST /objects/{id}/edits`` 的 alias（同一实现，W7 删）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "CT 模态需 science-core（未装配）")
    ref, _ = objects.resolve(volume_id)
    if ref.kind != "volume":
        raise HTTPException(404, f"非 CT volume id：{volume_id}")
    ops = [
        EditOp(index=Index(z=s.z), class_id=s.class_id, mode=s.mode, mask_png=s.mask_png_ref)
        for s in req.slices
    ]
    # 旧契约的 base_seq 可为 None（不做乐观并发校验），故绕过 EditRequest 的必填校验构造
    edit = EditRequest.model_construct(
        task=req.task, method=req.method, base_seq=req.base_seq, ops=ops
    )
    return objects.apply_edit(volume_id, edit)


# /volume/{id}/verify（P6 复现 Dice）已删（2026-08-16，前端从未接线）；Dice 逻辑仍在
# glaux_core.verification.dice，参考数据 data/ct/{vid}_ref.nii.gz 保留，需要时补一条路由即可。


# --- P7：病理 WSI 瓦片服务（OpenSlide + DeepZoom；数据 IO，无 science-core 依赖）------


@router.get("/slides", response_model=list[ImageMeta], tags=["dataset"])
def slides() -> list[ImageMeta]:
    """P7：WSI slide 列表——与 /images?modality=pathology 同源（alias，W7 删）。"""
    _wsi_ready()
    return _objects_of("pathology")


@router.get("/wsi/{slide_id}/tile/{level}/{col}/{row}", tags=["dataset"])
def wsi_tile(slide_id: str, level: int, col: int, row: int) -> Response:
    """DeepZoom 瓦片 JPEG——``GET /objects/{id}/tiles/…`` 的 alias（字节等价，W7 删）。"""
    _wsi_ready()
    ref, _ = objects.resolve(slide_id)
    if ref.kind != "slide":
        raise HTTPException(404, f"非 WSI slide id：{slide_id}")
    return Response(content=objects.tile_bytes(slide_id, level, col, row), media_type="image/jpeg")


# /wsi/{id}/dzi、/thumbnail、/region 已删（2026-08-16，前端从未调用；
# OSD 走 /tile 自定义 tileSource）。


@router.get("/wsi/{slide_id}/verify", tags=["dataset"])
def wsi_verify(slide_id: str, method: str = "stardist_he") -> dict:
    """与 ship 的 reference 检测算质心匹配 F1（SDD 10 §5.3 有意保留；实现在 ``Detector.verify``）。

    **非真 GT 比较**——reference 是模型自身在固定 ROI 的检测；F1 衡量「管线能否复现自身
    ROI 检测」（确定性 + 缓存 → 期望 ≈1.0），不代表临床正确性。缺 reference → 422。
    """
    _wsi_ready()
    if not KERNEL_OK:
        raise HTTPException(503, "WSI 验证需 science-core（未装配）")
    from ..detectors import DETECTORS

    ref, obj = objects.resolve(slide_id)
    if ref.kind != "slide":
        raise HTTPException(404, f"非 WSI slide id：{slide_id}")
    try:
        return DETECTORS["wsi"].verify(ref, obj, None, method=method)
    except FileNotFoundError as e:
        raise HTTPException(422, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(503, str(e)) from e


@router.get("/image/{image_id}", tags=["dataset"])
def image(image_id: str) -> Response:
    """通用图像的既有直取面（SDD 10 §5.3 有意保留）：缺省索引的一帧，原样字节优先。

    未知 id 一律 404，不被合成图吞掉——伪造 id 看似成功会让 Agent 分割的是另一张图（D-17）。
    """
    try:
        ref = dsreg.resolve_object(image_id)
    except LookupError as e:
        raise HTTPException(404, f"图像不存在：{image_id}") from e
    try:
        data, media, _frame = ref.source.frame(ref.datasource, image_id, Index())
    except FileNotFoundError as e:
        raise HTTPException(404, f"图像不存在：{image_id}") from e
    except NotImplementedError as e:  # 该几何族在本面尚无单帧表征（slide 需 level）
        raise HTTPException(422, f"该对象没有此表征：{e}") from e
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    return Response(content=data, media_type=media)


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
    from glaux_core.errors import HardReject

    try:
        return kernel.run_task(spec)
    except LookupError as e:  # 未知对象 id（SDD 10 §13）
        raise HTTPException(404, str(e)) from e
    except (ValueError, HardReject) as e:  # 几何族/选区/标定不符 → 硬拒绝
        raise HTTPException(422, str(e)) from e
    except Exception as e:  # 检测不可用（未装配 / 子进程 / 隔离环境 / 缓存缺失）
        raise HTTPException(503, f"检测/运行不可用：{e}") from e


@router.post("/task/measure", tags=["task"])
def task_measure(req: TaskMeasureRequest) -> dict:
    """统一测量：由前端编辑后的图元重测（泛型替代 /measure + /hc/measure）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "统一测量需 science-core（未装配）")
    from glaux_core.errors import HardReject

    try:
        return kernel.measure_task(req.task, req.primitives, req.calibration)
    except (ValueError, KeyError, HardReject, RuntimeError) as e:  # 图元或标定不满足测量前置
        raise HTTPException(422, str(e)) from e


@router.get("/models", response_model=list[ModelInfo], tags=["models"])
def models() -> list[ModelInfo]:
    """方法清单：按注册表顺序汇总各 ``Detector.methods()``（SDD 10 §15.1 G）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "模型清单需 science-core（未装配）")
    return kernel.models()


@router.get("/capabilities", response_model=list[Capability], tags=["capabilities"])
def capabilities() -> list[Capability]:
    """能力注册表——「插件市场」的单一真相源（模型/数据集/skill/连接器/MCP/知识库，按环境四要素分组）。"""
    if not KERNEL_OK:
        raise HTTPException(503, "能力注册表需 science-core（未装配）")
    return [Capability(**c) for c in kernel.capabilities()]
