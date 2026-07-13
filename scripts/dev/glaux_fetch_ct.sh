#!/usr/bin/env bash
set -e
cd /home/zhentai/code/pre-tech/open-glaux
url=$(curl -s --max-time 25 "https://api.github.com/repos/wasserth/TotalSegmentator/contents/tests/reference_files/example_ct.nii.gz" | grep '"download_url"' | head -1 | sed -E 's/.*"download_url": *"([^"]+)".*/\1/')
echo "download_url = $url"
curl -sL --max-time 120 -o data/ct/ct_001.nii.gz "$url"
ls -la data/ct/ct_001.nii.gz
science-core/.venv/bin/python - <<'PY'
import nibabel as nib, numpy as np
img = nib.load("data/ct/ct_001.nii.gz")
print("shape", img.shape, "zooms", img.header.get_zooms()[:3])
d=np.asarray(img.dataobj); print("dtype",d.dtype,"min/max",float(d.min()),float(d.max()))
PY
