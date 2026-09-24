"""胎儿头围的动作轴：闭合颅骨轮廓 → 拟合椭圆（HC18 + CSM，或合成亮环检测）。"""

from __future__ import annotations

from glaux_core.contracts import Detection, EllipseShape

from .. import config, hc_dataset, hc_real, hc_synth
from ..schemas import ModelInfo
from .base import DetectorBase, calibration_result


class ContourDetector(DetectorBase):
    kind = "contour"
    accepted_regions = ("column_window",)

    def methods(self) -> list[ModelInfo]:
        if config.hc_data_available():
            return [ModelInfo(
                id="CSM",
                pub="gauravxthakur · CSM (HuggingFace)",
                desc=("Convolutional Segmentation Machine · HC18 · Apache-2.0 · "
                      "头部分割 → 椭圆 → Ramanujan 周长"),
                active=True,
                backend="isolated:uv/py3.12/torch-cpu",
                modality="fetal_hc",
            )]
        return [ModelInfo(
            id="ellipse-fit",
            pub="Bright-ring · direct LSQ ellipse",
            desc="阈高回声颅骨环 → Halir–Flusser 最小二乘椭圆拟合 → Ramanujan 周长（合成回退）",
            active=True,
            backend="local:numpy",
            modality="fetal_hc",
        )]

    @staticmethod
    def _backend(ref):
        return hc_synth if ref.datasource.synthetic else hc_real

    def detect(self, ref, obj, spec):
        # 取数前提：对象须在 HC 数据集内（几何族同为 image 的颈动脉图不能喂给头围检测）
        if not hc_dataset.is_hc(spec.image_id):
            raise ValueError(f"非 HC 图像 id：{spec.image_id}——硬拒绝，不在错模态上瞎跑")
        r = spec.region
        roi = (int(r.x0), int(r.x1)) if r is not None else None
        _points, ell, mv = self._backend(ref).detect(spec.image_id, roi)
        det = Detection(
            primitives=(EllipseShape.from_ellipse(ell, id="skull", role="skull"),),
            model_version=mv,
            region=r.model_dump(exclude_none=True) if r else None,
        )
        return det, calibration_result(spec.calibration)

    def enrich(self, out, ref, obj, spec, cal):
        """vs 真值 |偏差|（mm）：与参考头围之差。"""
        metrics = out.get("metrics", {})
        if "HC" not in metrics:
            return
        try:
            gt = self._backend(ref).gt_hc_mm(spec.image_id)
        except Exception:  # noqa: BLE001 - 参考缺失即不追加对比
            return
        metrics["vs_GT"] = {"value": round(abs(metrics["HC"]["value"] - gt), 2), "unit": "mm",
                            "label_en": "vs GT |bias|", "label_zh": "vs 真值 |偏差|"}
