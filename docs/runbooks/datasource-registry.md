# DataSource 注册表 runbook —— 文件夹导入 + 开发者/产品模式

> 落地计划：[docs/plans/2026-07-13-001-feat-datasource-registry-plan.md](../plans/2026-07-13-001-feat-datasource-registry-plan.md)

## 一句话

数据表征层从 config 写死固定根解耦到运行时 **DataSource 注册表**：新增数据 = 导入一个文件夹
（`POST /datasources`），不改代码；**开发者模式**（缺省）内置源 = config 实时视图，现状零破坏；
**产品模式**空源起步，用户导入。导入自动探测标定（WSI mpp / CT voxel），读不出则 `needs_calibration` 硬拒绝。

## 两种模式

| | 开发者模式 `GLAUX_DEV_MODE=1`（缺省） | 产品模式 `GLAUX_DEV_MODE=0` |
|---|---|---|
| 内置源 | 4 个（CUBS/HC18/CT/WSI）= config 根实时视图 | 无 |
| 行为 | == 现状（seed root == config 默认，逐字节一致） | 干净起步，导入后才有源 |
| 前端标识 | 市场页「开发者模式（内置数据源）」紫点 | 「产品模式（仅导入源）」绿点 |
| 用途 | 本机开发、e2e、演示 | 真实用户部署 |

切换：`export GLAUX_DEV_MODE=0` 后重启后端即产品模式。

## 关键路径 / env

| env | 缺省 | 作用 |
|---|---|---|
| `GLAUX_DEV_MODE` | `1` | 开发者模式开关（是否提供内置源） |
| `GLAUX_DATASETS_ROOT` | `~/glaux_datasets` | 导入白名单根——`POST /datasources` 只接受此目录下路径（防任意目录读） |
| `GLAUX_SOURCES_FILE` | `~/glaux_datasets/sources.json` | 导入/连接器源落盘清单（内置源不落盘，实时从 config 读） |

## 导入一个文件夹（两种方式）

### A. 前端 UI（市场页）

1. 活动栏点 **「插件市场」** → 顶部见模式标识。
2. **表征层** 下点 **「＋ 导入数据源」** 展开表单。
3. 填**服务端文件夹路径**（须在 `~/glaux_datasets` 下）+ 选模态（v0：pathology / ct_abdomen）→ **导入**。
4. 成功 → 出一张 `dataset` 卡（带 × 可删）；数据即出现在资源管理器该模态列表。

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

## 范围（v0）

- **完整可用**：WSI + CT 文件夹导入端到端（列表 / 浏览 / 跑任务 / 删除）。
- **暂 config-rooted**：carotid（CUBS 需 images+CF+LIMA-Profiles 三子目录）、HC（真/合成路由）——
  仅作内置源出现在市场，导入后续（见计划 §2）。
- **不做**：浏览器上传（v0 是服务端可达路径）、真 PACS 连接器、市场远程安装（`connector` 仍 planned 占位）。
- **市场只卖能力/连接器，不卖数据字节**——真实医疗数据永不进市场（PHI 红线）。

## 已知坑

- **内置源是 config 实时视图，非快照**：`_builtin_live()` 每次读 `config.X_ROOT` 属性——故测试
  `monkeypatch.setattr(config, "CT_ROOT", tmp)` 立即反映（若快照则不反映，会大面积假失败）。
- **`config.*_available()` 现注册表感知**：内部走 `resolve_root + root_has_data`；`root_has_data`
  **不查注册表**（直接判目录）——否则 seed 探针 → available → resolve_root → seed 递归。
- **多源歧义**：一个模态多 active 源时 v0 取 `list_all` 首个（builtin 在前）；多源选择是后续。
- **落盘并发**：`sources.json` 单后端进程假设（原子写 tmp+rename）；多进程写需加锁（同 P6 mask-edit）。

## 验证（真机 e2e，2026-07-13）

- 110→124 后端测试全绿（+22 注册表 / +9 端点 / +5 探测；现有四模态端点测试不变 = 零破坏证明）。
- UI 闭环：市场页导入 `~/glaux_datasets/imported_wsi_test`（真 demo slide）→ 自动探测
  `mpp [0.499,0.499]` → `active` → 出卡 → × 删除 → 归 0。全绿。
- 前端 typecheck + build 绿。
