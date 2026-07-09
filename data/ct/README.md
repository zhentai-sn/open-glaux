# CT 体积数据（P6 楔子）

存放 TotalSegmentator v2 公开 demo CT 案例的 NIfTI 文件，供 `ct_abdomen` 模态使用。

## 命名约定

- `<id>.nii.gz` —— 原始 CT 体积
- id 形如 `ct_001`、`ct_002`（3 位数字）
- 路径由 `backend/app/config.py` 的 `CT_ROOT` 控制（默认 `data/ct/`）

## 手动拉取（不入仓）

TotalSegmentator v2.4.0 公开 demo 案例在 GitHub release / Zenodo 资产中。手工步骤见
`docs/runbooks/p6-3d-totalseg-wedge.md`（U6 落地）。本目录**不**入 git（`.gitignore` 已含
体积数据通配符）。

## v0 楔子数据

P6 第一刀只需要 1 例 demo：

- `ct_001.nii.gz` —— 1 例腹部 CT（CT-RATE / TotalSegmentator 公开 demo 任一）
- 配套 reproducibility reference 由 `docs/runbooks/p6-3d-totalseg-wedge.md` 说明

## 权限与协议

TotalSegmentator 预训练权重 Apache-2.0；其 demo 案例的 CT 卷通常走原数据集协议
（CT-RATE / LiTS / AutoPET 等各自的 DUA）。v0 用 TotalSegmentator 自带 demo（公开、
无需额外协议）作 reproducibility reference，非真 GT。
