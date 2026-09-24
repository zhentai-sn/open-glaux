"""颈动脉 IMT 的动作轴：LI/MA 壁线对（caroSegDeep 缓存 / 隔离子进程，或合成边界）。"""

from __future__ import annotations

from glaux_core.contracts import Detection, Polyline

from .. import config, dataset, mock, segment_proc
from ..schemas import ModelInfo
from .base import DetectorBase, calibration_result

#: 已知方法的 (出处, 描述, 执行方式)；数据集里出现的其余参考方法按目录名兜底。
_KNOWN = {
    dataset.CARO: (
        "nl3769 · Dilated U-Net",
        "CUBS CREATIS baseline · Keras/TF 2.4.1 · far-wall + IMC",
        "isolated:uv/py3.8/TF2.4",
    ),
    "GT-FAMUS": ("FAMUS · reference", "Fusion of experts — CUBS gold-standard reference",
                 "reference"),
    "Manual-A1": ("Expert A1", "Manual tracing (gold)", "reference"),
    "Manual-A2": ("Expert A2", "Manual tracing", "reference"),
    "Computerized-CNR_IT": ("CNR Pisa", "First-order absolute moment edge operator", "reference"),
    "Computerized-POLITO_UNET": ("Politecnico di Torino", "U-Net segmentation of the IMC",
                                 "reference"),
}


def _polyline(role: str, pts) -> Polyline:
    return Polyline(id=role, role=role, points=tuple((float(x), float(y)) for x, y in pts))


def _column_window(spec) -> tuple[int, int] | None:
    r = spec.region
    return (int(r.x0), int(r.x1)) if r is not None and r.kind == "column_window" else None


class WallPairDetector(DetectorBase):
    kind = "wall_pair"
    accepted_regions = ("column_window",)

    def methods(self) -> list[ModelInfo]:
        pub, desc, backend = _KNOWN[dataset.CARO]
        out = [ModelInfo(id=dataset.CARO, pub=pub, desc=desc, active=True, backend=backend)]
        if config.SEG_DIR.is_dir():
            for d in sorted(config.SEG_DIR.iterdir()):
                if not d.is_dir() or d.name == f"Computerized-{dataset.CARO}":
                    continue
                pub, desc, be = _KNOWN.get(d.name, (d.name, "CUBS reference method", "reference"))
                out.append(ModelInfo(id=d.name, pub=pub, desc=desc, active=False, backend=be))
        return out

    def detect(self, ref, obj, spec):
        roi = _column_window(spec)
        method = spec.method or dataset.CARO
        if ref.datasource.synthetic:  # 开发者模式合成源：合成边界（形状即契约）
            li, ma = mock.segment_boundaries(roi)
            mv = f"{method}@mock"
        else:
            li, ma, mv = segment_proc.segment(spec.image_id, method)
        det = Detection(
            primitives=(_polyline("LI", li), _polyline("MA", ma)),
            model_version=mv,
            region=spec.region.model_dump(exclude_none=True) if spec.region else None,
        )
        return det, calibration_result(spec.calibration)

    def reference(self, ref, obj):
        """金标准 Manual-A1 壁线；合成源或缺失 → None。"""
        if ref.datasource.synthetic:
            return None
        try:
            li, ma = dataset.boundaries_as_points(ref.object_id, "Manual-A1")
        except FileNotFoundError:
            return None
        return Detection(primitives=(_polyline("LI", li), _polyline("MA", ma)),
                         model_version="Manual-A1")

    def enrich(self, out, ref, obj, spec, cal):
        """vs A1 |偏差|（µm）：与 Manual-A1 壁线的对称 PDM 之差。"""
        from .. import kernel

        metrics = out.get("metrics", {})
        if (spec.method or dataset.CARO) == "Manual-A1" or "IMT_pdm" not in metrics:
            return
        gold = self.reference(ref, obj)
        if gold is None:
            return
        by_role = {p.role: p.as_points() for p in gold.primitives}
        a1 = kernel.measure(by_role["LI"], by_role["MA"], cal.cf)
        um = round(abs(metrics["IMT_pdm"]["value"] - a1.pdm_mean_mm) * 1000, 1)
        metrics["vs_A1"] = {"value": um, "unit": "µm", "label_en": "vs A1 |bias|",
                            "label_zh": "vs A1 |偏差|"}
