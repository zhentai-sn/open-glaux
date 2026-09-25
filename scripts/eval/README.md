# scripts/eval — 视频评测数据准备

计划见 [视频评测计划：TennisTV 与 BARD](../../docs/plans/2026-09-25-video-eval-tennistv-bard-plan.md)。数据写到 `data/eval/`，该目录被 `.gitignore` 忽略；视频只在本机使用，不入库、不再分发。

## TennisTV

`tennistv.py` 用后端虚拟环境运行，依赖 PyAV，不需要 ffmpeg。

```bash
backend/.venv/bin/python scripts/eval/tennistv.py selftest
backend/.venv/bin/python scripts/eval/tennistv.py questions
backend/.venv/bin/python scripts/eval/tennistv.py plan --top 3
backend/.venv/bin/python scripts/eval/tennistv.py download
backend/.venv/bin/python scripts/eval/tennistv.py slice
backend/.venv/bin/python scripts/eval/tennistv.py manifest
```

| 子命令 | 作用 | 产物 |
| --- | --- | --- |
| `selftest` | 用合成视频检查按帧切片：帧数、首帧、音频时长 | 无 |
| `questions` | 拉取 ModelScope 的 8 个题目文件和 F3Set 的 `videos.csv` | `benchmark/*.json`、`benchmark/videos.csv` |
| `plan` | 按题量给比赛排序；`--matches` 可直接指定比赛 | `selection.json` |
| `download` | 缺省只打印 yt-dlp 命令；加 `--run` 才执行。视频流和音频流分开下载 | `raw/<比赛>.video.mp4`、`raw/<比赛>.audio.m4a` |
| `slice` | 按 `[起始帧, 结束帧)` 切片，输出 H.264/AAC MP4；先核对原片是 25 fps 且时长足够 | `clips/<比赛>_<起始帧>_<结束帧>.mp4` |
| `manifest` | 只收录已切出片段的题目；MGG 题附 `gold_interval_ms` | `manifest.jsonl` |

题目格式：

- 选项有三种写法：字母编号、HO 的数字编号（`1. in 2. under the net 3. out`）、PWTF 的判断题（`T`/`F`）。脚本统一解析为 `options` 字典。
- MGG 的选项是片段内的秒数区间，从片段第一帧起算。

YouTube 下载：

- 需要 yt-dlp，以及它解析 YouTube 所需的 JS 运行时。yt-dlp 默认只启用 deno；用 node 时加 `--js-runtimes node`。
- 音频只取标为 `original` 的音轨。YouTube 常附带多条自动配音音轨，选错会丢掉现场原声和解说。
- yt-dlp 装在 Windows 侧时，不能直接写 `\\wsl.localhost` 路径：先下载到 Windows 本地目录，再移进 `data/eval/tennistv/raw/`。文件名与 `download` 打印的一致。
- 下载不到的视频可以向 F3Set 作者索取。
