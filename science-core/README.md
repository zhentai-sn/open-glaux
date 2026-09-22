# glaux-core · Glaux 科学内核

headless 科学内核（包名 `glaux-core`，导入名 `glaux_core`）：提供任务注册表
`glaux_core.tasks.REGISTRY`——能力清单的单一事实源，以及各任务的读取、标定、分割/检测、测量、验证。
现已登记四个任务：`far_wall_cca_imt`（颈动脉 IMT）、`fetal_hc`（胎儿头围）、
`totalseg_liver_kidney`（CT 肝与双肾）、`nuclei_detection`（病理 WSI 核检测）。

CUBS IMT 是第一个实现的任务，闭环为
`读取 → 标定 → 表征 → 分割 → PDM 测量 → 验证 → 结构化产物 → 评测`，可复现、可审计。

- 仓库现状：[`docs/architecture.zh-CN.md`](../docs/architecture.zh-CN.md)
- IMT 首任务的历史计划：[`docs/plans/2026-07-05-001-feat-cubs-imt-pipeline-plan.zh-CN.md`](../docs/plans/2026-07-05-001-feat-cubs-imt-pipeline-plan.zh-CN.md)
- IMT 首任务的历史需求：[`docs/brainstorms/20260705-01-cubs-imt-first-task.zh-CN.md`](../docs/brainstorms/20260705-01-cubs-imt-first-task.zh-CN.md)

## 安装（开发）

```bash
cd science-core
pip install -e ".[dev]"          # 核心 + pytest
pip install -e ".[dev,interp]"   # 追加 scipy（pchip 曲线插值，可选）
```

核心测量只依赖 numpy / Pillow / pandas；`scipy`（曲线插值）与
`tensorflow`（caroSegDeep 适配器）是可选 extra，刻意隔离，避免整包强依赖重后端。

## 测试

```bash
python -m pytest
```

## 数据（不入库）

CUBS 走下载，不进仓库（见 `.gitignore`）。CC BY 4.0：

- 主集（2176 图 tiff + `CF/` + `SEGMENTATIONS/` + 临床 CSV）：
  <https://data.mendeley.com/datasets/fpv535fss7/1>
- 技术集（`DATASET_CUBS_tech.zip`，7 算法 + `GT-FAMUS` + `Folds`）：
  <https://data.mendeley.com/datasets/m7ndn58sv6/1>

磁盘格式（2026-07-06 用技术集实测核对）：图 `.tiff`、CF `CF/<id>_CF.txt` 标量、
边界 `LIMA-Profiles/<method>/<id>-{LI,MA}.txt`。边界为**逐点** `x y`（每行一个点，
N 行 = N 点）；reader 同时兼容「两行（x 行 / y 行）」布局。

## 边界约束

输出止于可计算表征，拿表征做决策由用户自建（纲领 §三）。

**研究，非临床。** 输出是研究洞察，不是临床诊断 / 决策。
标定不可得时**硬拒绝**，绝不静默输出无标定的假 IMT。
