"""caroSegDeep 适配器脚手架（U4）——首个真实模型的集成接缝.

caroSegDeep（CUBS 论文自带 CREATIS 基线，Keras）：两段式
① 远壁（FW）检测 dilated U-Net → ② IMC 分割 dilated U-Net → 输出 LI/MA 曲线。
仓库 + 可下载权重：https://github.com/nl3769/caroSegDeep（companion arXiv:2201.12152）。

**许可证注记**：该仓库无 license 文件（默认保留所有权利）——研究评测可用，
随产品发行前须联系作者授权。适配器隔离在 :class:`ModelAdapter` 之后，换模型低成本。

本文件是接缝：TF/权重在 ``[carosegdeep]`` extra 与外部下载中；缺失时**显式报错**，
绝不静默返回空曲线。真实推理体标注为 TODO 的执行期未知，留给接线阶段落地。
"""

from __future__ import annotations

from pathlib import Path

from glaux_imt.segmentation.base import (
    ModelAdapter,
    SegmentationBackendUnavailable,
    SegmentationRequest,
    SegmentationResult,
)


class CaroSegDeepAdapter(ModelAdapter):
    name = "carosegdeep"

    def __init__(self, fw_weights: Path, imc_weights: Path) -> None:
        self.fw_weights = Path(fw_weights)
        self.imc_weights = Path(imc_weights)

    def _require_backend(self) -> None:
        try:
            import tensorflow  # noqa: F401
        except ImportError as exc:  # pragma: no cover - 环境相关
            raise SegmentationBackendUnavailable(
                "caroSegDeep 需要 TensorFlow：pip install -e '.[carosegdeep]'"
            ) from exc
        for w in (self.fw_weights, self.imc_weights):
            if not w.is_file():
                raise SegmentationBackendUnavailable(
                    f"caroSegDeep 权重缺失：{w}（见 README 的 Dropbox 下载）"
                )

    def segment(self, request: SegmentationRequest) -> SegmentationResult:
        self._require_backend()
        # TODO(接线阶段)：FW 检测 → IMC 分割 → 两条曲线（每列一点）。
        # 属执行期未知，需真实权重 + 图像跑通后落地；此处不臆造实现。
        raise NotImplementedError(
            "caroSegDeep 实时推理未接线——见计划 U4 与 Phase B（需 TF + 权重）"
        )
