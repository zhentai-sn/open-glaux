#!/usr/bin/env bash
cd /home/zhentai/code/pre-tech/open-glaux/backend
./.venv/bin/python - <<'PY'
import traceback
from app import kernel
from glaux_orchestrator.spec import TaskSpec
try:
    spec = TaskSpec(task="totalseg_liver_kidney", image_id="ct_001")
    det, cal = kernel._detect_for_spec(spec)
    print("OK detect:", det.model_version, "prims", len(det.primitives))
except Exception as e:
    traceback.print_exc()
PY
