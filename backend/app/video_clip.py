"""SDD 11：从视频对象生成私有、带原声的短 MP4 观测。"""

from __future__ import annotations

import hashlib
import math
import tempfile
from fractions import Fraction
from functools import lru_cache
from pathlib import Path

from .dataset_video import _key, _probe_file

MAX_CLIP_MS = 60_000
MAX_CLIP_BYTES = 6 * 1024 * 1024
OUTPUT_FPS = 15
AUDIO_RATE = 16_000


class ClipTooLarge(ValueError):
    """片段无法完整编码到模型的单块媒体预算。"""


class VideoSourceChanged(ValueError):
    """旧证据指向的源文件已被覆盖。"""


@lru_cache(maxsize=64)
def _source_sha256(path: str, mtime_ns: int, size: int, ctime_ns: int, inode: int) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while chunk := source.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _even(value: int) -> int:
    return max(2, value - value % 2)


def _video_dimensions(width: int, height: int) -> tuple[int, int]:
    scale = min(1.0, 640 / max(width, height))
    return _even(round(width * scale)), _even(round(height * scale))


def _pts_ms(frame) -> float | None:
    return (
        float(frame.pts * frame.time_base) * 1000
        if frame.pts is not None and frame.time_base is not None
        else None
    )


def _encode_video(
    source_path: Path,
    output,
    stream,
    *,
    absolute_start_ms: float,
    absolute_end_ms: float,
    source_first_ms: float,
    frame_period_ms: float,
) -> tuple[int, int]:
    import av

    first_ms: float | None = None
    last_ms: float | None = None
    last_output_pts = -1
    with av.open(str(source_path)) as source:
        video = source.streams.video[0]
        source.seek(
            max(0, int(absolute_start_ms / 1000 / float(video.time_base))),
            stream=video,
            backward=True,
            any_frame=False,
        )
        for frame in source.decode(video):
            stamp = _pts_ms(frame)
            if stamp is None or stamp < absolute_start_ms:
                continue
            if stamp >= absolute_end_ms:
                break
            if first_ms is None:
                first_ms = stamp
                if stamp - absolute_start_ms > max(100.0, frame_period_ms):
                    raise ValueError("区间起点附近没有可用视频帧")
            output_pts = round((stamp - first_ms) * OUTPUT_FPS / 1000)
            if output_pts <= last_output_pts:
                continue
            encoded = frame.reformat(width=stream.width, height=stream.height, format="yuv420p")
            encoded.pts = output_pts
            encoded.time_base = Fraction(1, OUTPUT_FPS)
            for packet in stream.encode(encoded):
                output.mux(packet)
            last_output_pts = output_pts
            last_ms = stamp
    if first_ms is None or last_ms is None:
        raise ValueError("请求区间没有可解码视频帧")
    if absolute_end_ms - last_ms > max(100.0, frame_period_ms):
        raise ValueError("区间终点附近没有可用视频帧")
    for packet in stream.encode():
        output.mux(packet)
    return round(first_ms - source_first_ms), round(absolute_end_ms - source_first_ms)


def _encode_audio(
    source_path: Path,
    output,
    stream,
    *,
    absolute_start_ms: float,
    absolute_end_ms: float,
) -> None:
    import av

    resampler = av.AudioResampler(format="s16", layout="mono", rate=AUDIO_RATE)
    def encode_resampled(converted, fallback_ms: float) -> None:
        sample_start_ms = _pts_ms(converted)
        if sample_start_ms is None:
            sample_start_ms = fallback_ms
        data = converted.to_ndarray()
        count = converted.samples
        begin = max(0, math.ceil((absolute_start_ms - sample_start_ms) * AUDIO_RATE / 1000))
        end = min(count, math.floor((absolute_end_ms - sample_start_ms) * AUDIO_RATE / 1000))
        if end <= begin:
            return
        clipped = av.AudioFrame.from_ndarray(
            data[:, begin:end].copy(), format="s16", layout="mono"
        )
        clipped.sample_rate = AUDIO_RATE
        clipped.pts = round((sample_start_ms - absolute_start_ms) * AUDIO_RATE / 1000) + begin
        clipped.time_base = Fraction(1, AUDIO_RATE)
        for packet in stream.encode(clipped):
            output.mux(packet)

    last_stamp = absolute_start_ms
    with av.open(str(source_path)) as source:
        audio = source.streams.audio[0]
        source.seek(
            max(0, int(absolute_start_ms / 1000 / float(audio.time_base))),
            stream=audio,
            backward=True,
            any_frame=False,
        )
        for frame in source.decode(audio):
            stamp = _pts_ms(frame)
            if stamp is None:
                continue
            if stamp >= absolute_end_ms:
                break
            last_stamp = stamp
            for converted in resampler.resample(frame):
                encode_resampled(converted, stamp)
    for converted in resampler.resample(None):
        encode_resampled(converted, last_stamp)
    for packet in stream.encode():
        output.mux(packet)


def create_clip(
    path: Path, object_id: str, start_ms: int, end_ms: int, source_sha256: str | None = None
) -> tuple[bytes, dict]:
    """返回 MP4 正文和 X-Glaux-Clip 元数据；全部时间为源视频毫秒。"""
    import av

    info = _probe_file(*_key(path))
    duration_ms = info["duration_ms"]
    if not 0 <= start_ms < end_ms <= duration_ms or end_ms - start_ms > MAX_CLIP_MS:
        raise ValueError(f"片段区间须在 0..{duration_ms} ms 内且不超过 {MAX_CLIP_MS} ms")
    source_stat = path.stat()
    source_hash = _source_sha256(
        str(path), source_stat.st_mtime_ns, source_stat.st_size,
        source_stat.st_ctime_ns, source_stat.st_ino,
    )
    if source_sha256 is not None and source_sha256 != source_hash:
        raise VideoSourceChanged("视频源指纹已变化，旧证据不可回放")
    absolute_start_ms = info["first_pts_ms"] + start_ms
    absolute_end_ms = info["first_pts_ms"] + end_ms
    width, height = _video_dimensions(info["width"], info["height"])
    with tempfile.TemporaryDirectory(prefix="glaux-clip-") as directory:
        output_path = Path(directory) / "observation.mp4"
        with av.open(str(output_path), "w", format="mp4") as output:
            video = output.add_stream("libx264", rate=OUTPUT_FPS)
            video.width = width
            video.height = height
            video.pix_fmt = "yuv420p"
            video.bit_rate = 600_000
            video.options = {"preset": "veryfast"}
            audio = None
            if info["audio"]:
                audio = output.add_stream("aac", rate=AUDIO_RATE)
                audio.layout = "mono"
                audio.bit_rate = 64_000
            actual_start_ms, actual_end_ms = _encode_video(
                path,
                output,
                video,
                absolute_start_ms=absolute_start_ms,
                absolute_end_ms=absolute_end_ms,
                source_first_ms=info["first_pts_ms"],
                frame_period_ms=1000 / info["fps"],
            )
            if audio is not None:
                _encode_audio(
                    path,
                    output,
                    audio,
                    absolute_start_ms=info["first_pts_ms"] + actual_start_ms,
                    absolute_end_ms=absolute_end_ms,
                )
        if output_path.stat().st_size > MAX_CLIP_BYTES:
            raise ClipTooLarge("片段超过 6 MiB，请缩短观察区间")
        payload = output_path.read_bytes()
    header = {
        "object_id": object_id,
        "source_sha256": source_hash,
        "requested_interval": {"start_ms": start_ms, "end_ms": end_ms},
        "actual_interval": {"start_ms": actual_start_ms, "end_ms": actual_end_ms},
        "mime": "video/mp4",
        "clip_sha256": hashlib.sha256(payload).hexdigest(),
        "encoding": {
            "video": "h264",
            "width": width,
            "height": height,
            "max_fps": OUTPUT_FPS,
            "audio": "aac" if info["audio"] else None,
            "audio_rate": AUDIO_RATE if info["audio"] else None,
        },
    }
    return payload, header
