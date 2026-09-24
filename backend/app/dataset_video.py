"""视频（``video``）模态的数据轴——列举、元数据、音轨声明、逐帧解码（SDD 10 D-19、D-23）。

数据源是一个装着 mp4 / webm 文件的目录（上传或服务端导入）。对象 id 由服务端派生：
``vid-<源哈希8>-<源内相对文件名哈希8>``，客户端文件名不进路径（与 ``nat-`` 同一条防线）。

PyAV 是可选依赖（``pip install -e ".[video]"``），惰性导入：缺库时 ``probe`` 为 False，
``/datasources`` 标该源 unavailable，只在首次探测时记一条 info（SDD 10 §12）。

音轨只声明、不解释（§7 规则 22）：``meta()`` 解复用探测音频流，写进 ``streams[]`` 并下发
``resources.audio``；本模块不提供音频解码，取流形状由 SDD 11 冻结。
"""

from __future__ import annotations

import hashlib
import logging
from bisect import bisect_left
from functools import lru_cache
from pathlib import Path

from .datasource_registry import DataSource
from .schemas import Axis, Calibration, ObjectMeta, Stream
from .sources.base import SourceBase, resources_for

log = logging.getLogger("glaux.video")

MODALITY = "video"

_MIME = {".mp4": "video/mp4", ".webm": "video/webm"}
_UPLOAD_VIDEO_CODECS = {".mp4": {"h264"}, ".webm": {"vp8", "vp9"}}
_UPLOAD_AUDIO_CODECS = {".mp4": {"aac"}, ".webm": {"opus"}}
MAX_VIDEO_DURATION_MS = 600_000


class UnsupportedVideoCodec(ValueError):
    """容器可读取，但视频或音频编码不在 SDD 11 一期白名单。"""


class VideoDurationExceeded(ValueError):
    """视频时长超出 SDD 11 一期导入上限。"""


@lru_cache(maxsize=1)
def av_available() -> bool:
    try:
        import av  # noqa: F401
    except Exception as exc:  # noqa: BLE001 - 缺库或缺动态库
        log.info("PyAV 不可用，video 模态不可用：%s", exc)
        return False
    return True


def object_id(source_id: str, rel_name: str) -> str:
    """``vid-<源哈希8>-<相对文件名哈希8>``：同源同文件名恒得同 id。"""

    def h(text: str) -> str:
        return hashlib.sha1(text.encode("utf-8")).hexdigest()[:8]

    return f"vid-{h(source_id)}-{h(rel_name)}"


def _files(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(
        (p for p in root.iterdir() if p.is_file() and p.suffix.lower() in _MIME),
        key=lambda p: p.name,
    )


def _entries(source: DataSource) -> list[tuple[str, Path]]:
    return [(object_id(source.id, p.name), p) for p in _files(Path(source.root))]


def _path_of(source: DataSource, oid: str) -> Path:
    for candidate, path in _entries(source):
        if candidate == oid:
            return path
    raise FileNotFoundError(f"视频不存在：{oid}")


def _key(path: Path) -> tuple[str, int]:
    return str(path), path.stat().st_mtime_ns


@lru_cache(maxsize=128)
def _probe_file(path: str, mtime_ns: int) -> dict:
    """解复用读容器参数和源 PTS 范围（不解码画面）。"""
    import av

    try:
        with av.open(path) as container:
            if not container.streams.video:
                raise ValueError(f"无视频流：{Path(path).name}")
            vs = container.streams.video[0]
            rate = vs.average_rate or vs.guessed_rate
            if not rate:
                raise ValueError(f"帧率不可读：{Path(path).name}")
            first_ms: float | None = None
            end_ms: float | None = None
            frame_pts_ms: list[float] = []
            for packet in container.demux(vs):
                if not packet.size or packet.pts is None:
                    continue
                packet_base = packet.time_base or vs.time_base
                stamp = float(packet.pts * packet_base) * 1000
                frame_pts_ms.append(stamp)
                span = (
                    float(packet.duration * packet_base) * 1000
                    if packet.duration
                    else 1000.0 / float(rate)
                )
                first_ms = stamp if first_ms is None else min(first_ms, stamp)
                end_ms = stamp + span if end_ms is None else max(end_ms, stamp + span)
            if first_ms is None or end_ms is None or end_ms <= first_ms:
                raise ValueError(f"视频时长不可读：{Path(path).name}")
            duration_ms = round(end_ms - first_ms)
            frame_pts_ms.sort()
            info = {
                "width": int(vs.codec_context.width),
                "height": int(vs.codec_context.height),
                "fps": float(rate),
                "time_base": [vs.time_base.numerator, vs.time_base.denominator],
                "frames": len(frame_pts_ms),
                "frame_pts_ms": frame_pts_ms,
                "codec": vs.codec_context.name,
                "duration_ms": duration_ms,
                "first_pts_ms": first_ms,
                "audio": [],
            }
            for a in container.streams.audio:
                cc = a.codec_context
                duration_ms = (
                    round(float(a.duration * a.time_base) * 1000)
                    if a.duration is not None
                    else None
                )
                info["audio"].append(
                    {
                        "sample_rate": int(cc.sample_rate) if cc.sample_rate else None,
                        "channels": int(cc.layout.nb_channels) if cc.layout else None,
                        "duration_ms": duration_ms,
                        "codec": cc.name,
                    }
                )
    except av.error.FFmpegError as exc:
        raise ValueError(f"视频无法解析：{Path(path).name}（{exc}）") from exc
    if info["width"] <= 0 or info["height"] <= 0 or info["frames"] <= 0:
        raise ValueError(f"视频参数非法：{Path(path).name}")
    return info


def validate_upload(path: Path, ext: str) -> dict:
    """上传落盘前检查编码、时长及首个音画帧；拒绝原因由路由映射。"""
    import av

    info = _probe_file(*_key(path))
    if info["codec"] not in _UPLOAD_VIDEO_CODECS[ext]:
        raise UnsupportedVideoCodec(f"不支持的视频编码：{info['codec']}")
    if len(info["audio"]) > 1:
        raise UnsupportedVideoCodec("一期只支持一条音轨")
    if any(stream["codec"] not in _UPLOAD_AUDIO_CODECS[ext] for stream in info["audio"]):
        raise UnsupportedVideoCodec("不支持的音频编码")
    if info["duration_ms"] > MAX_VIDEO_DURATION_MS:
        raise VideoDurationExceeded(f"视频超过 {MAX_VIDEO_DURATION_MS // 1000} 秒")
    try:
        with av.open(str(path)) as container:
            next(container.decode(container.streams.video[0]))
    except (StopIteration, av.error.FFmpegError) as exc:
        raise ValueError("视频帧无法解码") from exc
    if info["audio"]:
        try:
            with av.open(str(path)) as container:
                next(container.decode(container.streams.audio[0]))
        except (StopIteration, av.error.FFmpegError) as exc:
            raise ValueError("音频帧无法解码") from exc
    return info


@lru_cache(maxsize=32)
def _decode(path: str, mtime_ns: int, t: int):
    """解出第 t 帧（呈现顺序）为 RGB PIL 图。按时间戳 seek 到前一关键帧再顺解。"""
    import av

    info = _probe_file(path, mtime_ns)
    target = info["frame_pts_ms"][t] / 1000
    half = 0.5 / info["fps"]
    last = None
    with av.open(path) as container:
        vs = container.streams.video[0]
        container.seek(
            max(0, int(target / vs.time_base)), stream=vs, backward=True, any_frame=False
        )
        for frame in container.decode(vs):
            last = frame
            if frame.time is not None and frame.time >= target - half:
                break
    if last is None:
        raise ValueError(f"第 {t} 帧解码失败：{Path(path).name}")
    return last.to_image().convert("RGB")


class VideoSource(SourceBase):
    modality = MODALITY
    kind = "video"
    label = "Video"
    formats = ((".mp4", b"ftyp", 4), (".webm", b"\x1a\x45\xdf\xa3", 0))
    caches = (_probe_file, _decode)

    def probe(self, root: Path) -> bool:
        return av_available() and bool(_files(root))

    def list_ids(self, source: DataSource) -> list[str]:
        if not av_available():
            return []
        out: list[str] = []
        for oid, path in _entries(source):
            try:
                _probe_file(*_key(path))
            except (ValueError, OSError):
                continue  # 损坏或无视频流的文件不进列表
            out.append(oid)
        return out

    def describe(self, source: DataSource, object_id: str) -> ObjectMeta:
        path = _path_of(source, object_id)
        info = _probe_file(*_key(path))
        streams = [Stream(kind="audio", **a) for a in info["audio"]]
        resources = resources_for(object_id, raw=True)
        resources["clip"] = f"/objects/{object_id}/clip?start_ms={{start_ms}}&end_ms={{end_ms}}"
        if streams:
            resources["audio"] = f"/objects/{object_id}/audio"
        return ObjectMeta(
            id=object_id,
            kind=self.kind,
            modality=self.modality,
            source_id=source.id,
            display_name=path.name,
            axes=[
                Axis(name="x", size=info["width"]),
                Axis(name="y", size=info["height"]),
                Axis(name="t", size=info["frames"], spacing=1000.0 / info["fps"], unit="ms"),
            ],
            calibration=Calibration(
                kind="time_base",
                value={"fps": info["fps"], "time_base": info["time_base"]},
                source="container",
            ),
            resources=resources,
            streams=streams,
            meta={
                "center": source.name,
                "codec": info["codec"],
                "duration_ms": info["duration_ms"],
            },
        )

    def render(self, source, object_id, index, window):
        path = _path_of(source, object_id)
        return _decode(*_key(path), index.t)

    def frame_at_time(
        self, source, object_id: str, time_ms: int, source_sha256: str | None = None
    ):
        from .schemas import Index
        from .video_clip import VideoSourceChanged, _source_sha256

        path = _path_of(source, object_id)
        if source_sha256 is not None:
            stat = path.stat()
            if _source_sha256(
                str(path), stat.st_mtime_ns, stat.st_size, stat.st_ctime_ns, stat.st_ino
            ) != source_sha256:
                raise VideoSourceChanged("视频源指纹已变化，旧证据不可回放")
        info = _probe_file(*_key(path))
        if not 0 <= time_ms < info["duration_ms"]:
            raise ValueError(f"时间须在 0..{info['duration_ms']} ms 内")
        target = info["first_pts_ms"] + time_ms
        pts = info["frame_pts_ms"]
        right = bisect_left(pts, target)
        index = min(
            range(max(0, right - 1), min(len(pts), right + 1)),
            key=lambda i: abs(pts[i] - target),
        )
        image, mime, frame = self.frame(source, object_id, Index(t=index), size=640)
        gaps = [
            abs(pts[index] - pts[neighbor])
            for neighbor in (index - 1, index + 1)
            if 0 <= neighbor < len(pts)
        ]
        tolerance_ms = max(100, round(max(gaps, default=100)))
        return image, mime, frame, round(pts[index] - info["first_pts_ms"]), tolerance_ms

    def raw(self, source, object_id):
        path = _path_of(source, object_id)
        return path, _MIME[path.suffix.lower()]

    def clip(
        self, source, object_id: str, start_ms: int, end_ms: int,
        source_sha256: str | None = None,
    ) -> tuple[bytes, dict]:
        import av

        from .video_clip import create_clip

        try:
            return create_clip(
                _path_of(source, object_id), object_id, start_ms, end_ms, source_sha256
            )
        except av.error.FFmpegError as exc:
            raise ValueError(f"音画片段生成失败：{exc}") from exc

    def detect_calibration(self, root: Path) -> dict:
        """第一段可解析视频的帧率 → {"fps": x}。读不出 → {}。"""
        if not av_available():
            return {}
        for path in _files(root):
            try:
                return {"fps": _probe_file(*_key(path))["fps"]}
            except (ValueError, OSError):
                continue
        return {}

    def derive_id(self, source: DataSource, rel_name: str) -> str:
        return object_id(source.id, rel_name)


SOURCE = VideoSource()
