# P7 WSI 病理楔子 runbook — StarDist 细胞核检测 + 计数/密度

> 落地计划：[docs/plans/2026-07-10-001-feat-p7-wsi-nuclei-wedge-plan.md](../plans/2026-07-10-001-feat-p7-wsi-nuclei-wedge-plan.md)

## 一句话

病理全切片（WSI）第四模态：OpenSeadragon 深缩放浏览 `.svs` → 框选 ROI → 隔离子进程跑
StarDist-HE 核检测（ROI 抽块 + 质心去重）→ 计数 / 密度（个/mm²，MPP 标定）→ reproducibility F1。

## 前置

- 本机 `uv`（Python 环境管理）、Node ≥ 22（`~/.nvm/nvm.sh`）。
- 后端主进程 **不** 引 torch/TF——核模型只在 `.venv-wsi` 隔离子进程（护城河：主进程 `find_spec("torch") is None`）。
- OpenSlide 走 `openslide-bin` wheel（自带 libopenslide 二进制，**免系统装** libopenslide）——已在
  `backend/pyproject.toml` 声明，`uv sync` 即得。

## 1. 后端装 OpenSlide（`~10 s`，已在 deps）

```bash
cd ~/code/pre-tech/open-glaux/backend
uv sync --extra dev          # openslide-python + openslide-bin + nibabel + pytest
.venv/bin/python -c "import openslide; from openslide.deepzoom import DeepZoomGenerator; print('ok', openslide.__version__)"
```

> 若团队机器要用系统 libopenslide：`apt install libopenslide0`（Debian/Ubuntu）或 `conda install openslide`；
> 但 `openslide-bin` wheel 已够，CI 无需系统装。

## 2. 装核分割隔离子环境（`~3 min`）

StarDist-HE 训练于 ~0.25 µm/px（40×），需 TF；用 **py3.11 + tensorflow-cpu 2.15** 避开
TF 2.16/Keras 3 与 StarDist 的冲突。

```bash
mkdir -p ~/glaux_models/wsi_seg/weights
cp ~/code/pre-tech/open-glaux/science-core/runners/segment_wsi_headless.py ~/glaux_models/wsi_seg/run_headless.py
cd ~/glaux_models/wsi_seg
uv venv .venv-wsi --python 3.11
uv pip install --python .venv-wsi/bin/python "tensorflow-cpu==2.15.*" stardist csbdeep numpy pillow
# 预热 HE 权重（首次 from_pretrained 下载 ~5MB 到 ~/.keras）
TF_CPP_MIN_LOG_LEVEL=3 CUDA_VISIBLE_DEVICES=-1 .venv-wsi/bin/python -c \
  "from stardist.models import StarDist2D; StarDist2D.from_pretrained('2D_versatile_he'); print('weights cached')"
```

## 3. ship 1 例公开 demo slide（`~10 s`，1.9 MB）

```bash
mkdir -p ~/code/pre-tech/open-glaux/data/wsi
cd ~/code/pre-tech/open-glaux/data/wsi
# OpenSlide 可再分发测试数据（Aperio，含 MPP 0.499）
curl -fL -o slide_001.svs \
  "https://openslide.cs.cmu.edu/download/openslide-testdata/Aperio/CMU-1-Small-Region.svs"
# 验证：2220×2967，mpp 0.499
python3 -c "import openslide; s=openslide.OpenSlide('slide_001.svs'); print(s.dimensions, s.properties['openslide.mpp-x'])"
```

`slide_001_ref_nuclei.json`（reproducibility reference）由第 6 步真跑后从缓存拷得（见下）。

## 4. 配环境变量（缺省已指向上面的路径；`~10 s`）

缺省值（见 `backend/app/config.py`）——路径一致时可跳过：

```bash
export GLAUX_WSI_ROOT=~/code/pre-tech/open-glaux/data/wsi
export GLAUX_WSI_SEG_PYTHON=~/glaux_models/wsi_seg/.venv-wsi/bin/python
export GLAUX_WSI_SEG_DRIVER=~/glaux_models/wsi_seg/run_headless.py
export GLAUX_WSI_SEG_WEIGHTS=~/glaux_models/wsi_seg/weights
export GLAUX_WSI_CACHE=~/glaux_models/wsi_tiles         # DeepZoom 瓦片缓存
export GLAUX_WSI_SEG_CACHE=~/glaux_models/wsi_seg_out   # 质心 json 缓存
```

## 5. 启动后端（`~10 s`）

```bash
cd ~/code/pre-tech/open-glaux/backend
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
# 冒烟：
curl -s localhost:8000/slides            # [{"id":"slide_001","modality":"pathology","mpp_um":[0.499,0.499],"dims":[2220,2967]...}]
curl -s localhost:8000/tasks | grep -o nuclei_detection
curl -s -o /dev/null -w "%{http_code}\n" "localhost:8000/wsi/slide_001/dzi"   # 200
```

## 6. 真机跑一次核检测 + 生成 reference（`~10 s`，首次含模型加载）

```bash
cd ~/code/pre-tech/open-glaux/backend
PYTHONPATH=../science-core:../orchestration:. .venv/bin/python - <<'PY'
from app import segment_wsi
roi = (1200, 1200, 1712, 1712)          # tissue-dense 512×512 ROI（canonical）
path, mv = segment_wsi.segment("slide_001", roi, "stardist_he", timeout=600)
print(mv, "→", path)                    # StarDist 2D_versatile_he@live
PY
# 拷作 ship reference（首次；之后入库）
cp ~/glaux_models/wsi_seg_out/slide_001_*_stardist_he.json \
   ~/code/pre-tech/open-glaux/data/wsi/slide_001_ref_nuclei.json
# 验证复现（缓存命中 → F1=1.0）：
curl -s "localhost:8000/wsi/slide_001/verify" | python3 -m json.tool
```

**预期**：canonical ROI 出 ~51 核，密度 ~780 个/mm²；`verify` → `f1: 1.0, tp: 51`。

## 7. 启动前端（`~15 s`）

```bash
source ~/.nvm/nvm.sh
cd ~/code/pre-tech/open-glaux/frontend
npm install          # 首次：含 openseadragon
npm run dev          # Vite dev（proxy /api → :8000）
```

## 8. 浏览器端到端流程（`~2 min`）

1. 打开 dev 地址 → 侧栏模态切换器点 **「细胞核检测 (病理 WSI)」**。
2. 中部 OpenSeadragon 加载 `slide_001`——深缩放浏览 H&E 组织（滚轮缩放、拖拽平移）。
3. 工具栏点 **「▭ 框选 ROI」** → 在组织区拖一个框 → 松开即触发检测。
4. **预期**：核质心以绿点叠在核上（随缩放/平移实时跟随）；信息栏出 `NN 核/mm² · ROI x.xxx mm²`。
5. 右上 **「复现验证」** → F1 徽标（canonical ROI 自复现应为 `F1 1.00 (51/51)`，绿色）。

## 9. 已知问题 / 坑

- **坐标系三套（头号坑）**：① OpenSlide **level-0 px**（质心/ROI 存储真相）；② **DeepZoom level**
  （瓦片编号，与 OpenSlide level 反向；仅瓦片路由，OSD 内部）；③ **OSD viewport**（归一化 0..1，
  渲染用，经 `imageToViewerElementCoordinates` 换算）。质心一律存 level-0 px，overlay 绘制时换算。
  `dataset_wsi._deepzoom` 用 `limit_bounds=False` 保证 DeepZoom 最大层 dims == level-0 dims，三套不偏移。
- **放大倍率错配（真机才暴露）**：StarDist HE 训练 MPP ~0.25；slide 0.499（20×）时核显小、**欠检出**
  （实测 1×→6、2×→48、3×→98 核）。driver 按 `scale = mpp / 0.25 ≈ 2×` 上采样到训练 MPP 再推理、
  质心 `/scale` 映回。**若换更高/更低倍率的 slide，检出数会变——这是模型特性,不是 bug**。
- **patch 边界重复计核**：ROI 切重叠 patch → 同一核跨 patch 被检两次；主进程 `dedup_centroids`
  （质心 NMS，纯 numpy，阈值 8px）合并。实测 canonical ROI n_raw 108 → n_dedup 51，与非分块单发 48 一致。
- **浏览器预览（headless）看不到组织背景**：OSD 靠 `requestAnimationFrame` 连续循环拉瓦片/绘制，
  **隐藏标签页会暂停 rAF** → 背景空白（overlay/度量仍正常，那些不靠 rAF）。**在可见浏览器里正常**。
  这是 CS3D（按需 `.render()`）在预览里能显示、OSD 不能的原因。
- **最小 env 需带 HOME**：StarDist 首次 `from_pretrained` 把权重缓存到 `~/.keras`，子进程最小 env
  含 `HOME`（`segment_wsi._run_live` 已加）——同 P6 对 TotalSegmentator 记的 HOME 坑。
- **背景 patch 触发 StarDist ClipperLib 崩溃**：完整切片（非纯组织小样本）的 ROI 会混入背景/玻璃 patch，
  喂给 StarDist 时其星凸多边形 NMS（ClipperLib）在近白/平坦输入上抛 C++ 异常 → `std::terminate`
  **杀整个子进程**（Python 抓不住）。driver 加 **tissue masking**：`gray.mean()>220 或 std<5` 的 patch
  跳过（WSI 标准做法，既避崩溃又大幅提速——gigapixel 切片绝大部分是背景）。
- **多层 vs 单层 slide**：`CMU-1-Small-Region.svs`（demo，单分辨率层，2220×2967）放大超原生即糊；
  完整 `CMU-1.svs`（3 层：46000×32914 / 4× / 16×，1.5 gigapixel，20× 物镜）才有深缩放层层变清晰。
  data/wsi 是 gitignore + env 可指向，丢任意 `.svs` 进去即被 `/slides` 列出。

## 10. 后续路径（P7.x 展望）

- 核 **边界**轮廓 overlay（instance 多边形，非仅质心）+ point-correction 编辑回流（沿用 P6 `editSeqRef` 守卫）。
- 整片分块推理 + 核密度热力图（whole-slide count map）。
- HoVerNet-PanNuke（5 类：肿瘤/炎症/结缔/坏死/上皮）→ per-class 计数 + 肿瘤核占比（`measure_nuclei` 已支持多类，无需改）。
- 组织区域分割任务（第二个 WSI 任务族，复用同 OSD 查看器栈）。

## 变更记录

- v1（2026-07-10）：P7 楔子 U1–U6 落地。StarDist-HE + OpenSlide 动态 DeepZoom + OpenSeadragon。
  真机 e2e：canonical ROI 51 核 / 781 个/mm² / verify F1 1.0。
