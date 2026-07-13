# scripts/dev — 开发期一次性脚本（归档）

> ⚠️ **这些不是构建/CI/运行时依赖**。是 P4–P7 迭代过程中,在本机 `~` 下随手写的
> 调试 / e2e 冒烟 / 环境安装 / 数据抓取脚本,含**机器相关的 WSL 绝对路径**
> (`~/glaux_models/...`、`.venv-*/bin/python` 等),换机器基本跑不动。
> 入库仅作**历史留痕**,方便回溯当时怎么验的。可复现的规范步骤看
> [`docs/runbooks/`](../../docs/runbooks/),不看这里。

原先散落在 `~`,2026-07-13 归拢入库(见 [清理说明](#清理背景))。

## 脚本清单

| 脚本 | 用途（当时） |
|---|---|
| `glaux_backend.sh` | 起后端 uvicorn(带 `PYTHONPATH` 装配) |
| `glaux_e2e_backend.sh` | 后端端点冒烟(IMT/HC/CT/WSI) |
| `glaux_e2e_seg.sh` | 分割子进程 e2e(真机跑一次核对产出) |
| `glaux_e2e_taskrun.sh` | `/task/run` 意图→检测→度量整链 e2e |
| `glaux_fetch_ct.sh` | 下载 CT demo NIfTI(P6) |
| `glaux_install_tv.sh` | 装 TotalSegmentator 隔离环境(`.venv-ts`) |
| `glaux_fix_torch.sh` | 修 torch/torchvision 版本冲突 |
| `glaux_masktest.sh` | labelmap/掩膜叠色调试 |
| `glaux_dbg{,2,3}.sh` | 临时调试(逐次覆写,内容不定) |
| `eval_carosegdeep.py` | caroSegDeep 100 图 eval(IMT 精度基线) |

## 清理背景

这批脚本本该落在会话 scratchpad / `/tmp`(跑完即弃),当时图 heredoc 落地方便写到了
home 根目录,一路积到 P7。归拢时顺带把两个数据集根从 `~/cubs_data`、`~/hc18_data`
统一到了 `~/glaux_datasets/`(`config.py` 默认路径已同步)。

模型/权重/venv/缓存仍在 `~/glaux_models/`——那是**有意**放仓库外的重资产(几 GB,
`.gitignore` 语义内),不在本次归拢范围。
