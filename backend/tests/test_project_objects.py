"""SDD 13 B2：按需识别——列目录、按需打开对象、按「目录 + 模态」登记数据源、上传归属项目。"""

from __future__ import annotations

import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import datasource_registry as reg
from app import sources as sources_pkg
from app import upload_store
from app.main import app
from app.routers.loopback import require_loopback
from app.sources.base import SourceBase

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """每测隔离：落盘清单 + 白名单根指向 tmp，注册表、项目表与索引清空；回环守卫放行。"""
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    reg._SOURCES.clear()
    reg._PROJECTS.clear()
    reg.invalidate_index()
    app.dependency_overrides[require_loopback] = lambda: None
    yield
    app.dependency_overrides.pop(require_loopback, None)
    reg._SOURCES.clear()
    reg._PROJECTS.clear()
    reg.invalidate_index()


def _jpeg(size=(8, 6)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 10, 10)).save(buf, format="JPEG")
    return buf.getvalue()


def _png(size=(5, 4)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (10, 200, 10)).save(buf, format="PNG")
    return buf.getvalue()


def _write_mp4(path: Path) -> None:
    """合成 4 帧 64×48 的 H.264 mp4；缺 PyAV / numpy 时跳过调用它的用例。"""
    av = pytest.importorskip("av")
    np = pytest.importorskip("numpy")
    with av.open(str(path), "w") as c:
        vs = c.add_stream("libx264", rate=10)
        vs.width, vs.height, vs.pix_fmt = 64, 48, "yuv420p"
        for i in range(4):
            frame = av.VideoFrame.from_ndarray(np.full((48, 64, 3), i * 40, np.uint8), "rgb24")
            for p in vs.encode(frame):
                c.mux(p)
        for p in vs.encode():
            c.mux(p)


@pytest.fixture
def project(tmp_path):
    """项目目录 ``cases/``：两张图、一段文本、一个 CT 文件、一个子目录与一个隐藏文件。"""
    root = tmp_path / "cases"
    (root / "sub").mkdir(parents=True)
    (root / "b.jpg").write_bytes(_jpeg())
    (root / "a.png").write_bytes(_png())
    (root / "notes.txt").write_text("hello")
    (root / "ct_001.nii.gz").write_bytes(b"\x1f\x8b" + b"\x00" * 64)
    (root / ".hidden.jpg").write_bytes(_jpeg())
    (root / "sub" / "c.jpg").write_bytes(_jpeg((3, 3)))
    prj, _ = reg.register_project(root)
    return prj


def _open(prj, path: str):
    return client.post(f"/projects/{prj.id}/objects", json={"path": path})


def _code(r) -> str:
    return r.json()["detail"]["code"]


def _project_sources(prj) -> list[reg.DataSource]:
    return [s for s in reg._SOURCES.values() if s.project_id == prj.id]


# --- 打开对象 -----------------------------------------------------------------


def test_open_image_registers_one_source_per_dir_and_modality(project):
    r1 = _open(project, "b.jpg")
    assert r1.status_code == 200, r1.text
    meta = r1.json()
    assert meta["modality"] == "natural_image"
    assert [a["size"] for a in meta["axes"]] == [8, 6]
    srcs = _project_sources(project)
    assert len(srcs) == 1
    ds = srcs[0]
    assert ds.origin == "project" and ds.status == "active"
    assert ds.root == project.path and ds.modality == "natural_image"
    assert ds.id == reg.project_source_id(project.path, "natural_image")
    assert meta["source_id"] == ds.id

    # 同目录同模态的另一文件复用该源
    r2 = _open(project, "a.png")
    assert r2.status_code == 200
    assert r2.json()["source_id"] == ds.id
    assert len(_project_sources(project)) == 1

    # 子目录另登记一个源
    r3 = _open(project, "sub/c.jpg")
    assert r3.status_code == 200
    assert len(_project_sources(project)) == 2

    saved = json.loads(Path(reg.sources_file()).read_text())
    assert {s["origin"] for s in saved["sources"]} == {"project"}
    assert {s["project_id"] for s in saved["sources"]} == {project.id}


def test_repeat_open_same_id_no_duplicate_source(project):
    a = _open(project, "b.jpg").json()["id"]
    b = _open(project, "./b.jpg").json()["id"]
    assert a == b
    assert len(_project_sources(project)) == 1


def test_open_resolvable_and_objects_meta(project):
    oid = _open(project, "b.jpg").json()["id"]
    ref = reg.resolve_object(oid)
    assert ref.datasource.project_id == project.id
    r = client.get(f"/objects/{oid}")
    assert r.status_code == 200
    assert r.json()["id"] == oid
    frame = client.get(f"/objects/{oid}/frame")
    assert frame.status_code == 200


def test_new_file_in_registered_dir_resolvable(project):
    """目录已登记、索引已建之后新增的文件，打开后同样可解析（索引未命中走兜底）。"""
    _open(project, "b.jpg")
    reg.resolve_object(_open(project, "a.png").json()["id"])  # 建索引
    (project.path / "later.jpg").write_bytes(_jpeg())
    r = _open(project, "later.jpg")
    assert r.status_code == 200
    assert reg.resolve_object(r.json()["id"]).object_id == r.json()["id"]


def test_jpeg_and_mp4_same_dir_two_sources(project):
    _write_mp4(project.path / "clip.mp4")
    img = _open(project, "b.jpg")
    vid = _open(project, "clip.mp4")
    assert img.status_code == 200 and vid.status_code == 200, vid.text
    assert vid.json()["modality"] == "video"
    srcs = {s.modality: s for s in _project_sources(project)}
    assert set(srcs) == {"natural_image", "video"}
    assert srcs["natural_image"].id != srcs["video"].id
    assert srcs["natural_image"].root == srcs["video"].root
    assert srcs["video"].status == "active" and srcs["video"].calibration.get("fps")
    assert reg.resolve_object(vid.json()["id"]).modality == "video"


def test_outside_project_rejected(project, tmp_path):
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(_jpeg())
    (project.path / "link.jpg").symlink_to(outside)
    (project.path / "linkdir").symlink_to(tmp_path, target_is_directory=True)
    for p in ("../outside.jpg", "sub/../../outside.jpg", str(outside), "link.jpg",
              "linkdir/outside.jpg"):
        r = _open(project, p)
        assert r.status_code == 422, p
        assert _code(r) == "outside_project"
    assert _project_sources(project) == []


def test_unsupported_and_corrupt(project):
    r = _open(project, "notes.txt")
    assert (r.status_code, _code(r)) == (422, "unsupported_format")
    r = _open(project, "ct_001.nii.gz")
    assert (r.status_code, _code(r)) == (422, "unsupported_format")
    (project.path / "fake.jpg").write_text("not really a jpeg")
    r = _open(project, "fake.jpg")
    assert (r.status_code, _code(r)) == (422, "corrupt")
    # 魔数对、内容截断：同样 corrupt
    (project.path / "trunc.jpg").write_bytes(_jpeg()[:12])
    r = _open(project, "trunc.jpg")
    assert (r.status_code, _code(r)) == (422, "corrupt")
    assert _project_sources(project) == []  # 校验不过不留数据源


def test_default_object_id_for_is_unsupported(project, monkeypatch):
    """候选 Source 未实现 ``object_id_for``（P1 的 CT、WSI 形态）→ unsupported_format。"""

    class Legacy(SourceBase):
        modality = "ct_abdomen"
        kind = "volume"
        formats = ((".nii.gz", b"\x1f\x8b", 0),)

    # 路由模块在导入期绑定了 SOURCES 这个 dict，故原地替换条目而不是换掉整张表
    monkeypatch.setitem(sources_pkg.SOURCES, "ct_abdomen", Legacy())
    r = _open(project, "ct_001.nii.gz")
    assert (r.status_code, _code(r)) == (422, "unsupported_format")
    entries = client.get(f"/projects/{project.id}/entries").json()["entries"]
    assert {e["name"]: e["modality"] for e in entries}["ct_001.nii.gz"] == "ct_abdomen"


def test_not_found_and_not_file(project):
    r = _open(project, "nope.jpg")
    assert (r.status_code, _code(r)) == (404, "not_found")
    r = _open(project, "sub")
    assert (r.status_code, _code(r)) == (422, "not_file")
    r = client.post("/projects/prj-00000000/objects", json={"path": "b.jpg"})
    assert (r.status_code, _code(r)) == (404, "project_not_found")


def test_concurrent_open_registers_once(project):
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: _open(project, "b.jpg"), range(8)))
    assert {r.status_code for r in results} == {200}
    assert len({r.json()["id"] for r in results}) == 1
    assert len(_project_sources(project)) == 1
    saved = json.loads(Path(reg.sources_file()).read_text())
    assert len(saved["sources"]) == 1


def test_concurrent_ensure_project_source(project):
    with ThreadPoolExecutor(max_workers=8) as pool:
        got = list(pool.map(
            lambda _: reg.ensure_project_source(project, project.path, "natural_image"),
            range(16),
        ))
    assert len({id(s) for s in got}) == 1
    assert len(_project_sources(project)) == 1


def test_remove_project_drops_on_demand_sources(project):
    oid = _open(project, "b.jpg").json()["id"]
    assert client.delete(f"/projects/{project.id}").status_code == 204
    assert _project_sources(project) == []
    assert client.get(f"/objects/{oid}").status_code == 404


# --- 列目录 -------------------------------------------------------------------


def test_entries_root_listing(project, tmp_path):
    (tmp_path / "outside_dir").mkdir()
    (project.path / "escape").symlink_to(tmp_path / "outside_dir", target_is_directory=True)
    (project.path / "inner").symlink_to(project.path / "sub", target_is_directory=True)
    (project.path / "broken.jpg").symlink_to(project.path / "missing.jpg")
    (project.path / "A_dir").mkdir()
    r = client.get(f"/projects/{project.id}/entries")
    assert r.status_code == 200
    body = r.json()
    assert body["path"] == ""
    rows = [(e["name"], e["type"], e["modality"], e["object_id"]) for e in body["entries"]]
    assert rows == [
        ("A_dir", "dir", None, None),
        ("inner", "dir", None, None),
        ("sub", "dir", None, None),
        ("a.png", "file", "natural_image", None),
        ("b.jpg", "file", "natural_image", None),
        ("ct_001.nii.gz", "file", None, None),
        ("notes.txt", "file", None, None),
    ]
    assert body["total"] == 7
    assert _project_sources(project) == []  # 列目录不登记


def test_entries_subdir_and_backfill(project):
    oid = _open(project, "sub/c.jpg").json()["id"]
    body = client.get(f"/projects/{project.id}/entries", params={"path": "sub"}).json()
    assert body["path"] == "sub"
    assert body["entries"] == [{
        "name": "c.jpg", "path": "sub/c.jpg", "type": "file",
        "modality": "natural_image", "object_id": oid,
    }]
    # 根目录未登记 → 不回填；同目录未打开过的文件在目录登记后也回填
    root = client.get(f"/projects/{project.id}/entries").json()["entries"]
    assert {e["name"]: e["object_id"] for e in root}["b.jpg"] is None
    b = _open(project, "b.jpg").json()["id"]
    root = client.get(f"/projects/{project.id}/entries").json()["entries"]
    got = {e["name"]: e["object_id"] for e in root}
    assert got["b.jpg"] == b
    sid = reg.project_source_id(project.path, "natural_image")
    assert got["a.png"] == upload_store.image_id(sid, "a.png")


def test_entries_backfill_does_not_read_content(project, monkeypatch):
    """回填是纯派生：列目录不校验魔数、不探测；损坏文件同样回填（打开时才校验）。"""
    from app import dataset_natural, dataset_video

    _write_mp4(project.path / "clip.mp4")
    img = _open(project, "b.jpg").json()["id"]
    vid = _open(project, "clip.mp4").json()["id"]
    (project.path / "fake.jpg").write_text("not really a jpeg")
    calls: list[str] = []

    def boom(*args, **kwargs):
        calls.append(str(args[0]))
        raise AssertionError("列目录不应读文件内容")

    monkeypatch.setattr(dataset_natural, "_probe", boom)
    monkeypatch.setattr(dataset_video, "_probe_file", boom)
    r = client.get(f"/projects/{project.id}/entries")
    assert r.status_code == 200, r.text
    got = {e["name"]: e["object_id"] for e in r.json()["entries"]}
    assert calls == []
    assert got["b.jpg"] == img and got["clip.mp4"] == vid
    sid = reg.project_source_id(project.path, "natural_image")
    assert got["fake.jpg"] == upload_store.image_id(sid, "fake.jpg")
    assert _open(project, "fake.jpg").status_code == 422


def test_entries_errors(project):
    def get(path):
        return client.get(f"/projects/{project.id}/entries", params={"path": path})

    for p in ("..", "../cases", "/etc"):
        r = get(p)
        assert (r.status_code, _code(r)) == (422, "outside_project"), p
    r = get("b.jpg")
    assert (r.status_code, _code(r)) == (422, "not_directory")
    r = get("nope")
    assert (r.status_code, _code(r)) == (404, "not_found")
    r = client.get("/projects/prj-00000000/entries")
    assert (r.status_code, _code(r)) == (404, "project_not_found")


def test_entries_and_objects_require_loopback(project):
    app.dependency_overrides.pop(require_loopback, None)
    assert client.get(f"/projects/{project.id}/entries").status_code == 403
    assert _open(project, "b.jpg").status_code == 403


# --- 打开项目不遍历 -------------------------------------------------------------


def test_create_project_does_not_walk_directory(tmp_path, monkeypatch):
    root = tmp_path / "big"
    root.mkdir()
    for i in range(50):
        (root / f"{i}.jpg").write_bytes(b"\xff\xd8\xff")
    calls: list[Path] = []
    real_iterdir, real_scandir = Path.iterdir, __import__("os").scandir

    def iterdir(self):
        calls.append(self)
        return real_iterdir(self)

    def scandir(path="."):
        calls.append(Path(path))
        return real_scandir(path)

    monkeypatch.setattr(Path, "iterdir", iterdir)
    monkeypatch.setattr("os.scandir", scandir)
    t0 = time.perf_counter()
    r = client.post("/projects", json={"path": str(root)})
    assert r.status_code == 201
    assert time.perf_counter() - t0 < 2
    assert not [p for p in calls if Path(p).resolve().is_relative_to(root.resolve())]
    assert reg._SOURCES == {}


# --- 上传归属 -----------------------------------------------------------------


def test_upload_with_project_id(project, tmp_path):
    r = client.post(
        "/uploads/images",
        files=[("files", ("x.jpg", _jpeg(), "image/jpeg"))],
        data={"name": "shots", "project_id": project.id},
    )
    assert r.status_code == 200, r.text
    src = r.json()["source"]
    assert src["project_id"] == project.id
    assert src["origin"] == "imported"
    root = Path(src["root"])
    assert root.is_relative_to((tmp_path / "uploads").resolve())  # 落盘位置不变
    assert not any(project.path.rglob("img-*"))  # 不写入项目目录
    assert reg._SOURCES[src["id"]].project_id == project.id

    # 同名、未归属的上传是另一个数据源，不会把项目源改成未归属
    r2 = client.post(
        "/uploads/images",
        files=[("files", ("x.jpg", _jpeg(), "image/jpeg"))],
        data={"name": "shots"},
    )
    assert r2.status_code == 200
    assert r2.json()["source"]["id"] != src["id"]
    assert r2.json()["source"]["project_id"] is None
    assert reg._SOURCES[src["id"]].project_id == project.id


def test_upload_unknown_project_404(tmp_path):
    r = client.post(
        "/uploads/images",
        files=[("files", ("x.jpg", _jpeg(), "image/jpeg"))],
        data={"project_id": "prj-00000000"},
    )
    assert r.status_code == 404
    assert not (tmp_path / "uploads").exists()
