"""HC 端到端验证：真实 HC18 图 → CSM 隔离推理 → science-core 几何 → 报告。

跨全表均匀取样 N 张（覆盖 HC 量程，非挑选），逐图跑 run_headless 落盘预测，
再用 eval.hc_harness 汇总 Bland-Altman/MAE(mm) + Dice，打印并存 CSV。
"""
import csv
import subprocess
import sys
import time
from pathlib import Path

HOME = Path.home()
sys.path.insert(0, str(HOME / "code/pre-tech/open-glaux/science-core"))
from glaux_core.io.hc18 import Hc18Dataset  # noqa: E402
from eval.hc_harness import evaluate  # noqa: E402

DATA = HOME / "glaux_datasets/hc18_data"
WEIGHTS = HOME / "glaux_models/hc_seg/hf/test_model.pth"
DRIVER = HOME / "glaux_models/hc_seg/run_headless.py"
PY = HOME / "glaux_models/hc_seg/.venv-hc/bin/python"
OUT = HOME / "glaux_models/hc_seg_out"

N = int(sys.argv[1]) if len(sys.argv) > 1 else 80
ds = Hc18Dataset(DATA)
ids_all = ds.list_ids()
stride = max(1, len(ids_all) // N)
ids = ids_all[::stride][:N]
print(f"总图 {len(ids_all)}，均匀取样 {len(ids)}（stride={stride}）")

t0 = time.time()
fails = 0
for i, image_id in enumerate(ids, 1):
    r = subprocess.run([str(PY), str(DRIVER), str(ds.images_dir), str(OUT), str(WEIGHTS), image_id],
                       capture_output=True, text=True)
    if r.returncode != 0:
        fails += 1
        print(f"[{i}/{len(ids)}] FAIL {image_id}: {r.stderr.strip()[:70]}")
    elif i % 20 == 0:
        print(f"[{i}/{len(ids)}] ... {time.time()-t0:.0f}s")
print(f"推理完成：{len(ids)-fails}/{len(ids)} 成功，用时 {time.time()-t0:.0f}s")

agg, rows = evaluate(ds, OUT, ids, with_dice=True)
print("\n==== HC 端到端验证报告（真实 HC18 + CSM 真模型）====")
print(f"样本 n = {agg.n}")
print(f"Bias(pred-ref)   = {agg.bias_mm:+.2f} mm")
print(f"SD of diff       = {agg.sd_mm:.2f} mm")
print(f"95% LoA          = [{agg.loa_lower_mm:+.2f}, {agg.loa_upper_mm:+.2f}] mm")
print(f"MAE              = {agg.mae_mm:.2f} mm")
print(f"max |diff|       = {agg.max_abs_mm:.2f} mm")
print(f"mean Dice        = {agg.mean_dice:.4f}" if agg.mean_dice is not None else "mean Dice = n/a")

with open(OUT / "verify_report.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["id", "hc_pred_mm", "hc_ref_mm", "diff_mm", "dice"])
    w.writeheader()
    w.writerows(rows)
print(f"逐图明细已存：{OUT/'verify_report.csv'}")
