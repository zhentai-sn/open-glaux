#!/usr/bin/env bash
cd /home/zhentai/code/pre-tech/open-glaux/backend
./.venv/bin/python - <<'PY'
import traceback
from app import kernel
from app.schemas import TaskSpec
try:
    spec = TaskSpec(task="totalseg_liver_kidney", image_id="ct_001")
    out = kernel.run_task(spec)
    print("OK run_task; metrics:", list(out.get("metrics",{}).keys()), "prims:", [p.get("kind") for p in out.get("primitives",[])])
except Exception as e:
    traceback.print_exc()
PY
