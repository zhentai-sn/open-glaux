#!/usr/bin/env bash
set -e
cd /home/zhentai/code/pre-tech/open-glaux/backend
./.venv/bin/python - <<'PY'
from fastapi.testclient import TestClient
from app.main import app
from app import config
print("CT_ROOT:", config.CT_ROOT, "exists:", config.CT_ROOT.is_dir())
print("TS_CACHE:", config.TS_CACHE, "labelmap:", (config.TS_CACHE/"ct_001_totalsegmentator_v2.nii.gz").is_file())
print("ts_live_available:", config.ts_live_available())
c = TestClient(app)

print("\n=== GET /volumes ===")
r = c.get("/volumes"); print(r.status_code, r.json())

print("\n=== GET /volume/ct_001 (NIfTI bytes) ===")
r = c.get("/volume/ct_001"); print(r.status_code, "bytes", len(r.content), "magic", r.content[:2].hex())

print("\n=== POST /volume/ct_001/segment (cache hit) ===")
r = c.post("/volume/ct_001/segment"); print(r.status_code, r.json())

print("\n=== POST /volume/ct_001/mask-edit (empty slices -> current metrics on REAL labelmap) ===")
r = c.post("/volume/ct_001/mask-edit", json={"task":"totalseg_liver_kidney","slices":[]})
print(r.status_code)
m = r.json()["metrics"]
for k in sorted(m):
    print(f"   {k} = {m[k]['value']:.1f} {m[k]['unit']}")
print("   seq =", r.json().get("seq"))

print("\n=== GET /volume/ct_001/verify (Dice vs ref == self -> 1.0) ===")
r = c.get("/volume/ct_001/verify?task=totalseg_liver_kidney")
print(r.status_code, r.json())

print("\n=== path-traversal guard (H2 fix): GET /volume/..%2f..%2fetc ===")
r = c.get("/volume/ct_999"); print("ct_999:", r.status_code)
PY
echo "=== E2E-BACKEND-DONE ==="
