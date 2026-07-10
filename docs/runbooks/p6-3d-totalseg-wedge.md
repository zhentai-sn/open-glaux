# P6 3D CT 楔子 runbook — TotalSegmentator 肝+双肾

> **状态**：v0 手动 e2e 流程（不入 CI）。**用途**：工程师在干净环境按本 runbook 跑通
> 第一个 3D CT 楔子（肝+双肾分割 + 体积度量 + 画笔编辑 + Reproducibility Dice）。
> **依据**：[P6 设计文档](../designs/2026-07-09-001-p6-3d-totalseg-wedge.zh-CN.md) ·
> [P6 实施计划](../plans/2026-07-09-001-feat-p6-3d-totalseg-wedge-plan.md)
> **半衰期**：TotalSegmentator 权重版本 / CS3D 4.x→5.x API 漂移时复核。

## 一句话

把 TotalSegmentator v2.4.0 预训练权重 + 1 例公开 demo CT 跑通到前端 VolumeViewer 显示 +
Dice 报告 ≥ 0.95。CPU-only 即可；GPU 可选（开 `CUDA_VISIBLE_DEVICES=0`）。

## 前置

- Python 3.12（与主项目 `backend/.venv/` 一致）
- Node.js 20+（前端 Vite）
- `uv`（[Astral uv](https://github.com/astral-sh/uv)，包管理）
- ~5 GB 磁盘（venv-ts + TotalSegmentator 权重）
- 网络（首次下权重 + 拉 TotalSegmentator demo 案例）

## 1. 装隔离子环境（`~3 min`）

```bash
# TotalSegmentator v2.4.0 隔离 venv（与 .venv-csd / .venv-hc 同构）
mkdir -p ~/glaux_models/totalseg
cd ~/glaux_models/totalseg
uv venv .venv-ts --python 3.12
source .venv-ts/bin/activate
uv pip install torch --index-url https://download.pytorch.org/whl/cpu
uv pip install nibabel nnunetv2 totalsegmentator
```

## 2. 拉 TotalSegmentator 预训练权重（`~5 min`，1.2 GB）

```bash
# 仍在上一步 venv 内
python -c "from totalsegmentator.python_api import totalsegmentator; totalsegmentator('-h')"  # 触发首跑下载
# 实际下载由 totalsegmentator 包内 logic 控制，通常落到 ~/.cache/totalseg/ 或 venv 内的 totalsegmentator_weights/
# 若下载失败，按官方 README：https://github.com/wasserth/TotalSegmentator#installation
ls ~/glaux_models/totalseg/.venv-ts/lib/python3.12/site-packages/totalsegmentator/resources/  # 或 ~/.cache/totalseg/
```

## 3. 拉 1 例公开 demo CT 案例（`~30 s`）

```bash
# 回到仓库根
cd /path/to/open-glaux
mkdir -p data/ct
# TotalSegmentator 仓库的 sample data：https://github.com/wasserth/TotalSegmentator/tree/main/resources
# 也可走 TotalSegmentator 公开 demo（README 中 #example-data 段）
# v0 楔子：1 例腹部 CT + 配套的官方预测（reference）——便于跑 Reproducibility Dice

# 例：从 TotalSegmentator 测试 fixtures 取 1 例
curl -L -o data/ct/ct_001.nii.gz \
  https://raw.githubusercontent.com/wasserth/TotalSegmentator/main/resources/example_ct.nii.gz

# 配套 reproducibility reference（官方 demo 预测）
curl -L -o data/ct/ct_001_ref.nii.gz \
  https://raw.githubusercontent.com/wasserth/TotalSegmentator/main/resources/example_ct_ref.nii.gz
```

> 若上述 URL 失效：参考 TotalSegmentator GitHub README 的 **Example Data** 段，挑 1
> 例 NIfTI 命名为 `ct_001.nii.gz` 放 `data/ct/`，再下 1 例对应的官方预测命名为
> `ct_001_ref.nii.gz` 放同目录。reference 是 ship 的官方预测——非真 GT。

## 4. 装 driver 脚本（`~10 s`）

```bash
# driver 已 commit 在 science-core/runners/segment_ts_headless.py
# 把它软链到 .venv-ts 目录方便 PATH 引用
cd ~/glaux_models/totalseg
ln -sf /path/to/open-glaux/science-core/runners/segment_ts_headless.py ./run_headless.py
```

## 5. 配环境变量（`~10 s`）

在 `~/.bashrc` 或临时 shell 写：

```bash
export GLAUX_TS_PYTHON=$HOME/glaux_models/totalseg/.venv-ts/bin/python
export GLAUX_TS_DRIVER=$HOME/glaux_models/totalseg/run_headless.py
export GLAUX_TS_WEIGHTS=$HOME/glaux_models/totalseg/.venv-ts/lib/python3.12/site-packages/totalsegmentator/resources
export GLAUX_TS_CACHE=$HOME/glaux_models/ts_out
export GLAUX_CT_ROOT=/path/to/open-glaux/data/ct
```

或用现成的 .env（见 `backend/.env.example`——本流程不入仓，工程师本地维护）。

## 6. 启动后端（`~10 s`）

```bash
cd /path/to/open-glaux/backend
.venv/bin/uvicorn app.main:app --reload --port 8000
```

应看到：

```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

## 7. 启动前端（`~15 s`）

```bash
cd /path/to/open-glaux/frontend
npm run dev
```

应看到：

```
VITE v5.4.21  ready in 250 ms
  ➜  Local:   http://localhost:5173/
```

## 8. 浏览器端到端流程（`~3 min`）

打开 <http://localhost:5173/>：

1. **切模态** → 右侧 ActivityBar 找 "肝+双肾"（**插件市场** 或 **侧栏** 任一处会暴露新模态），
   切到 `ct_abdomen`。
2. **选体积** → 资源管理器 / 切片列表面板选 `ct_001`。
3. **首跑** → ActivityBar 的 **Run & Measure** 点 "Run"；首次会触发
   `POST /volume/ct_001/segment`：
   - 后端读 `data/ct/ct_001.nii.gz` → 调 `segment_ts._run_live` → 启 `.venv-ts/bin/python`
     跑 `run_headless.py --input ct_001.nii.gz --output ct_001_totalsegmentator_v2.nii.gz`
   - 子进程读 → 调 `totalsegmentator(task="liver_kidney", ml=True)` → 落盘
     - 首跑 ~3-10 min（CPU 跑 nnU-Net）；之后命中缓存 < 1s
4. **看 3D 渲染** → Viewer 切到 `volume_3d` 引擎；显示肝+双肾分割 overlay + 状态条：
   - 肝体积 ~1300-1700 cm³
   - 双肾各 ~150-200 cm³
   - 滚轮切 z 轴（不是 zoom）
5. **画笔编辑（v0 简化）** → 通过 ActivityBar / 工具栏切到 brush 工具，在肝上擦一小块：
   - 后端 `POST /volume/ct_001/mask-edit` 接受
   - 度量重算 → 肝体积下降
   - 状态条实时更新
6. **Reproducibility Dice** → 调 `curl` 验证：
   ```bash
   curl http://localhost:8000/volume/ct_001/verify?task=totalseg_liver_kidney
   ```
   期望响应（数字会有小差异，shape 一致）：
   ```json
   {
     "per_class": {
       "liver": {"dice": 0.95, ...},
       "lk": {"dice": 0.92, ...},
       "rk": {"dice": 0.93, ...}
     },
     "mean_dice": 0.93,
     "note": "reproducibility check vs ship reference（非真 GT）"
   }
   ```
   - **Dice ≥ 0.90** = 复现好，pipeline 健康
   - **Dice < 0.85** = 检查 measure / 标定 / 缓存逻辑；不**代表临床正确性**（reference 是
     ship 的官方 demo 预测，非真 GT）
7. **回滚验证** → ActivityBar 切到 **Reset to model**（U3/U4 留位；v0 行为可走
   `reRunActiveModel()` 重新跑 /segment）。

## 9. 已知问题

- **首跑 5-10 min**：CPU 跑 nnU-Net 慢；GPU 需改 `_run_live` 去掉 `CUDA_VISIBLE_DEVICES=-1`。
- **Dice < 0.85**：通常因为 reference 是 ship demo 预测，**不是**我们 pipeline bug；
  也可能是我们 voxel_spacing 解析差异（检查 `dataset_ct.vox_spacing_mm`）。
- **画笔没显示**（v0 简化）：U3 的图例画在 overlay canvas 上，**不**叠到 CT 像素；
  U4 留接口，CS3D SegmentIndex 体素叠色 v0 不稳定——后续 U4.x 落实。
- **镜像体积错误**：检查 `data/ct/ct_001.nii.gz` 的 `pixdim[1:4]`，是否包含负值
  （nibabel 会自动取 abs → 误通过）。
- **CUDA**：v0 CPU-only；要 GPU 跑改 `segment_ts._run_live` 的 env 删 `CUDA_VISIBLE_DEVICES=-1`。

## 10. 后续路径（P6.x/x 展望）

- P6.x：扩到 ~10 主器官（脾/胰/胃/胆囊/主动脉/腔静脉/膀胱/肾上腺/前列腺/子宫）
- P6.xx：扩到 117 全量
- P6.x+：MPR（三平面联动）/ 3D 体积渲染 / 撤销栈
- P7：病理 WSI（OpenSeadragon，沿 Viewer 接缝 ENGINES["wsi"]）

## 变更记录

- **2026-07-09**：v1。P6 楔子首个 3D 楔子 runbook——沿用 P6 设计/计划的端到端流程
  文档化（不入 CI，手动 checkpoint）。
