---
kind: living
status: living
---

# P6 3D CT 楔子 runbook — TotalSegmentator 肝+双肾

> **状态**：v0 手动 e2e 流程（不入 CI）。**用途**：工程师在干净环境按本 runbook 跑通
> 第一个 3D CT 楔子（肝+双肾分割 + 体积度量 + 画笔编辑 + Reproducibility Dice）。
> **依据**：[P6 设计文档](../designs/2026-07-09-001-p6-3d-totalseg-wedge.zh-CN.md) ·
> [P6 实施计划](../plans/2026-07-09-001-feat-p6-3d-totalseg-wedge-plan.md)
> **半衰期**：TotalSegmentator 权重版本变化或 Cornerstone3D 主版本升级（当前 3.x）时复核。

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
# TotalSegmentator 官方测试 fixture：tests/reference_files/example_ct.nii.gz
#   —— 3mm 各向同性腹部 CT，~2.2MB（默认分支是 master，非 main）。
curl -L -o data/ct/ct_001.nii.gz \
  https://raw.githubusercontent.com/wasserth/TotalSegmentator/master/tests/reference_files/example_ct.nii.gz

# 验证是真 NIfTI（前 2 字节应是 gzip magic 1f 8b）：
python -c "import nibabel as nib; i=nib.load('data/ct/ct_001.nii.gz'); print(i.shape, i.header.get_zooms()[:3])"
# 期望：(122, 101, 112) (3.0, 3.0, 3.0)
```

> **reproducibility reference（`ct_001_ref.nii.gz`）**：TS 官方不 ship 该 CT 的 liver_kidney
> 预测，故 v0 用「本机首跑 TotalSegmentator 产出的 labelmap 快照」作 reference——
> 生成方式：§8 第 3 步首跑后，把 `$GLAUX_TS_CACHE/ct_001_totalsegmentator_v2.nii.gz` 拷为 `data/ct/ct_001_ref.nii.gz`。这是**自复现快照**，非真 GT；Dice=1.0 说明 verify 链路端到端通，不代表
> 临床正确性。若日后拿到独立 GT，替换 `ct_001_ref.nii.gz` 即可。

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
cd /path/to/open-glaux
make backend          # 已显式 GLAUX_DEV_MODE=1，内置 CT 源可见；也可用 bash scripts/dev/run-backend.sh
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

1. **切模态** → 侧栏模态切换器选 `ct_abdomen`
   （模态按 `/datasources` 显示：缺省产品模式看不到内置 CT 源，需 `GLAUX_DEV_MODE=1` 或先「加载示例数据」）。
2. **选体积** → 资源管理器 / 切片列表面板选 `ct_001`。
3. **首跑** → ActivityBar 的 **Run & Measure** 点 "Run"（或在对话里让智能体测，走 `run_task` 工具）；
   首次会触发 `POST /task/run`（`task=totalseg_liver_kidney`；旧 `/volume/{id}/segment` 已于 2026-08-16 删除）：
   - 后端读 `data/ct/ct_001.nii.gz` → 调 `segment_ts._run_live` → 启 `.venv-ts/bin/python`
     跑 `run_headless.py --input ct_001.nii.gz --output ct_001_totalsegmentator_v2.nii.gz`
   - 子进程读 → 调 `totalsegmentator(task="liver_kidney", ml=True)` → 落盘
     - 首跑 ~3-10 min（CPU 跑 nnU-Net）；之后命中缓存 < 1s
4. **看 3D 渲染** → Viewer 切到 `volume_3d` 引擎；显示肝+双肾分割 overlay + 状态条：
   - 肝体积 ~1300-1700 cm³
   - 双肾各 ~150-200 cm³
   - 滚轮切 z 轴（不是 zoom）
5. **画笔编辑** → 工具栏切到 brush 工具，在肝上擦一小块：
   - 后端 `POST /volume/ct_001/mask-edit` 接受
   - 度量重算 → 肝体积下降
   - 状态条实时更新
6. **Reproducibility Dice** → `/volume/{id}/verify` 端点已于 2026-08-16 删除（前端从未接线）；
   要做复现校验直接调内核（reference 仍在 `data/ct/ct_001_ref.nii.gz`）：
   ```bash
   cd backend && uv run python - <<'EOF'
   import nibabel as nib, numpy as np
   from glaux_core.verification.dice import dice_per_class
   from glaux_core.tasks import LIVER_KIDNEY_CLASSES
   from app import config, segment_ts
   pred = np.asarray(nib.load(segment_ts.labelmap_path("ct_001", "totalsegmentator_v2")).dataobj).astype(np.int32)
   ref = np.asarray(nib.load(str(config.CT_ROOT / "ct_001_ref.nii.gz")).dataobj).astype(np.int32)
   print(dice_per_class(pred, ref, [c.class_id for c in LIVER_KIDNEY_CLASSES]))
   EOF
   ```
   输出是 `{class_id: dice}`（1=肝、2=左肾、3=右肾），例如：
   ```
   {1: 0.98, 2: 0.96, 3: 0.96}
   ```
   - **Dice ≥ 0.90** = 复现好，pipeline 健康
   - **Dice < 0.85** = 检查 measure / 标定 / 缓存逻辑；不**代表临床正确性**（reference 是
     本机首跑快照，非真 GT）
7. **回滚验证** → 查看器工具栏 **Reset to model（重置为模型输出）**，内部走 `reRunActiveModel()` 重跑 `POST /task/run`，丢弃画笔编辑。

## 9. 已知问题

- **首跑慢 / 要 GPU**：子进程 env 最小化（`MPLBACKEND` / `CUDA_VISIBLE_DEVICES=-1` / `PATH`），
  v0 CPU-only，首跑 ~3-10 min（nnU-Net），之后命中缓存 < 1s；要用 GPU 改 `segment_ts._run_live`
  的 env，去掉 `CUDA_VISIBLE_DEVICES=-1`。
- **Dice < 0.85**：reference 是本机首跑快照，复跑应近乎一致；偏低先查 TotalSegmentator 或权重版本是否变了、
  缓存 labelmap 是否被覆盖，也可能是 voxel_spacing 解析差异（检查 `dataset_ct.vox_spacing_mm`）。
- **镜像体积错误**：检查 `data/ct/ct_001.nii.gz` 的 `pixdim[1:4]`，是否包含负值
  （nibabel 会自动取 abs → 误通过）。

