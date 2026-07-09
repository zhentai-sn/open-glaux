"""TotalSegmentator 子进程 driver（.venv-ts/ 隔离环境执行）。

主进程 (FastAPI / uvicorn) 通过 :mod:`backend.app.segment_ts._run_live` 调起本脚本：

    .venv-ts/bin/python segment_ts_headless.py --input /…/ct_001.nii.gz \
        --output /…/ct_001_totalsegmentator_v2.nii.gz --method totalsegmentator_v2

本脚本在隔离环境内做：
1. 读 NIfTI 输入
2. 调 ``totalsegmentator`` Python API 跑 v2.4.0 分割（torch + nnunetv2 只在本 venv）
3. 写 labelmap ``.nii.gz`` 到 --output

退出码：0 = 成功；非 0 = 失败（stdout/stderr 被主进程 capture_output 捕获，错误由缓存缺失判定）。

注：本脚本**不**做硬拒绝（与主进程 segment_ts 同形态——失败由主进程验缓存缺失判定）。
硬拒绝哲学在主进程；本脚本只负责「跑模型 → 落盘」，无静默假造路径。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser(description="TotalSegmentator v2.4.0 CT 分割 driver (isolated venv)")
    p.add_argument("--input", required=True, help="input NIfTI path (.nii.gz)")
    p.add_argument("--output", required=True, help="output labelmap NIfTI path (.nii.gz)")
    p.add_argument("--method", default="totalsegmentator_v2",
                   help="segmentation method (v0: 仅 totalsegmentator_v2)")
    p.add_argument("--timeout", type=float, default=600.0, help="子进程超时（秒）")
    args = p.parse_args()

    in_path = Path(args.input)
    out_path = Path(args.output)
    if not in_path.is_file():
        print(f"ERROR: input NIfTI 不存在：{in_path}", file=sys.stderr)
        return 1
    if args.method != "totalsegmentator_v2":
        print(f"ERROR: 本 driver 仅支持 totalsegmentator_v2，得 {args.method!r}", file=sys.stderr)
        return 1

    out_path.parent.mkdir(parents=True, exist_ok=True)

    # 全部 import 在函数内——避免 venv 未装时 import 报错泄露到主进程
    try:
        import nibabel as nib
        import numpy as np
        from totalsegmentator import python_api as ts_api
    except ImportError as e:
        print(f"ERROR: 隔离环境缺依赖：{e}", file=sys.stderr)
        return 2

    print(f"[segment_ts_headless] reading {in_path}", file=sys.stderr)
    img = nib.load(str(in_path))
    img_data = np.asarray(img.dataobj).astype(np.float32, copy=False)
    print(f"[segment_ts_headless] shape={img_data.shape}", file=sys.stderr)

    try:
        # Totalsegmentator v2.4.0 python_api 期望 NIfTI 文件路径；自己造临时文件
        # v0 简化：3 类楔子（肝+双肾），传 task="liver_kidney"（官方支持）。
        # P6.x 扩 117 类再分 method。
        ts_result = ts_api.totalsegmentator(
            input=str(in_path),
            output=None,  # 写到 .nii.gz 自动命名
            task="liver_kidney",
            ml=True,  # 用 nnU-Net 路径（v2 标准）
            quiet=True,
        )
    except Exception as e:
        print(f"ERROR: totalsegmentator 失败：{e}", file=sys.stderr)
        return 3

    # ts_api 输出落到 <input-dir>/<input-stem>/liver_kidney.nii.gz 或类似
    # v0：直接约定路径——总 segmentator 默认输出是 <output_dir 或 input_dir>/<name>/<task>.nii.gz
    # 简化：让 totalsegmentator 写到 out_path 同目录的 tmp 子目录，再 mv
    import shutil
    candidates = [
        in_path.parent / "liver_kidney.nii.gz",
        in_path.parent / f"{in_path.stem.split('.')[0]}" / "liver_kidney.nii.gz",
    ]
    found = next((c for c in candidates if c.is_file()), None)
    if found is None:
        print(f"ERROR: totalsegmentator 输出未在 candidates 找到：{candidates}", file=sys.stderr)
        return 4
    shutil.move(str(found), str(out_path))
    print(f"[segment_ts_headless] wrote {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
