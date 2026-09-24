"""病理 WSI 的动作轴：ROI 内核检测（StarDist 缓存 / 隔离子进程）+ 复现验证。"""

from __future__ import annotations

import json

from glaux_core.contracts import Detection, PointSet
from glaux_core.tasks import REGISTRY, TaskType

from .. import config
from ..schemas import ModelInfo
from .base import DetectorBase, calibration_result

_DEFAULT_METHOD = "stardist_he"


def _wsi_modules():
    from .. import dataset_wsi, segment_wsi

    return dataset_wsi, segment_wsi


class WsiDetector(DetectorBase):
    kind = "wsi"
    accepted_regions = ("box",)

    def available(self) -> bool:
        try:
            import openslide  # noqa: F401
        except Exception:  # noqa: BLE001 - 缺库或缺 libopenslide
            return False
        return True

    def methods(self) -> list[ModelInfo]:
        if not config.wsi_data_available():
            return []
        return [ModelInfo(
            id=_DEFAULT_METHOD,
            pub="Weigert & Schmidt · StarDist 2D_versatile_he",
            desc="StarDist 星凸多边形核检测 · H&E 预训练（v0 核计数/密度）· BSD-3",
            active=True,
            backend="isolated:uv/py3.12/tf-cpu",
            modality="pathology",
        )]

    def detect(self, ref, obj, spec):
        r = spec.region
        if r is None:
            raise ValueError(
                "WSI 核检测需 box 选区（region）——硬拒绝，整片推理不可行"
            )
        _, segment_wsi = _wsi_modules()
        plugin = REGISTRY[TaskType(spec.task)]
        roi_box = (int(r.x0), int(r.y0), int(r.x1), int(r.y1))
        nuclei_json_path, mv = segment_wsi.segment(spec.image_id, roi_box,
                                                   spec.method or _DEFAULT_METHOD)
        data = segment_wsi.load_nuclei(nuclei_json_path)
        ps = PointSet(
            id=f"{spec.image_id}_nuclei",
            points=tuple((float(x), float(y)) for x, y in data.get("points", [])),
            point_class_ids=tuple(int(c) for c in data.get("class_ids", [])),
            classes=plugin.classes,
            roi=roi_box,
        )
        det = Detection(primitives=(ps,), model_version=mv,
                        region=r.model_dump(exclude_none=True))
        return det, calibration_result(spec.calibration)

    def verify(self, ref, obj, output, *, method: str = _DEFAULT_METHOD):
        """与 ship 的 reference 检测算质心匹配 F1（复现验证，非真 GT）。

        缺 reference → ``FileNotFoundError``（端点 422）；隔离环境不可用 → ``RuntimeError``（503）。
        """
        from glaux_core.verification.nuclei import nuclei_reproducibility

        _, segment_wsi = _wsi_modules()
        ref_path = config.WSI_ROOT / f"{ref.object_id}_ref_nuclei.json"
        if not ref_path.is_file():
            raise FileNotFoundError(
                f"reproducibility reference 缺失：{ref_path}——按 data/wsi/README 手工 ship "
                f"模型在 canonical ROI 的检测作 reference；本接口非真 GT 比较"
            )
        gold = json.loads(ref_path.read_text())
        roi = tuple(int(v) for v in gold["roi"])
        try:  # 在 reference 的 ROI 上重跑检测（缓存命中即秒回）
            pred_path, _mv = segment_wsi.segment(ref.object_id, roi, method)
        except Exception as e:  # noqa: BLE001 - 隔离环境不可用 / 子进程失败
            raise RuntimeError(f"核检测不可用：{e}") from e
        pred = segment_wsi.load_nuclei(pred_path)
        res = nuclei_reproducibility(pred.get("points", []), gold.get("points", []),
                                     dist_thresh=8.0)
        res["roi"] = list(roi)
        res["method"] = method
        res["note"] = "reproducibility vs ship reference（模型自身 canonical ROI 检测，非真 GT）"
        return res
