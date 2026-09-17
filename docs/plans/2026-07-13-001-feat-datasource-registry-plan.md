---
kind: record
status: done
---

# 计划：DataSource 注册表 + 文件夹导入 + 开发者模式（数据表征层解耦）

> 讨论背景：数据集不该「内置在文件树 / 写死在 config」，应可**手动导入文件夹**，
> 长远从**插件市场**加载连接器。本计划落地其中**可落地的一半**——数据表征层从
> 「代码硬编码固定路径」改为「运行时 DataSource 注册表」，并保留一个**开发者模式**
> 让现有 dev/CI 工作流零破坏。

## 0. 一句话

把 4 个模态的数据来源从 `config.py` 写死的固定根 + `capabilities()` 里硬编码的数据集卡，
统一到一个 **DataSource 注册表**（可落盘、可运行时增删）；新增数据 = 注册一个源
（文件夹导入），**不改代码**；内置源在**开发者模式**下从 config 自动 seed，现状不变。

## 1. 为什么（现状的耦合，均有据可查）

| 症状 | 证据 |
|---|---|
| 数据集根写死 | [`config.py`](../../backend/app/config.py) `DATA_ROOT`/`HC18_ROOT`/`CT_ROOT`/`WSI_ROOT` 四处 + 各自 `*_available()` |
| 数据集卡硬编码 | [`kernel.py:452-470`](../../backend/app/kernel.py) `capabilities()` 里 `dataset:cubs-tech`/`dataset:hc18` 手写 |
| 发现靠固定目录 glob | `dataset.list_ids` glob `IMAGES_DIR`、`dataset_ct` glob `CT_ROOT/ct_*`、`dataset_wsi` glob `slide_*` |
| 加第 5 个数据集要改 3 处代码 | config 加路径 + available 函数 + capabilities 卡 + 可能 dataset 模块 |
| 真实用户导不进自己的片子 | 无「注册数据源」入口，只有 env 覆盖（dev 手段，非产品能力） |

**但接缝已经埋好**：`capabilities()` 已是「插件市场单一真相源」，用**环境四层**本体
（representation / action / verification / memory）把数据集收成 `kind:dataset,
layer:representation` 的卡，并有 `connector:dicom-pacs`（status=planned）占位——
本计划是把这套目录从「硬编码」变「注册表驱动」，不是另起炉灶。

## 2. 目标 / 非目标

**做：**
- `DataSource` 契约 + 注册表模块（内存 + 落盘 json），运行时可增删。
- 各 `dataset*.list_ids/image_meta` 改走注册表取源（**保持函数签名**，只换数据来源）。
- `POST /datasources`（导入文件夹）+ `GET /datasources`；`capabilities()` 数据集卡动态化。
- **开发者模式**：`GLAUX_DEV_MODE`（缺省 on）门控——从 config env 把现有 4 源 seed 成 `builtin`。
- 导入时**捕获标定**（WSI mpp / CT voxel / US CF / HC pixel-size），缺则 `needs_calibration` + 跑任务硬拒绝。
- 前端「数据源」概念：侧栏「+ 导入数据源」入口 + 开发者模式标识。

**明确不做（边界）：**
- **不分发数据字节**——市场卖连接器/清单，不卖患者数据（法律红线，见 §7）。
- v0 不做真 PACS 连接器、不做远程下载/安装/沙箱编排（`connector` 仍 planned 占位）。
- **不碰能力层**：`_detect_for_spec` 的 adapter 分派、各 measure/driver/viewer 一律不动。
- 不做多租户上传（v0 导入 = 服务端可达的文件夹路径；真上传是后续）。

## 3. 核心设计

### 3.1 DataSource 契约（science-core 或 backend/app）

```python
@dataclass(frozen=True)
class DataSource:
    id: str                       # "cubs-tech" / "imported-a1b2" / "connector:pacs"
    name: str                     # 展示名
    modality: Modality            # carotid_imt / fetal_hc / ct_abdomen / pathology
    root: Path                    # 数据根（文件夹）
    origin: Literal["builtin", "imported", "connector"]
    calibration: dict             # 标定提示：{"mpp": [..]} / {"voxel_mm": [..]} / {"cf": ..} / {} 
    status: Literal["active", "needs_calibration", "empty", "planned"]
```

### 3.2 注册表模块 `datasource_registry.py`

- 内存 dict + 落盘 `sources.json`（路径由 `GLAUX_SOURCES_FILE` 定，缺省 `~/glaux_datasets/sources.json`）。
- `seed_builtin()`：**仅开发者模式**调用，从 config 的 4 个 env 根注册 `origin="builtin"` 源
  （复用现有 `*_available()` 判断 status）。
- `register_folder(path, modality, calibration)`：校验路径存在 + 探测标定 → 落盘 → 返回 DataSource。
- `sources_for(modality)` / `list_all()`：发现改查这里，不再 glob 固定根。
- `resolve_root(modality)`：给 `dataset*.py` 用——返回该模态当前 active 源的 root（多源 v0 取第一个 active，多源选择是后续）。

### 3.3 开发者模式（用户明确要保留）

| | 开发者模式 `GLAUX_DEV_MODE=1`（缺省） | 产品模式 `GLAUX_DEV_MODE=0` |
|---|---|---|
| 启动 seed | `seed_builtin()` 注册 CUBS/HC18/CT/WSI 内置源 | 不 seed，数据源列表空 |
| 行为 | **= 现状**，四模态数据present 即亮 | 干净起步，用户导入/连接器后才有源 |
| CI / mock 回退 | 不变（无数据仍回退 mock/503） | 同 |
| 用途 | 本机开发、e2e、演示脚本 | 真实用户部署、多租户演示 |
| 标识 | 前端角标「开发者模式」 | 无 |

→ **零破坏保证**：缺省 `GLAUX_DEV_MODE=1` 时，`seed_builtin()` 产生的源 root 与今天
config 默认完全一致，`list_ids`/`/images`/`capabilities()` 输出逐字节不变。开发者模式
就是「现状的显式命名」。

### 3.4 标定捕获（导入的硬骨头，护城河延伸）

导入任意文件夹时按模态探测标定，**缺标定不静默——标 `needs_calibration`，跑任务时硬拒绝**：

| 模态 | 标定来源 | 探测 | 缺失时 |
|---|---|---|---|
| pathology | OpenSlide `mpp-x/y` | `dataset_wsi.mpp`（已硬拒绝） | needs_calibration |
| ct_abdomen | NIfTI header pixdim | `dataset_ct.vox_spacing_mm` | needs_calibration |
| carotid_imt | 每图 CF 文件 / 用户填 | CF 目录探测；无则要用户提供 | needs_calibration（IMT 已硬拒绝无 CF）|
| fetal_hc | pixel-size csv / 用户填 | csv 探测 | needs_calibration |

这与现有 `_detect_for_spec` 的「标定不可用 → ValueError → 422」一脉相承，只是把关口前移到导入。

## 4. 落地单元（Units）

### U1 — DataSource 契约 + 注册表模块 + 开发者模式 seed
- `DataSource` dataclass + `datasource_registry.py`（内存 + `sources.json` 落盘）。
- `seed_builtin()` 从 config env 注册 4 内置源；`GLAUX_DEV_MODE` 门控（缺省 on）。
- 单测：seed 后 `sources_for(modality)` 与 config 现状一致；产品模式下空；落盘/回读幂等。

### U2 — dataset 模块改走注册表 + 发现端点
- `dataset*.list_ids/image_meta` 内部从固定 root → `registry.resolve_root(modality)`（**签名不变**）。
- `GET /datasources`（列所有源 + status）；`POST /datasources`（导入文件夹：path+modality → 校验+探测+落盘）。
- `capabilities()` 数据集卡从 `list_all()` 动态生成（删硬编码的 cubs/hc18 卡）。
- **回归红线**：开发者模式下 `/images`（四模态）、`/slides`、`/volumes`、`/capabilities` 输出与改前一致。

### U3 — 标定捕获 + 导入硬拒绝
- 导入时按 §3.4 探测标定写入 `DataSource.calibration`；缺 → `status=needs_calibration`。
- `needs_calibration` 源上跑 `/task/run` → 沿用现有 422 硬拒绝路径（补测试覆盖导入源）。
- 支持导入请求带显式标定覆盖（用户手填 mpp/cf）。

### U4 — 前端「数据源」概念 + 导入入口
- 侧栏 Explorer 顶部「+ 导入数据源」→ 填文件夹路径 + 选模态（+ 可选标定）→ `POST /datasources` → 刷新列表。
- 数据源分组显示（builtin / imported）；`needs_calibration` 源置灰 + 提示补标定。
- `types.ts` 加 `DataSource`；`client.ts` 加 `datasources()`/`importDatasource()`。
- 现有 `loadImages/switchModality` 的模态分支不变（仍按 modality 拉列表；列表来源已换成注册表驱动，前端无感）。

### U5 — 开发者模式开关 + 能力市场页接线
- `GET /config`（或 `/capabilities` 附带）下发 `dev_mode` 标志；前端角标显示。
- 能力市场页（若已有 capabilities 视图）数据集卡接 `/datasources` 的真实 status；`connector` 卡保持 planned。
- 产品模式冒烟：空源起步 → 导入一个文件夹 → 该模态点亮。

### U6 — runbook + 测试回归 + 文档
- `docs/runbooks/datasource-registry.md`：两种模式切换、导入文件夹步骤、标定要求、`sources.json` 格式。
- 三套测试（science-core/backend/前端 typecheck+build）回归绿。
- 更新 `config.py` docstring + 相关 README（数据不再「内置」的说明）。

## 5. 风险 / 坑

- **回归风险（最高）**：`list_ids` 改数据来源可能扰动四模态现状 → U2 设「输出逐字节一致」红线测试，
  开发者模式 seed 的 root 必须 == 今天 config 默认。
- **标定静默丢失**：导入无标定的 WSI/CT，若不拦，算密度/体积静默错 → U3 硬拒绝，`needs_calibration` 门控。
- **路径穿越 / 任意读**：`POST /datasources` 收文件夹路径 = 服务端任意目录读风险 → 校验路径在允许根下
  （`GLAUX_DATASETS_ROOT` 白名单）+ 复用现有 `is_ct/is_wsi` 白名单式守卫。
- **多源歧义**：一个模态多个 active 源时 v0 取第一个 → 明确标注「多源选择是后续」，不在本计划。
- **落盘并发**：`sources.json` 多进程写 → 复用 P6 mask-edit 的锁模式或单写者假设（v0 单后端进程，够）。

## 6. 验收

- [ ] 开发者模式（缺省）：`/images`×4 模态、`/slides`、`/volumes`、`/capabilities` 与改前一致（红线测试绿）。
- [ ] 产品模式（`GLAUX_DEV_MODE=0`）：数据源列表空；导入一个 WSI 文件夹 → `/slides` 出该片 → 能跑核检测。
- [ ] 导入无 mpp 的 WSI → `needs_calibration` → 跑核检测 422 硬拒绝（不出假密度）。
- [ ] `capabilities()` 数据集卡随 `/datasources` 动态变（加一个源 → 多一张卡，不改代码）。
- [ ] 前端「+ 导入数据源」端到端：填路径 → 该模态侧栏出现新数据。
- [ ] 三套测试 + 前端 build 绿。

## 7. 与「插件市场」的关系（本计划的定位）

本计划只做**数据平面**的解耦（本地数据源注册表 + 文件夹导入）。**能力平面**（模态 TaskPlugin
作为可安装能力）和**连接器市场**（PACS / 数据集 fetch 配方）是后续：

- 市场分发的是**能力和连接器**，**不是数据字节**——真实医疗数据永不进市场（PHI/隐私/授权红线）。
- demo 数据（CUBS/HC18）走**连接器**（指向 Zenodo/官方源的 fetch 配方），不镜像字节。
- `connector` 卡在 `capabilities()` 已占位（planned）——本计划让数据集卡先动态化，为连接器接线铺路。

> 一句话定位：**「数据集不内置」的正解是「本地数据源注册表 + 文件夹导入」（本计划），
> 不是从市场下载数据；市场是后续，且卖能力/连接器而非数据。**
