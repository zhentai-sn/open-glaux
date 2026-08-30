"""U1：DataSource 注册表——seed 现状一致性、开发者模式门控、导入白名单/标定/落盘。"""

from __future__ import annotations

import pytest

from app import config
from app import datasource_registry as reg


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """每测隔离：落盘清单 + 导入白名单根指向 tmp，注册表清空。"""
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    # SDD 08 D-4 起缺省是**产品模式**，故想验开发者模式必须显式置 1（原来靠 delenv 吃缺省）
    monkeypatch.setenv("GLAUX_DEV_MODE", "1")
    reg._SOURCES.clear()
    yield
    reg._SOURCES.clear()


# --- 开发者模式 seed ---------------------------------------------------------


def test_seed_builtin_roots_match_config():
    """seed 的内置源 root 必须与 config 现状逐字节一致（零破坏红线）。"""
    reg.init()
    by_id = {s.id: s for s in reg.list_all()}
    assert by_id["cubs-tech"].root == config.DATA_ROOT
    assert by_id["hc18"].root == config.HC18_ROOT
    assert by_id["ct-demo"].root == config.CT_ROOT
    assert by_id["wsi-demo"].root == config.WSI_ROOT
    assert by_id["natural-demo"].root == config.NATURAL_ROOT  # SDD 08 D-4
    # 每个模态各恰一个内置源
    assert {s.modality for s in by_id.values() if s.origin == "builtin"} == set(reg.MODALITIES)


def test_dev_mode_on_seeds_one_builtin_per_modality():
    """开发者模式下每个模态一个内置源——SDD 08 D-4 起含 natural_image，故为 5 而非 4。"""
    reg.init()
    builtins = [s for s in reg.list_all() if s.origin == "builtin"]
    assert len(builtins) == len(reg.MODALITIES) == 5


def test_product_mode_no_builtins(monkeypatch):
    monkeypatch.setenv("GLAUX_DEV_MODE", "0")
    reg.init()
    assert [s for s in reg.list_all() if s.origin == "builtin"] == []


@pytest.mark.parametrize("val", ["0", "false", "no", ""])
def test_dev_mode_falsy_values(monkeypatch, val):
    monkeypatch.setenv("GLAUX_DEV_MODE", val)
    assert reg.dev_mode() is False


def test_builtin_status_reflects_probe(monkeypatch):
    """内置源状态由 config.root_has_data 探针定：数据在 → active，不在 → empty。"""
    monkeypatch.setattr(config, "root_has_data", lambda m, root: m == "pathology")
    reg.init()
    by_id = {s.id: s for s in reg.list_all()}
    assert by_id["wsi-demo"].status == "active"
    assert by_id["ct-demo"].status == "empty"


# --- 查询 -------------------------------------------------------------------


def test_sources_for_modality():
    reg.init()
    wsi = reg.sources_for("pathology")
    assert len(wsi) == 1 and wsi[0].id == "wsi-demo"


def test_resolve_root_returns_active(monkeypatch):
    monkeypatch.setattr(config, "root_has_data", lambda m, root: m == "pathology")
    reg.init()
    assert reg.resolve_root("pathology") == config.WSI_ROOT


def test_resolve_root_none_when_no_active(monkeypatch):
    monkeypatch.setattr(config, "root_has_data", lambda m, root: m != "ct_abdomen")
    reg.init()
    assert reg.resolve_root("ct_abdomen") is None


# --- 导入文件夹 -------------------------------------------------------------


def _make_folder(tmp_path, name="myslides", with_file=True):
    d = tmp_path / name
    d.mkdir()
    if with_file:
        (d / "slide_001.svs").write_bytes(b"stub")
    return d


def test_register_folder_with_calibration_active(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "root_has_data", lambda m, root: False)  # 内置全 empty
    reg.init()
    d = _make_folder(tmp_path)
    src = reg.register_folder(d, "pathology", calibration={"mpp": [0.5, 0.5]})
    assert src.status == "active"
    assert src.origin == "imported"
    # 内置源 empty，导入源是唯一 active → resolve_root 落到导入根
    assert reg.resolve_root("pathology") == src.root


def test_register_folder_without_calibration_needs_calibration(tmp_path):
    reg.init()
    d = _make_folder(tmp_path)
    src = reg.register_folder(d, "pathology")
    assert src.status == "needs_calibration"


def test_register_empty_folder_empty_status(tmp_path):
    reg.init()
    d = _make_folder(tmp_path, with_file=False)
    src = reg.register_folder(d, "pathology", calibration={"mpp": [0.5, 0.5]})
    assert src.status == "empty"


def test_register_detect_callback(tmp_path):
    """detect 回调探到标定 → active（U3 会注入真实模态探针）。"""
    reg.init()
    d = _make_folder(tmp_path)
    src = reg.register_folder(d, "pathology", detect=lambda root, m: {"mpp": [0.25, 0.25]})
    assert src.status == "active" and src.calibration == {"mpp": [0.25, 0.25]}


def test_register_rejects_bad_modality(tmp_path):
    reg.init()
    d = _make_folder(tmp_path)
    with pytest.raises(reg.ImportError_):
        reg.register_folder(d, "mri_brain")


def test_register_rejects_nonexistent_path(tmp_path):
    reg.init()
    with pytest.raises(reg.ImportError_):
        reg.register_folder(tmp_path / "nope", "pathology")


def test_register_rejects_path_outside_whitelist(tmp_path, monkeypatch):
    """白名单外的目录（防任意目录读）——即便存在也拒。"""
    outside = tmp_path.parent / "outside_root"
    outside.mkdir(exist_ok=True)
    (outside / "x").write_bytes(b"1")
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))  # 白名单 = tmp_path，outside 在其外
    reg.init()
    with pytest.raises(reg.ImportError_):
        reg.register_folder(outside, "pathology", calibration={"mpp": [0.5, 0.5]})


def test_register_deterministic_id_dedups(tmp_path):
    """同文件夹重复导入 = 更新（同 id），不产生重复源。"""
    reg.init()
    d = _make_folder(tmp_path)
    a = reg.register_folder(d, "pathology", calibration={"mpp": [0.5, 0.5]})
    b = reg.register_folder(d, "pathology", calibration={"mpp": [0.3, 0.3]})
    assert a.id == b.id
    assert len([s for s in reg.list_all() if s.id == a.id]) == 1


# --- 落盘持久化 -------------------------------------------------------------


def test_persistence_round_trip(tmp_path, monkeypatch):
    """导入源落盘 → 新 init 回读（产品模式隔离，确认非 builtin 也持久）。"""
    reg.init()
    d = _make_folder(tmp_path)
    src = reg.register_folder(d, "pathology", calibration={"mpp": [0.5, 0.5]})
    # 产品模式重新装配——builtin 不 seed，只应回读落盘的导入源
    monkeypatch.setenv("GLAUX_DEV_MODE", "0")
    reg.init()
    reloaded = {s.id: s for s in reg.list_all()}
    assert src.id in reloaded
    assert reloaded[src.id].calibration == {"mpp": [0.5, 0.5]}
    assert reloaded[src.id].origin == "imported"


def test_builtin_not_persisted(tmp_path):
    """builtin 每次从 config 重 seed，不写盘（避免 config 改了但落盘旧值盖回）。"""
    reg.init()
    reg._save_persisted()
    import json
    payload = json.loads((tmp_path / "sources.json").read_text())
    assert all(s["origin"] != "builtin" for s in payload["sources"])


def test_remove_imported_but_not_builtin(tmp_path):
    reg.init()
    d = _make_folder(tmp_path)
    src = reg.register_folder(d, "pathology", calibration={"mpp": [0.5, 0.5]})
    assert reg.remove(src.id) is True
    assert reg.remove("cubs-tech") is False  # builtin 不可删
    assert reg.remove(src.id) is False  # 已删，再删 False
