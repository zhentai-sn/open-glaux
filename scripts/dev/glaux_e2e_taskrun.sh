#!/usr/bin/env bash
set -e
cd /home/zhentai/code/pre-tech/open-glaux/backend
./.venv/bin/python - <<'PY'
from fastapi.testclient import TestClient
from app.main import app
import json
c = TestClient(app)
print("=== POST /task/run task=totalseg_liver_kidney image_id=ct_001 (frontend path) ===")
r = c.post("/task/run", json={"task":"totalseg_liver_kidney","image_id":"ct_001"})
print("status", r.status_code)
d = r.json()
prims = d.get("primitives", [])
print("primitives:", [ (p.get("kind"), p.get("id"), p.get("ref")) for p in prims ])
if prims:
    p0 = prims[0]
    print("classes:", [ (c["class_id"], c["role"], c["color"]) for c in p0.get("classes", []) ])
print("metrics keys:", list(d.get("metrics", {}).keys()))
print("model_version:", d.get("provenance", {}).get("model_version"))
PY
echo "=== DONE ==="
