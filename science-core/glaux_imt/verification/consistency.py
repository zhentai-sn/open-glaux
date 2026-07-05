"""多方法一致性 / 分歧暴露（U6）.

CUBS 每图自带多方法输出（5–7 算法 + 多专家）——天然可做一致性检验：
一致处高置信，分歧处标记；并揪出离群方法。素材几乎白送。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class AgreementResult:
    per_column_std: np.ndarray  # 跨方法逐列标准差
    mean_std: float
    median_curve: np.ndarray
    high_variance_columns: np.ndarray  # 分歧热点（列索引）
    outlier_methods: list[str]


def method_agreement(
    per_method: dict[str, np.ndarray],
    *,
    std_threshold: float | None = None,
    outlier_z: float = 3.0,
) -> AgreementResult:
    """对同图多方法的逐列厚度剖面做一致性分析。

    ``per_method``: method → 等长逐列厚度数组（µm，已对齐到公共支撑）。
    ``std_threshold`` 缺省为 2×平均逐列标准差。离群方法 = 与中位数曲线的
    平均绝对偏离超出稳健阈（median + z·MAD）。
    """
    if len(per_method) < 2:
        raise ValueError("一致性分析至少需要 2 个方法")
    names = list(per_method)
    lengths = {arr.size for arr in per_method.values()}
    if len(lengths) != 1:
        raise ValueError(f"各方法列数不一致：{lengths}")

    mat = np.vstack([np.asarray(per_method[n], float) for n in names])  # (K, C)
    median_curve = np.median(mat, axis=0)
    per_column_std = mat.std(axis=0)
    if std_threshold is None:
        std_threshold = 2.0 * float(per_column_std.mean())
    high_var = np.flatnonzero(per_column_std > std_threshold)

    dev = np.abs(mat - median_curve).mean(axis=1)  # 每方法对中位曲线的平均偏离
    med_dev = float(np.median(dev))
    mad = float(np.median(np.abs(dev - med_dev)))
    thr = med_dev + outlier_z * mad
    outliers = [
        names[k] for k in range(len(names)) if dev[k] > thr and dev[k] > 1e-6
    ]

    return AgreementResult(
        per_column_std=per_column_std,
        mean_std=float(per_column_std.mean()),
        median_curve=median_curve,
        high_variance_columns=high_var,
        outlier_methods=outliers,
    )
