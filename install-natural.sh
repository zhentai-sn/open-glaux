#!/usr/bin/env bash
# 联调脚手架:把自然图装进数据集,用于验证 agent→SAM 链路(SAM3 医学模态 0 命中,见 SDD 02 D-6)。
#
# id 用 tech_0450 / tech_0451(前导零):
#  - int("0450")=450 落在**默认**演示区间 401..500 内 —— 不依赖任何环境变量,重启不丢;
#  - 前导零让它们在 sorted() 里排到 tech_401 之前 —— 侧栏只渲染前 14 个,排后面看不到;
#  - 文件名与真实的 tech_450.tiff 不同,不覆盖任何东西。
set -e
D="$HOME/glaux_datasets/cubs_data/tech_extract/DATASET_CUBS_tech"
A="$HOME/code/pre-tech/open-glaux/docs/landing/assets"
cd ~/code/pre-tech/open-glaux/backend

# 清掉上一轮的命名
rm -f "$D"/images/tech_00901.tiff "$D"/images/tech_00902.tiff \
      "$D"/CF/tech_00901_CF.txt "$D"/CF/tech_00902_CF.txt \
      "$D"/images/tech_901.tiff "$D"/images/tech_902.tiff \
      "$D"/CF/tech_901_CF.txt "$D"/CF/tech_902_CF.txt

put() { # $1=源 $2=id $3=可用 prompt
  .venv/bin/python - "$1" "$D/images/$2.tiff" <<'PY'
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
im.save(sys.argv[2])
print(f"  {sys.argv[2].split('/')[-1]:18s} {im.size[0]}x{im.size[1]}")
PY
  echo "0.048" > "$D/CF/$2_CF.txt"
  echo "                     试 prompt: $3"
}

echo "装入自然图(SAM3 已验证有命中):"
put "$A/hand.png" tech_0450 "hand"
put "$A/eye.png"  tech_0451 "eye"
echo
echo "回滚: rm $D/images/tech_045*.tiff $D/CF/tech_045*_CF.txt"
