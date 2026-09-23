"""``SOURCES``：数据轴注册表（SDD 10 §8.2），键为 modality。

每个 ``dataset_*.py`` 模块末尾定义 ``SOURCE = <XxxSource>()``；本模块按 ``_MODULES`` 的顺序导入
并登记。增删一个模态 = 增删 ``_MODULES`` 一行。顺序即 ``MODALITIES`` 的顺序，也是
``resolve_object`` 兜底遍历的顺序。

惰性构建：``SOURCES`` 在首次访问时才导入各数据模块。数据模块在模块末尾继承
:class:`app.sources.base.SourceBase`，若本包在导入期就回头导入它们会形成循环。

某个数据模块导入失败（如缺 science-core）时只记一条 warning 并跳过——该模态不出现在
``SOURCES`` 中，其余模态照常可用（SDD 10 §13「可选依赖缺失是状态不是错误」）。
"""

from __future__ import annotations

import logging
from importlib import import_module
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from .base import Source

log = logging.getLogger("glaux.sources")

_MODULES: tuple[str, ...] = (
    "dataset",
    "hc_dataset",
    "dataset_ct",
    "dataset_wsi",
    "dataset_natural",
    "dataset_video",
)

_SOURCES: dict[str, Source] | None = None


def _build() -> dict[str, Source]:
    out: dict[str, Source] = {}
    for name in _MODULES:
        try:
            module = import_module(f"..{name}", __name__)
        except Exception as exc:  # noqa: BLE001 - 缺依赖的模态跳过，不拖垮其余模态
            log.warning("数据源模块 %s 不可用，已跳过：%s", name, exc)
            continue
        source = module.SOURCE
        if source.modality in out:
            raise RuntimeError(f"模态重复注册：{source.modality}（{name}）")
        out[source.modality] = source
    return out


def __getattr__(name: str):
    global _SOURCES
    if name == "SOURCES":
        if _SOURCES is None:
            _SOURCES = _build()
        return _SOURCES
    raise AttributeError(name)
