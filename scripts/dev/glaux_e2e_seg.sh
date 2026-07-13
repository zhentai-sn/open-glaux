#!/usr/bin/env bash
set -e
REPO=/home/zhentai/code/pre-tech/open-glaux
TSPY=$HOME/glaux_models/totalseg/.venv-ts/bin/python
DRIVER=$HOME/glaux_models/totalseg/run_headless.py
OUT=$HOME/glaux_models/ts_out/ct_001_totalsegmentator_v2.nii.gz

echo "=== 1. run driver (first run downloads weights, then CPU inference) ==="
time $TSPY $DRIVER --input $REPO/data/ct/ct_001.nii.gz --output $OUT --method totalsegmentator_v2

echo "=== 2. inspect remapped labelmap ==="
$REPO/science-core/.venv/bin/python - "$OUT" <<'PY'
import sys, nibabel as nib, numpy as np
a = np.asarray(nib.load(sys.argv[1]).dataobj).astype(int)
u, c = np.unique(a, return_counts=True)
print("labels present:", dict(zip(u.tolist(), c.tolist())))
vox = 3*3*3
for cid, role in [(1,"liver"),(2,"lk"),(3,"rk")]:
    n = int((a==cid).sum())
    print(f"  {role}(id={cid}): {n} vox = {n*vox/1000:.1f} cm3")
PY

echo "=== 3. copy labelmap -> reproducibility reference ==="
cp $OUT $REPO/data/ct/ct_001_ref.nii.gz
ls -la $REPO/data/ct/
echo "=== E2E-SEG-DONE ==="
