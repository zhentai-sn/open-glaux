"""SDD 13 B1：项目登记与移除、``/fs`` 目录选择器、回环守卫、``sources.json`` 兼容。"""

from __future__ import annotations

import json
from pathlib import Path, PureWindowsPath

import pytest
from fastapi.testclient import TestClient

from app import datasource_registry as reg
from app.main import app
from app.routers.loopback import is_loopback, require_loopback
from app.schemas import DataSourceInfo

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """每测隔离：落盘清单 + 白名单根指向 tmp，注册表与项目表清空；回环守卫放行。"""
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    reg._SOURCES.clear()
    reg._PROJECTS.clear()
    app.dependency_overrides[require_loopback] = lambda: None
    yield
    app.dependency_overrides.pop(require_loopback, None)
    reg._SOURCES.clear()
    reg._PROJECTS.clear()


def _dir(tmp_path: Path, name: str = "cases") -> Path:
    d = tmp_path / name
    d.mkdir()
    return d


def _unc(path: Path, distro: str = "Ubuntu") -> str:
    """把 POSIX 路径写成 ``\\\\wsl.localhost\\<发行版>\\…``。"""
    return "\\\\wsl.localhost\\" + distro + str(PureWindowsPath(path)).replace("/", "\\")


def _persisted(tmp_path: Path) -> dict:
    return json.loads((tmp_path / "sources.json").read_text())


# --- 登记与幂等 ---------------------------------------------------------------


def test_create_then_idempotent(tmp_path):
    d = _dir(tmp_path)
    r1 = client.post("/projects", json={"path": str(d)})
    assert r1.status_code == 201
    body = r1.json()
    assert body["id"] == reg.project_id_for(d.resolve())
    assert body["id"].startswith("prj-") and len(body["id"]) == 12
    assert body["name"] == "cases"
    assert body["path"] == str(d.resolve())
    assert body["status"] == "ok"
    assert body["created_at"]

    r2 = client.post("/projects", json={"path": str(d) + "/"})  # 尾斜杠
    assert r2.status_code == 200
    assert r2.json() == body
    assert len(_persisted(tmp_path)["projects"]) == 1


def test_three_spellings_same_project(tmp_path, monkeypatch):
    """POSIX、尾斜杠、``\\\\wsl.localhost`` 三种写法经 HTTP 得到同一项目，清单不重复。"""
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")
    d = _dir(tmp_path)
    ids = {
        client.post("/projects", json={"path": p}).json()["id"]
        for p in (str(d), str(d) + "/", _unc(d), _unc(d, "ubuntu") + "\\")
    }
    assert len(ids) == 1
    assert len(_persisted(tmp_path)["projects"]) == 1


def test_drive_spelling_normalizes_like_mnt(monkeypatch):
    """``C:\\…``、``/mnt/c/…``、``/mnt/c/…/`` 规范化后同一路径、同一 id（不要求目录存在）。"""
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")
    got = {
        reg.normalize_project_path(p)
        for p in (r"C:\cases\liver", "/mnt/c/cases/liver", "/mnt/c/cases/liver/")
    }
    assert len(got) == 1
    assert len({reg.project_id_for(p) for p in got}) == 1


def test_symlink_same_project(tmp_path):
    real = _dir(tmp_path, "real")
    link = tmp_path / "link"
    link.symlink_to(real, target_is_directory=True)
    a = client.post("/projects", json={"path": str(real)})
    b = client.post("/projects", json={"path": str(link)})
    assert (a.status_code, b.status_code) == (201, 200)
    assert a.json()["id"] == b.json()["id"]
    assert b.json()["path"] == str(real.resolve())


def test_create_missing_404(tmp_path):
    r = client.post("/projects", json={"path": str(tmp_path / "nope")})
    assert r.status_code == 404
    assert reg.list_projects() == []


def test_create_not_dir_422(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("x")
    r = client.post("/projects", json={"path": str(f)})
    assert r.status_code == 422


def test_create_unconvertible_422(tmp_path, monkeypatch):
    monkeypatch.delenv("WSL_DISTRO_NAME", raising=False)
    assert client.post("/projects", json={"path": r"C:\cases"}).status_code == 422
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")
    assert client.post("/projects", json={"path": _unc(tmp_path, "Debian")}).status_code == 422
    assert client.post("/projects", json={"path": "relative/dir"}).status_code == 422


def test_register_does_not_register_sources(tmp_path):
    """登记项目不扫描、不登记数据源（§7.2 规则 1）。"""
    d = _dir(tmp_path)
    (d / "a.jpg").write_bytes(b"\xff\xd8\xff")
    reg.register_project(d)
    assert reg._SOURCES == {}


# --- 列表与状态 ---------------------------------------------------------------


def test_list_reports_missing_after_rmdir(tmp_path):
    d = _dir(tmp_path)
    prj, _ = reg.register_project(d)
    assert [p.status for p in reg.list_projects()] == ["ok"]
    d.rmdir()
    assert [p.status for p in reg.list_projects()] == ["missing"]
    r = client.get("/projects")
    assert r.status_code == 200
    assert [(p["id"], p["status"]) for p in r.json()] == [(prj.id, "missing")]


def test_display_path_under_wsl(monkeypatch):
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")
    prj = reg.Project(id="prj-x", path=Path("/mnt/c/cases/liver"), created_at="")
    assert prj.info()["display_path"] == "C:\\cases\\liver"
    assert prj.info()["name"] == "liver"


# --- 移除 ---------------------------------------------------------------------


def test_remove_keeps_disk_and_drops_owned_sources(tmp_path):
    d = _dir(tmp_path)
    (d / "a.jpg").write_bytes(b"\xff\xd8\xff")
    prj, _ = reg.register_project(d)
    owned = reg.DataSource(
        id="psrc-1", name="cases", modality="natural_image", root=d,
        origin="imported", project_id=prj.id,
    )
    other = reg.DataSource(
        id="imported-2", name="other", modality="natural_image", root=tmp_path,
        origin="imported",
    )
    reg._SOURCES.update({owned.id: owned, other.id: other})
    reg._save_persisted()

    r = client.delete(f"/projects/{prj.id}")
    assert r.status_code == 204
    assert (d / "a.jpg").read_bytes() == b"\xff\xd8\xff"  # 磁盘不动
    assert set(reg._SOURCES) == {"imported-2"}
    saved = _persisted(tmp_path)
    assert saved["projects"] == []
    assert [s["id"] for s in saved["sources"]] == ["imported-2"]

    assert client.delete(f"/projects/{prj.id}").status_code == 404


def test_reopen_after_remove_restores_same_id(tmp_path):
    d = _dir(tmp_path)
    pid = client.post("/projects", json={"path": str(d)}).json()["id"]
    assert client.delete(f"/projects/{pid}").status_code == 204
    r = client.post("/projects", json={"path": str(d)})
    assert r.status_code == 201
    assert r.json()["id"] == pid


def test_remove_unknown_404():
    assert client.delete("/projects/prj-00000000").status_code == 404


# --- sources.json 持久化与兼容 --------------------------------------------------


def test_projects_persist_across_init(tmp_path):
    d = _dir(tmp_path)
    prj, _ = reg.register_project(d)
    reg.init()
    assert [p.to_dict() for p in reg.list_projects()] == [prj.to_dict()]


def test_legacy_sources_json_without_projects(tmp_path):
    """旧文件：无 ``projects`` 键、数据源无 ``project_id`` → 无项目、数据源未归属。"""
    d = _dir(tmp_path, "imgs")
    (tmp_path / "sources.json").write_text(json.dumps({
        "sources": [{
            "id": "imported-abcdef12", "name": "imgs", "modality": "natural_image",
            "root": str(d), "origin": "imported", "calibration": {}, "status": "active",
        }],
        "samples": [],
    }))
    reg.init()
    assert reg.list_projects() == []
    src = reg._SOURCES["imported-abcdef12"]
    assert src.project_id is None
    assert DataSourceInfo(**src.info()).project_id is None
    # 回写后带上新键，旧字段不丢
    reg._save_persisted()
    saved = _persisted(tmp_path)
    assert saved["projects"] == []
    assert saved["sources"][0]["project_id"] is None
    assert saved["sources"][0]["root"] == str(d)


def test_project_id_round_trips(tmp_path):
    d = _dir(tmp_path)
    src = reg.DataSource(
        id="psrc-9", name="cases", modality="natural_image", root=d,
        origin="imported", project_id="prj-12345678",
    )
    reg._SOURCES[src.id] = src
    reg._save_persisted()
    reg.init()
    assert reg._SOURCES["psrc-9"].project_id == "prj-12345678"


# --- /fs ----------------------------------------------------------------------


def test_fs_dirs_lists_only_visible_dirs(tmp_path):
    d = _dir(tmp_path, "root")
    (d / "b").mkdir()
    (d / "A").mkdir()
    (d / "A" / "sub").mkdir()
    (d / ".hidden").mkdir()
    (d / "b" / ".only_hidden").mkdir()
    (d / "file.txt").write_text("x")
    r = client.get("/fs/dirs", params={"path": str(d)})
    assert r.status_code == 200
    body = r.json()
    assert body["path"] == str(d.resolve())
    assert body["parent"] == str(d.resolve().parent)
    assert [(e["name"], e["has_children"]) for e in body["entries"]] == [
        ("A", True),
        ("b", False),  # 只有隐藏子目录 → 无子目录
    ]
    assert body["entries"][0]["path"] == str(d.resolve() / "A")


def test_fs_dirs_root_has_no_parent():
    r = client.get("/fs/dirs", params={"path": "/"})
    assert r.status_code == 200
    assert r.json()["parent"] is None


def test_fs_dirs_errors(tmp_path, monkeypatch):
    assert client.get("/fs/dirs", params={"path": str(tmp_path / "nope")}).status_code == 404
    f = tmp_path / "f.txt"
    f.write_text("x")
    assert client.get("/fs/dirs", params={"path": str(f)}).status_code == 422
    monkeypatch.delenv("WSL_DISTRO_NAME", raising=False)
    assert client.get("/fs/dirs", params={"path": r"C:\x"}).status_code == 422


def test_fs_dirs_accepts_unc(tmp_path, monkeypatch):
    monkeypatch.setenv("WSL_DISTRO_NAME", "Ubuntu")
    (tmp_path / "sub").mkdir()
    r = client.get("/fs/dirs", params={"path": _unc(tmp_path)})
    assert r.status_code == 200
    assert r.json()["path"] == str(tmp_path.resolve())


def test_fs_roots_includes_home_and_datasets_root(tmp_path):
    r = client.get("/fs/roots")
    assert r.status_code == 200
    got = {e["path"] for e in r.json()}
    assert str(tmp_path.resolve()) in got
    assert str(Path.home().resolve()) in got


def test_fs_roots_lists_mnt_drives_only_under_wsl(monkeypatch):
    monkeypatch.delenv("WSL_DISTRO_NAME", raising=False)
    paths_ = {e["path"] for e in client.get("/fs/roots").json()}
    assert not any(p.startswith("/mnt/") for p in paths_)


# --- 回环守卫 -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("host", "ok"),
    [
        ("127.0.0.1", True),
        ("::1", True),
        ("::ffff:127.0.0.1", True),
        ("testclient", False),
        ("10.0.0.2", False),
        ("127.0.0.2", False),
        (None, False),
    ],
)
def test_is_loopback(host, ok):
    assert is_loopback(host) is ok


@pytest.mark.parametrize(
    ("headers", "status"),
    [
        ({}, 200),
        ({"X-Forwarded-For": "192.168.1.5"}, 403),
        ({"X-Forwarded-For": "127.0.0.1"}, 200),
        ({"X-Forwarded-For": "127.0.0.1, ::ffff:127.0.0.1 , ::1"}, 200),
        ({"X-Forwarded-For": "127.0.0.1, 192.168.1.5"}, 403),
        ({"Forwarded": 'for="[::1]:1234"'}, 200),
        ({"Forwarded": "for=127.0.0.1;proto=http, for=[::1]"}, 200),
        ({"Forwarded": "for=10.0.0.2"}, 403),
        ({"Forwarded": 'for="10.0.0.2:8080";proto=http'}, 403),
        ({"Forwarded": "for=unknown"}, 403),
        ({"X-Forwarded-For": "127.0.0.1", "Forwarded": "for=10.0.0.2"}, 403),
    ],
)
def test_loopback_honours_forwarded_headers(headers, status):
    """直连回环（如经 Vite 代理）时，转发头里每一跳也须是回环。"""
    app.dependency_overrides.pop(require_loopback, None)
    local = TestClient(app, client=("127.0.0.1", 50000))
    r = local.get("/projects", headers=headers)
    assert r.status_code == status, r.text
    if status == 403:
        assert "回环" in r.json()["detail"]


def test_non_loopback_rejected(tmp_path):
    """去掉依赖覆盖后，``TestClient`` 的来源 ``testclient`` 被拦截，响应体说明原因。"""
    app.dependency_overrides.pop(require_loopback, None)
    d = _dir(tmp_path)
    for r in (
        client.get("/fs/roots"),
        client.get("/fs/dirs", params={"path": str(d)}),
        client.get("/projects"),
        client.post("/projects", json={"path": str(d)}),
        client.delete("/projects/prj-00000000"),
    ):
        assert r.status_code == 403
        assert "回环" in r.json()["detail"]
    assert reg.list_projects() == []
