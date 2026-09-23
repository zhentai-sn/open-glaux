"""U3：导入文件夹时的标定自动探测——从数据文件读嵌入的标定，免用户手填。

多数真实 WSI/CT 自带标定（OpenSlide ``mpp-x/y`` / NIfTI ``pixdim``），导入时读出来即
``status=active``；读不出（缺嵌入标定）→ 返回空 dict → 注册表标 ``needs_calibration``，
提示用户补（护城河：不猜标定，宁可硬拒绝）。

各模态的探测实现在 ``Source.detect_calibration``（SDD 10 §4.1）；本模块只是
``register_folder(detect=...)`` 的注入点，与 :mod:`datasource_registry`（纯 stdlib）分离。
"""

from __future__ import annotations

from pathlib import Path


def detect(root: Path, modality: str) -> dict:
    """按模态从数据文件探测嵌入标定。未注册模态或读不出 → {}（→ needs_calibration）。"""
    from .sources import SOURCES

    src = SOURCES.get(modality)
    return src.detect_calibration(root) if src is not None else {}
