"""确定性内核的薄封装（F8/F9）——pdm 测量 + 模型注册表 + 泛型任务驱动。

后端不搬业务：测量用 science-core 的对齐口径 imt（共同支撑 + 对称 PDM），任务契约读
glaux_core.tasks.REGISTRY。此处只做 HTTP schema ↔ 领域对象 的映射。
意图解析已退役（2026-08-16）：NL 由 agent-runtime 的参考智能体理解，经 run_task 工具调 /task/run。

SDD 10 W2：按几何族取数的四个分支拆进 ``detectors/``（``DETECTORS``，键为 adapter_kind），
:func:`run_task` 只持有公共前缀——解析对象 → ``object_kinds`` 门控 → ``available()`` →
``region.kind`` 校验 → 标定解析——与信封组装（§7 规则 13）。
"""

from __future__ import annotations

import numpy as np
from glaux_core.contracts import (  # noqa: E402
    Detection,
    TaskOutput,
    measurement_to_dict,
    primitive_from_dict,
    task_output_to_dict,
)
from glaux_core.io.boundaries import Boundary  # noqa: E402
from glaux_core.measurement.pdm import imt as _imt  # noqa: E402
from glaux_core.tasks import REGISTRY as _REGISTRY
from glaux_core.tasks import TaskType as _TaskType
from glaux_core.tasks import plugin_to_view as _plugin_to_view

from . import datasource_registry
from .detectors import DETECTORS, DetectorUnavailable, calibration_result
from .schemas import Calibration, IMTResult, ModelInfo, TaskSpec


def _boundary(name: str, pts: list[list[float]]) -> Boundary:
    arr = np.asarray(pts, dtype=float)
    return Boundary(name=name, x=arr[:, 0], y=arr[:, 1])


def measure(
    li: list[list[float]],
    ma: list[list[float]],
    cf: float,
    x_window: tuple[float, float] | None = None,
) -> IMTResult:
    """对齐口径测量：共同支撑 + 对称 PDM（内核 imt）。"""
    res = _imt(_boundary("LI", li), _boundary("MA", ma), cf, x_window=x_window)
    return IMTResult(
        mean_mm=round(float(res.mean_mm), 4),
        max_mm=round(float(res.max_mm), 4),
        pdm_mean_mm=round(float(res.pdm_mean_mm), 4),
        per_column_um=[round(float(v), 2) for v in np.asarray(res.per_column_um).ravel()],
        n_columns=int(res.n_columns),
    )


def tasks() -> list[dict]:
    """任务注册表视图——前端 ``GET /tasks`` 的单一真相源（模态/查看器/工具/度量字段）。

    直接下发 :data:`glaux_core.tasks.REGISTRY` 的可序列化视图（不含 measure 可调用）。
    前端据此渲染任务切换器 / 工具栏 / 测量面板，**不再硬编码 if 模态**。
    """
    return [_plugin_to_view(p) for p in _REGISTRY.values()]


# --- 统一驱动：公共前缀 + DETECTORS 取数 → 统一信封 --------------------------------


def _plugin(task: str):
    return _REGISTRY[_TaskType(task)]


def _round_metric_values(d: dict) -> None:
    """展示层取整（内核数值原生，取整只在序列化边界做）。"""
    for m in d.get("metrics", {}).values():
        v = m.get("value")
        if isinstance(v, float):
            m["value"] = round(v, 4)


def run_task(spec: TaskSpec) -> dict:
    """统一驱动（多模态）：公共前缀 → ``Detector.detect`` → 注册表测量 → TaskOutput dict。

    失败映射（SDD 10 §13）：未知对象 ``LookupError``（404）；几何族不符、选区类型不符、缺标定
    ``ValueError`` / ``HardReject``（422）；Detector 不可用 ``DetectorUnavailable``（503）。
    """
    plugin = _plugin(spec.task)
    if not spec.image_id:
        raise ValueError("run 需要 image_id")
    ref = datasource_registry.resolve_object(spec.image_id)  # 未知 → LookupError
    obj = ref.source.meta(ref.datasource, spec.image_id)
    if ref.kind not in plugin.object_kinds:  # ① 几何族门控（D-13，不比 modality）
        raise ValueError(f"任务 {spec.task} 不适用于 {ref.kind} 对象：{spec.image_id}")
    detector = DETECTORS[plugin.adapter_kind]
    if not detector.available():  # ②
        raise DetectorUnavailable(f"{plugin.adapter_kind} 检测能力未装配")
    if spec.region is not None and spec.region.kind not in detector.accepted_regions:  # ③
        raise ValueError(
            f"任务 {spec.task} 不接受 {spec.region.kind} 选区（接受 {detector.accepted_regions}）"
        )
    calibration: Calibration | None = spec.calibration or obj.calibration  # ④ 显式优先，缺省取对象
    if calibration is None:
        raise ValueError(f"标定不可用：{spec.image_id} 无标定——硬拒绝，不出假值")
    calibration_result(calibration)  # 校验：未知 kind / 非法值 → HardReject
    spec = spec.model_copy(update={"calibration": calibration})

    det, cal = detector.detect(ref, obj, spec)
    meas = plugin.measure(det, cal)
    out = TaskOutput(
        task=spec.task,
        metrics=meas.metrics,
        primitives=tuple(det.primitives) + tuple(meas.overlays),
        calibration=cal,
        provenance={
            "model_version": det.model_version,
            "method": spec.method,
            "cf_source": cal.source.value,
        },
    )
    d = task_output_to_dict(out)
    detector.enrich(d, ref, obj, spec, cal)
    _round_metric_values(d)
    return d


def measure_task(task: str, primitives: list[dict], calibration: Calibration) -> dict:
    """由前端编辑后的图元重测：标定按 ``Calibration.kind`` 派发，不再恒为 CUBS mm/px（D-16）。"""
    plugin = _plugin(task)
    detector = DETECTORS[plugin.adapter_kind]
    prims = detector.hydrate(tuple(primitive_from_dict(p) for p in primitives))
    det = Detection(primitives=prims, model_version="edited")
    meas = plugin.measure(det, calibration_result(calibration))
    d = measurement_to_dict(meas)
    _round_metric_values(d)
    return d


def models() -> list[ModelInfo]:
    """模型注册表——按 REGISTRY 顺序汇总各 ``Detector.methods()``。"""
    out: list[ModelInfo] = []
    for plugin in _REGISTRY.values():
        out.extend(DETECTORS[plugin.adapter_kind].methods())
    return out


def capabilities() -> list[dict]:
    """能力注册表（「插件市场」的单一真相源，§5）。

    按环境四要素（纲领 §六）把 skill/model/dataset/…收成一套清单。

    真实优先：Skill = TaskPlugin（REGISTRY）、Model/ReferenceMethod = models() 按 backend 分类、
    Dataset/CalibrationSource = 真实可用性；Connector/MCP/KnowledgeBase 出有类型占位卡
    （status=planned，v0 不做下载/安装/沙箱编排——市场先是目录 + 状态）。
    """
    caps: list[dict] = []
    modality_task = {p.modality: p.task.value for p in _REGISTRY.values()}

    # 动作空间 · Skill（= TaskPlugin：打包好的任务配方本身就是一种能力）
    for p in _REGISTRY.values():
        caps.append(
            {
                "id": f"skill:{p.task.value}",
                "kind": "skill",
                "layer": "action",
                "name": p.label_en,
                "provider": "glaux",
                "license": "internal",
                "status": "active",
                "isolation": "in_process",
                "desc": f"Task recipe · {p.adapter_kind} · viewer={p.viewer}",
                "tasks": [p.task.value],
            }
        )

    # 动作空间 · Model / 验证器 · ReferenceMethod（models() 按 backend 分类）
    for m in models():
        is_ref = "reference" in m.backend
        caps.append(
            {
                "id": m.id,
                "kind": "reference_method" if is_ref else "model",
                "layer": "verification" if is_ref else "action",
                "name": m.pub,
                "provider": m.pub.split(" · ")[0] if " · " in m.pub else "",
                "license": "research",
                "status": "active" if m.active else "installed",
                "isolation": m.backend,
                "desc": m.desc,
                "tasks": [modality_task.get(m.modality, "")],
            }
        )

    # 观测空间 · Dataset（注册表驱动——加一个数据源 = 多一张卡，不改本函数）
    # DataSource.status → Capability.status（active/installed/planned 三态）
    _DS_STATUS = {
        "active": "active",
        "needs_calibration": "installed",
        "empty": "planned",
        "planned": "planned",
    }
    for s in datasource_registry.list_all():
        # provider / license / 描述由 Source.builtin_sample() 随内置源提供（SDD 10 §4.1）
        provider, lic, desc = (
            (s.provider, s.license, s.desc)
            if s.provider
            else (s.origin, "—", f"{s.modality} · 导入源 · {s.root}")
        )
        caps.append(
            {
                "id": f"dataset:{s.id}",
                "kind": "dataset",
                "layer": "representation",
                "name": s.name,
                "provider": provider,
                "license": lic,
                "status": _DS_STATUS.get(s.status, "planned"),
                "isolation": "local",
                "desc": desc,
                "tasks": [modality_task.get(s.modality, "")],
            }
        )

    # 验证器 · CalibrationSource（真实：CUBS CF）
    caps.append(
        {
            "id": "cal:cubs-cf",
            "kind": "calibration_source",
            "layer": "verification",
            "name": "CUBS calibration factor",
            "provider": "CREATIS",
            "license": "CC BY",
            "status": "active",
            "isolation": "local",
            "desc": "每图 mm/px 标定系数（无标定硬拒绝）",
            "tasks": ["far_wall_cca_imt"],
        }
    )

    # 占位卡（planned · 有类型不接线）——观测空间 / 动作空间 / 回合与轨迹
    caps += [
        {
            "id": "connector:dicom-pacs",
            "kind": "connector",
            "layer": "representation",
            "name": "DICOM-PACS connector",
            "provider": "—",
            "license": "—",
            "status": "planned",
            "isolation": "",
            "desc": "从院内 PACS 拉取 DICOM（待接）",
            "tasks": [],
        },
        {
            "id": "mcp:clinical-tools",
            "kind": "mcp",
            "layer": "action",
            "name": "Clinical-tools MCP",
            "provider": "—",
            "license": "—",
            "status": "planned",
            "isolation": "",
            "desc": "外部工具服务器（MCP，待接）",
            "tasks": [],
        },
        {
            "id": "kb:fetal-growth",
            "kind": "knowledge_base",
            "layer": "memory",
            "name": "Fetal growth curves",
            "provider": "—",
            "license": "—",
            "status": "planned",
            "isolation": "",
            "desc": "生长曲线 / 指南 RAG（待接）",
            "tasks": ["fetal_hc"],
        },
        {
            "id": "store:corrections",
            "kind": "correction_store",
            "layer": "memory",
            "name": "Correction store",
            "provider": "glaux",
            "license": "internal",
            "status": "planned",
            "isolation": "local",
            "desc": "人工修正沉淀为案例（占位）",
            "tasks": [],
        },
    ]
    return caps
