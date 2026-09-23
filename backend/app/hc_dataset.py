"""胎儿头围（HC）模态**数据/模型路由**——真实优先，无数据回退合成。

对齐 IMT 的"真实资产不可用则优雅回退"哲学（见 dataset/mock）：

- HC18 真实数据集就绪（``config.hc_data_available()``）→ 路由到 :mod:`app.hc_real`
  （HC18 + CSM 隔离子进程，真图真模型真参考头围）。
- 否则 → 路由到 :mod:`app.hc_synth`（自包含合成，无需外部下载），使 CI/无数据环境也能起。

按 image_id 派发：真实 id（HC18 CSV 内，如 ``000_HC``）走 hc_real，合成 id（``hc_001``）
走 hc_synth，两者命名不冲突、可共存。上层（kernel/api）只认本模块的统一接口，不感知后端。
"""

from __future__ import annotations

from . import config, hc_real, hc_synth

MODALITY = "fetal_hc"


def _real_available() -> bool:
    return config.hc_data_available()


def _route(image_id: str):
    """为某 image_id 选后端模块。"""
    if _real_available() and hc_real.is_hc(image_id):
        return hc_real
    if hc_synth.is_hc(image_id):
        return hc_synth
    return hc_real if _real_available() else hc_synth


def is_hc(image_id: str) -> bool:
    return (_real_available() and hc_real.is_hc(image_id)) or hc_synth.is_hc(image_id)


def list_ids() -> list[str]:
    """当前活跃后端的图像清单（真实优先）。"""
    return hc_real.list_ids() if _real_available() else hc_synth.list_ids()


def cf_of(image_id: str) -> float:
    return _route(image_id).cf_of(image_id)


def image_png(image_id: str) -> bytes:
    return _route(image_id).image_png(image_id)


def image_size(image_id: str) -> tuple[int, int]:
    return _route(image_id).image_size(image_id)


def image_meta(image_id: str) -> dict:
    return _route(image_id).image_meta(image_id)


def gt_hc_mm(image_id: str) -> float:
    return _route(image_id).gt_hc_mm(image_id)


def detect(image_id: str, roi: tuple[int, int] | None = None):
    """真椭圆检测（缓存优先 + 隔离子进程）或合成检测——返回 (points, Ellipse, model_version)。"""
    return _route(image_id).detect(image_id, roi)


# --- SDD 10 数据轴：胎儿头围 Source ---------------------------------------------------
# hc_real / hc_synth 各是一个 DataSource：hc18（真实，内置示例）与 synthetic-hc（开发者模式显式
# 注册，D-17）。上面按「真实优先」路由的函数仍供 kernel 使用，W2 随 DETECTORS 收口。

from pathlib import Path  # noqa: E402

from PIL import Image  # noqa: E402

from .datasource_registry import DataSource  # noqa: E402
from .schemas import Axis, Calibration, ObjectMeta  # noqa: E402
from .sources.base import SourceBase, method_refs, resources_for  # noqa: E402

SYNTHETIC_ID = "synthetic-hc"


class HcSource(SourceBase):
    modality = MODALITY
    kind = "image"
    label = "Fetal head ultrasound"
    caches = (hc_real._ds,)

    def probe(self, root: Path) -> bool:
        return (root / "training_set/training_set").is_dir() and (
            root / "training_set_pixel_size_and_HC.csv"
        ).is_file()

    def builtin_sample(self) -> DataSource:
        return DataSource(
            id="hc18",
            name="HC18 · fetal head US",
            modality=self.modality,
            root=config.HC18_ROOT,
            origin="builtin",
            calibration={"pixel_size": "per-image csv"},
            provider="Grand Challenge",
            license="CC BY-NC-SA",
            desc="999 张真实胎儿颅脑超声 + 椭圆真值",
        )

    def synthetic_sample(self) -> DataSource:
        return DataSource(
            id=SYNTHETIC_ID,
            name="Synthetic · fetal head US",
            modality=self.modality,
            root=Path("synthetic"),
            origin="builtin",
            calibration={"pixel_size": "synthetic"},
        )

    @staticmethod
    def _backend(source: DataSource):
        return hc_synth if source.synthetic else hc_real

    def list_ids(self, source: DataSource) -> list[str]:
        return self._backend(source).list_ids()

    def describe(self, source: DataSource, object_id: str) -> ObjectMeta:
        backend = self._backend(source)
        rec = backend.image_meta(object_id)
        w, h = backend.image_size(object_id)
        cf = rec["cf"]
        return ObjectMeta(
            id=object_id,
            kind=self.kind,
            modality=self.modality,
            source_id=source.id,
            axes=[Axis(name="x", size=w, spacing=cf, unit="mm"),
                  Axis(name="y", size=h, spacing=cf, unit="mm")],
            calibration=Calibration(
                kind="mm_per_px",
                value=cf,
                source="synthetic" if source.synthetic else "hc18_csv",
            ),
            resources=resources_for(object_id),
            methods=method_refs(rec["methods"], gold=("GT-ellipse",),
                                agent=tuple(rec["methods"][:1])),
            meta={"center": rec["center"]},
        )

    def encoded(self, source, object_id, index):
        return self._backend(source).image_png(object_id), "image/png"

    def render(self, source, object_id, index, window):
        import io

        data, _ = self.encoded(source, object_id, index)
        return Image.open(io.BytesIO(data)).convert("L")


SOURCE = HcSource()
