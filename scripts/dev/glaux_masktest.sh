#!/usr/bin/env bash
cd /home/zhentai/code/pre-tech/open-glaux/backend
./.venv/bin/python - <<'PY'
import base64, io, numpy as np, nibabel as nib
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app
from app import config, dataset_ct
c=TestClient(app)
vid="ct_001"; method="totalsegmentator_v2"
lbl=np.asarray(nib.load(str(config.TS_CACHE/f"{vid}_{method}.nii.gz")).dataobj).astype(int)
X,Y,Z=lbl.shape
best_z=max(range(Z), key=lambda z:(lbl[:,:,z]==1).sum())
liver_at_z=int((lbl[:,:,best_z]==1).sum())
print("shape(X,Y,Z):",lbl.shape,"best_z:",best_z,"liver@z:",liver_at_z)
sl=(lbl[:,:,best_z]==1)  # (X,Y)
img=Image.fromarray((sl.T*255).astype(np.uint8),mode="L")  # PIL (width=X,height=Y)
buf=io.BytesIO(); img.save(buf,format="PNG")
png="data:image/png;base64,"+base64.b64encode(buf.getvalue()).decode()
dataset_ct.reset_edit_seq(vid, method)
b=c.post(f"/volume/{vid}/mask-edit",json={"task":"totalseg_liver_kidney","slices":[]}).json()
print("liver BEFORE:",b["metrics"]["liver_volume_mm3"]["value"],"seq",b.get("seq"))
r=c.post(f"/volume/{vid}/mask-edit",json={"task":"totalseg_liver_kidney","method":method,"base_seq":b.get("seq"),
  "slices":[{"z":best_z,"class_id":1,"mode":"erase","mask_png_ref":png}]})
print("status:",r.status_code)
if r.status_code==200:
    d=r.json(); af=d["metrics"]["liver_volume_mm3"]["value"]
    print("liver AFTER:",af,"delta_mm3:",b["metrics"]["liver_volume_mm3"]["value"]-af,"expected~",liver_at_z*27)
else:
    print("body:",r.text[:300])
PY
