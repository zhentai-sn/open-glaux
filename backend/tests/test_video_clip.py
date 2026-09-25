"""SDD 11：视频上传校验、原声短片段与按时间取帧（§9、§13、§15）。

样例全部用 PyAV 合成：第 i 帧为灰度 ``_level(i)`` 的纯色帧，解出的像素值即可反推帧号；
时间戳以毫秒时间基显式给出，用来构造非零起始 PTS、可变帧率与长 GOP（非关键帧起点）。
"""

from __future__ import annotations

import hashlib
import io
import json
from fractions import Fraction
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app import config, dataset_video, datasource_detect, video_clip
from app import datasource_registry as reg
from app.main import app

av = pytest.importorskip("av")
np = pytest.importorskip("numpy")

client = TestClient(app)

W, H = 64, 48
MS = Fraction(1, 1000)


def _level(i: int) -> int:
    return (i * 20) % 256


def write_video(
    path: Path,
    pts_ms: list[int],
    *,
    codec: str = "libx264",
    gop: int | None = None,
    audio: str | None = None,
) -> None:
    """按给定毫秒时间戳写视频；``audio`` 为音频编码名（与视频同起点、同长度的正弦）。"""
    with av.open(str(path), "w") as c:
        vs = c.add_stream(codec, rate=30)
        vs.width, vs.height, vs.pix_fmt = W, H, "yuv420p"
        vs.codec_context.time_base = MS
        if gop is not None:
            vs.codec_context.gop_size = gop
            vs.options = {"g": str(gop), "keyint_min": str(gop), "sc_threshold": "0", "bf": "0"}
        a = None
        if audio is not None:
            a = c.add_stream(audio, rate=48000 if audio == "libopus" else 16000)
            a.layout = "mono"
        for i, p in enumerate(pts_ms):
            frame = av.VideoFrame.from_ndarray(np.full((H, W, 3), _level(i), np.uint8), "rgb24")
            frame.pts, frame.time_base = p, MS
            for pkt in vs.encode(frame):
                c.mux(pkt)
        for pkt in vs.encode():
            c.mux(pkt)
        if a is not None:
            rate = a.codec_context.sample_rate
            start = pts_ms[0] * rate // 1000
            total = (pts_ms[-1] + 100) * rate // 1000
            pts, block = start, 960
            fmt = "s16" if audio == "libopus" else "fltp"
            while pts < total:
                samples = np.sin(np.arange(pts, pts + block) / 10.0) * 0.3
                data = (
                    (samples * 32767).astype(np.int16)
                    if fmt == "s16"
                    else samples.astype(np.float32)
                )
                af = av.AudioFrame.from_ndarray(data.reshape(1, -1), format=fmt, layout="mono")
                af.sample_rate, af.pts, af.time_base = rate, pts, Fraction(1, rate)
                for pkt in a.encode(af):
                    c.mux(pkt)
                pts += block
            for pkt in a.encode():
                c.mux(pkt)


def _regular(n: int, *, start: int = 0, step: int = 100) -> list[int]:
    return [start + i * step for i in range(n)]


#: 可变帧率：间隔 33～400 ms 不等，含 250/260 这样远小于平均周期的相邻帧。
VFR_PTS = [0, 33, 100, 250, 260, 500, 900, 1000, 1400, 1450]


@pytest.fixture
def library(tmp_path, monkeypatch):
    """导入一个 video 源，返回 {样本名: 对象 id} 与源文件路径。"""
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    reg.init()
    folder = tmp_path / "clips"
    folder.mkdir()
    samples = {
        "av": dict(pts_ms=_regular(30), audio="aac"),
        "silent": dict(pts_ms=_regular(30)),
        "offset": dict(pts_ms=_regular(30, start=2000), audio="aac"),
        "vfr": dict(pts_ms=VFR_PTS),
        "longgop": dict(pts_ms=_regular(30), gop=30),
    }
    for name, kw in samples.items():
        write_video(folder / f"{name}.mp4", **kw)
    src = reg.register_folder(folder, "video", detect=datasource_detect.detect)
    yield {
        "ids": {n: dataset_video.object_id(src.id, f"{n}.mp4") for n in samples},
        "paths": {n: folder / f"{n}.mp4" for n in samples},
    }
    reg._SOURCES.clear()
    reg.invalidate_index()


def _clip(object_id: str, start_ms: int, end_ms: int, **extra):
    return client.get(
        f"/objects/{object_id}/clip", params={"start_ms": start_ms, "end_ms": end_ms, **extra}
    )


def _decoded_levels(body: bytes) -> list[int]:
    with av.open(io.BytesIO(body)) as c:
        return [
            int(round(float(np.asarray(f.to_image().convert("L")).mean())))
            for f in c.decode(c.streams.video[0])
        ]


def _audio_streams(body: bytes) -> int:
    with av.open(io.BytesIO(body)) as c:
        return len(c.streams.audio)


# --- 对象元数据 ---------------------------------------------------------------


def test_meta_declares_clip_template_and_duration(library):
    meta = client.get(f"/objects/{library['ids']['offset']}").json()
    assert meta["resources"]["clip"] == (
        f"/objects/{library['ids']['offset']}/clip?start_ms={{start_ms}}&end_ms={{end_ms}}"
    )
    # 非零起始 PTS 不计入时长：时长从首帧 PTS 起算
    assert meta["meta"]["duration_ms"] == 3000


# --- 片段：头部、时间映射与音轨 ---------------------------------------------------


def test_clip_header_is_complete_and_matches_body(library):
    r = _clip(library["ids"]["av"], 1000, 2000)
    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "video/mp4"
    raw = r.headers["x-glaux-clip"]
    header = json.loads(raw)
    assert set(header) == {
        "object_id", "source_sha256", "requested_interval", "actual_interval",
        "mime", "clip_sha256", "encoding",
    }
    assert len(raw) < 2048  # 头部只放短元数据，不含 Base64
    assert header["clip_sha256"] == hashlib.sha256(r.content).hexdigest()
    assert header["source_sha256"] == hashlib.sha256(
        library["paths"]["av"].read_bytes()
    ).hexdigest()
    assert header["requested_interval"] == {"start_ms": 1000, "end_ms": 2000}
    assert header["encoding"]["audio"] == "aac"


def test_clip_keeps_audio_only_when_source_has_it(library):
    with_audio = _clip(library["ids"]["av"], 0, 1000)
    silent = _clip(library["ids"]["silent"], 0, 1000)
    assert _audio_streams(with_audio.content) == 1
    assert _audio_streams(silent.content) == 0
    assert json.loads(silent.headers["x-glaux-clip"])["encoding"]["audio"] is None


def _assert_within_tolerance(header: dict, frame_period_ms: float) -> None:
    req, act = header["requested_interval"], header["actual_interval"]
    assert req["start_ms"] <= act["start_ms"] < act["end_ms"] <= req["end_ms"]
    assert act["start_ms"] - req["start_ms"] <= max(100, frame_period_ms)
    assert req["end_ms"] - act["end_ms"] <= 100


def test_clip_maps_non_zero_start_pts_to_source_time(library):
    """源首帧 PTS=2000 ms：区间以首帧为零点，1000..2000 对应第 10～19 帧。"""
    r = _clip(library["ids"]["offset"], 1000, 2000)
    assert r.status_code == 200, r.text
    header = json.loads(r.headers["x-glaux-clip"])
    _assert_within_tolerance(header, 100)
    levels = _decoded_levels(r.content)
    assert levels[0] == pytest.approx(_level(10), abs=3)
    assert _audio_streams(r.content) == 1


def test_clip_from_non_keyframe_start_drops_preroll(library):
    """整段只有首帧是关键帧：从 1500 ms 起取，片段首帧必须是第 15 帧而非 GOP 起点。"""
    r = _clip(library["ids"]["longgop"], 1500, 2500)
    assert r.status_code == 200, r.text
    _assert_within_tolerance(json.loads(r.headers["x-glaux-clip"]), 100)
    levels = _decoded_levels(r.content)
    assert levels[0] == pytest.approx(_level(15), abs=3)
    assert all(level != pytest.approx(_level(0), abs=3) for level in levels)


def test_clip_on_variable_frame_rate_stays_inside_request(library):
    r = _clip(library["ids"]["vfr"], 240, 950)
    assert r.status_code == 200, r.text
    header = json.loads(r.headers["x-glaux-clip"])
    _assert_within_tolerance(header, 150)
    assert header["actual_interval"]["start_ms"] == 250
    assert _decoded_levels(r.content)[0] == pytest.approx(_level(3), abs=3)


def test_clip_rejects_when_boundary_frame_is_too_far(library):
    """VFR 样本 500→900 ms 间隔 400 ms：从 510 起取时首帧偏移超出容差，必须拒绝而非谎报精确时间。"""
    r = _clip(library["ids"]["vfr"], 510, 890)
    assert r.status_code == 422


# --- 片段：拒绝路径 --------------------------------------------------------------


@pytest.mark.parametrize(
    ("start_ms", "end_ms"),
    [(-1, 500), (500, 500), (800, 400), (0, 3001), (0, 60_001)],
)
def test_clip_rejects_illegal_interval(library, start_ms, end_ms):
    assert _clip(library["ids"]["av"], start_ms, end_ms).status_code == 422


def test_clip_over_byte_budget_is_rejected_not_truncated(library, monkeypatch):
    monkeypatch.setattr(video_clip, "MAX_CLIP_BYTES", 1024)
    r = _clip(library["ids"]["av"], 0, 3000)
    assert r.status_code == 413
    assert "clip_too_large" in r.json()["detail"]


def test_clip_budget_fits_qwen_base64_limit():
    """6 MiB 原始片段的 Base64 长度严格小于 10 MB（SDD 11 D-12）。"""
    assert video_clip.MAX_CLIP_BYTES == 6 * 1024 * 1024
    assert (video_clip.MAX_CLIP_BYTES + 2) // 3 * 4 < 10_000_000
    assert video_clip.MAX_CLIP_MS == 60_000


def test_clip_and_frame_reject_changed_source_fingerprint(library):
    oid = library["ids"]["av"]
    assert _clip(oid, 0, 500, source_sha256="0" * 64).status_code == 409
    r = client.get(
        f"/objects/{oid}/frame-at", params={"time_ms": 0, "source_sha256": "0" * 64}
    )
    assert r.status_code == 409


def test_missing_source_file_is_404(library):
    oid = library["ids"]["silent"]
    library["paths"]["silent"].unlink()
    dataset_video.SOURCE.invalidate()
    assert _clip(oid, 0, 500).status_code == 404


# --- 按时间取帧 --------------------------------------------------------------------


def _frame_at(object_id: str, time_ms: int):
    r = client.get(f"/objects/{object_id}/frame-at", params={"time_ms": time_ms})
    assert r.status_code == 200, r.text
    level = int(round(float(np.asarray(Image.open(io.BytesIO(r.content)).convert("L")).mean())))
    return r, level


@pytest.mark.parametrize(
    ("time_ms", "t"),
    [(0, 0), (30, 1), (240, 3), (258, 4), (262, 4), (700, 5), (1420, 8), (1440, 9)],
)
def test_frame_at_uses_source_pts_on_variable_frame_rate(library, time_ms, t):
    """最近帧按源 PTS 判定，解出的像素必须属于该帧，不按平均帧率换算。"""
    r, level = _frame_at(library["ids"]["vfr"], time_ms)
    assert int(r.headers["x-glaux-frame-time"]) == VFR_PTS[t]
    assert json.loads(r.headers["x-glaux-frame"])["index"]["t"] == t
    assert level == pytest.approx(_level(t), abs=3)
    tolerance = int(r.headers["x-glaux-frame-tolerance"])
    assert tolerance >= 100 and abs(VFR_PTS[t] - time_ms) <= tolerance


def test_frame_at_offsets_non_zero_start_pts(library):
    r, level = _frame_at(library["ids"]["offset"], 1000)
    assert int(r.headers["x-glaux-frame-time"]) == 1000
    assert level == pytest.approx(_level(10), abs=3)


def test_frame_at_rejects_time_outside_duration(library):
    oid = library["ids"]["av"]
    assert client.get(f"/objects/{oid}/frame-at", params={"time_ms": 3000}).status_code == 422
    assert client.get(f"/objects/{oid}/frame-at", params={"time_ms": -1}).status_code == 422


# --- 上传受理 --------------------------------------------------------------------


@pytest.fixture
def upload_root(tmp_path, monkeypatch):
    monkeypatch.setenv("GLAUX_DATASETS_ROOT", str(tmp_path))
    monkeypatch.setenv("GLAUX_SOURCES_FILE", str(tmp_path / "sources.json"))
    reg.init()
    yield tmp_path
    reg._SOURCES.clear()
    reg.invalidate_index()


def _upload(name: str, files: list[tuple[str, bytes]]):
    return client.post(
        "/uploads/images",
        files=[("files", (fn, data, "application/octet-stream")) for fn, data in files],
        data={"name": name},
    )


def _leftovers(root: Path) -> list[str]:
    uploads = root / "uploads"
    return [p.name for p in uploads.rglob("*") if p.is_file()] if uploads.exists() else []


def test_upload_accepts_webm_with_opus_and_mp4_with_aac(upload_root, tmp_path):
    mp4, webm = tmp_path / "a.mp4", tmp_path / "b.webm"
    write_video(mp4, _regular(10), audio="aac")
    write_video(webm, _regular(10), codec="libvpx-vp9", audio="libopus")
    r = _upload("mixed-containers", [("a.mp4", mp4.read_bytes()), ("b.webm", webm.read_bytes())])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["source"]["modality"] == "video"
    assert [a["filename"] for a in body["accepted"]] == ["a.mp4", "b.webm"]
    for accepted in body["accepted"]:
        meta = client.get(f"/objects/{accepted['id']}").json()
        assert [s["kind"] for s in meta["streams"]] == ["audio"]


def test_upload_rejects_each_bad_video_without_half_objects(upload_root, tmp_path, monkeypatch):
    monkeypatch.setattr(dataset_video, "MAX_VIDEO_DURATION_MS", 1500)
    ok, long_, mpeg4 = tmp_path / "ok.mp4", tmp_path / "long.mp4", tmp_path / "mpeg4.mp4"
    write_video(ok, _regular(10))
    write_video(long_, _regular(20))
    write_video(mpeg4, _regular(10), codec="mpeg4")
    truncated = ok.read_bytes()[: len(ok.read_bytes()) // 3]
    r = _upload(
        "bad-videos",
        [
            ("ok.mp4", ok.read_bytes()),
            ("long.mp4", long_.read_bytes()),
            ("mpeg4.mp4", mpeg4.read_bytes()),
            ("broken.mp4", truncated),
        ],
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert [a["filename"] for a in body["accepted"]] == ["ok.mp4"]
    assert {x["filename"]: x["reason"] for x in body["rejected"]} == {
        "long.mp4": "duration_exceeded",
        "mpeg4.mp4": "unsupported_codec",
        "broken.mp4": "corrupt",
    }
    assert len(_leftovers(upload_root)) == 1  # 只有 ok.mp4 落盘，无临时文件残留


def test_upload_video_uses_its_own_byte_limit(upload_root, tmp_path, monkeypatch):
    clip = tmp_path / "c.mp4"
    write_video(clip, _regular(10))
    data = clip.read_bytes()
    monkeypatch.setattr(config, "UPLOAD_MAX_BYTES", 16)  # 图片上限不作用于视频
    monkeypatch.setattr(config, "VIDEO_UPLOAD_MAX_BYTES", len(data) - 1)
    r = _upload("too-big", [("c.mp4", data)])
    assert r.status_code == 422  # 全部被拒 → 不建数据源
    assert _leftovers(upload_root) == []
    monkeypatch.setattr(config, "VIDEO_UPLOAD_MAX_BYTES", len(data))
    assert _upload("fits", [("c.mp4", data)]).status_code == 200
