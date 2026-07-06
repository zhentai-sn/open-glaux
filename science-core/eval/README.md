# eval · 评测 harness（阶段 4 证明）

复现 CUBS 一致性口径，作为科学内核的可发表证明。度量在合成 GT 上自证正确
（完美预测→bias≈0、Dice≈1、Hausdorff≈0；已知偏移→bias≈偏移），并在真实
CUBS 技术集上产出与已发布数对表的报告。

## 评测口径（对齐 CUBS 论文）

跨方法比 IMT 必须**量同一段血管壁**，且用**对称距离**，否则 bias 不可比：

1. **共同支撑（common support）**：两方法各自的 LI/MA 公共 x 区间再求交，
   测量只在这个跨方法重叠窗口进行。GT-FAMUS 是全宽密集边界（600+ 点），
   手动/计算机方法只标注局部 ROI（十几~几十点）——不对齐支撑会把「平均的
   不是同一段壁」记成假偏差。
2. **对称 PDM（Polyline Distance Method）**：IMT = LI↔MA 双向法向投影距离
   的均值 × CF（`IMTResult.pdm_mean_mm`），而非单向 LI→MA 均值。曲线原生、
   确定性几何，不塌缩成掩膜面积、不经 LLM。

实现：`paired_imt(pred, ref, cf)` 在共同支撑上用对称 PDM 各算一次 IMT；
`agreement(pred, ref, cf)` 汇成 Bland-Altman（观察者内/间、方法 vs 金标准通用）。

## 真实数据复现（DATASET_CUBS_tech，2026-07-06）

技术集 500 图 + 真实 CF + 9 方法边界（A1/A1'/A2 手动、GT-FAMUS、7 算法）。
对齐口径下的一致性 vs 已发布参考（单位 µm，`|bias|` = 平均绝对 IMT 差）：

| 比对 | n | 对齐 \|bias\| | 参考 | 判定 |
| --- | --- | --- | --- | --- |
| 观察者内 A1 vs A1' | 500 | **158.7** | 160±140 | ✓ 命中 |
| 观察者间 A1 vs A2 | 500 | **179.3** | 194±177 | ✓ 接近 |
| CREATIS vs A1（caroSegDeep 源） | 500 | **104.7** | ~106±89 | ✓ 精准 |

三条独立参考值全部落位，佐证「共同支撑 + 对称 PDM」复现了 CUBS 的测量方法学。
其余算法 vs A1：CNR_IT 138.9、TUM_DE 142.6、UCY_CY 138.4、POLITO_UNET 177.7。
对齐相对「原生支撑 + 非对称」旧口径的差异在支撑失配处最大（GT-FAMUS vs A1
\|bias\| 139.5→128.2）。

> **数据不入库**：CUBS 走下载（见根 `README` 与 `.gitignore`）。复现脚本按上述
> 口径调用 `cubs.read_dataset` → `agreement`，指向本地技术集解压目录即可。

## 成功阈（据 CUBS 调研）

- 测量准确：CIMT 绝对 bias ≤160µm（观察者内 LoA），理想 ≤110µm（CREATIS 级）。
- 边界质量：逐边界 Dice ≥0.77；Hausdorff 报告并对标。
- 跨中心：leave-one-center-out 中心间 bias 差距有界。
