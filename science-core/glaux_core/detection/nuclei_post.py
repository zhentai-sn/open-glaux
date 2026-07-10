"""WSI 核检测的 ROI 后处理（P7）——patch 网格切分 + 跨 patch 质心去重。纯 numpy，无 scipy。

为什么在主进程/科学内核做（不在隔离子进程）：这两个是**确定性几何**（不经模型），
放这里可被主测试套件覆盖——patch 边界重复计核是 P7 头号坑之一（同一核落在两个重叠
patch 里会被数两次），先有测试保护。隔离子进程只跑「patch 图 → 质心」的模型部分。

坐标约定：所有坐标是 ROI-local 或 level-0 px（调用方负责在 dedup 前把 patch-local 加 patch 原点
偏到统一坐标系，再 dedup）。
"""

from __future__ import annotations

import numpy as np


def _starts(total: int, patch: int, stride: int) -> list[int]:
    """一维起点序列：步长 stride 覆盖 [0, total)，末块贴右边界（不越界、不漏尾）。"""
    if total <= patch:
        return [0]
    starts = list(range(0, total - patch + 1, stride))
    if not starts or starts[-1] != total - patch:
        starts.append(total - patch)
    return starts


def tile_grid(
    w: int, h: int, patch: int = 256, overlap: int = 32
) -> list[tuple[int, int, int, int]]:
    """把 ROI (w×h) 切成重叠 patch 框 ``(x0, y0, x1, y1)``（ROI-local 坐标）。

    - ``overlap``：相邻 patch 的重叠像素（去重靠它——跨 patch 的同一核落在重叠带才可被识别合并）。
    - 末块贴右/下边界（不漏 ROI 边缘的核）；框按 ROI 边界 clamp（不越界）。
    - ROI 小于一个 patch → 单框覆盖全 ROI。
    """
    if w <= 0 or h <= 0:
        raise ValueError(f"ROI 尺寸非正：({w}, {h})")
    if patch <= 0 or overlap < 0 or overlap >= patch:
        raise ValueError(f"patch/overlap 非法：patch={patch} overlap={overlap}")
    stride = patch - overlap
    boxes: list[tuple[int, int, int, int]] = []
    for y0 in _starts(h, patch, stride):
        for x0 in _starts(w, patch, stride):
            x1 = min(x0 + patch, w)
            y1 = min(y0 + patch, h)
            boxes.append((x0, y0, x1, y1))
    return boxes


def dedup_centroids(
    points: np.ndarray, class_ids: np.ndarray, dist_thresh: float = 8.0
) -> tuple[np.ndarray, np.ndarray]:
    """跨 patch 质心去重：距离 < ``dist_thresh`` 的质心视为同一核，保留先出现者。

    纯 numpy 网格哈希（cell 边长 = dist_thresh）：每个候选点查 3×3 邻域 cell 里已保留的点，
    有任一在阈值内即丢弃。O(n)（点在空间上稀疏）。等价于「贪心近邻合并」。

    - ``points``：``(N, 2)`` float 坐标（统一坐标系，调用方已加 patch 偏移）。
    - ``class_ids``：``(N,)`` int，与 points 对齐。
    - 返回去重后的 ``(points', class_ids')``，保序（先出现者优先）。
    """
    points = np.asarray(points, dtype=float).reshape(-1, 2)
    class_ids = np.asarray(class_ids).reshape(-1)
    if len(points) != len(class_ids):
        raise ValueError(f"points({len(points)}) 与 class_ids({len(class_ids)}) 不等长")
    if len(points) == 0:
        return points, class_ids
    if dist_thresh <= 0:
        return points, class_ids

    cell = float(dist_thresh)
    thresh_sq = cell * cell
    grid: dict[tuple[int, int], list[int]] = {}  # cell → 已保留点的行索引
    keep: list[int] = []
    for i in range(len(points)):
        px, py = points[i]
        cx, cy = int(np.floor(px / cell)), int(np.floor(py / cell))
        dup = False
        for gx in (cx - 1, cx, cx + 1):
            for gy in (cy - 1, cy, cy + 1):
                for j in grid.get((gx, gy), ()):
                    dx = px - points[j, 0]
                    dy = py - points[j, 1]
                    if dx * dx + dy * dy < thresh_sq:
                        dup = True
                        break
                if dup:
                    break
            if dup:
                break
        if not dup:
            keep.append(i)
            grid.setdefault((cx, cy), []).append(i)
    idx = np.asarray(keep, dtype=int)
    return points[idx], class_ids[idx]
