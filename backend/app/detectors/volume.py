"""CT 的动作轴：体掩膜（TotalSegmentator 缓存 / 隔离子进程）+ 画笔编辑回流。"""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from glaux_core.contracts import Detection, VolumeMask, measurement_to_dict
from glaux_core.tasks import REGISTRY, TaskType

from .. import config, dataset_ct, segment_ts
from ..schemas import ModelInfo
from .base import DetectorBase, calibration_result

_DEFAULT_METHOD = "totalsegmentator_v2"


def labelmap_ref(volume_id: str, task: str, method: str) -> str:
    """任务结果字节面的 URL 模板（SDD 10 §5.3：有意保留的 /volume/{id}/labelmap）。"""
    return f"/api/volume/{volume_id}/labelmap?task={task}&method={method}"


def _plugin(task: str):
    try:
        plugin = REGISTRY[TaskType(task)]
    except ValueError as e:
        raise ValueError(f"未知 task：{task}") from e
    if plugin.adapter_kind != VolumeDetector.kind:
        raise ValueError(f"task {task} 非 volume 任务")
    return plugin


class VolumeDetector(DetectorBase):
    kind = "volume"
    accepted_regions: tuple[str, ...] = ()  # 全体积分割，不接受选区

    def methods(self) -> list[ModelInfo]:
        # 注册为 ct_abdomen 的 active 模型：否则切模态时 activeModel 停在上一模态的方法。
        if not config.ct_data_available():
            return []
        return [ModelInfo(
            id=_DEFAULT_METHOD,
            pub="wasserth · TotalSegmentator v2.4.0",
            desc="nnU-Net v2 · 117 类全身 CT 分割（v0 肝+双肾 3 类）· Apache-2.0",
            active=True,
            backend="isolated:uv/py3.12/torch-cpu",
            modality="ct_abdomen",
        )]

    def detect(self, ref, obj, spec):
        plugin = REGISTRY[TaskType(spec.task)]
        method = spec.method or _DEFAULT_METHOD
        labelmap_path, mv = segment_ts.segment(spec.image_id, method)
        vol_prim = VolumeMask(
            id=f"{spec.image_id}_labelmap",
            ref=labelmap_ref(spec.image_id, spec.task, method),  # URL：前端拉 labelmap
            classes=plugin.classes,
            raw_ref=f"/api/volume/{spec.image_id}/raw",  # URL：下发前端
            path=labelmap_path,  # fs 路径：measure 读 labelmap
            raw_path=dataset_ct.nifti_path(spec.image_id),  # fs 路径：measure 算 HU mean
        )
        det = Detection(primitives=(vol_prim,), model_version=mv, roi_used=None)
        return det, calibration_result(spec.calibration)

    def hydrate(self, primitives):
        """``/task/measure`` 回传的 VolumeMask 只带 ``ref`` URL：据其补回 labelmap 与原始体路径。"""
        out = []
        for p in primitives:
            if isinstance(p, VolumeMask) and p.path is None and p.ref:
                q = parse_qs(urlparse(p.ref).query)
                volume_id = p.id.removesuffix("_labelmap")
                method = q.get("method", [_DEFAULT_METHOD])[0]
                path = segment_ts.labelmap_path(volume_id, method)
                if not Path(path).is_file():
                    raise ValueError(f"labelmap 缓存未命中：{volume_id} {method}——先跑 /task/run")
                p = replace(p, path=str(path), raw_path=dataset_ct.nifti_path(volume_id))
            out.append(p)
        return tuple(out)

    def apply_edit(self, ref, obj, req):
        """画笔编辑 → patch labelmap（base_seq 乐观并发）→ 按注册表重测（SDD 10 §5.2）。

        ``EditOp.index.z`` 定位轴状位切片；``mask_png`` 为 ``data:image/png;base64,…``。
        """
        plugin = _plugin(req.task)
        slices = []
        for op in req.ops:
            if op.index.z is None:
                raise ValueError("volume 编辑须给 index.z")
            slices.append({"z": op.index.z, "class_id": op.class_id, "mode": op.mode,
                           "mask_png_ref": op.mask_png})
        new_path, _arr, new_seq = dataset_ct.guarded_patch_labelmap(
            ref.object_id,
            slices,
            base_seq=req.base_seq,
            method=req.method,
            class_id_to_role={c.class_id: c.role for c in plugin.classes},
        )
        cal = calibration_result(obj.calibration)
        # raw_ref 留 None——画笔只改 labelmap（count）不改 CT 强度，HU mean 不重算。
        ref_url = labelmap_ref(ref.object_id, req.task, req.method)
        vol_prim = VolumeMask(id=f"{ref.object_id}_labelmap", ref=ref_url,
                              classes=plugin.classes, raw_ref=None, path=new_path)
        meas = plugin.measure(Detection(primitives=(vol_prim,), model_version="human@edit"), cal)
        return {
            "metrics": measurement_to_dict(meas)["metrics"],
            "labelmap_ref": ref_url,
            "new_labelmap_path": new_path,
            "model_version": "human@edit",
            "seq": new_seq,  # 客户端下次编辑回传作 base_seq（乐观并发）
        }


