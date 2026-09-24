"""SDD 10 W1：VideoSource 数据轴——元数据、音轨声明（D-23）、逐帧解码、上传与缺库降级。

样例全部在测试里用 PyAV 合成（12 帧、10 fps、64×48；一段带 16 kHz 单声道 AAC 音轨，一段不带），
不提交任何来源不明的真实影像。
"""

from __future__ import annotations

import base64
import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config, dataset_video, datasource_detect, upload_store
from app import datasource_registry as reg
from app.main import app
from app.routers import annotations as ann_router
from app.schemas import Index, ObjectMeta, Region
from app.sources import SOURCES

av = pytest.importorskip("av")
np = pytest.importorskip("numpy")

client = TestClient(app)

N_FRAMES, FPS, W, H = 12, 10, 64, 48


def _level(i: int) -> int:
    return (i * 20) % 256


def write_mp4(path, *, audio: bool) -> None:
    """合成一段 mp4：第 i 帧为灰度 _level(i) 的纯色帧。"""
    with av.open(str(path), "w") as c:
        vs = c.add_stream("mpeg4", rate=FPS)
        vs.width, vs.height, vs.pix_fmt = W, H, "yuv420p"
        a = c.add_stream("aac", rate=16000) if audio else None
        if a is not None:
            a.layout = "mono"
        for i in range(N_FRAMES):
            frame = av.VideoFrame.from_ndarray(np.full((H, W, 3), _level(i), np.uint8), "rgb24")
            for p in vs.encode(frame):
                c.mux(p)
        for p in vs.encode():
            c.mux(p)
        if a is not None:
            total, pts = 16000 * N_FRAMES // FPS, 0
            while pts < total:
                samples = (np.sin(np.arange(pts, pts + 1024) / 10.0) * 0.3).astype(np.float32)
                af = av.AudioFrame.from_ndarray(
                    samples.reshape(1, -1), format="fltp", layout="mono"
                )
                af.sample_rate, af.pts = 16000, pts
                for p in a.encode(af):
                    c.mux(p)
                pts += 1024
            for p in a.encode():
                c.mux(p)


@pytest.fixture
def videos(tmp_path, monkeypatch):
    """tmp 下导入一个 video 源：with_audio.mp4 + silent.mp4。返回 {文件名: 对象 id}。"""
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    reg.init()
    folder = tmp_path / "clips"
    folder.mkdir()
    write_mp4(folder / "with_audio.mp4", audio=True)
    write_mp4(folder / "silent.mp4", audio=False)
    (folder / "notes.txt").write_text("not a video")
    src = reg.register_folder(folder, "video", detect=datasource_detect.detect)
    yield {
        "source": src,
        "with_audio": dataset_video.object_id(src.id, "with_audio.mp4"),
        "silent": dataset_video.object_id(src.id, "silent.mp4"),
    }
    reg._SOURCES.clear()
    reg.invalidate_index()


def _by_id():
    rows = client.get("/images", params={"modality": "video"}).json()
    return {r["id"]: ObjectMeta(**r) for r in rows}


def test_video_folder_import_detects_fps(videos):
    src = videos["source"]
    assert src.status == "active" and src.calibration == {"fps": pytest.approx(FPS)}
    row = {s["id"]: s for s in client.get("/datasources").json()}[src.id]
    assert row["kind"] == "video" and row["importable"] == [".mp4", ".webm"]


def test_video_meta_axes_and_time_base(videos):
    objs = _by_id()
    assert set(objs) == {videos["with_audio"], videos["silent"]}  # notes.txt 不进列表
    for obj in objs.values():
        assert obj.kind == "video" and obj.modality == "video"
        assert [(a.name, a.size) for a in obj.axes] == [("x", W), ("y", H), ("t", N_FRAMES)]
        assert obj.axis("t").unit == "ms" and obj.axis("t").spacing == pytest.approx(100.0)
        assert obj.calibration.kind == "time_base"
        assert obj.calibration.value["fps"] == pytest.approx(FPS)
        assert obj.id.startswith("vid-") and obj.display_name.endswith(".mp4")
        assert not {"cf", "voxel_spacing_mm", "mpp_um", "dims"} & obj.model_dump().keys()
        assert obj.resources["raw"] == f"/objects/{obj.id}/raw"


def test_audio_track_declared_not_consumed(videos):
    """D-23 / §15.1 A：有音轨 → streams 恰一条 audio 且参数非空、下发 resources.audio；
    无音轨 → streams 为空、无 audio 键；两者 axes 与 calibration 相同。"""
    objs = _by_id()
    loud, silent = objs[videos["with_audio"]], objs[videos["silent"]]
    assert len(loud.streams) == 1 and loud.streams[0].kind == "audio"
    s = loud.streams[0]
    assert (s.sample_rate, s.channels, s.codec) == (16000, 1, "aac")
    assert s.duration_ms and abs(s.duration_ms - 1000 * N_FRAMES / FPS) < 200
    assert loud.resources["audio"] == f"/objects/{loud.id}/audio"
    assert silent.streams == [] and "audio" not in silent.resources
    assert loud.axes == silent.axes and loud.calibration == silent.calibration


def test_video_frames_decode_by_t(videos):
    oid = videos["silent"]
    ref = reg.resolve_object(oid)
    assert (ref.kind, ref.modality) == ("video", "video")
    for t in (0, 5, N_FRAMES - 1):
        data, mime, frame = ref.source.frame(ref.datasource, oid, Index(t=t))
        img = Image.open(io.BytesIO(data))
        assert mime == "image/png" and img.size == (W, H)
        assert abs(img.convert("L").getpixel((W // 2, H // 2)) - _level(t)) <= 12
        assert frame.index.t == t and (frame.width, frame.height, frame.scale) == (W, H, 1.0)
    with pytest.raises(ValueError):
        ref.source.frame(ref.datasource, oid, Index(t=N_FRAMES))  # 越界
    with pytest.raises(ValueError):
        ref.source.frame(ref.datasource, oid, Index(z=0))  # video 没有 z 轴
    _, _, cropped = ref.source.frame(
        ref.datasource, oid, Index(t=3), roi=Region(kind="box", x0=8, y0=8, x1=40, y1=24)
    )
    assert (cropped.origin, cropped.width, cropped.height) == ((8.0, 8.0), 32, 16)


def test_image_endpoint_serves_first_frame(videos):
    r = client.get(f"/image/{videos['with_audio']}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(r.content)).size == (W, H)


def test_raw_is_container_bytes(videos):
    ref = reg.resolve_object(videos["silent"])
    path, mime = ref.source.raw(ref.datasource, videos["silent"])
    assert mime == "video/mp4" and path.read_bytes()[4:8] == b"ftyp"


def test_upload_mp4_infers_video_modality(tmp_path, monkeypatch):
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    reg.init()
    clip = tmp_path / "c.mp4"
    write_mp4(clip, audio=False)
    png = io.BytesIO()
    Image.new("RGB", (4, 4)).save(png, format="PNG")
    r = client.post(
        "/uploads/images",
        files=[
            ("files", ("clip.mp4", clip.read_bytes(), "video/mp4")),
            ("files", ("fake.mp4", b"\x00" * 64, "video/mp4")),  # 后缀对、魔数错
            ("files", ("pic.png", png.getvalue(), "image/png")),  # 另一模态：本批拒收
        ],
        data={"name": "clips"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"]["modality"] == "video" and body["source"]["status"] == "active"
    assert [a["filename"] for a in body["accepted"]] == ["clip.mp4"]
    assert {x["filename"]: x["reason"] for x in body["rejected"]} == {
        "fake.mp4": "corrupt",
        "pic.png": "unsupported_type",
    }
    oid = body["accepted"][0]["id"]
    assert oid.startswith("vid-") and oid in _by_id()
    reg._SOURCES.clear()


def test_upload_png_still_natural_image(tmp_path, monkeypatch):
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    reg.init()
    png = io.BytesIO()
    Image.new("RGB", (4, 4)).save(png, format="PNG")
    body = client.post(
        "/uploads/images", files=[("files", ("p.png", png.getvalue(), "image/png"))]
    ).json()
    assert body["source"]["modality"] == "natural_image"
    stored = upload_store.store_name("p.png", ".png")
    assert body["accepted"][0]["id"] == upload_store.image_id(body["source"]["id"], stored)
    reg._SOURCES.clear()


def test_missing_pyav_is_a_state_not_an_error(videos, monkeypatch):
    """PyAV 不可用：probe 为 False、不列对象、不探标定，其余模态不受影响（SDD 10 §13）。"""
    monkeypatch.setattr(dataset_video, "av_available", lambda: False)
    src = SOURCES["video"]
    folder = videos["source"].root
    assert src.probe(folder) is False
    assert src.detect_calibration(folder) == {}
    assert client.get("/images", params={"modality": "video"}).json() == []
    reg.invalidate_index()
    assert client.get(f"/image/{videos['silent']}").status_code == 404
    assert client.get("/images", params={"modality": "natural_image"}).status_code == 200


def test_objects_frame_video_reference_frame(videos):
    """§15.1 E：video 在 t=10 下取帧，X-Glaux-Frame 的 index.t 为 10；raw 经 /objects 下发。"""
    import json

    oid = videos["with_audio"]
    r = client.get(f"/objects/{oid}/frame", params={"t": 10, "roi": "16,8,48,40"})
    assert r.status_code == 200, r.text
    f = json.loads(r.headers["X-Glaux-Frame"])
    assert f["index"]["t"] == 10 and (f["width"], f["height"]) == (32, 32)
    assert f["scale"] == 1.0 and f["origin"] == [16.0, 8.0]
    assert client.get(f"/objects/{oid}/frame", params={"t": N_FRAMES}).status_code == 422
    assert client.get(f"/objects/{oid}/frame", params={"z": 0}).status_code == 422
    raw = client.get(f"/objects/{oid}/raw")
    assert raw.status_code == 200 and raw.headers["content-type"] == "video/mp4"
    assert raw.content[4:8] == b"ftyp"


def test_video_annotations_are_scoped_to_frame_and_survive_reopen(videos, tmp_path, monkeypatch):
    """W6：bbox 与画笔 mask 均落在 index.t，刷新后只回显所属帧。"""
    monkeypatch.setattr(config, "ANNOTATIONS_ROOT", tmp_path / "ann")
    ann_router._stores.clear()
    oid = videos["silent"]
    bbox = {"kind": "bbox", "x0": 2, "y0": 3, "x1": 20, "y1": 24}
    for t in (3, 4):
        response = client.post("/annotations", json={
            "image_id": oid, "index": {"t": t}, "primitive": bbox,
        })
        assert response.status_code == 201, response.text
        assert response.json()["annotation"]["index"] == {"t": t}
    mask_bytes = io.BytesIO()
    Image.new("L", (W, H), 0).save(mask_bytes, format="PNG")
    response = client.post("/annotations", json={
        "image_id": oid, "index": {"t": 3}, "primitive": {"kind": "mask"},
        "mask_png_b64": base64.b64encode(mask_bytes.getvalue()).decode(),
    })
    assert response.status_code == 201, response.text
    assert response.json()["annotation"]["index"] == {"t": 3}
    ann_router._stores.clear()  # 模拟刷新重开
    frame3 = client.get("/annotations", params={"image_id": oid, "index_from": 3, "index_to": 3})
    frame4 = client.get("/annotations", params={"image_id": oid, "index_from": 4, "index_to": 4})
    assert frame3.status_code == frame4.status_code == 200
    assert len(frame3.json()["annotations"]) == 2
    assert {a["primitive"]["kind"] for a in frame3.json()["annotations"]} == {"bbox", "mask"}
    assert len(frame4.json()["annotations"]) == 1
    assert all(a["index"] == {"t": 3} for a in frame3.json()["annotations"])
    ann_router._stores.clear()
