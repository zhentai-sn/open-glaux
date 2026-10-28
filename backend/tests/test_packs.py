"""SDD 25：可选模型组件的清单校验、状态推导、端点与安装器。"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient

from app import config
from app.packs import installer as installer_mod
from app.packs import registry as reg
from app.routers.loopback import require_loopback


def _catalog(tmp_path: Path, packs: list[dict[str, Any]]) -> Path:
    p = tmp_path / "catalog.json"
    p.write_text(json.dumps({"version": 1, "packs": packs}), encoding="utf-8")
    return p


def _model_pack(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "demo-model",
        "type": "model",
        "depends_on": "demo-runtime",
        "display_name": "演示模型",
        "description": "x",
        "license": "Apache-2.0",
        "bytes": 10,
        "files": [
            {
                "name": "w.onnx",
                "url": "https://example.com/w.onnx",
                "sha256": "a" * 64,
                "bytes": 10,
            }
        ],
    }
    base.update(over)
    return base


def _runtime_pack(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "demo-runtime",
        "type": "runtime",
        "depends_on": None,
        "display_name": "演示运行时",
        "description": "x",
        "license": "Apache-2.0",
        "bytes": 10,
        "requirements": ["nothing==1"],
    }
    base.update(over)
    return base


@pytest.fixture()
def packs_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "packs"
    root.mkdir()
    monkeypatch.setattr(config, "PACKS_ROOT", root)
    return root


# --- 清单校验 ---------------------------------------------------------------


def test_catalog_rejects_missing_sha256(tmp_path: Path) -> None:
    pack = _model_pack()
    del pack["files"][0]["sha256"]
    with pytest.raises(reg.PacksCatalogError, match="sha256"):
        reg.load_catalog(_catalog(tmp_path, [_runtime_pack(), pack]))


def test_catalog_rejects_model_without_depends(tmp_path: Path) -> None:
    pack = _model_pack()
    pack.pop("depends_on")
    with pytest.raises(reg.PacksCatalogError, match="depends_on"):
        reg.load_catalog(_catalog(tmp_path, [_runtime_pack(), pack]))


def test_catalog_rejects_depends_not_runtime(tmp_path: Path) -> None:
    with pytest.raises(reg.PacksCatalogError, match="runtime"):
        reg.load_catalog(_catalog(tmp_path, [_model_pack(depends_on="ghost")]))


def test_catalog_rejects_http_url(tmp_path: Path) -> None:
    pack = _model_pack()
    pack["files"][0]["url"] = "http://example.com/w.onnx"
    with pytest.raises(reg.PacksCatalogError, match="https"):
        reg.load_catalog(_catalog(tmp_path, [_runtime_pack(), pack]))


def test_catalog_rejects_duplicate_id(tmp_path: Path) -> None:
    with pytest.raises(reg.PacksCatalogError, match="重复"):
        reg.load_catalog(_catalog(tmp_path, [_runtime_pack(), _runtime_pack()]))


def test_shipped_catalog_is_valid() -> None:
    specs = reg.load_catalog()
    ids = [s.id for s in specs]
    assert ids == ["vision-runtime", "depth-dav2s", "detect-rtdetr"]
    models = [s for s in specs if s.type == "model"]
    assert models and all(s.depends_on == "vision-runtime" for s in models)


# --- 状态推导 ---------------------------------------------------------------


def test_status_absent_without_state(packs_env: Path) -> None:
    spec = reg.PackSpec("x", "model", "r", "n", "", "Apache-2.0", 1)
    assert reg.derive_status(spec) == "absent"


def test_status_ready_when_artifacts_present(packs_env: Path) -> None:
    spec = reg.PackSpec("x", "model", None, "n", "", "Apache-2.0", 1)
    root = packs_env / "x"
    root.mkdir()
    (root / "w.onnx").write_bytes(b"1")
    reg.write_state("x", {"status": "ready"})
    spec = reg.PackSpec(
        "x", "model", None, "n", "", "Apache-2.0", 1,
        files=(reg.PackFile("w.onnx", "https://e.com/w", "a" * 64, 1),),
    )
    assert reg.derive_status(spec) == "ready"


def test_ready_with_missing_artifact_becomes_incomplete(packs_env: Path) -> None:
    root = packs_env / "x"
    root.mkdir()
    reg.write_state("x", {"status": "ready"})
    spec = reg.PackSpec(
        "x", "model", None, "n", "", "Apache-2.0", 1,
        files=(reg.PackFile("w.onnx", "https://e.com/w", "a" * 64, 1),),
    )
    assert reg.derive_status(spec) == "failed"
    assert (reg.read_state("x") or {}).get("error") == "incomplete"


def test_zombie_installing_becomes_interrupted(packs_env: Path) -> None:
    root = packs_env / "x"
    root.mkdir()
    reg.write_state(
        "x",
        {"status": "installing", "pid": 999_999_99, "heartbeat_at": "2020-01-01T00:00:00Z"},
    )
    spec = reg.PackSpec("x", "model", None, "n", "", "Apache-2.0", 1)
    assert reg.derive_status(spec) == "failed"
    state = reg.read_state("x") or {}
    assert state.get("error") == "interrupted"
    assert state.get("pid") is None


def test_live_installing_is_kept(packs_env: Path) -> None:
    root = packs_env / "x"
    root.mkdir()
    reg.write_state("x", {"status": "installing", "pid": os.getpid()})
    spec = reg.PackSpec("x", "model", None, "n", "", "Apache-2.0", 1)
    assert reg.derive_status(spec) == "installing"


def test_list_packs_reports_dependency(packs_env: Path, monkeypatch: pytest.MonkeyPatch,
                                       tmp_path: Path) -> None:
    path = _catalog(tmp_path, [_runtime_pack(), _model_pack()])
    monkeypatch.setattr(config, "PACKS_CATALOG", path)
    rows = {r["id"]: r for r in reg.list_packs()}
    assert rows["demo-runtime"]["dependency_ready"] is True
    assert rows["demo-model"]["dependency_ready"] is False


# --- 端点 -------------------------------------------------------------------


@pytest.fixture()
def client(packs_env: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    from app.main import app as real_app

    real_app.dependency_overrides[require_loopback] = lambda: None
    yield TestClient(real_app)
    real_app.dependency_overrides.pop(require_loopback, None)


def test_api_lists_three_packs(client: TestClient) -> None:
    r = client.get("/packs")
    assert r.status_code == 200
    assert {p["id"] for p in r.json()["packs"]} == {
        "vision-runtime",
        "depth-dav2s",
        "detect-rtdetr",
    }


def test_api_unknown_pack_404(client: TestClient) -> None:
    assert client.get("/packs/ghost/progress").status_code == 404
    assert client.post("/packs/ghost/install").status_code == 404


def test_api_install_ready_is_idempotent(client: TestClient, packs_env: Path) -> None:
    root = packs_env / "vision-runtime"
    (root / ".venv" / "bin").mkdir(parents=True)
    (root / ".venv" / "bin" / "python").write_bytes(b"")
    (root / ".venv" / "Scripts").mkdir(parents=True)
    (root / ".venv" / "Scripts" / "python.exe").write_bytes(b"")
    reg.write_state("vision-runtime", {"status": "ready"})
    r = client.post("/packs/vision-runtime/install")
    assert r.status_code == 200
    body = r.json()
    assert body["started"] is False and body["status"] == "ready"


def test_api_delete_refuses_when_depended_on(client: TestClient, packs_env: Path,
                                            monkeypatch: pytest.MonkeyPatch,
                                            tmp_path: Path) -> None:
    path = _catalog(tmp_path, [_runtime_pack(), _model_pack()])
    monkeypatch.setattr(config, "PACKS_CATALOG", path)

    rt = packs_env / "demo-runtime"
    (rt / ".venv" / "bin").mkdir(parents=True)
    (rt / ".venv" / "bin" / "python").write_bytes(b"")
    (rt / ".venv" / "Scripts").mkdir(parents=True)
    (rt / ".venv" / "Scripts" / "python.exe").write_bytes(b"")
    reg.write_state("demo-runtime", {"status": "ready"})

    md = packs_env / "demo-model"
    md.mkdir()
    (md / "w.onnx").write_bytes(b"1")
    reg.write_state("demo-model", {"status": "ready"})

    r = client.delete("/packs/demo-runtime")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "pack_in_use"


def test_api_requires_loopback_when_guard_active(packs_env: Path) -> None:
    from app.main import app as real_app

    real_app.dependency_overrides.pop(require_loopback, None)
    c = TestClient(real_app)
    assert c.get("/packs").status_code == 403


def test_api_cancel_idle_returns_false(client: TestClient) -> None:
    r = client.post("/packs/depth-dav2s/cancel")
    assert r.status_code == 200
    assert r.json()["cancelled"] is False


# --- 安装器 -----------------------------------------------------------------


class _FakeResp:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def raise_for_status(self) -> None:
        return None

    def iter_bytes(self, n: int):
        yield self._payload

    def __enter__(self):
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False


class _FakeClient:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def stream(self, method: str, url: str) -> _FakeResp:
        return _FakeResp(self.payload)

    def __enter__(self):
        return self

    def __exit__(self, *exc: Any) -> bool:
        return False


def _install_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, payload: bytes,
                 sha: str) -> Path:
    root = tmp_path / "packs"
    root.mkdir()
    monkeypatch.setattr(config, "PACKS_ROOT", root)
    path = _catalog(
        tmp_path,
        [
            _runtime_pack(),
            _model_pack(
                files=[{"name": "w.onnx", "url": "https://e.com/w", "sha256": sha,
                        "bytes": len(payload)}]
            ),
        ],
    )
    monkeypatch.setattr(config, "PACKS_CATALOG", path)
    monkeypatch.setattr(installer_mod, "_http_client", lambda proxy: _FakeClient(payload))

    rt = root / "demo-runtime"
    (rt / ".venv" / "bin").mkdir(parents=True)
    (rt / ".venv" / "bin" / "python").write_bytes(b"")
    (rt / ".venv" / "Scripts").mkdir(parents=True)
    (rt / ".venv" / "Scripts" / "python.exe").write_bytes(b"")
    reg.write_state("demo-runtime", {"status": "ready"})
    return root


def test_installer_checksum_mismatch_leaves_no_pack(tmp_path: Path,
                                                    monkeypatch: pytest.MonkeyPatch) -> None:
    import hashlib

    payload = b"hello"
    wrong = hashlib.sha256(b"other").hexdigest()
    root = _install_env(tmp_path, monkeypatch, payload, wrong)
    code = installer_mod.install("demo-model")
    assert code == 2
    assert not (root / "demo-model" / "w.onnx").exists()
    assert not (root / "demo-model.partial").exists()
    state = reg.read_state("demo-model") or {}
    assert state.get("status") == "failed"
    assert state.get("error") == "checksum_mismatch"


def test_installer_success_moves_files(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import hashlib

    payload = b"hello"
    good = hashlib.sha256(payload).hexdigest()
    root = _install_env(tmp_path, monkeypatch, payload, good)
    code = installer_mod.install("demo-model")
    assert code == 0
    assert (root / "demo-model" / "w.onnx").read_bytes() == payload
    state = reg.read_state("demo-model") or {}
    assert state.get("status") == "ready"


def test_installer_disk_guard_blocks_before_download(tmp_path: Path,
                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    import hashlib

    payload = b"hello"
    good = hashlib.sha256(payload).hexdigest()
    root = _install_env(tmp_path, monkeypatch, payload, good)
    monkeypatch.setattr(installer_mod, "_disk_ok", lambda p, need: False)
    code = installer_mod.install("demo-model")
    assert code == 2
    assert not (root / "demo-model" / "w.onnx").exists()
    assert (reg.read_state("demo-model") or {}).get("error") == "insufficient_disk"


def test_installer_rejects_dependency_not_ready(tmp_path: Path,
                                                monkeypatch: pytest.MonkeyPatch) -> None:
    import hashlib

    payload = b"hello"
    good = hashlib.sha256(payload).hexdigest()
    root = _install_env(tmp_path, monkeypatch, payload, good)
    reg.write_state("demo-runtime", {"status": "failed", "error": "x"})
    code = installer_mod.install("demo-model")
    assert code == 2
    assert (reg.read_state("demo-model") or {}).get("error") == "dependency_not_ready"
    assert not (root / "demo-model" / "w.onnx").exists()
    assert not (root / "demo-model.partial").exists()


def test_mirror_prefix_rewrites_host() -> None:
    assert (
        installer_mod._mirror("https://huggingface.co/a/b/c.onnx", "https://hf-mirror.com")
        == "https://hf-mirror.com/a/b/c.onnx"
    )
    url = installer_mod._mirror("https://huggingface.co/a/b", "")
    assert urlsplit(url).hostname == "huggingface.co"
