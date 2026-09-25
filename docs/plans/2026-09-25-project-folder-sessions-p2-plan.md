---
kind: record
status: done
---

# SDD 13 项目文件夹与并行会话 · P2 实施计划

依据：[SDD 13](../sdd/feats/13-project-folder-sessions/README.md) §3 P2 行、§7.2 规则 7、10～14、D-21、D-23～D-26；[SDD 10](../sdd/feats/10-object-convergence/README.md) D-25。P1 见 [P1 计划](2026-09-25-project-folder-sessions-p1-plan.md)。

## 现状要点

- `dataset_ct.py`、`dataset_wsi.py` 的模块函数只收对象 id，经 `resolve_root(modality)`（首个活动源）拼路径；`CtSource.list_ids(source)`、`WsiSource.list_ids(source)` 忽略 `source`。内置示例源活动时，导入源（SDD 08）的对象既不列出也读不到。
- id 即文件名去后缀，受 `^ct_\d{3}$`、`^slide_\d{3}$` 约束；CT 只读 `.nii.gz`。
- `formats` 同时驱动上传受理表与项目识别；CT、WSI 未声明。
- `VolumeDetector`、`WsiDetector` 的方法可用性与 `/wsi/{id}/verify` 就绪判定探测全局根下的 `ct_*`、`slide_*`。
- 缓存（`_load_nifti`、`_open`、`_deepzoom` 的 lru，TS_CACHE、WSI_CACHE、WSI_SEG_CACHE 的文件）都以对象 id 为键；派生 id 含源哈希，无需改键。

## 波次

| 波次 | 内容 | 波末状态 |
| --- | --- | --- |
| P2-B | backend：CT、WSI Source 改造与检测器可用性（下节） | 项目与导入的 CT、WSI 可列、可读、可跑任务 |
| P2-F | frontend：删除 `ImportPanel` 服务端文件夹部分及 `importDataSource`、`api.importDatasource` 与相关 i18n、测试 | 导入面板只剩上传与示例 |
| P2-V | 活文档同步；SDD 13 §15 P2 自查；浏览器走查 | SDD 13 标注 P2 已实现 |

## P2-B · backend

- `sources/base.py`：`SourceBase.browser_upload = True`；`upload_store._formats` 与 `DataSource.info().importable` 只汇总 `browser_upload` 为真的 Source。
- 共用解析：两模块各增 `_path_of(object_id) -> Path`：`resolve_object(object_id)` 得数据源，内置源按既有约定拼路径，其余源在 `source.root` 下按派生 id 反查；原经 `_root()` 拼路径的函数（`_load_nifti`、`nifti_path`、`_slide_path` 及其调用链）全部改走 `_path_of`。`_root()` 删除。
- CT：
  - `formats`：`.nii.gz`（`1f8b`@0）、`.nii`（`n+1\0`@344）；`browser_upload = False`。
  - `list_ids(source)`：内置源保留 `ct_\d{3}` 约定；其余源列 `source.root` 下一层合法 NIfTI（`.nii` 与 `.nii.gz`），id 为 `ct-<sha1(source_id)[:8]>-<sha1(name)[:8]>`。
  - `object_id_for`、`derive_id`；`probe`、`detect_calibration` 对非内置目录不依赖文件名前缀。
- WSI：
  - `formats`：`.svs`、`.tif`、`.tiff`、`.ndpi`、`.scn`、`.bif`，魔数 `II*\0` 与 `MM\0*`（BigTIFF `II+\0`、`MM\0+` 同列）；`browser_upload = False`。
  - `list_ids(source)`：内置源保留 `slide_\d{3}` 约定；其余源列一层中 `openslide.OpenSlide.detect_format` 非空的文件，id 为 `wsi-<…>-<…>`。
  - `object_id_for`、`derive_id`；`tile`、`frame`、`read_region` 经 `_path_of`。
- 项目源状态：`ensure_project_source` 登记即 `active`（D-24）；`register_folder` 对导入源的状态语义不变。
- 检测器可用性：`config.wsi_data_available()`、CT 对应判定与 `_wsi_ready` 改为「该模态存在活动数据源」（WSI 另需 OpenSlide 可用）；`WsiDetector.verify` 的参考文件仍只查内置根。
- 测试：
  - 现生成最小 NIfTI（nibabel）与小型 TIFF 切片（优先复制本机 `data/wsi/slide_001.svs` 改名，无数据时按现有方式 skip）。
  - 覆盖：非约定文件名在项目中打开、`frame`、`raw`、`tiles`；内置源与导入源、项目源并存互不遮蔽且内置 id 不变；只有项目源时 `/tasks` 方法可用、`/task/run` 进入检测器（CT 分割可 monkeypatch runner；WSI 无 mpp 时 422）；浏览器上传 `.nii`、`.nii.gz`、`.svs`、`.tiff` 被拒；缺 mpp 切片可打开且 `calibration` 为空。
  - 更新受影响断言：`test_project_objects.py` 中 CT 为 `unsupported_format` 的用例、`Legacy` 替身用例改用仍无 `object_id_for` 的替身。
- 门禁：`uv run pytest -q`、`uv run ruff check app tests`、`scripts/ci/check-modality-literals.sh --strict`。

## 风险

| 风险 | 处理 |
| --- | --- |
| 已有导入 CT、WSI 源的对象 id 变化，旧标注不跟随 | 导入源在 P1 前实际不可用（被内置源遮蔽），影响面小；SDD 13 D-25 记录代价 |
| `detect_format` 对大目录逐文件探测较慢 | 只在 `list_ids` 与打开时探测；`entries` 回填仍用纯派生（P1 已定） |
| 真实 CT 分割与细胞核检测依赖外部 runner | 单测 monkeypatch runner；真实运行放浏览器走查 |
