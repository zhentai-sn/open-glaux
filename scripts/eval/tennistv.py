"""TennisTV 评测数据准备：题目拉取、选场、下载、按帧切片、生成题目清单。

用后端虚拟环境运行（需要 PyAV）：
    backend/.venv/bin/python scripts/eval/tennistv.py <子命令>
计划见 docs/plans/2026-09-25-video-eval-tennistv-bard-plan.md。
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
from collections import Counter, defaultdict
from fractions import Fraction
from pathlib import Path

import av
import numpy as np

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data" / "eval" / "tennistv"
BENCH = DATA / "benchmark"
RAW = DATA / "raw"
CLIPS = DATA / "clips"
SELECTION = DATA / "selection.json"
MANIFEST = DATA / "manifest.jsonl"

TASKS = ("AR", "HD", "HO", "MGG", "PWTF", "RC", "TI", "TPP")
MODELSCOPE = "https://www.modelscope.cn/api/v1/datasets/FDUBay/TennisTV/repo?Revision=master&FilePath=benchmark/{}.json"
F3SET_CSV = "https://raw.githubusercontent.com/F3Set/F3Set/main/data/f3set-tennis/videos.csv"
FPS = 25
CLIP_RE = re.compile(r"^(?P<match>.+)_(?P<start>\d+)_(?P<end>\d+)$")
MGG_RE = re.compile(r"([\d.]+)\s*s to ([\d.]+)\s*s")


# ---------- 读取 ----------

def fetch(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as r:
        dest.write_bytes(r.read())


def load_questions() -> list[dict]:
    out = []
    for task in TASKS:
        path = BENCH / f"{task}.json"
        if not path.is_file():
            sys.exit(f"缺少 {path}，先运行 questions")
        for i, q in enumerate(json.loads(path.read_text())):
            m = CLIP_RE.match(q["video"])
            out.append({
                "id": f"{task}-{i:04d}", "task": task, "clip": q["video"],
                "match": m["match"], "start_frame": int(m["start"]), "end_frame": int(m["end"]),
                "question": q["Question"].strip(), "options": parse_options(q["Option"]),
                "answer": q["Answer"].strip(),
            })
    return out


def parse_options(text: str) -> dict[str, str]:
    """选项有三种写法：`A. x B. y`（HO 用 `1. x 2. y`），以及 PWTF 的 T/F 判断题。"""
    # 字母编号允许点后无空格（`D.Neither`）；数字编号必须带空格，避免吞掉 MGG 的 `1.88s`
    for pattern in (r"(?:^|\s)([A-F])\.\s*", r"(?:^|\s)([1-9])\.\s+"):
        parts = re.split(pattern, text.strip())
        if len(parts) > 1:
            return {parts[i]: parts[i + 1].strip() for i in range(1, len(parts) - 1, 2)}
    if "'T'" in text and "'F'" in text:
        return {"T": "True", "F": "False"}
    raise ValueError(f"无法解析选项：{text!r}")


def load_videos_csv() -> dict[str, dict]:
    with open(BENCH / "videos.csv", newline="") as f:
        return {row["video_name"]: row for row in csv.DictReader(f)}


def selected_matches() -> list[str]:
    if not SELECTION.is_file():
        sys.exit(f"缺少 {SELECTION}，先运行 plan")
    return [m["match"] for m in json.loads(SELECTION.read_text())["matches"]]


def raw_paths(match: str) -> tuple[Path | None, Path | None]:
    video = next(iter(sorted(RAW.glob(f"{match}.video.*"))), None)
    audio = next(iter(sorted(RAW.glob(f"{match}.audio.*"))), None)
    return video, audio


# ---------- 子命令 ----------

def cmd_questions(_: argparse.Namespace) -> None:
    for task in TASKS:
        fetch(MODELSCOPE.format(task), BENCH / f"{task}.json")
    fetch(F3SET_CSV, BENCH / "videos.csv")
    qs = load_questions()
    print(f"题目 {len(qs)} 道，片段 {len({q['clip'] for q in qs})} 个，比赛 {len({q['match'] for q in qs})} 场 → {BENCH}")


def cmd_plan(args: argparse.Namespace) -> None:
    qs, videos = load_questions(), load_videos_csv()
    per: dict[str, Counter] = defaultdict(Counter)
    for q in qs:
        per[q["match"]][q["task"]] += 1
    ranked = sorted(per, key=lambda m: (-sum(per[m].values()), m))
    if args.matches:
        ranked = [m for m in args.matches if m in per] or sys.exit("指定的比赛不在题目里")
    else:
        ranked = ranked[: args.top]
    rows = []
    for m in ranked:
        v = videos.get(m)
        if v is None:
            print(f"跳过 {m}：videos.csv 中没有")
            continue
        rows.append({"match": m, "yt_id": v["yt_id"], "fps": float(v["fps"]),
                     "resolution": v["resolution"], "questions": dict(per[m])})
    SELECTION.write_text(json.dumps({"matches": rows}, ensure_ascii=False, indent=1))
    total = Counter()
    for r in rows:
        total.update(r["questions"])
        print(f"{r['match']}  yt={r['yt_id']}  {sum(r['questions'].values())} 题  {r['questions']}")
    print(f"合计 {sum(total.values())} 题  {dict(total)} → {SELECTION}")


def ytdlp_cmds(match: str, yt_id: str, ytdlp: str) -> list[list[str]]:
    url = f"https://www.youtube.com/watch?v={yt_id}"
    base = [*ytdlp.split(), "--no-playlist", "--no-part"]
    return [
        [*base, "-f", "bv*[height=720][fps=25][ext=mp4]/bv*[height=720][fps=25]",
         "-o", str(RAW / f"{match}.video.%(ext)s"), url],
        # YouTube 常带多条自动配音音轨，只取标为 original 的原声
        [*base, "-f", "ba[ext=m4a][format_note*=original]/ba[format_note*=original]/ba[ext=m4a]",
         "-o", str(RAW / f"{match}.audio.%(ext)s"), url],
    ]


def cmd_download(args: argparse.Namespace) -> None:
    RAW.mkdir(parents=True, exist_ok=True)
    rows = json.loads(SELECTION.read_text())["matches"] if SELECTION.is_file() else sys.exit("先运行 plan")
    ytdlp = args.ytdlp or ("yt-dlp" if shutil.which("yt-dlp") else None)
    for r in rows:
        video, audio = raw_paths(r["match"])
        if video and audio:
            print(f"已存在 {r['match']}")
            continue
        cmds = ytdlp_cmds(r["match"], r["yt_id"], ytdlp or "yt-dlp")
        if not args.run or ytdlp is None:
            print(f"# {r['match']}")
            for c in cmds:
                print(" ".join(f"'{x}'" if any(ch in x for ch in "[]*/?") else x for x in c))
            continue
        for c in cmds:
            subprocess.run(c, check=True)
    if not args.run or ytdlp is None:
        print("\n以上为下载命令，未执行。确认后加 --run 执行，或手动运行后把文件放进", RAW)


def cmd_slice(args: argparse.Namespace) -> None:
    CLIPS.mkdir(parents=True, exist_ok=True)
    qs = load_questions()
    for match in selected_matches():
        video, audio = raw_paths(match)
        if video is None:
            print(f"跳过 {match}：缺少原片（{RAW}/{match}.video.*）")
            continue
        clips = sorted({(q["start_frame"], q["end_frame"], q["clip"]) for q in qs if q["match"] == match})
        check_source(video, clips[-1][1])
        done = 0
        for start, end, clip in clips:
            dest = CLIPS / f"{clip}.mp4"
            if dest.is_file() and not args.force:
                continue
            slice_clip(video, audio or video, start, end, dest)
            done += 1
        print(f"{match}：{len(clips)} 个片段，本次切出 {done} 个")


def cmd_manifest(_: argparse.Namespace) -> None:
    qs, n = load_questions(), 0
    with MANIFEST.open("w") as f:
        for q in qs:
            path = CLIPS / f"{q['clip']}.mp4"
            if not path.is_file():
                continue
            row = {**q, "clip_path": str(path.relative_to(REPO)),
                   "duration_ms": round((q["end_frame"] - q["start_frame"]) * 1000 / FPS)}
            if q["task"] == "MGG":
                a, b = MGG_RE.search(q["options"][q["answer"]]).groups()
                row["gold_interval_ms"] = [round(float(a) * 1000), round(float(b) * 1000)]
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            n += 1
    print(f"题目清单 {n} 道 → {MANIFEST}")


# ---------- 切片 ----------

def check_source(video: Path, last_end_frame: int) -> None:
    with av.open(str(video)) as c:
        s = c.streams.video[0]
        rate = float(s.average_rate or 0)
        dur = float(c.duration / av.time_base) if c.duration else 0.0
    if abs(rate - FPS) > 0.01:
        sys.exit(f"{video.name} 帧率 {rate}，题目按 {FPS} fps 标注，帧号会错位")
    if dur * FPS < last_end_frame:
        sys.exit(f"{video.name} 时长 {dur:.0f}s 不足以覆盖第 {last_end_frame} 帧，版本可能不同")


def slice_clip(video: Path, audio: Path, start: int, end: int, dest: Path) -> None:
    """切出 [start, end) 帧，片段时间从 0 开始，音频按采样点对齐到同一区间。"""
    t0, t1 = start / FPS, end / FPS
    tmp = dest.with_suffix(".part.mp4")
    with av.open(str(tmp), "w") as out:
        with av.open(str(video)) as vin:
            vs = vin.streams.video[0]
            ov = out.add_stream("libx264", rate=FPS)
            ov.width, ov.height, ov.pix_fmt = vs.codec_context.width, vs.codec_context.height, "yuv420p"
            ov.options = {"crf": "20", "preset": "veryfast"}
            with av.open(str(audio)) as ain:
                oa = None
                if ain.streams.audio:
                    oa = out.add_stream("aac", rate=48000, layout="stereo")
                n = write_video(vin, vs, ov, out, start, end)
                if oa is not None:
                    write_audio(ain, ain.streams.audio[0], oa, out, t0, t1)
    if n != end - start:
        tmp.unlink(missing_ok=True)
        sys.exit(f"{dest.name}：期望 {end - start} 帧，实际 {n} 帧")
    tmp.replace(dest)


def write_video(vin, vs, ov, out, start: int, end: int) -> int:
    base = vs.start_time or 0
    vin.seek(int((start / FPS) / vs.time_base) + base, stream=vs, backward=True)
    n = 0
    for frame in vin.decode(vs):
        idx = round(float((frame.pts - base) * vs.time_base) * FPS)
        if idx < start:
            continue
        if idx >= end:
            break
        f = frame.reformat(format="yuv420p")
        f.pts, f.time_base = n, Fraction(1, FPS)
        out.mux(ov.encode(f))
        n += 1
    out.mux(ov.encode())
    return n


def write_audio(ain, as_, oa, out, t0: float, t1: float) -> None:
    base = as_.start_time or 0
    ain.seek(int(t0 / as_.time_base) + base, stream=as_, backward=True)
    resampler = av.AudioResampler(format="fltp", layout="stereo", rate=48000, frame_size=1024)
    written = 0

    def emit(frames) -> None:
        nonlocal written
        for rf in frames:
            rf.pts, rf.time_base = written, Fraction(1, 48000)
            written += rf.samples
            out.mux(oa.encode(rf))

    for frame in ain.decode(as_):
        fs = float((frame.pts - base) * as_.time_base)
        fe = fs + frame.samples / frame.sample_rate
        if fe <= t0:
            continue
        if fs >= t1:
            break
        a = max(0, round((t0 - fs) * frame.sample_rate))
        b = min(frame.samples, round((t1 - fs) * frame.sample_rate))
        if b <= a:
            continue
        arr = frame.to_ndarray()
        planar = frame.format.is_planar
        part = arr[:, a:b] if planar else arr[:, a * len(frame.layout.channels):b * len(frame.layout.channels)]
        nf = av.AudioFrame.from_ndarray(np.ascontiguousarray(part), format=frame.format.name, layout=frame.layout.name)
        nf.sample_rate = frame.sample_rate
        emit(resampler.resample(nf))
    emit(resampler.resample(None))
    out.mux(oa.encode())


# ---------- 自检 ----------

def cmd_selftest(_: argparse.Namespace) -> None:
    """合成 20 秒 25fps 视频流和 440Hz 音频流（分两个文件，同 download 的产物），
    切 [100, 350) 帧并核对帧数、时长和首帧亮度。"""
    with tempfile.TemporaryDirectory() as d:
        src, src_a, dst = Path(d) / "src.video.mp4", Path(d) / "src.audio.m4a", Path(d) / "clip.mp4"
        with av.open(str(src), "w") as out:
            ov = out.add_stream("libx264", rate=FPS)
            ov.width, ov.height, ov.pix_fmt = 320, 240, "yuv420p"
            for i in range(20 * FPS):
                img = np.full((240, 320, 3), i % 250, dtype=np.uint8)
                f = av.VideoFrame.from_ndarray(img, format="rgb24")
                f.pts, f.time_base = i, Fraction(1, FPS)
                out.mux(ov.encode(f))
            out.mux(ov.encode())
        with av.open(str(src_a), "w", format="mp4") as out:
            oa = out.add_stream("aac", rate=48000, layout="stereo")
            t = np.arange(20 * 48000) / 48000
            tone = (0.3 * np.sin(2 * np.pi * 440 * t)).astype(np.float32)
            for k in range(0, len(tone), 1024):
                chunk = np.stack([tone[k:k + 1024]] * 2)
                af = av.AudioFrame.from_ndarray(chunk, format="fltp", layout="stereo")
                af.sample_rate, af.pts, af.time_base = 48000, k, Fraction(1, 48000)
                out.mux(oa.encode(af))
            out.mux(oa.encode())
        slice_clip(src, src_a, 100, 350, dst)
        with av.open(str(dst)) as c:
            frames = list(c.decode(video=0))
            first = frames[0].to_ndarray(format="rgb24").mean()
        with av.open(str(dst)) as c:
            samples = sum(f.samples for f in c.decode(audio=0))
        checks = {
            "帧数 250": len(frames) == 250,
            "首帧亮度约 100": abs(first - 100) < 4,
            "音频约 10 秒": abs(samples / 48000 - 10) < 0.05,
        }
        for k, ok in checks.items():
            print(("通过 " if ok else "失败 ") + k)
        print(f"  帧数={len(frames)} 首帧亮度={first:.1f} 音频={samples / 48000:.3f}s")
        if not all(checks.values()):
            sys.exit(1)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("questions", help="拉取题目文件与 F3Set 视频清单")
    sp = sub.add_parser("plan", help="按题量选比赛，写 selection.json")
    sp.add_argument("--top", type=int, default=3)
    sp.add_argument("--matches", nargs="*", help="直接指定比赛名，覆盖 --top")
    sd = sub.add_parser("download", help="打印或执行 yt-dlp 下载命令")
    sd.add_argument("--run", action="store_true", help="执行下载；缺省只打印命令")
    sd.add_argument("--ytdlp", help="yt-dlp 调用方式，如 'yt-dlp --js-runtimes node'")
    ss = sub.add_parser("slice", help="按帧切出回合片段")
    ss.add_argument("--force", action="store_true", help="覆盖已存在的片段")
    sub.add_parser("manifest", help="生成题目清单 manifest.jsonl")
    sub.add_parser("selftest", help="用合成视频检查切片")
    args = p.parse_args()
    {"questions": cmd_questions, "plan": cmd_plan, "download": cmd_download,
     "slice": cmd_slice, "manifest": cmd_manifest, "selftest": cmd_selftest}[args.cmd](args)


if __name__ == "__main__":
    main()
