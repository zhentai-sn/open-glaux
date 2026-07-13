"""caroSegDeep 真模型预测 vs A1 金标准——对齐口径（共同支撑 + 对称 PDM）。

读 science-core 外部产出的 caroSegDeep LI/MA + CUBS 真实 A1 + 真实 CF，
用 eval.agreement 复现 Bland-Altman，与已发布 caroSegDeep ~106±89µm 对表。
"""
import sys
from pathlib import Path

from eval.harness import agreement, bland_altman
from glaux_imt.io import cubs
from glaux_imt.io.boundaries import BoundaryPair
from glaux_imt.measurement.pdm import imt

CUBS = Path.home() / "cubs_data" / "tech_extract" / "DATASET_CUBS_tech"
CSD = Path.home() / "glaux_models" / "csd_out" / "Computerized-caroSegDeep"


def load_pair(method_dir: Path, image_id: str):
    li = method_dir / f"{image_id}-LI.txt"
    ma = method_dir / f"{image_id}-MA.txt"
    if not (li.is_file() and ma.is_file()):
        return None
    return BoundaryPair(li=cubs.read_profile(li, "LI"), ma=cubs.read_profile(ma, "MA"))


# 已完成的 caroSegDeep 预测
ids = sorted(p.name[: -len("-LI.txt")] for p in CSD.glob("*-LI.txt"))
print(f"[数据] caroSegDeep 预测 {len(ids)} 图")

csd, a1, cf = {}, {}, {}
for i in ids:
    cp = load_pair(CSD, i)
    ap = load_pair(CUBS / "LIMA-Profiles" / "Manual-A1", i)
    cfp = CUBS / "CF" / f"{i}_CF.txt"
    if cp is None or ap is None or not cfp.is_file():
        continue
    csd[i], a1[i], cf[i] = cp, ap, cubs.load_cf(cfp)

# 生理区间 sanity（caroSegDeep 自身 IMT，对称 PDM）
vals = [imt(csd[i].li, csd[i].ma, cf[i]).pdm_mean_mm for i in csd]
import statistics as st
print(f"[测量] caroSegDeep IMT(mm) n={len(vals)} min={min(vals):.3f} median={st.median(vals):.3f} "
      f"mean={st.mean(vals):.3f} max={max(vals):.3f}; 生理区间[0.3,2.0]内 {sum(0.3<=v<=2.0 for v in vals)}/{len(vals)}")

# 对齐口径 Bland-Altman：caroSegDeep vs A1
ba = agreement(csd, a1, cf)
print(f"\n[验证] caroSegDeep vs A1（共同支撑 + 对称 PDM，µm）:")
print(f"   n={ba.n}  bias={ba.bias_um:+.1f}  |bias|={ba.abs_bias_mean_um:.1f}  sd={ba.sd_um:.1f}  "
      f"LoA=[{ba.loa_lower_um:+.0f},{ba.loa_upper_um:+.0f}]")
print(f"   已发布参考：caroSegDeep/CREATIS ~106±89µm（|bias|），观察者内 160±140")
