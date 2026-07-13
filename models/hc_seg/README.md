# HC 分割隔离模型（CSM）— 运行时资产与部署

胎儿头围（HC）第二模态的**真实分割模型**运行时。与 caroSegDeep 一样，重后端（torch/cv2）
**隔离在独立子进程环境**，FastAPI 主进程绝不 import。本目录是**源的事实源**（driver + 验证脚本），
运行时部署到仓库外的 `~/glaux_models/hc_seg/`（venv、权重不入库，路径可经环境变量覆盖，见
`backend/app/config.py` 的 `GLAUX_HC_SEG_*` / `GLAUX_HC18_ROOT`）。

## 模型与数据来源

- **模型**：HuggingFace [`gauravxthakur/Fetal-Head-Biometry`](https://huggingface.co/gauravxthakur/Fetal-Head-Biometry)
  的 **CSM**（Convolutional Segmentation Machine），**Apache-2.0**。权重 `test_model.pth`（~547KB）。
  加载前已做**静态 pickle 操作码审查**：仅 `OrderedDict` / `torch FloatStorage` / `LongStorage` /
  `torch._utils._rebuild_tensor_v2`，无系统调用——纯 state_dict。
- **数据**：[HC18 挑战赛](https://zenodo.org/records/1327317)（Zenodo 1327317，**CC-BY-4.0**），
  999 图 + 椭圆真值标注 + 官方 pixel size / 参考头围 CSV。

## 一次性部署

```bash
# 1) 数据集
mkdir -p ~/glaux_datasets/hc18_data && cd ~/glaux_datasets/hc18_data
curl -sSL -o training_set.zip                     "https://zenodo.org/api/records/1327317/files/training_set.zip/content"
curl -sSL -o training_set_pixel_size_and_HC.csv   "https://zenodo.org/api/records/1327317/files/training_set_pixel_size_and_HC.csv/content"
unzip -q training_set.zip -d training_set

# 2) 隔离环境（torch-CPU + opencv）+ 权重
mkdir -p ~/glaux_models/hc_seg && cd ~/glaux_models/hc_seg
uv venv --python 3.12 .venv-hc
.venv-hc/bin/python -m pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv-hc/bin/python -m pip install numpy pillow opencv-python-headless
mkdir -p hf && cd hf
for f in modules.py test_model.pth; do curl -sSL "https://huggingface.co/gauravxthakur/Fetal-Head-Biometry/resolve/main/$f" -o "$f"; done

# 3) 部署 driver（本目录 → 运行时位置）
cp <repo>/models/hc_seg/run_headless.py ~/glaux_models/hc_seg/run_headless.py
```

## 推理管线（`run_headless.py`）

原图(灰度) → `img_crop` 居中裁 (512,768) → 缩放 (192,128)/255 → **CSM** → y3(32×48) 阈值
→ 最大连通域(填充头区) → Canny 边缘 → `u=16` 上采样回原图坐标。产出两份缓存供主进程（纯 numpy）读取：
`<id>-contour.txt`（颅骨轮廓点）与 `<id>-mask.png`（填充掩膜）。主进程 `fit_ellipse` → Ramanujan
周长 × pixel size = HC(mm)。

## 端到端验证（`verify_hc.py`）

```bash
~/glaux_models/hc_seg/.venv-hc/bin/python <repo>/models/hc_seg/verify_hc.py 80
```

跨全表均匀取样 80 图跑批，用 `science-core/eval/hc_harness.py` 出 Bland-Altman/MAE + Dice。
参考结果（2026-07-07，80 图）：**MAE 1.13mm · Bias +0.35mm · 95% LoA [-2.70,+3.39]mm ·
交付椭圆 vs GT Dice 0.982**。诚实边界：HC18 仅训练集有公开真值，验证在训练集图上进行。
