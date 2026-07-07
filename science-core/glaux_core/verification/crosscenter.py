"""跨中心外部验证 · leave-one-center-out（U6）.

CUBS 2 中心（Cyprus / Pisa）——最强的外部验证证明。

⚠️ 官方 ``Folds`` 是随机 5 折、混合 clin+tech、**非按中心**；LOCO 须**自建**
按临床 CSV 首列中心标签的分层切分，勿直接套官方 fold（见计划 U6）。
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping

import numpy as np


def center_split(centers: Mapping[str, str]) -> dict[str, list[str]]:
    """``image_id → center`` 反转为 ``center → [image_id...]``。"""
    out: dict[str, list[str]] = {}
    for image_id, center in centers.items():
        out.setdefault(center, []).append(image_id)
    return out


def leave_one_center_out(
    centers: Mapping[str, str],
) -> Iterator[tuple[str, list[str], list[str]]]:
    """产出 (held_out_center, test_ids, train_ids) 三元组。"""
    by_center = center_split(centers)
    all_centers = sorted(by_center)
    for held in all_centers:
        test_ids = by_center[held]
        train_ids = [i for c in all_centers if c != held for i in by_center[c]]
        yield held, test_ids, train_ids


def loco_report(
    abs_error: Mapping[str, float],
    centers: Mapping[str, str],
) -> dict[str, dict[str, float]]:
    """每个中心的 MAE 与样本数 + 中心间差距——跨中心泛化表。"""
    by_center = center_split(centers)
    table: dict[str, dict[str, float]] = {}
    for center, ids in by_center.items():
        errs = np.array([abs_error[i] for i in ids if i in abs_error], float)
        if errs.size == 0:
            continue
        table[center] = {"mae": float(errs.mean()), "n": float(errs.size)}
    maes = [v["mae"] for v in table.values()]
    if maes:
        gap = float(max(maes) - min(maes))
        for v in table.values():
            v["cross_center_gap"] = gap
    return table
