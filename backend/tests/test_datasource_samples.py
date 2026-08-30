"""示例数据显式加载（SDD 08 §5.2 / §7 规则 11 / §10）。

测试进程整体跑在开发者模式（见 conftest 的 ``pytest_configure``），故这里显式置 0 来验产品模式。
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import config
from app import datasource_registry as reg
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _product_mode(tmp_path, monkeypatch):
    monkeypatch.setenv("GLAUX_DEV_MODE", "0")
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    reg.init()
    yield
    reg.init()


def test_product_mode_starts_empty():
    assert reg.list_all() == []
    assert client.get("/datasources").json() == []


def test_dev_mode_default_is_off(monkeypatch):
    """缺省即产品模式（SDD 08 D-4）——新用户第一屏是导入引导，不是四个演示数据集。

    这条守的是缺省值本身，故必须把变量整个删掉再看，不能只置 0。
    """
    monkeypatch.delenv("GLAUX_DEV_MODE", raising=False)
    assert reg.dev_mode() is False
    reg.init()
    assert [s for s in reg.list_all() if s.origin == "builtin"] == []


def test_load_samples_opens_only_roots_with_data(monkeypatch):
    # 只让 pathology 的根「有数据」，其余示例不该被打开
    monkeypatch.setattr(config, "root_has_data", lambda m, root: m == "pathology")
    r = client.post("/datasources/samples")
    assert r.status_code == 200
    ids = [s["id"] for s in r.json()]
    assert ids == ["wsi-demo"]
    assert [s["id"] for s in client.get("/datasources").json()] == ["wsi-demo"]


def test_load_samples_is_idempotent(monkeypatch):
    monkeypatch.setattr(
        config, "root_has_data", lambda m, root: m in ("pathology", "natural_image")
    )
    first = client.post("/datasources/samples").json()
    before = client.get("/datasources").json()
    second = client.post("/datasources/samples").json()
    after = client.get("/datasources").json()
    assert {s["id"] for s in first} == {s["id"] for s in second}
    assert before == after  # 不新增、不重复（§10）


def test_load_samples_empty_when_no_data(monkeypatch):
    """内置根都没数据 → 200 + 空数组，不抛异常（§13：没有示例是正常状态）。"""
    monkeypatch.setattr(config, "root_has_data", lambda m, root: False)
    r = client.post("/datasources/samples")
    assert r.status_code == 200
    assert r.json() == []
    assert client.get("/datasources").json() == []


def test_samples_persist_across_init(monkeypatch, tmp_path):
    """打开的示例落盘为 id 集合，重启（init）后仍在；root 仍是 config 实时值。"""
    monkeypatch.setattr(config, "root_has_data", lambda m, root: m == "pathology")
    client.post("/datasources/samples")
    assert (tmp_path / "sources.json").is_file()

    reg.init()  # 模拟重启
    live = reg.list_all()
    assert [s.id for s in live] == ["wsi-demo"]
    assert live[0].root == config.WSI_ROOT  # 实时读 config，不是落盘快照


def test_old_sources_json_without_samples_key_still_loads(tmp_path, monkeypatch):
    """只增不改：旧清单没有 samples 键，回读后照常给出导入源，示例集合为空。"""
    monkeypatch.setattr(config, "root_has_data", lambda m, root: True)
    folder = tmp_path / "some-imported"
    folder.mkdir()
    (tmp_path / "sources.json").write_text(
        '{"sources": [{"id": "imported-1", "name": "n", "modality": "pathology",'
        f' "root": "{folder}", "origin": "imported", "calibration": {{}}, "status": "active"}}]}}'
    )
    reg.init()
    ids = [s.id for s in reg.list_all()]
    assert ids == ["imported-1"]  # 导入源在，示例一个都没打开
