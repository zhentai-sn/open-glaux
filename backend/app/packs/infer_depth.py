"""深度估计子进程（SDD 25 §7.1 depth-dav2s）。

由 backend 以 vision-runtime 的解释器运行，**主进程不 import onnxruntime**：

    <runtime>/.venv/bin/python infer_depth.py <image> <model.onnx> <preprocessor.json> <out.json>

输出 JSON 含归一化统计与一张 8 位灰度深度图（base64 PNG），供工具回给模型查看。
"""

from __future__ import annotations

import base64
import io
import json
import sys
from pathlib import Path

import numpy as np


def _preprocess(image_path: str, mean: list[float], std: list[float], size: int) -> np.ndarray:
    from PIL import Image

    im = Image.open(image_path).convert("RGB").resize((size, size), Image.BICUBIC)
    x = np.asarray(im, dtype=np.float32) / 255.0
    x = (x - np.asarray(mean, dtype=np.float32)) / np.asarray(std, dtype=np.float32)
    return np.ascontiguousarray(x.transpose(2, 0, 1)[None])


def main(argv: list[str]) -> int:
    if len(argv) != 5:
        print(
            "usage: infer_depth.py <image> <model> <preprocessor.json> <out.json>",
            file=sys.stderr,
        )
        return 2
    image_path, model_path, cfg_path, out_path = argv[1], argv[2], argv[3], argv[4]

    cfg = json.loads(Path(cfg_path).read_text(encoding="utf-8"))
    size = int((cfg.get("size") or {}).get("height") or 518)
    mean = cfg.get("image_mean") or [0.485, 0.456, 0.406]
    std = cfg.get("image_std") or [0.229, 0.224, 0.225]

    import onnxruntime as ort

    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess = ort.InferenceSession(model_path, so, providers=["CPUExecutionProvider"])
    iname = sess.get_inputs()[0].name

    x = _preprocess(image_path, mean, std, size)
    pred = sess.run(None, {iname: x})[0]
    depth = np.asarray(pred, dtype=np.float32).reshape(-1)

    # 相对深度：按分位数拉伸到 0–255 生成可视图
    lo, hi = np.percentile(depth, 1.0), np.percentile(depth, 99.0)
    span = max(float(hi - lo), 1e-6)
    norm = np.clip((depth - lo) / span, 0.0, 1.0).reshape(int(np.sqrt(depth.size)), -1)
    gray = (norm * 255.0).astype(np.uint8)

    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(gray, mode="L").save(buf, format="PNG")
    preview = base64.b64encode(buf.getvalue()).decode("ascii")

    payload = {
        "input_size": [size, size],
        "depth": {
            "min": float(depth.min()),
            "max": float(depth.max()),
            "mean": float(depth.mean()),
            "median": float(np.median(depth)),
            "p01": float(lo),
            "p99": float(hi),
        },
        "near_ratio": float((norm < 0.33).mean()),
        "mid_ratio": float(((norm >= 0.33) & (norm < 0.66)).mean()),
        "far_ratio": float((norm >= 0.66).mean()),
        "preview_png_base64": preview,
    }
    Path(out_path).write_text(json.dumps(payload), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
