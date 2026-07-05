"""校准的不确定（U6）.

用 CUBS 专家标注建"观察者间/内包络"，把预测分类 confident / unsure，
并**校准**：保证环境"有把握"处误差确实小、"存疑"处确实大——这是环境知道
"哪些自己扛、哪些递给 B"的前提（对无 ground truth 的 B 尤其关键）。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


def absolute_bias_um(a: np.ndarray, b: np.ndarray) -> dict[str, float]:
    """两组 IMT（mm）间的绝对/带符号偏差（µm）——对标 CUBS 观察者内/间。

    CUBS 参考：观察者内 A1 vs A1′ ≈ 160±140µm；观察者间 A1 vs A2 ≈ 194±177µm。
    """
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    if a.shape != b.shape:
        raise ValueError("两组长度不等")
    diff_um = (a - b) * 1000.0
    return {
        "abs_bias_mean": float(np.abs(diff_um).mean()),
        "abs_bias_std": float(np.abs(diff_um).std()),
        "signed_bias_mean": float(diff_um.mean()),
    }


@dataclass(frozen=True)
class CalibrationReport:
    threshold: float
    confident_mae: float
    unsure_mae: float
    separation_ok: bool  # confident 误差 < unsure 误差 → 校准成立


class UncertaintyCalibrator:
    """把不确定信号（如多方法离散度）校准为 confident/unsure 阈值。"""

    def __init__(self, threshold: float | None = None) -> None:
        self.threshold = threshold

    def fit(self, signal: np.ndarray, *, quantile: float = 0.5) -> "UncertaintyCalibrator":
        """以信号分位数为阈（缺省中位数）：低于阈=confident。"""
        self.threshold = float(np.quantile(np.asarray(signal, float), quantile))
        return self

    def classify(self, signal: np.ndarray) -> np.ndarray:
        """返回布尔数组：True=confident（信号 ≤ 阈）。"""
        if self.threshold is None:
            raise RuntimeError("未 fit：无阈值")
        return np.asarray(signal, float) <= self.threshold

    def calibration_report(
        self, signal: np.ndarray, abs_error: np.ndarray
    ) -> CalibrationReport:
        """在带 ground truth 的留出集上检验分流是否可信。"""
        signal = np.asarray(signal, float)
        abs_error = np.asarray(abs_error, float)
        confident = self.classify(signal)
        conf_mae = float(abs_error[confident].mean()) if confident.any() else float("nan")
        uns_mae = float(abs_error[~confident].mean()) if (~confident).any() else float("nan")
        return CalibrationReport(
            threshold=float(self.threshold),
            confident_mae=conf_mae,
            unsure_mae=uns_mae,
            separation_ok=bool(conf_mae < uns_mae),
        )
