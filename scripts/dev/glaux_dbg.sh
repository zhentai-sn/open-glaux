#!/usr/bin/env bash
cd /home/zhentai/code/pre-tech/open-glaux/backend
./.venv/bin/python - <<'PY'
from fastapi.testclient import TestClient
from app.main import app
c = TestClient(app)
r = c.post("/task/run", json={"task":"totalseg_liver_kidney","image_id":"ct_001"})
print("status", r.status_code)
print("detail:", r.json())
PY
