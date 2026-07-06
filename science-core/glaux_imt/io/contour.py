"""闭合轮廓 / 椭圆表征（多模态几何）——胎儿头围（HC）等**闭合边界**任务的曲线原生载体。

与 :mod:`glaux_imt.io.boundaries` 的开放折线（LI/MA 血管壁对）并列：
颈动脉 IMT 量的是两条开放壁线间的法向厚度；胎儿头围量的是**一条闭合曲线**（颅骨轮廓）
拟合成椭圆后的**周长**。二者共享标定（mm/px）与任务规范层，只是几何族不同。

设计对齐脑暴「曲线原生、确定性几何」：椭圆拟合用直接最小二乘（Halir–Flusser，
数值稳定、纯 numpy、可复现），周长用 Ramanujan II 近似（相对误差 < 1e-5）——
**不塌缩成掩膜面积、不经 LLM 估值**。
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Ellipse:
    """一个椭圆：中心 (cx, cy)、半长轴 a ≥ 半短轴 b、长轴与 x 轴夹角 theta（弧度）。

    坐标为像素单位；转 mm 由标定 CF 完成（与 IMT 同一标定层）。
    """

    cx: float
    cy: float
    a: float  # 半长轴（像素）
    b: float  # 半短轴（像素）
    theta: float  # 长轴相对 +x 的旋转（弧度）

    def __post_init__(self) -> None:
        if not (self.a > 0 and self.b > 0):
            raise ValueError(f"椭圆半轴须为正：a={self.a} b={self.b}")
        if self.b > self.a:  # 规范化：a 恒为半长轴（长轴随之转 90°）
            a0, b0 = self.a, self.b
            object.__setattr__(self, "a", b0)
            object.__setattr__(self, "b", a0)
            object.__setattr__(self, "theta", self.theta + math.pi / 2)

    def circumference(self) -> float:
        """椭圆周长（像素）——Ramanujan 第二近似。

        C ≈ π(a+b)·(1 + 3h/(10 + √(4−3h)))，h = ((a−b)/(a+b))²。
        对生理范围（低偏心）相对误差 < 1e-5，远优于 π(a+b) 或 2π√((a²+b²)/2)。
        """
        a, b = self.a, self.b
        if a + b == 0:
            return 0.0
        h = ((a - b) / (a + b)) ** 2
        return math.pi * (a + b) * (1.0 + 3.0 * h / (10.0 + math.sqrt(4.0 - 3.0 * h)))

    def area(self) -> float:
        """椭圆面积（像素²）= π·a·b。"""
        return math.pi * self.a * self.b

    def polygon(self, n: int = 180) -> np.ndarray:
        """把椭圆离散成 (n,2) 闭合多边形点列（渲染 / 叠加 / 反投影用）。"""
        t = np.linspace(0.0, 2.0 * math.pi, n, endpoint=False)
        ct, st = math.cos(self.theta), math.sin(self.theta)
        ex = self.a * np.cos(t)
        ey = self.b * np.sin(t)
        x = self.cx + ex * ct - ey * st
        y = self.cy + ex * st + ey * ct
        return np.column_stack([x, y])


def fit_ellipse(points: np.ndarray) -> Ellipse:
    """对散点做**直接最小二乘椭圆拟合**（Halir–Flusser 1998），返回几何椭圆。

    ``points`` 为 (N,2) 像素坐标，N ≥ 5（椭圆 5 自由度）。约束 4AC−B²=1 保证解为椭圆
    （非双曲/抛物），数值上比 Fitzgibbon 原版稳定。几何参数由 2×2 二次型特征分解求得
    （避免旋转角的象限歧义）。
    """
    p = np.asarray(points, dtype=float).reshape(-1, 2)
    if p.shape[0] < 5:
        raise ValueError(f"椭圆拟合至少需 5 点，实得 {p.shape[0]}")
    x = p[:, 0]
    y = p[:, 1]
    # 数值调理：中心化 + 缩放，拟合后再逆变换（避免大坐标下 S 矩阵病态）
    mx, my = x.mean(), y.mean()
    s = max(np.sqrt(((x - mx) ** 2 + (y - my) ** 2).mean()), 1e-9)
    xn = (x - mx) / s
    yn = (y - my) / s

    d1 = np.column_stack([xn * xn, xn * yn, yn * yn])  # 二次项
    d2 = np.column_stack([xn, yn, np.ones_like(xn)])  # 线性项
    s1 = d1.T @ d1
    s2 = d1.T @ d2
    s3 = d2.T @ d2
    try:
        t = -np.linalg.solve(s3, s2.T)
    except np.linalg.LinAlgError as exc:
        raise ValueError("椭圆拟合失败：线性部分奇异（点可能共线）") from exc
    m = s1 + s2 @ t
    c1_inv = np.array([[0.0, 0.0, 0.5], [0.0, -1.0, 0.0], [0.5, 0.0, 0.0]])
    m = c1_inv @ m
    _, eigvec = np.linalg.eig(m)
    # 选满足 4AC−B²>0 的特征向量（椭圆解）
    a_coef = None
    for k in range(eigvec.shape[1]):
        v = np.real(eigvec[:, k])
        if 4.0 * v[0] * v[2] - v[1] ** 2 > 0:
            a_coef = v
            break
    if a_coef is None:
        raise ValueError("椭圆拟合失败：无满足椭圆约束的解（点分布非椭圆）")
    a2 = t @ a_coef
    A, B, C = a_coef
    D, E, F = a2
    # 归一化坐标下的几何椭圆 → 特征分解 2×2 二次型
    ell_n = _conic_to_ellipse(A, B, C, D, E, F)
    # 逆变换：反缩放 + 反中心化（角度与缩放无关，半轴 ×s，中心还原）
    return Ellipse(
        cx=ell_n.cx * s + mx,
        cy=ell_n.cy * s + my,
        a=ell_n.a * s,
        b=ell_n.b * s,
        theta=ell_n.theta,
    )


def _conic_to_ellipse(A: float, B: float, C: float, D: float, E: float, F: float) -> Ellipse:
    """代数二次曲线 A x²+B xy+C y²+D x+E y+F=0 → 几何椭圆（特征分解，无象限歧义）。"""
    mat = np.array([[A, B / 2.0], [B / 2.0, C]])
    b_vec = np.array([D, E])
    center = -0.5 * np.linalg.solve(mat, b_vec)
    c0 = A * center[0] ** 2 + B * center[0] * center[1] + C * center[1] ** 2
    c0 += D * center[0] + E * center[1] + F
    eigval, eigvec = np.linalg.eigh(mat)  # 对称阵 → 实特征值 + 正交特征向量
    # (x-x0)ᵀ M (x-x0) = -c0 → 沿特征向量 i 的半轴 = √(-c0/λ_i)；小 λ ↔ 长轴
    axes = np.sqrt(np.maximum(-c0 / eigval, 0.0))
    i_major = int(np.argmax(axes))  # 显式取长轴，不假设 eigh 排序方向
    i_minor = 1 - i_major
    major_vec = eigvec[:, i_major]
    theta = math.atan2(major_vec[1], major_vec[0])
    return Ellipse(
        cx=float(center[0]),
        cy=float(center[1]),
        a=float(axes[i_major]),
        b=float(axes[i_minor]),
        theta=theta,
    )
