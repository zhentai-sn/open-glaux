"""SDD 13 P2-B：CT、WSI 的 Source 改造。

覆盖 §7.2 规则 10–14 与 §15.1 的 P2 条目：非约定文件名在项目中打开并取帧、原始字节、瓦片；
内置源与导入源、项目源并存互不遮蔽且内置 id 不变；只有项目源时检测器方法可用、``/task/run``
能以项目对象为输入（CT 分割打桩 runner；WSI 无 mpp 时 422）；浏览器上传医学卷仍被拒；
缺 mpp 的切片可打开且 ``calibration`` 为空。

WSI 夹具优先用本机 ``data/wsi/slide_001.svs`` 改名复制（无数据时跳过该条），另手写一个
OpenSlide 能识别的最小 generic tiled TIFF，保证无本机数据时仍有覆盖。
"""

from __future__ import annotations

import gzip
import io
import json
import shutil
import struct
from pathlib import Path

import nibabel as nib
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config, dataset_ct, dataset_wsi, datasource_detect, segment_ts, segment_wsi
from app import datasource_registry as reg
from app.main import app
from app.routers.loopback import require_loopback
from app.sources import SOURCES
from app.sources.base import magic_matches

client = TestClient(app)

#: 导入期记下本机演示切片路径（用例会把 ``config.WSI_ROOT`` 改到临时目录）。
DEMO_SVS = config.WSI_ROOT / "slide_001.svs"
HAS_OPENSLIDE = config._openslide_available()
needs_openslide = pytest.mark.skipif(not HAS_OPENSLIDE, reason="需 openslide")


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    """落盘清单、白名单根、内置根与各缓存都指向 tmp；内置 CT、WSI 根为空目录。"""
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    for name, sub in (("CT_ROOT", "builtin_ct"), ("WSI_ROOT", "builtin_wsi")):
        (tmp_path / sub).mkdir()
        monkeypatch.setattr(config, name, tmp_path / sub)
    monkeypatch.setattr(config, "WSI_CACHE", tmp_path / "tiles")
    monkeypatch.setattr(config, "TS_CACHE", tmp_path / "ts")
    monkeypatch.setattr(config, "WSI_SEG_CACHE", tmp_path / "seg")
    reg._SOURCES.clear()
    reg._PROJECTS.clear()
    reg.invalidate_index()
    app.dependency_overrides[require_loopback] = lambda: None
    yield
    app.dependency_overrides.pop(require_loopback, None)
    reg._SOURCES.clear()
    reg._PROJECTS.clear()
    reg.invalidate_index()


# --- 夹具生成 -------------------------------------------------------------------


def _nifti(path: Path, shape=(4, 5, 3), zooms=(0.8, 0.8, 2.0), fill=50.0) -> Path:
    """最小 NIfTI-1；``.nii`` / ``.nii.gz`` 由 nibabel 按文件名决定。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    img = nib.Nifti1Image(np.full(shape, fill, dtype=np.float32), np.eye(4))
    img.header.set_zooms(zooms)
    nib.save(img, str(path))
    return path


def _tiled_tiff(path: Path, w=300, h=200, tile=256, px_per_cm: int | None = None) -> Path:
    """手写单 IFD、未压缩 RGB 的 tiled TIFF——OpenSlide 按 generic-tiff 识别。

    ``px_per_cm`` 给出时写 XResolution/YResolution + ResolutionUnit=厘米，OpenSlide 由此
    推出 mpp（40000 px/cm → 0.25 µm/px）；缺省不写，即「缺 mpp 的切片」。
    """
    tx, ty = -(-w // tile), -(-h // tile)
    tiles = [bytes([(40 + 90 * c) % 256, (60 + 70 * r) % 256, 160]) * (tile * tile)
             for r in range(ty) for c in range(tx)]
    n = len(tiles)
    body = bytearray()
    offsets = []
    for t in tiles:
        offsets.append(8 + len(body))
        body += t
    bps_off = 8 + len(body)
    body += struct.pack("<3H", 8, 8, 8)
    offs_off = 8 + len(body)
    body += struct.pack(f"<{n}I", *offsets)
    cnt_off = 8 + len(body)
    body += struct.pack(f"<{n}I", *[len(t) for t in tiles])
    tags = [(256, 4, 1, w), (257, 4, 1, h), (258, 3, 3, bps_off), (259, 3, 1, 1),
            (262, 3, 1, 2), (277, 3, 1, 3)]
    if px_per_cm:
        res_off = 8 + len(body)
        body += struct.pack("<2I", px_per_cm, 1)
        tags += [(282, 5, 1, res_off), (283, 5, 1, res_off)]
    tags.append((284, 3, 1, 1))
    if px_per_cm:
        tags.append((296, 3, 1, 3))  # ResolutionUnit = centimeter
    tags += [(322, 3, 1, tile), (323, 3, 1, tile), (324, 4, n, offs_off), (325, 4, n, cnt_off)]
    ifd = struct.pack("<H", len(tags))
    for tag, typ, cnt, val in tags:
        if typ == 3 and cnt == 1:
            ifd += struct.pack("<HHIHH", tag, typ, cnt, val, 0)
        else:
            ifd += struct.pack("<HHII", tag, typ, cnt, val)
    ifd += struct.pack("<I", 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"II*\x00" + struct.pack("<I", 8 + len(body)) + bytes(body) + ifd)
    return path


def _project(tmp_path: Path, name: str = "cases"):
    root = tmp_path / name
    root.mkdir(exist_ok=True)
    prj, _ = reg.register_project(root)
    return prj


def _open(prj, rel: str):
    return client.post(f"/projects/{prj.id}/objects", json={"path": rel})


def _code(r) -> str:
    return r.json()["detail"]["code"]


def _project_sources(prj) -> list[reg.DataSource]:
    return [s for s in reg._SOURCES.values() if s.project_id == prj.id]


def _nifti_from_raw(data: bytes, gz: bool) -> nib.Nifti1Image:
    if gz:
        data = gzip.decompress(data)
    return nib.Nifti1Image.from_bytes(data)


def _method_ids() -> set[str]:
    return {m["id"] for m in client.get("/models").json()}


# --- CT：非约定文件名 ------------------------------------------------------------


def test_ct_non_convention_names_open_frame_raw(tmp_path):
    prj = _project(tmp_path)
    gz = _nifti(prj.path / "abdomen scan.nii.gz", shape=(6, 5, 4), zooms=(0.7, 0.7, 1.5))
    plain = _nifti(prj.path / "liver.nii", shape=(3, 4, 2), zooms=(1.0, 1.0, 2.5))

    seen = set()
    cases = ((gz, (6, 5, 4), (0.7, 0.7, 1.5)), (plain, (3, 4, 2), (1.0, 1.0, 2.5)))
    for path, shape, zooms in cases:
        r = _open(prj, path.name)
        assert r.status_code == 200, r.text
        meta = r.json()
        oid = meta["id"]
        seen.add(oid)
        assert oid.startswith("ct-") and meta["modality"] == "ct_abdomen"
        assert meta["display_name"] == path.name
        assert [a["size"] for a in meta["axes"]] == list(shape)
        assert meta["calibration"]["kind"] == "voxel_mm"
        assert meta["calibration"]["value"] == pytest.approx(list(zooms))

        frame = client.get(f"/objects/{oid}/frame", params={"z": shape[2] - 1})
        assert frame.status_code == 200
        assert frame.headers["content-type"] == "image/png"
        assert Image.open(io.BytesIO(frame.content)).size == (shape[0], shape[1])

        raw = client.get(f"/objects/{oid}/raw")
        assert raw.status_code == 200
        assert raw.content == path.read_bytes()
        assert _nifti_from_raw(raw.content, gz=path.name.endswith(".gz")).shape == shape

    assert len(seen) == 2
    [ds] = _project_sources(prj)  # 同目录同模态只登记一个源
    assert ds.modality == "ct_abdomen" and ds.status == "active"
    assert ds.calibration["voxel_mm"]  # 源级提示照常记录（§7.2 规则 6）


def test_ct_listing_skips_invalid_and_entries_backfill(tmp_path):
    prj = _project(tmp_path)
    _nifti(prj.path / "a.nii.gz")
    (prj.path / "b.nii.gz").write_bytes(gzip.compress(b"not a nifti header" * 40))
    (prj.path / "c.nii").write_bytes(b"\0" * 400)

    oid = _open(prj, "a.nii.gz").json()["id"]
    for bad in ("b.nii.gz", "c.nii"):
        r = _open(prj, bad)
        assert (r.status_code, _code(r)) == (422, "corrupt"), bad

    listed = [o["id"] for o in client.get("/images", params={"modality": "ct_abdomen"}).json()]
    assert listed == [oid]

    rows = {e["name"]: e for e in client.get(f"/projects/{prj.id}/entries").json()["entries"]}
    assert {n: rows[n]["modality"] for n in ("a.nii.gz", "b.nii.gz", "c.nii")} == dict.fromkeys(
        ("a.nii.gz", "b.nii.gz", "c.nii"), "ct_abdomen"
    )
    assert rows["a.nii.gz"]["object_id"] == oid
    # 回填是纯派生、不读内容：损坏文件同样回填，打开时才校验
    sid = reg.project_source_id(prj.path, "ct_abdomen")
    assert rows["b.nii.gz"]["object_id"] == dataset_ct.object_id(sid, "b.nii.gz")


def test_ct_object_id_for_and_derive_id_agree(tmp_path):
    prj = _project(tmp_path)
    p = _nifti(prj.path / "x.nii")
    ds = reg.project_source_spec(prj, prj.path, "ct_abdomen")
    src = SOURCES["ct_abdomen"]
    assert src.object_id_for(ds, p) == src.derive_id(ds, "x.nii") == dataset_ct.object_id(
        ds.id, "x.nii"
    )
    # 不在源目录下一层 → None
    sub = _nifti(prj.path / "sub" / "y.nii")
    assert src.object_id_for(ds, sub) is None


# --- WSI：非约定文件名 -----------------------------------------------------------


@needs_openslide
def test_wsi_generic_tiff_without_mpp_opens(tmp_path):
    prj = _project(tmp_path)
    _tiled_tiff(prj.path / "tissue B.tif")
    r = _open(prj, "tissue B.tif")
    assert r.status_code == 200, r.text
    meta = r.json()
    oid = meta["id"]
    assert oid.startswith("wsi-") and meta["modality"] == "pathology"
    assert meta["display_name"] == "tissue B.tif"
    assert [(a["name"], a["size"]) for a in meta["axes"][:2]] == [("x", 300), ("y", 200)]
    assert meta["calibration"] is None  # 缺 mpp：可浏览、标定为空（§7.2 规则 6、D-24）

    [ds] = _project_sources(prj)
    assert ds.status == "active" and ds.calibration == {}

    levels = meta["axes"][2]["size"]
    frame = client.get(f"/objects/{oid}/frame", params={"level": levels - 1})
    assert frame.status_code == 200 and frame.headers["content-type"] == "image/png"

    top = dataset_wsi._deepzoom(oid).level_count - 1
    tile = client.get(f"/objects/{oid}/tiles/{top}/0/0")
    assert tile.status_code == 200
    assert tile.content[:2] == b"\xff\xd8"
    assert (tmp_path / "tiles" / oid / str(top) / "0_0.jpeg").is_file()


@needs_openslide
@pytest.mark.skipif(not DEMO_SVS.is_file(), reason="需本机 data/wsi/slide_001.svs")
def test_wsi_svs_copy_with_other_name(tmp_path):
    prj = _project(tmp_path)
    shutil.copy(DEMO_SVS, prj.path / "tissue A.svs")
    r = _open(prj, "tissue A.svs")
    assert r.status_code == 200, r.text
    meta = r.json()
    assert meta["id"].startswith("wsi-")
    assert meta["calibration"]["kind"] == "mpp_um"
    assert all(v > 0 for v in meta["calibration"]["value"])
    top = dataset_wsi._deepzoom(meta["id"]).level_count - 1
    assert client.get(f"/objects/{meta['id']}/tiles/{top}/0/0").status_code == 200


@needs_openslide
def test_wsi_rejects_unrecognized_and_multifile(tmp_path):
    prj = _project(tmp_path)
    (prj.path / "fake.svs").write_bytes(b"II*\x00" + b"\0" * 64)
    (prj.path / "broken.tiff").write_bytes(b"II*\x00" + b"\0" * 64)  # 切片与普通图都解不开
    (prj.path / "case.mrxs").write_bytes(b"\0" * 16)
    for name in ("fake.svs", "broken.tiff"):
        r = _open(prj, name)
        assert (r.status_code, _code(r)) == (422, "corrupt"), name
    r = _open(prj, "case.mrxs")
    assert (r.status_code, _code(r)) == (422, "unsupported_format")
    assert _project_sources(prj) == []


def _big_endian_gray_tiff(w: int, h: int) -> bytes:
    """手写大端（``MM\\0*``）、未压缩、单条带的 8 位灰度 TIFF——PIL 只写小端。"""
    entries = [  # (tag, type, count, value)；type 3 = SHORT，4 = LONG
        (256, 3, 1, w), (257, 3, 1, h), (258, 3, 1, 8), (259, 3, 1, 1), (262, 3, 1, 1),
        (273, 4, 1, 0), (277, 3, 1, 1), (278, 3, 1, h), (279, 4, 1, w * h),
    ]
    ifd_size = 2 + 12 * len(entries) + 4
    pixels_at = 8 + ifd_size
    out = bytearray(b"MM\x00*" + struct.pack(">I", 8) + struct.pack(">H", len(entries)))
    for tag, typ, count, value in entries:
        value = pixels_at if tag == 273 else value
        packed = struct.pack(">HH", value, 0) if typ == 3 else struct.pack(">I", value)
        out += struct.pack(">HHI", tag, typ, count) + packed
    out += struct.pack(">I", 0) + bytes(range(256)) * (w * h // 256) + bytes(w * h % 256)
    return bytes(out)


@needs_openslide
@pytest.mark.parametrize("variant", ["L", "RGB", "big-endian"])
def test_plain_tiff_opens_as_natural_image(tmp_path, variant):
    """OpenSlide 不能识别的普通 TIFF 落到通用图像（SDD 13 §7.2 规则 5、10），取图解码为 PNG。"""
    prj = _project(tmp_path)
    if variant == "big-endian":
        data = _big_endian_gray_tiff(40, 30)
    else:
        buf = io.BytesIO()
        Image.new(variant, (40, 30), 128).save(buf, format="TIFF")
        data = buf.getvalue()
    (prj.path / "scan.tiff").write_bytes(data)
    r = _open(prj, "scan.tiff")
    assert r.status_code == 200, r.text
    meta = r.json()
    assert meta["modality"] == "natural_image" and meta["display_name"] == "scan.tiff"
    assert [a["size"] for a in meta["axes"]] == [40, 30]
    frame = client.get(f"/objects/{meta['id']}/frame")
    assert frame.status_code == 200 and frame.headers["content-type"] == "image/png"


@needs_openslide
def test_tiled_tiff_still_opens_as_pathology_beside_plain_tiff(tmp_path):
    prj = _project(tmp_path)
    _tiled_tiff(prj.path / "tissue.tif")
    Image.new("L", (20, 20), 9).save(prj.path / "scan.tif")
    assert _open(prj, "tissue.tif").json()["modality"] == "pathology"
    assert _open(prj, "scan.tif").json()["modality"] == "natural_image"
    assert sorted(s.modality for s in _project_sources(prj)) == ["natural_image", "pathology"]


def test_wsi_formats_accept_tiff_and_bigtiff_magics(tmp_path):
    """同一后缀四行魔数，``magic_matches`` 任一命中即符。"""
    formats = SOURCES["pathology"].formats
    for i, magic in enumerate((b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")):
        p = tmp_path / f"s{i}.svs"
        p.write_bytes(magic + b"\0" * 12)
        assert magic_matches(formats, p)
    bad = tmp_path / "bad.svs"
    bad.write_bytes(b"GIF89a" + b"\0" * 8)
    assert not magic_matches(formats, bad)
    exts = {ext for ext, _, _ in formats}
    assert exts == {".svs", ".tif", ".tiff", ".ndpi", ".scn", ".bif"}


# --- 多源并存 --------------------------------------------------------------------


def test_ct_builtin_imported_project_coexist(tmp_path):
    builtin = _nifti(config.CT_ROOT / "ct_001.nii.gz", shape=(2, 2, 2))
    imp_dir = tmp_path / "imported_ct"
    imported = _nifti(imp_dir / "ct_001.nii.gz", shape=(3, 3, 3))  # 与内置同名
    imp = reg.register_folder(imp_dir, "ct_abdomen", detect=datasource_detect.detect)
    assert imp.status == "active" and imp.calibration["voxel_mm"]
    prj = _project(tmp_path)
    proj_file = _nifti(prj.path / "ct_001.nii.gz", shape=(4, 4, 4))
    proj_id = _open(prj, "ct_001.nii.gz").json()["id"]

    rows = {o["id"]: o for o in client.get("/images", params={"modality": "ct_abdomen"}).json()}
    imp_id = dataset_ct.object_id(imp.id, "ct_001.nii.gz")
    assert set(rows) == {"ct_001", imp_id, proj_id}
    assert rows["ct_001"]["source_id"] == "ct-demo"  # 内置 id 不变
    assert rows[imp_id]["source_id"] == imp.id
    for oid, path, n in (("ct_001", builtin, 2), (imp_id, imported, 3), (proj_id, proj_file, 4)):
        assert rows[oid]["axes"][0]["size"] == n
        assert client.get(f"/objects/{oid}/raw").content == path.read_bytes()
        assert client.get(f"/objects/{oid}/frame", params={"z": 0}).status_code == 200


@needs_openslide
def test_wsi_builtin_imported_project_coexist(tmp_path):
    _tiled_tiff(config.WSI_ROOT / "slide_001.tif", w=300, h=200, px_per_cm=40000)
    imp_dir = tmp_path / "imported_wsi"
    _tiled_tiff(imp_dir / "slide_001.tif", w=280, h=190, px_per_cm=40000)  # 与内置同名
    imp = reg.register_folder(imp_dir, "pathology", detect=datasource_detect.detect)
    assert imp.status == "active" and imp.calibration["mpp"] == pytest.approx([0.25, 0.25])
    prj = _project(tmp_path)
    _tiled_tiff(prj.path / "slide_001.tif", w=260, h=180)
    proj_id = _open(prj, "slide_001.tif").json()["id"]

    rows = {o["id"]: o for o in client.get("/images", params={"modality": "pathology"}).json()}
    imp_id = dataset_wsi.object_id(imp.id, "slide_001.tif")
    assert set(rows) == {"slide_001", imp_id, proj_id}
    assert rows["slide_001"]["source_id"] == "wsi-demo"  # 内置 id 不变
    for oid, w in (("slide_001", 300), (imp_id, 280), (proj_id, 260)):
        assert rows[oid]["axes"][0]["size"] == w
        top = dataset_wsi._deepzoom(oid).level_count - 1
        assert client.get(f"/objects/{oid}/tiles/{top}/0/0").status_code == 200
    assert rows["slide_001"]["calibration"]["value"] == pytest.approx([0.25, 0.25])
    assert rows[proj_id]["calibration"] is None


@needs_openslide
def test_register_folder_status_semantics_unchanged(tmp_path):
    """导入源仍按源级标定定状态；项目源登记即 active（D-24）。"""
    no_mpp = tmp_path / "no_mpp"
    _tiled_tiff(no_mpp / "a.tif")
    assert reg.register_folder(no_mpp, "pathology", detect=datasource_detect.detect).status == (
        "needs_calibration"
    )
    prj = _project(tmp_path)
    _tiled_tiff(prj.path / "a.tif")
    assert _open(prj, "a.tif").status_code == 200
    [ds] = _project_sources(prj)
    assert (ds.status, ds.calibration) == ("active", {})


# --- 只有项目源时的检测器可用性与任务 ------------------------------------------


def test_ct_only_project_source_methods_and_task_run(tmp_path, monkeypatch):
    assert not config.ct_data_available()
    assert "totalsegmentator_v2" not in _method_ids()

    prj = _project(tmp_path)
    vol = _nifti(prj.path / "kidney study.nii", shape=(4, 4, 4), zooms=(0.5, 0.5, 2.0))
    oid = _open(prj, vol.name).json()["id"]
    assert config.ct_data_available()
    assert "totalsegmentator_v2" in _method_ids()

    calls: list[list[str]] = []

    class _Done:
        returncode = 0
        stderr = ""

    def fake_run(cmd, **kwargs):
        calls.append(cmd)
        lbl = np.zeros((4, 4, 4), dtype=np.int32)
        lbl[0:2, 0:2, 0:2] = 1
        nib.save(nib.Nifti1Image(lbl, np.eye(4)), cmd[cmd.index("--output") + 1])
        return _Done()

    monkeypatch.setattr(config, "ts_live_available", lambda: True)
    monkeypatch.setattr(segment_ts.subprocess, "run", fake_run)
    r = client.post("/task/run", json={"task": "totalseg_liver_kidney", "image_id": oid})
    assert r.status_code == 200, r.text
    assert [c[c.index("--input") + 1] for c in calls] == [str(vol)]  # 输入经 resolve_object 定位
    assert r.json()["metrics"]
    labelmap = client.get(f"/volume/{oid}/labelmap")
    assert labelmap.status_code == 200


@needs_openslide
def test_wsi_only_project_source_methods_and_task_run(tmp_path, monkeypatch):
    assert not config.wsi_data_available()
    assert "stardist_he" not in _method_ids()
    assert client.get("/wsi/anything/verify").status_code == 503

    prj = _project(tmp_path)
    _tiled_tiff(prj.path / "no mpp.tif")
    _tiled_tiff(prj.path / "with mpp.tif", px_per_cm=40000)
    bare = _open(prj, "no mpp.tif").json()["id"]
    cal = _open(prj, "with mpp.tif").json()["id"]
    assert config.wsi_data_available()
    assert "stardist_he" in _method_ids()

    region = {"kind": "box", "x0": 0, "y0": 0, "x1": 256, "y1": 192}
    body = {"task": "nuclei_detection", "region": region, "method": "stardist_he"}
    r = client.post("/task/run", json={**body, "image_id": bare})
    assert r.status_code == 422 and "标定" in r.text  # 无 mpp 不出假密度

    class _Done:
        returncode = 0
        stderr = ""

    def fake_run(cmd, **kwargs):
        out = Path(cmd[cmd.index("--output") + 1])
        out.write_text('{"points": [[10, 10], [100, 50]], "class_ids": [1, 1]}')
        return _Done()

    monkeypatch.setattr(config, "wsi_live_available", lambda: True)
    monkeypatch.setattr(segment_wsi.subprocess, "run", fake_run)
    r = client.post("/task/run", json={**body, "image_id": cal})
    assert r.status_code == 200, r.text
    assert r.json()["metrics"]["nuclei_count"]["value"] == 2

    # 参考核验文件只对内置示例源提供：项目对象按「不可核验」422，不是 500
    v = client.get(f"/wsi/{cal}/verify")
    assert v.status_code == 422 and "内置示例" in v.text


# --- 浏览器上传仍拒医学卷 ---------------------------------------------------------


def test_browser_upload_rejects_medical_volumes():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (1, 2, 3)).save(buf, format="JPEG")
    nii = b"\x5c\x01\x00\x00" + b"\0" * 340 + b"n+1\x00" + b"\0" * 16
    files = [
        ("files", ("ok.jpg", buf.getvalue(), "image/jpeg")),
        ("files", ("vol.nii", nii, "application/octet-stream")),
        ("files", ("vol.nii.gz", gzip.compress(nii), "application/gzip")),
        ("files", ("slide.svs", b"II*\x00" + b"\0" * 32, "application/octet-stream")),
    ]
    r = client.post("/uploads/images", files=files, data={"name": "mixed"})
    assert r.status_code == 200, r.text
    reasons = {x["filename"]: x["reason"] for x in r.json()["rejected"]}
    assert reasons == dict.fromkeys(("vol.nii", "vol.nii.gz", "slide.svs"), "unsupported_type")
    exts = set(client.get("/uploads/formats").json()["extensions"])
    assert not exts & {".nii", ".gz", ".nii.gz", ".svs"}
    # .tif/.tiff 以通用图像进受理表（普通 TIFF），不以病理进表（SDD 08 §7 规则 5）
    assert {".tif", ".tiff"} <= exts
    rows = {s["modality"]: s for s in client.get("/datasources").json()}
    assert rows["natural_image"]["importable"]


def test_legacy_needs_calibration_project_source_promoted_on_open(tmp_path):
    """D-24 之前落为 needs_calibration 的项目源：再次打开时提为 active，对象可解析。"""
    prj = _project(tmp_path)
    _nifti(tmp_path / "cases" / "scan.nii.gz")
    spec = reg.project_source_spec(prj, (tmp_path / "cases").resolve(), "ct_abdomen")
    reg._SOURCES[spec.id] = reg.DataSource(
        **{**reg.asdict(spec), "calibration": {}, "status": "needs_calibration"}
    )
    reg.invalidate_index()

    r = _open(prj, "scan.nii.gz")
    assert r.status_code == 200, r.text
    assert reg._SOURCES[spec.id].status == "active"
    assert reg.resolve_object(r.json()["id"]).datasource.id == spec.id


def test_wsi_fit_level_picks_coarsest_level_that_fills_output(monkeypatch):
    """省略 level 时选降采样不超过「区域长边 / 输出长边」的最粗一层（SDD 10 §5.2）。"""

    class _Slide:
        level_downsamples = (1.0, 4.0, 16.0)

    monkeypatch.setattr(dataset_wsi, "_open", lambda _id: _Slide())
    assert dataset_wsi.fit_level("s", 44.9) == 2  # 全片概览
    assert dataset_wsi.fit_level("s", 6.8) == 1
    assert dataset_wsi.fit_level("s", 1.56) == 0  # 1600 px 区域 → level 0
    assert dataset_wsi.fit_level("s", 0.5) == 0  # 区域小于输出，不越过 level 0


def test_wsi_frame_without_level_fits_output(tmp_path):
    """slide 省略 level：按输出尺寸自动选层，实际层在 X-Glaux-Frame 回报（SDD 10 §5.2）。"""
    prj = _project(tmp_path)
    _tiled_tiff(prj.path / "tissue C.tif")
    oid = _open(prj, "tissue C.tif").json()["id"]
    r = client.get(f"/objects/{oid}/frame", params={"roi": "0,0,100,100", "size": 1024})
    assert r.status_code == 200, r.text
    assert json.loads(r.headers["X-Glaux-Frame"])["index"]["level"] == 0
