"""M0 mock 数据——形状即最终契约，M1 换实现不换形状。

数值取自 2026-07-06 真数据端到端验证（见 eval/README）：IMT 0.918mm、vs A1 |bias| 66.6µm、
CF 0.0559 mm/px。绝不用凭空假数字冒充测量结果（见设计稿 §8）。
（规则意图分类 mock 已随意图层退役，2026-08-16。）
"""

from __future__ import annotations

import math
import struct
import zlib

from .schemas import ImageMeta, ModelInfo

# --- 数据集（mock CUBS-tech 切片） -------------------------------------------

CF_CANONICAL = 0.0559
IMT_MEAN_MM = 0.918
IMT_MAX_MM = 1.041
ABS_BIAS_UM = 66.6
N_COLUMNS = 598

_METHODS = ["Manual-A1", "Manual-A2", "GT-FAMUS", "Computerized-caroSegDeep"]


def dataset(n: int = 40) -> list[ImageMeta]:
    return [
        ImageMeta(
            id=f"tech_{436 + i}",
            center="CUBS-tech",
            cf=round(CF_CANONICAL + math.sin(i) * 0.0004, 4),
            methods=_METHODS,
        )
        for i in range(n)
    ]


# --- 模型（扩展=适配器） -----------------------------------------------------


def models() -> list[ModelInfo]:
    return [
        ModelInfo(
            id="caroSegDeep",
            pub="nl3769 · Dilated U-Net",
            desc="CUBS CREATIS baseline · Keras/TF 2.4.1 · far-wall + IMC",
            active=True,
            backend="isolated:uv/py3.8/TF2.4",
        ),
        ModelInfo(
            id="Computerized-CNR_IT",
            pub="CNR Pisa",
            desc="First-order absolute moment edge operator",
            active=False,
            backend="reference",
        ),
        ModelInfo(
            id="POLITO_UNET",
            pub="Politecnico di Torino",
            desc="U-Net segmentation of the IMC",
            active=False,
            backend="reference",
        ),
        ModelInfo(
            id="ConstantStub",
            pub="glaux · testing",
            desc="Deterministic stub adapter for pipeline tests",
            active=False,
            backend="in_process",
        ),
    ]


# --- 合成边界 / 测量（mock；形状与 measurement.pdm 一致） --------------------


def _boundary(kind: str, x0: int = 84, x1: int = 630, n: int = N_COLUMNS) -> list[list[float]]:
    """生成一条平滑的远壁边界，LI 在上、MA 在下（相隔约 16.4px ≈ 0.918mm/0.0559）。"""
    pts = []
    for i in range(n):
        x = x0 + (x1 - x0) * i / (n - 1)
        li = 275 + math.sin(x / 95) * 6 + math.sin(x / 230) * 10
        y = li if kind == "li" else li + 16.4
        pts.append([round(x, 1), round(y, 2)])
    return pts


def segment_boundaries(roi: tuple[int, int] | None = None) -> tuple[list, list]:
    x0, x1 = roi if roi else (84, 630)
    return _boundary("li", x0, x1), _boundary("ma", x0, x1)


def synthetic_png(image_id: str, w: int = 700, h: int = 470) -> bytes:
    """纯 stdlib 生成的合成灰度 B-mode PNG（示意渲染 · 非真实患者数据）。

    M1 会替换为真实 tiff→PNG；此处让 `/image/{id}` 在 mock 阶段也返回真正的 image/png，
    契约与测试才诚实。用 image_id 派生种子，保证同图确定性、异图不同。
    """
    seed = (abs(hash(image_id)) % 0x7FFFFFFF) or 20240706
    state = seed

    def rnd() -> float:
        nonlocal state
        state = (state * 1664525 + 1013904223) & 0x7FFFFFFF
        return state / 0x7FFFFFFF

    raw = bytearray()
    for y in range(h):
        raw.append(0)  # 每行 filter type 0
        for x in range(w):
            li = h * 0.585 + math.sin(x / 95) * 6 + math.sin(x / 230) * 10
            lt, lb = li - 66, li - 6
            if lt < y < lb:  # 管腔（低回声）
                v = 11 + rnd() * 13
            else:
                near = math.exp(-((y - (li - 92)) ** 2) / 700) * 66
                far = math.exp(-((y - (li + 8)) ** 2) / 150) * 118
                med = math.exp(-((y - (li + 18.4)) ** 2) / 95) * 92
                v = 24 + near + far + med + (rnd() * 44 - 8)
            v += (rnd() * rnd()) * 44
            raw.append(max(0, min(255, int(v))))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)  # 8-bit grayscale
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + chunk(b"IEND", b"")
    )
