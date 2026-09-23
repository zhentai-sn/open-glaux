"""数据加载层缓存的失效路径（技术债审计 D5）。

修复前：`dataset.list_ids()` 挂着 `lru_cache(maxsize=1)`，而全仓一次 `cache_clear()` 都没有；
运行期增删数据源后 `/images` 仍返回旧清单，只能靠重启后端绕过。
"""

from __future__ import annotations

import pytest

from app import config, dataset
from app import datasource_registry as reg
from app.sources import SOURCES


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    images = tmp_path / "images"
    cf = tmp_path / "CF"
    images.mkdir()
    cf.mkdir()
    monkeypatch.setattr(config, "IMAGES_DIR", images)
    monkeypatch.setattr(config, "CF_DIR", cf)
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path / "ds"))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "ds" / "sources.json"))
    (tmp_path / "ds").mkdir()
    dataset.list_ids.cache_clear()
    reg.init()
    yield
    dataset.list_ids.cache_clear()
    reg.init()


def _add_image(stem: str) -> None:
    """造一张「演示区间内、有图有 CF」的图——list_ids 的收录条件。"""
    (config.IMAGES_DIR / f"{stem}.tiff").write_bytes(b"II*\x00")
    (config.CF_DIR / f"{stem}_CF.txt").write_text("0.048")


def test_cache_masks_disk_change_until_invalidated():
    """先确认缓存确实会挡住磁盘变化——否则下面那条测试等于什么都没验。"""
    _add_image("tech_401")
    assert dataset.list_ids() == ["tech_401"]

    _add_image("tech_402")
    assert dataset.list_ids() == ["tech_401"]  # 仍是旧值：缓存生效中

    reg._invalidate_dataset_caches()
    assert dataset.list_ids() == ["tech_401", "tech_402"]


def test_register_folder_invalidates(tmp_path):
    _add_image("tech_401")
    assert dataset.list_ids() == ["tech_401"]

    _add_image("tech_402")
    folder = tmp_path / "ds" / "some-slides"
    folder.mkdir()
    (folder / "slide_a.svs").write_bytes(b"x")
    reg.register_folder(folder, "pathology")

    assert dataset.list_ids() == ["tech_401", "tech_402"]


def test_remove_invalidates(tmp_path):
    folder = tmp_path / "ds" / "gone-soon"
    folder.mkdir()
    (folder / "slide_a.svs").write_bytes(b"x")
    src = reg.register_folder(folder, "pathology")

    _add_image("tech_401")
    assert dataset.list_ids() == ["tech_401"]

    _add_image("tech_402")
    assert reg.remove(src.id) is True
    assert dataset.list_ids() == ["tech_401", "tech_402"]


def test_load_samples_invalidates(monkeypatch):
    _add_image("tech_401")
    assert dataset.list_ids() == ["tech_401"]

    _add_image("tech_402")
    for modality, src in SOURCES.items():
        monkeypatch.setattr(src, "probe", lambda root, m=modality: m == "carotid_imt")
    reg.register_builtin_samples()

    assert dataset.list_ids() == ["tech_401", "tech_402"]


def test_invalidate_is_idempotent_and_isolated(monkeypatch):
    """每个 Source 的 invalidate 可重复调用；一个 Source 失效失败不拖垮其余（SDD 10 §10）。

    缺 openslide / nibabel 的环境里对应 Source 根本不会登记（见 app/sources），故这里模拟的是
    「已登记的某个 Source 失效时抛异常」这一更一般的情形。
    """
    assert dataset.list_ids() == []  # 先把空清单缓存住
    _add_image("tech_401")
    for src in SOURCES.values():  # 对从未建立缓存的 Source 调用也不抛
        src.invalidate()
        src.invalidate()

    def boom():
        raise RuntimeError("cache backend gone")

    monkeypatch.setattr(SOURCES["pathology"], "invalidate", boom)
    reg._invalidate_dataset_caches()  # 不抛
    assert dataset.list_ids() == ["tech_401"]  # 且其余 Source 的缓存照常失效
