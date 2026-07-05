# glaux-imt · CUBS 颈动脉 IMT 科学内核

Glaux 首个楔子的 headless 科学内核。把 CUBS 数据集上的
`读取 → 标定 → 表征 → 分割 → PDM 测量 → 验证 → 结构化产物 → 评测`
跑成可复现、可审计的闭环——环境四层（表征 / 动作 / 验证 / 记忆）的首个实例。

计划：[`docs/plans/2026-07-05-001-feat-cubs-imt-pipeline-plan.zh-CN.md`](../docs/plans/2026-07-05-001-feat-cubs-imt-pipeline-plan.zh-CN.md)
需求：[`docs/brainstorms/20260705-01-cubs-imt-first-task.zh-CN.md`](../docs/brainstorms/20260705-01-cubs-imt-first-task.zh-CN.md)

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

磁盘格式（2026-07-05 核对）：图 `.tiff`、CF `CF/<id>_CF.txt` 标量、
边界 `LIMA-Profiles/<method>/<id>-{LI,MA}.txt`（两行：x 行 / y 行）。

## 边界约束

**研究，非临床。** 输出是研究洞察，不是临床诊断 / 决策。
标定不可得时**硬拒绝**，绝不静默输出无标定的假 IMT。
