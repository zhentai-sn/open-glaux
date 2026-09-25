# CT 体积 demo 数据（ct_abdomen）

存放 TotalSegmentator v2 公开 demo CT 案例的 NIfTI 文件，供 `ct_abdomen` 模态使用。

## 命名约定

本目录是内置示例源 `ct-demo` 的根，路径由 `backend/app/config.py` 的 `CT_ROOT` 控制（默认 `data/ct/`）。

- `<id>.nii.gz` —— 原始 CT 体积，id 形如 `ct_001`、`ct_002`（3 位数字）；不符此约定的文件不进内置源。
- 该约定只约束内置示例源。作为项目打开的目录与经 `POST /datasources` 导入的目录接受任意文件名的
  `.nii`、`.nii.gz`，对象 id 按文件派生（`ct-<源哈希8>-<文件名哈希8>`），见
  [datasource-registry.md](../../docs/runbooks/datasource-registry.md)「CT、WSI 的识别与对象 id」。

## 手动拉取（不入仓）

输入病例取自 TotalSegmentator 仓库的测试文件 `tests/reference_files/example_ct.nii.gz`（master 分支）。手工步骤见
`docs/runbooks/p6-3d-totalseg-wedge.md`（U6 落地）。本目录**不**入 git（`.gitignore` 已含
体积数据通配符）。

## demo 数据

本目录当前只需 1 例 demo：

- `ct_001.nii.gz` —— 1 例腹部 CT（TotalSegmentator 公开 demo，3mm 各向同性，122×101×112）
- `ct_001_ref.nii.gz` —— TotalSegmentator 首跑输出的 reproducibility reference（**非真 GT**），生成方式见同一 runbook 第 3 步末尾的说明

## 权限与协议

TotalSegmentator 预训练权重 Apache-2.0；其 demo 案例的 CT 卷通常走原数据集协议
（CT-RATE / LiTS / AutoPET 等各自的 DUA）。v0 的输入病例是 TotalSegmentator 仓库
自带的公开测试 CT；reproducibility reference 是本机首跑快照，非真 GT。
