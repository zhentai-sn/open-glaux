"""动作轴协议（SDD 10 §9.2、D-12）：一个几何族（``TaskPlugin.adapter_kind``）一个 ``Detector``。

``Detector`` 只负责取数与调用模型（缓存 / 隔离子进程），组装成 science-core 的 ``Detection``。
对象解析、``object_kinds`` 门控、``available()`` 探测、``region.kind`` 校验与标定解析这五步公共
前缀固定在 :func:`app.kernel.run_task` 内（§7 规则 13），实现里不得重复。

与 ``glaux_core.segmentation.base.Adapter`` 同名字空间（``kind`` 取同一组值）但**不继承**：
``Adapter.run`` 吃进程内像素、只覆盖 2D 灰度；后端做的是按对象 id 取数、起隔离子进程、读缓存与
标定。硬继承会让后端 import 模型层，或让 science-core 感知文件系统。两边键集合一致由不变量测试
``set(REGISTRY.adapter_kind) == set(DETECTORS)`` 保证。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from glaux_core.calibration.calibration import (
    CalibrationResult,
    CFSource,
    calibration_from_dict,
)

if TYPE_CHECKING:  # pragma: no cover
    from glaux_core.contracts import Detection, Primitive

    from ..schemas import Calibration, EditRequest, ModelInfo, ObjectMeta, TaskSpec
    from ..sources.base import ObjectRef


class DetectorUnavailable(RuntimeError):
    """模型层 / 可选依赖未装配（公共前缀②，映射 503）。"""


class Detector(Protocol):
    kind: str
    accepted_regions: tuple[str, ...]

    def available(self) -> bool: ...
    def methods(self) -> list[ModelInfo]: ...
    def detect(
        self, ref: ObjectRef, obj: ObjectMeta, spec: TaskSpec
    ) -> tuple[Detection, CalibrationResult]: ...
    def reference(self, ref: ObjectRef, obj: ObjectMeta) -> Detection | None: ...
    def apply_edit(self, ref: ObjectRef, obj: ObjectMeta, req: EditRequest) -> dict | None: ...
    def verify(self, ref: ObjectRef, obj: ObjectMeta, output: dict | None) -> dict | None: ...


def calibration_result(cal: Calibration) -> CalibrationResult:
    """``Calibration`` → ``CalibrationResult``。

    ``mm_per_px`` 保持收敛前的形状（``source=cubs``、空 provenance），TaskOutput 因此逐字节不变；
    其余 kind 一律经 ``calibration_from_dict`` 派发（未知 kind → ``HardReject``，D-16）。
    """
    if cal.kind == "mm_per_px":
        calibration_from_dict(cal.model_dump())  # 只做校验：非正 / 非数 → HardReject
        return CalibrationResult(cf=float(cal.value), source=CFSource.CUBS)  # type: ignore[arg-type]
    return calibration_from_dict(cal.model_dump())


class DetectorBase:
    """``Detector`` 的缺省实现。"""

    kind: str = ""
    accepted_regions: tuple[str, ...] = ()

    def available(self) -> bool:
        return True

    def methods(self) -> list[ModelInfo]:
        return []

    def detect(self, ref, obj, spec):
        raise NotImplementedError

    def reference(self, ref, obj):
        return None

    def apply_edit(self, ref, obj, req):
        return None

    def verify(self, ref, obj, output):
        return None

    # --- Protocol 之外的挂点 ---------------------------------------------------

    def enrich(self, out: dict, ref: ObjectRef, obj: ObjectMeta, spec: TaskSpec,
               cal: CalibrationResult) -> None:
        """与参考结果的对比度量（原 ``kernel._enrich_gold``），追加进 ``out["metrics"]``。"""

    def hydrate(self, primitives: tuple[Primitive, ...]) -> tuple[Primitive, ...]:
        """``/task/measure`` 收到的图元只带 URL 引用时，补回测量所需的本地路径。缺省原样返回。"""
        return primitives
