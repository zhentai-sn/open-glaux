---
kind: living
status: living
---

# DataSource 注册表 runbook —— 数据导入 + 开发者/产品模式

> 落地计划：[docs/plans/2026-07-13-001-feat-datasource-registry-plan.md](../plans/2026-07-13-001-feat-datasource-registry-plan.md) ·
> 导入入口见 [SDD 08](../sdd/feats/08-data-import-first-explorer/README.md)

## 一句话

数据源从 config 写死固定根解耦到运行时 **DataSource 注册表**：新增数据 = 上传文件或导入一个文件夹
（`POST /uploads/images` / `POST /datasources`），不改代码；缺省是**产品模式**，空源起步，示例数据按需加载。
导入文件夹时自动探测标定（WSI mpp / CT voxel / 视频帧率），读不出则 `needs_calibration` 硬拒绝。
本机任意目录也可作为**项目**打开（[SDD 13](../sdd/feats/13-project-folder-sessions/README.md)）：打开时不扫描，
文件被打开时才按「目录 + 模态」登记数据源，见下文「项目与按需登记」。

模态由后端数据轴注册表 `SOURCES`（`backend/app/sources/`，[SDD 10](../sdd/feats/10-object-convergence/README.md) §8.2）
决定，一个模态一个 `Source`，登记在 `backend/app/sources/__init__.py` 的 `_MODULES` 一行。对象 id 的唯一解析入口是
`datasource_registry.resolve_object`：未知 id 一律 404，不回落到合成图。

## 两种模式

| | 产品模式 `GLAUX_DEV_MODE=0`（缺省） | 开发者模式 `GLAUX_DEV_MODE=1` |
|---|---|---|
| 内置源 | 无；「加载示例数据」按需注册 | 5 个（CUBS / HC18 / CT / WSI / Natural images）= config 根实时视图 |
| 合成源 | 无 | `synthetic-us`（颈动脉）、`synthetic-hc`（胎儿头围）；仅当同模态没有其他 active 源时为 active |
| 行为 | 干净起步，导入后才有源 | seed root == config 默认，逐字节一致 |
| 前端标识 | 插件市场顶部「产品模式（仅导入源）」绿点 | 「开发者模式（内置数据源）」紫点 |
| 用途 | 真实用户部署 | 本机开发、e2e、演示 |

切换：`export GLAUX_DEV_MODE=1` 后重启后端即开发者模式。`make dev` 与 `scripts/dev/run-backend.sh`
已显式置 1，本地联调默认就是开发者模式。

## 关键路径 / env

| env | 缺省 | 作用 |
|---|---|---|
| `GLAUX_DEV_MODE` | `0` | 开发者模式开关（是否提供内置源）；SDD 08 D-4 起缺省关闭 |
| `GLAUX_DATASETS_ROOT` | `~/glaux_datasets` | 导入白名单根——`POST /datasources` 只接受此目录下路径（防任意目录读）；浏览器上传落在其下 `uploads/`。项目目录不受此约束，改由回环守卫限制 |
| `GLAUX_SOURCES_FILE` | `~/glaux_datasets/sources.json` | 落盘清单：`sources`（导入、连接器、项目源）、`samples`（已打开的示例源 id）、`projects`（已登记项目）；内置源不落盘，实时从 config 读 |
| `WSL_DISTRO_NAME` | WSL 自动注入 | 存在时 backend 视为运行在 WSL：接受 `C:\…` 与 `\\wsl.localhost\<发行版>\…` 写法，快捷根列出 `/mnt/<盘符>` |

## 导入数据（两种方式）

### A. 前端 UI（统一导入面板）

面板出现在资源管理器（空态常驻，有数据时点标题栏 ＋ 展开）与插件市场的「观测空间 · 数据读取」组里，
三个入口：

1. **拖拽图片或视频 / 选择文件…**：浏览器上传，图像单个 ≤ 32 MiB，视频单个 ≤ 512 MiB、最长 10 分钟；一次最多 20 个（`POST /uploads/images`）。
   后端按后缀加魔数推断模态：JPEG / PNG → `natural_image`，MP4 / WebM → `video`（需 PyAV）；一批只落一个
   数据源，模态取第一个受理文件的模态，其余模态的文件按 `unsupported_type` 拒收。前端文件选择器目前仍只放行
   JPEG / PNG，改读 `/datasources` 的 `importable` 在 SDD 10 W3。
2. **加载示例数据**：注册仓库自带的示例源（`POST /datasources/samples`）；幂等，内置根都没数据时返回空。
3. **打开服务端文件夹（医学数据）**：填服务端路径（须在 `~/glaux_datasets` 下）+ 选模态
   （pathology / ct_abdomen）→ **导入**；成功后该模态列表里即出现这批数据。CT、WSI 在项目中打开要到 SDD 13 P2
   才支持，在此之前这是这两个模态的导入途径；P2 落地后该入口由「打开项目」取代并删除。

作用域规则：

- 文件栏里的导入面板只在「未归属」会话中出现；插件市场里的导入面板在任何会话中可用。
- 在项目会话中上传的文件，数据源带该项目的 `project_id`，在项目目录树的「上传」节点下列出；落盘仍在
  `GLAUX_DATASETS_ROOT/uploads/`，落盘子目录按「项目 + 名称」派生，不同项目的同名上传是两个数据源。
- 「打开服务端文件夹」导入的源与示例源始终属于「未归属」，只在「未归属」会话的文件栏中列出。

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

## 项目与按需登记

操作入口见 [reference-agent-conversations.md](reference-agent-conversations.md) §5.2～§5.4，契约见 [SDD 13](../sdd/feats/13-project-folder-sessions/README.md)。

| 步骤 | 端点 | 行为 |
|---|---|---|
| 浏览目录 | `GET /fs/roots`、`GET /fs/dirs?path=` | 快捷根与单层子目录；只列目录，跳过 `.` 开头的条目 |
| 登记项目 | `POST /projects {path}` | 路径写法转换 → `resolve` → `project_id = prj-<sha1(路径)[:8]>`；新建 201，已存在 200；不扫描目录 |
| 列目录 | `GET /projects/{id}/entries?path=` | 项目内一层条目；文件只按后缀给候选模态，不读内容；已登记的文件回填 `object_id` |
| 打开文件 | `POST /projects/{id}/objects {path}` | 后缀 + 魔数校验；首次打开时按「目录 + 模态」登记 `origin=project` 的数据源（id `psrc-…`），同目录同模态的文件复用；返回 `ObjectMeta` |
| 移除项目 | `DELETE /projects/{id}` | 注销项目与其数据源；不删磁盘文件、不删会话 |

```bash
curl -s -X POST localhost:8000/projects -H 'Content-Type: application/json' \
  -d '{"path":"C:\\cases\\liver"}'                       # WSL 下等价于 /mnt/c/cases/liver
curl -s 'localhost:8000/projects/prj-1a2b3c4d/entries?path=day1'
curl -s -X POST localhost:8000/projects/prj-1a2b3c4d/objects \
  -H 'Content-Type: application/json' -d '{"path":"day1/scan_01.jpg"}'
```

- 路径写法：POSIX、`C:\…`、`\\wsl.localhost\<发行版>\…`（含 `\\wsl$\…`）；后两种只在 WSL 下可用，发行版须与 backend 一致，否则 422。
- 项目内路径含 `..`、是绝对路径或经符号链接指向项目外 → 422 `outside_project`。
- P1 可打开 `natural_image`、`video`；CT、WSI 文件 → 422 `unsupported_format`，仍经「打开服务端文件夹」导入。
- 后缀可识别但内容不符 → 422 `corrupt`，不留下数据源。
- 同一目录先经「打开服务端文件夹」导入、后在项目中打开，得到两个数据源，对象 id 不同，旧标注不跟随。
- 回环守卫：`/fs/*` 与 `/projects*` 只接受回环来源，带 `X-Forwarded-For` / `Forwarded` 头时逐跳校验；局域网来源 403。
  上面的 `curl` 须在 backend 所在机器上执行。

## 标定探测（U3）

导入时无显式标定 → 按模态从数据文件读嵌入标定（`Source.detect_calibration`，`datasource_detect.detect` 只做分派）：

| 模态 | 探测源 | 命名要求 |
|---|---|---|
| pathology | OpenSlide `mpp-x/y` | `slide_NNN.<svs/ndpi/...>` |
| ct_abdomen | NIfTI header `pixdim` | `ct_NNN.nii.gz` |
| video | 容器帧率（PyAV 解复用） | `*.mp4` / `*.webm`，id 由服务端派生为 `vid-<源哈希>-<文件名哈希>` |

`natural_image` 不需要标定（`Source.calibration_required = False`），空标定即 `active`。

读得出 → `status=active`；读不出（缺嵌入标定）→ `status=needs_calibration`（**不猜标定**，
`resolve_root` 不返回它 → 该源数据不列出，跑任务硬拒绝）。可在导入请求带 `calibration` 手动覆盖：

```bash
-d '{"path":"...","modality":"pathology","calibration":{"mpp":[0.25,0.25]}}'
```

## 范围

- **完整可用**：浏览器上传通用图像（JPEG / PNG）；WSI + CT 文件夹导入端到端（列表 / 浏览 / 跑任务 / 删除）。
- **视频逐帧可用**：video 的上传 / 文件夹导入、列表（`GET /images?modality=video`，含音轨声明 `streams[]`）、
  `GET /objects/{id}/frame?t=N` 取帧；前端按 `timeline` 能力位显示时间轴，可在当前帧画 bbox / polygon / 画笔，标注以 `index.t` 落库并按帧回显；agent 从同一焦点帧取观测。PyAV 是可选依赖：
  `uv pip install -e ".[video]"`（`make install-backend` 已含），缺库时 video 模态不可用、其余模态不受影响。
- **暂 config-rooted**：carotid（CUBS 需 images+CF+LIMA-Profiles 三子目录）、HC（真/合成路由）——
  仅作内置示例源出现，导入后续（见计划 §2）。
- **不做**：真 PACS 连接器、市场远程安装（`connector` 仍 planned 占位）。
- **市场只卖能力/连接器，不卖数据字节**——真实医疗数据永不进市场（PHI 红线）。

## 已知坑

- **内置源是 config 实时视图，非快照**：`_builtin_live()` 每次读 `config.X_ROOT` 属性——故测试
  `monkeypatch.setattr(config, "CT_ROOT", tmp)` 立即反映（若快照则不反映，会大面积假失败）。
- **`config.*_available()` 现注册表感知**：内部走 `resolve_root + root_has_data`；`root_has_data` 是
  `SOURCES[modality].probe` 的薄 alias，**不查注册表**（直接判目录）——否则 seed 探针 → available →
  resolve_root → seed 递归。测试里打桩「某根有无数据」用 conftest 的 `probe_only` fixture。
- **对象索引**：`resolve_object` 先查 `id → ObjectRef` 索引（首次解析时由各源 `list_ids` 建立），未命中再在
  active 源里现列一次兜底。`register_folder` / 加载示例 / `remove` 会同时作废各 Source 缓存与索引。
- **合成源与真实源互斥**：合成 id 与 CUBS 真实 id 同形（`tech_4xx`），同时 active 会让一个 id 指向两张图，
  故合成源只在同模态无其他 active 源时为 active；有真实数据时它在 `/datasources` 里显示为 `empty`。
- **模态缺依赖**：某个数据模块导入失败（如缺 science-core）时该模态不进 `SOURCES`，`/datasources` 不列出
  该模态的源（落盘清单保留），`/images?modality=` 返回空数组。
- **多源歧义**：一个模态多 active 源时取 `list_all` 首个（builtin 在前）；多源选择是后续。
- **模式标识看的是有无内置源**：前端按 `origin == "builtin"` 判模式；产品模式下「加载示例数据」注册的示例源也是 builtin，
  所以之后顶部显示「开发者模式（内置数据源）」紫点，`GLAUX_DEV_MODE` 本身没有变。
- **落盘并发**：`sources.json` 单后端进程假设（原子写 tmp+rename）；进程内读改写与落盘共用一把 `RLock`，
  并发按需登记同一目录只登记一条；多进程写需另加文件锁（同 P6 mask-edit）。
- **项目状态实时判定**：`GET /projects` 每次检查目录是否存在且可读，不可用时 `status=missing`；该状态不落盘。

## 测试

`backend/tests/test_datasource_registry.py`、`test_datasource_detect.py`、`test_datasource_samples.py`、
`test_datasources_api.py`、`test_uploads_api.py`、`test_upload_store.py`、`test_sources.py`（SOURCES 不变量、
resolve_object、合成源、删源）、`test_video.py`（测试内合成 mp4，缺 PyAV 时整文件跳过）、`test_paths.py`（路径写法转换）、
`test_projects.py`（项目登记、回环守卫、目录浏览）、`test_project_objects.py`（按需登记、越界、上传归属）。
回环守卫在测试中经 `app.dependency_overrides[require_loopback]` 放行（`TestClient` 的来源地址是 `testclient`）。
