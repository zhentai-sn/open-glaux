"""WSI 核检测子进程 driver（.venv-wsi/ 隔离环境执行）——StarDist-HE，模型-only。

主进程 (FastAPI / uvicorn) 通过 :mod:`backend.app.segment_wsi._run_live` 调起本脚本：

    .venv-wsi/bin/python segment_wsi_headless.py --workdir /tmp/wsiseg_xxx \
        --manifest /tmp/wsiseg_xxx/manifest.json --output /tmp/.../centroids.json \
        --method stardist_he

本脚本在隔离环境内**只**做模型部分（TF / StarDist 只存在于本 venv，主进程绝不 import）：
1. 读 manifest（patch png 列表 + 各 patch 的 ROI-local 原点 x0/y0）
2. 逐 patch 跑 StarDist ``2D_versatile_he`` → 每核质心（patch-local (y,x)）
3. 加 patch 原点 → ROI-local (x,y)，汇总写 centroids.json

**不**做 ROI 抽块 / 切 patch / 去重——那些确定性几何在主进程（可测；见 segment_wsi 注）。
本脚本也**不**做硬拒绝：失败由主进程验 centroids.json 缺失判定。类别无关模型 → class_id 恒 1。

退出码：0 = 成功；非 0 = 失败（stderr 被主进程 capture_output 捕获）。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description="StarDist-HE 核检测 driver (isolated venv)")
    p.add_argument("--workdir", required=True, help="patch png 所在目录")
    p.add_argument("--manifest", required=True, help="manifest.json：[{file,x0,y0}]")
    p.add_argument("--output", required=True, help="输出 centroids.json（ROI-local 坐标）")
    p.add_argument("--method", default="stardist_he")
    p.add_argument("--mpp", type=float, default=0.25,
                   help="slide 原生 MPP (µm/px)。模型按训练 MPP 重采样 patch 后推理，"
                        "质心再除以 scale 映回原生坐标——纠正放大倍率错配（低倍片欠检出）。")
    args = p.parse_args()

    # StarDist 2D_versatile_he 训练于 ~0.25 µm/px（40×）。slide 更粗（如 0.5=20×）时核显小、
    # 欠检出——按 scale=mpp/TARGET 上采样到训练 MPP 再推理，质心 /scale 映回。clamp 防极端。
    TARGET_MPP = 0.25
    scale = args.mpp / TARGET_MPP
    scale = min(4.0, max(0.5, scale))

    import numpy as np
    from PIL import Image

    # 重依赖只在隔离子进程 import（主进程绝不 import TF/StarDist）
    from csbdeep.utils import normalize
    from stardist.models import StarDist2D

    workdir = Path(args.workdir)
    manifest = json.loads(Path(args.manifest).read_text())

    model = StarDist2D.from_pretrained("2D_versatile_he")

    all_x: list[float] = []
    all_y: list[float] = []
    for entry in manifest:
        patch_path = workdir / entry["file"]
        x0 = float(entry["x0"])
        y0 = float(entry["y0"])
        img = np.asarray(Image.open(patch_path).convert("RGB"))
        if img.shape[0] < 2 or img.shape[1] < 2:
            continue
        # 组织掩膜：跳过背景/玻璃 patch（近白 = 无核）。WSI 标准做法——大切片绝大部分是背景，
        # 既大幅提速，又避开 StarDist ClipperLib 在退化（近白/平坦）输入上的 C++ terminate 崩溃
        # （std::terminate 会杀整个子进程，Python 抓不住，只能从源头不喂坏 patch）。
        gray = img.mean(axis=2)
        if gray.mean() > 220.0 or gray.std() < 5.0:
            continue
        # 按 scale 重采样到训练 MPP（放大倍率纠正）
        if scale != 1.0:
            new_wh = (max(2, round(img.shape[1] * scale)), max(2, round(img.shape[0] * scale)))
            img = np.asarray(Image.fromarray(img).resize(new_wh, Image.BILINEAR))
        # HE 模型吃 RGB；按通道分位归一化（csbdeep 惯例）
        img_norm = normalize(img, 1, 99.8, axis=(0, 1))
        try:
            _labels, details = model.predict_instances(img_norm)
        except Exception as e:  # noqa: BLE001 — Python 级错误跳过该 patch（C++ terminate 抓不住，靠上面组织掩膜避开）
            print(f"[segment_wsi_headless] patch {entry['file']} predict 失败跳过：{e}", file=sys.stderr)
            continue
        pts = details.get("points")  # (N, 2) 数组，(row=y, col=x)（重采样空间）
        if pts is None or len(pts) == 0:
            continue
        for row, col in pts:
            all_x.append(float(col) / scale + x0)  # 重采样空间 → patch-local(/scale) → ROI-local(+x0)
            all_y.append(float(row) / scale + y0)

    out = {
        "points": [[x, y] for x, y in zip(all_x, all_y)],
        "class_ids": [1] * len(all_x),  # StarDist-HE 类别无关 → 单类 nucleus
        "model_version": "StarDist 2D_versatile_he",
    }
    Path(args.output).write_text(json.dumps(out))
    print(f"[segment_wsi_headless] {len(manifest)} patches → {len(all_x)} raw centroids", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
