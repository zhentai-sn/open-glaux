---
kind: living
status: living
---

# DataSource 注册表 runbook —— 数据导入 + 开发者/产品模式

> 落地计划：[docs/plans/2026-07-13-001-feat-datasource-registry-plan.md](../plans/2026-07-13-001-feat-datasource-registry-plan.md) ·
> 导入入口见 [SDD 08](../sdd/feats/08-data-import-first-explorer/README.md)

## 一句话

数据源从 config 写死固定根解耦到运行时 **DataSource 注册表**：新增数据 = 上传图片或导入一个文件夹
（`POST /uploads/images` / `POST /datasources`），不改代码；缺省是**产品模式**，空源起步，示例数据按需加载。
导入文件夹时自动探测标定（WSI mpp / CT voxel），读不出则 `needs_calibration` 硬拒绝。

## 两种模式

| | 产品模式 `GLAUX_DEV_MODE=0`（缺省） | 开发者模式 `GLAUX_DEV_MODE=1` |
|---|---|---|
| 内置源 | 无；「加载示例数据」按需注册 | 5 个（CUBS / HC18 / CT / WSI / Natural images）= config 根实时视图 |
| 行为 | 干净起步，导入后才有源 | seed root == config 默认，逐字节一致 |
| 前端标识 | 插件市场顶部「产品模式（仅导入源）」绿点 | 「开发者模式（内置数据源）」紫点 |
| 用途 | 真实用户部署 | 本机开发、e2e、演示 |

切换：`export GLAUX_DEV_MODE=1` 后重启后端即开发者模式。`make dev` 与 `scripts/dev/run-backend.sh`
已显式置 1，本地联调默认就是开发者模式。

## 关键路径 / env

| env | 缺省 | 作用 |
|---|---|---|
| `GLAUX_DEV_MODE` | `0` | 开发者模式开关（是否提供内置源）；SDD 08 D-4 起缺省关闭 |
| `GLAUX_DATASETS_ROOT` | `~/glaux_datasets` | 导入白名单根——`POST /datasources` 只接受此目录下路径（防任意目录读） |
| `GLAUX_SOURCES_FILE` | `~/glaux_datasets/sources.json` | 导入/连接器源落盘清单（内置源不落盘，实时从 config 读） |

## 导入数据（两种方式）

### A. 前端 UI（统一导入面板）

面板出现在资源管理器（空态常驻，有数据时点标题栏 ＋ 展开）与插件市场的「观测空间 · 数据读取」组里，
三个入口：

1. **拖拽图片 / 选择文件…**：浏览器上传，JPEG / PNG，单个 ≤ 32 MB，一次最多 20 个（`POST /uploads/images`）。
2. **加载示例数据**：注册仓库自带的示例源（`POST /datasources/samples`）；幂等，内置根都没数据时返回空。
3. **打开服务端文件夹（医学数据）**：填服务端路径（须在 `~/glaux_datasets` 下）+ 选模态
   （pathology / ct_abdomen）→ **导入**；成功后该模态列表里即出现这批数据。

### B. REST

```bash
# 造一个白名单下的 WSI 文件夹
mkdir -p ~/glaux_datasets/my_slides
cp /path/to/some.svs ~/glaux_datasets/my_slides/slide_001.svs   # 命名须 slide_NNN.<vendor后缀>

# 导入（不传 calibration → 后端从 slide 自动探测 mpp）
curl -s -X POST localhost:8000/datasources \
  -H 'Content-Type: application/json' \
  -d '{"path":"/home/USER/glaux_datasets/my_slides","modality":"pathology"}' | python3 -m json.tool
# → {"id":"imported-xxxx","status":"active","calibration":{"mpp":[0.499,0.499]},...}

curl -s localhost:8000/datasources           # 列表（builtin + imported）
curl -s -X POST localhost:8000/datasources/samples   # 加载内置示例源
curl -s -X DELETE localhost:8000/datasources/imported-xxxx   # 删除（builtin 不可删 → 404）
```

## 标定探测（U3）

导入时无显式标定 → 按模态从数据文件读嵌入标定（`datasource_detect.py`）：

| 模态 | 探测源 | 命名要求 |
|---|---|---|
| pathology | OpenSlide `mpp-x/y` | `slide_NNN.<svs/ndpi/...>` |
| ct_abdomen | NIfTI header `pixdim` | `ct_NNN.nii.gz` |

读得出 → `status=active`；读不出（缺嵌入标定）→ `status=needs_calibration`（**不猜标定**，
`resolve_root` 不返回它 → 该源数据不列出，跑任务硬拒绝）。可在导入请求带 `calibration` 手动覆盖：

```bash
-d '{"path":"...","modality":"pathology","calibration":{"mpp":[0.25,0.25]}}'
```

## 范围

- **完整可用**：浏览器上传通用图像（JPEG / PNG）；WSI + CT 文件夹导入端到端（列表 / 浏览 / 跑任务 / 删除）。
- **暂 config-rooted**：carotid（CUBS 需 images+CF+LIMA-Profiles 三子目录）、HC（真/合成路由）——
  仅作内置示例源出现，导入后续（见计划 §2）。
- **不做**：真 PACS 连接器、市场远程安装（`connector` 仍 planned 占位）。
- **市场只卖能力/连接器，不卖数据字节**——真实医疗数据永不进市场（PHI 红线）。

## 已知坑

- **内置源是 config 实时视图，非快照**：`_builtin_live()` 每次读 `config.X_ROOT` 属性——故测试
  `monkeypatch.setattr(config, "CT_ROOT", tmp)` 立即反映（若快照则不反映，会大面积假失败）。
- **`config.*_available()` 现注册表感知**：内部走 `resolve_root + root_has_data`；`root_has_data`
  **不查注册表**（直接判目录）——否则 seed 探针 → available → resolve_root → seed 递归。
- **多源歧义**：一个模态多 active 源时取 `list_all` 首个（builtin 在前）；多源选择是后续。
- **模式标识看的是有无内置源**：前端按 `origin == "builtin"` 判模式；产品模式下「加载示例数据」注册的示例源也是 builtin，
  所以之后顶部显示「开发者模式（内置数据源）」紫点，`GLAUX_DEV_MODE` 本身没有变。
- **落盘并发**：`sources.json` 单后端进程假设（原子写 tmp+rename）；多进程写需加锁（同 P6 mask-edit）。

## 测试

`backend/tests/test_datasource_registry.py`、`test_datasource_detect.py`、`test_datasource_samples.py`、
`test_datasources_api.py`、`test_uploads_api.py`、`test_upload_store.py`。
