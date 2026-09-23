"""测试间清空数据加载层的 lru_cache。

数据加载缓存按「对象 id」做键（如 `dataset_ct._load_nifti("ct_001")`），不含数据根路径。
用例常用 monkeypatch 把 `config.CT_ROOT` 指到 tmp_path 再写同名文件，若上一条用例已把
真实 `data/ct/ct_001.nii.gz` 读进缓存，这条就会拿到上一份影像——本机有演示数据时才复现，
CI 无数据只会跳过，属于隐性用例间耦合。逐条清空，让缓存只在单条用例内生效。
"""

import os
from functools import lru_cache
from types import ModuleType

import pytest

# 整套测试跑在开发者模式下（内置示例源可见）。SDD 08 D-4 把 GLAUX_DEV_MODE 的生产缺省翻为 0
# 之后，「有数据」不再是默认状态；大量既有用例隐含依赖它——与其逐个放宽断言（那会掩盖真实回归），
# 不如把这个前提写明。
# 必须在**模块导入期**设，而不是 autouse fixture：像 test_api.HAS_HC_DATA 这类模块级常量在导入期
# 就求值了，函数级 fixture 那时还没跑。用 setdefault，外部显式指定的值仍然优先；
# 验产品模式的单条用例照旧 monkeypatch.setenv(..., "0") 覆盖。
os.environ.setdefault("GLAUX_DEV_MODE", "1")

# 必须先于任何 app 数据模块导入：science-core 不在 backend 的依赖里，是由 config 在 import 时
# 插进 sys.path 的（见 config.py「源码装配」）。而 app/__init__.py 是薄壳、不碰 config，
# 于是 `from app import dataset` 会在 dataset.py 的 `import glaux_core` 处直接炸。
# 这一行就是那次装配；不要因为「看起来没用到」而删掉或让 linter 合并顺序。
from app import config as _config  # noqa: F401  isort:skip
from app import dataset, dataset_ct, dataset_video, dataset_wsi, hc_real, hc_synth
from app import datasource_registry as reg

_CACHED_MODULES: tuple[ModuleType, ...] = (
    dataset,
    dataset_ct,
    dataset_video,
    dataset_wsi,
    hc_real,
    hc_synth,
)

_CACHE_TYPE = type(lru_cache(maxsize=1)(lambda: None))


@pytest.fixture(autouse=True)
def _clear_data_caches():
    for module in _CACHED_MODULES:
        for obj in vars(module).values():
            if isinstance(obj, _CACHE_TYPE) and obj is not dataset_video.av_available:
                obj.cache_clear()
    # id → ObjectRef 索引同理：用例常 monkeypatch 数据根，索引不得跨用例沿用（SDD 10 §11.2）
    reg.invalidate_index()
    yield


@pytest.fixture
def probe_only(monkeypatch):
    """让 ``SOURCES[*].probe`` 只对给定模态为真——内置源「有无数据」的打桩点（SDD 10 §4.1）。

    用法：``probe_only(lambda m: m == "pathology")``。
    """
    from app.sources import SOURCES

    def _set(pred):
        for modality, src in SOURCES.items():
            monkeypatch.setattr(src, "probe", lambda root, m=modality: bool(pred(m)))

    return _set
