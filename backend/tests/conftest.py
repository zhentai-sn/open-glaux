"""测试间清空数据加载层的 lru_cache。

数据加载缓存按「对象 id」做键（如 `dataset_ct._load_nifti("ct_001")`），不含数据根路径。
用例常用 monkeypatch 把 `config.CT_ROOT` 指到 tmp_path 再写同名文件，若上一条用例已把
真实 `data/ct/ct_001.nii.gz` 读进缓存，这条就会拿到上一份影像——本机有演示数据时才复现，
CI 无数据只会跳过，属于隐性用例间耦合。逐条清空，让缓存只在单条用例内生效。
"""

from functools import lru_cache
from types import ModuleType

import pytest

# 必须先于任何 app 数据模块导入：science-core 不在 backend 的依赖里，是由 config 在 import 时
# 插进 sys.path 的（见 config.py「源码装配」）。而 app/__init__.py 是薄壳、不碰 config，
# 于是 `from app import dataset` 会在 dataset.py 的 `import glaux_core` 处直接炸。
# 这一行就是那次装配；不要因为「看起来没用到」而删掉或让 linter 合并顺序。
from app import config as _config  # noqa: F401  isort:skip
from app import dataset, dataset_ct, dataset_wsi, hc_real, hc_synth

_CACHED_MODULES: tuple[ModuleType, ...] = (
    dataset,
    dataset_ct,
    dataset_wsi,
    hc_real,
    hc_synth,
)

_CACHE_TYPE = type(lru_cache(maxsize=1)(lambda: None))


@pytest.fixture(autouse=True)
def _clear_data_caches():
    for module in _CACHED_MODULES:
        for obj in vars(module).values():
            if isinstance(obj, _CACHE_TYPE):
                obj.cache_clear()
    yield
