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
from functools import lru_cache
from pathlib import Path

from .datasource_registry import DataSource
from .schemas import Axis, Calibration, ObjectMeta, Stream
from .sources.base import SourceBase, resources_for

log = logging.getLogger("glaux.video")

MODALITY = "video"

_MIME = {".mp4": "video/mp4", ".webm": "video/webm"}


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
    """解复用读容器参数（不解码画面）。无视频流或读不出 → ValueError。"""
    import av

    try:
        with av.open(path) as container:
            if not container.streams.video:
                raise ValueError(f"无视频流：{Path(path).name}")
            vs = container.streams.video[0]
            rate = vs.average_rate or vs.guessed_rate
            if not rate:
                raise ValueError(f"帧率不可读：{Path(path).name}")
            info = {
                "width": int(vs.codec_context.width),
                "height": int(vs.codec_context.height),
                "fps": float(rate),
                "time_base": [vs.time_base.numerator, vs.time_base.denominator],
                "frames": int(vs.frames or 0),
                "codec": vs.codec_context.name,
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
            if info["frames"] <= 0:  # webm 等容器不记帧数：数视频包（只解复用，不解码）
                container.seek(0)
                info["frames"] = sum(1 for p in container.demux(vs) if p.size)
    except av.error.FFmpegError as exc:
        raise ValueError(f"视频无法解析：{Path(path).name}（{exc}）") from exc
    if info["width"] <= 0 or info["height"] <= 0 or info["frames"] <= 0:
        raise ValueError(f"视频参数非法：{Path(path).name}")
    return info


@lru_cache(maxsize=32)
def _decode(path: str, mtime_ns: int, t: int):
    """解出第 t 帧（呈现顺序）为 RGB PIL 图。按时间戳 seek 到前一关键帧再顺解。"""
    import av

    info = _probe_file(path, mtime_ns)
    target = t / info["fps"]
    half = 0.5 / info["fps"]
    last = None
    with av.open(path) as container:
        vs = container.streams.video[0]
        container.seek(int(target / vs.time_base), stream=vs, backward=True, any_frame=False)
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
            meta={"center": source.name, "codec": info["codec"]},
        )

    def render(self, source, object_id, index, window):
        path = _path_of(source, object_id)
        return _decode(*_key(path), index.t)

    def raw(self, source, object_id):
        path = _path_of(source, object_id)
        return path, _MIME[path.suffix.lower()]

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
