---
kind: living
status: living
---

# DataSource 注册表 runbook —— 数据导入 + 开发者/产品模式

> 落地计划：[docs/plans/2026-07-13-001-feat-datasource-registry-plan.md](../plans/2026-07-13-001-feat-datasource-registry-plan.md) ·
> 导入入口见 [SDD 08](../sdd/feats/08-data-import-first-explorer/README.md)

## 一句话

数据源从 config 写死固定根解耦到运行时 **DataSource 注册表**，新增数据不改代码，三条途径：

- 浏览器上传通用图像、视频（`POST /uploads/images`）。
- 把本机任意目录作为**项目**打开（[SDD 13](../sdd/feats/13-project-folder-sessions/README.md)）：打开时不扫描，
  文件被打开时才按「目录 + 模态」登记数据源，见下文「项目与按需登记」。UI 中 CT、WSI 只经此途径接入。
- 经 REST 导入 `GLAUX_DATASETS_ROOT` 下的一个文件夹（`POST /datasources`），供 API 与脚本使用，UI 不提供入口。

缺省是**产品模式**，空源起步，示例数据按需加载。导入文件夹时自动探测源级标定（WSI mpp / CT voxel / 视频帧率），
读不出则 `needs_calibration`；项目源登记即 `active`，标定以对象级为准，见「标定探测」。

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
两个入口：

1. **拖拽图片或视频 / 选择文件…**：浏览器上传，图像单个 ≤ 32 MiB，视频单个 ≤ 512 MiB、最长 10 分钟；一次最多 20 个（`POST /uploads/images`）。
   后端按后缀加魔数推断模态：JPEG / PNG / TIFF → `natural_image`，MP4 / WebM → `video`（需 PyAV）；一批只落一个
   数据源，模态取第一个受理文件的模态，其余模态的文件按 `unsupported_type` 拒收。前端文件选择器与拖拽预检读
   `GET /uploads/formats` 的后缀清单。
2. **加载示例数据**：注册仓库自带的示例源（`POST /datasources/samples`）；幂等，内置根都没数据时返回空。

医学卷不走浏览器上传：`SourceBase.browser_upload` 决定一个模态是否受理上传，CT、WSI 为假，其后缀不进上传受理表、
`/uploads/formats` 与 `/datasources` 的 `importable`。服务端目录（含 CT、WSI）经左侧栏「打开文件夹」作为项目接入。

作用域规则：

- 文件栏里的导入面板只在「未归属」会话中出现；插件市场里的导入面板在任何会话中可用。
- 在项目会话中上传的文件，数据源带该项目的 `project_id`，在项目目录树的「上传」节点下列出；落盘仍在
  `GLAUX_DATASETS_ROOT/uploads/`，落盘子目录按「项目 + 名称」派生，不同项目的同名上传是两个数据源。
- 上传文件落盘名为 `img-<哈希>.<ext>`，原始文件名记在同目录的 `.glaux-names.json`，文件栏与「最近使用」据此显示原名；删掉该清单只会让显示名回退到落盘名。
- 经 `POST /datasources` 导入的源与示例源不带 `project_id`，属于「未归属」，只在「未归属」会话的文件栏中列出。

### B. REST

`POST /datasources` 供 API 与脚本使用，只接受 `GLAUX_DATASETS_ROOT` 下的目录。导入源按目录列举一层文件，
识别规则与对象 id 规则同项目源，见下文「CT、WSI 的识别与对象 id」。

```bash
# 造一个白名单下的 WSI 文件夹（文件名不限，后缀须属单文件 TIFF 族）
mkdir -p ~/glaux_datasets/my_slides
cp /path/to/some.svs ~/glaux_datasets/my_slides/

# 导入（不传 calibration → 后端从第一张可识别切片探测 mpp）
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
- 可打开 `natural_image`、`video`、`ct_abdomen`、`pathology`；后缀不属于任何模态的 `formats` → 422 `unsupported_format`。
- 后缀可识别但内容不符 → 422 `corrupt`，不留下数据源。
- 同一目录既经 `POST /datasources` 导入、又在项目中打开，得到两个数据源（`imported-…` 与 `psrc-…`），对象 id 不同，标注不跨源跟随。
- 回环守卫：`/fs/*` 与 `/projects*` 只接受回环来源，带 `X-Forwarded-For` / `Forwarded` 头时逐跳校验；局域网来源 403。
  上面的 `curl` 须在 backend 所在机器上执行。

### CT、WSI 的识别与对象 id

适用于项目源与 `POST /datasources` 导入源；两者只列数据源目录下一层，不依赖文件名前缀，不经全局根。

| 模态 | 接受的文件 | 内容校验 | 对象 id |
|---|---|---|---|
| `ct_abdomen` | `.nii.gz`、`.nii` | `.nii.gz` 为 gzip 魔数且解压后是 NIfTI-1 单文件头；`.nii` 偏移 344 处为 `n+1\0` | `ct-<源哈希8>-<文件名哈希8>` |
| `pathology` | 单文件 TIFF 族 `.svs`、`.tif`、`.tiff`、`.ndpi`、`.scn`、`.bif` | TIFF / BigTIFF 魔数，且 OpenSlide 能识别格式 | `wsi-<源哈希8>-<文件名哈希8>` |

- 多文件切片格式不接受。
- `.tif`、`.tiff` 先按 `pathology` 判定；OpenSlide 不能识别的普通 TIFF（如超声、显微单帧图）按 `natural_image` 打开，取首帧，取图时解码为 PNG。
- 内置示例源 `ct-demo`、`wsi-demo` 保留文件名约定 `ct_NNN.nii.gz`、`slide_NNN.<后缀>` 与既有 id `ct_001`、`slide_001`，
  其他文件名不进内置源；项目源与导入源不受该约定约束。
- 按 id 取体数据、切片、瓦片、原始文件与任务输入一律经 `resolve_object` 定位所属数据源，内置源、导入源、项目源并存互不遮蔽。
- 派生 id 不可读，`ObjectMeta.display_name` 取文件名。

## 标定探测（U3）

登记数据源时按模态从数据文件读源级标定（`Source.detect_calibration`，`datasource_detect.detect` 只做分派）：

| 模态 | 源级探测 | 对象级标定 |
|---|---|---|
| pathology | 第一张可识别切片的 OpenSlide `mpp-x/y` | 各切片自身的 mpp；缺失时 `ObjectMeta.calibration` 为空 |
| ct_abdomen | 第一例合法 NIfTI 的 header `pixdim` | 各体积自身的体素间距 |
| video | 容器帧率（PyAV 解复用） | — |

`natural_image` 不需要标定（`Source.calibration_required = False`），空标定即 `active`。

状态规则按来源不同：

- **导入源**（`POST /datasources`）：显式 `calibration` 或探测结果非空 → `status=active`；都为空 → `status=needs_calibration`
  （**不猜标定**；该源不是 active，对象不进索引、不列出、打开 404）。可在导入请求带 `calibration` 手动覆盖：

  ```bash
  -d '{"path":"...","modality":"pathology","calibration":{"mpp":[0.25,0.25]}}'
  ```

- **项目源**：登记即 `active`，探测结果只作源级提示。缺 mpp 的切片可以浏览，依赖标定的任务由 `/task/run` 返回 422，不出假值。

## 范围

- **完整可用**：浏览器上传通用图像（JPEG / PNG / TIFF）；WSI、CT 经项目打开或 `POST /datasources` 导入端到端（列表 / 浏览 / 跑任务 / 删除）。
- **WSI 复现核验**：`GET /wsi/{id}/verify` 的参考文件只对内置示例源提供，导入源与项目源的切片返回 422。
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
- **`config.*_available()` 注册表感知**：CT、WSI 按「该模态存在活动的非合成数据源」判定（WSI 另需 OpenSlide），
  `VolumeDetector`、`WsiDetector` 的可用性与 `/wsi/*` 就绪都读它，只有项目源或导入源时同样为真，不探测任何全局根。
  颈动脉、HC 走 `resolve_root + root_has_data`；`root_has_data` 是 `SOURCES[modality].probe` 的薄 alias，
  **不查注册表**（直接判目录）——否则 seed 探针 → available → resolve_root → seed 递归。测试里打桩「某根有无数据」
  用 conftest 的 `probe_only` fixture。
- **对象索引**：`resolve_object` 先查 `id → ObjectRef` 索引（首次解析时由各源 `list_ids` 建立），未命中再在
  active 源里现列一次兜底。`register_folder` / 加载示例 / `remove` 会同时作废各 Source 缓存与索引。
- **合成源与真实源互斥**：合成 id 与 CUBS 真实 id 同形（`tech_4xx`），同时 active 会让一个 id 指向两张图，
  故合成源只在同模态无其他 active 源时为 active；有真实数据时它在 `/datasources` 里显示为 `empty`。
- **模态缺依赖**：某个数据模块导入失败（如缺 science-core）时该模态不进 `SOURCES`，`/datasources` 不列出
  该模态的源（落盘清单保留），`/images?modality=` 返回空数组。
- **多源歧义**：同一对象 id 出现在多个 active 源时，索引取 `list_all` 顺序的首个（builtin 在前）；`resolve_root`
  （首个 active 真实源的根）只用于颈动脉、HC 的可用性判定。
- **模式标识看的是有无内置源**：前端按 `origin == "builtin"` 判模式；产品模式下「加载示例数据」注册的示例源也是 builtin，
  所以之后顶部显示「开发者模式（内置数据源）」紫点，`GLAUX_DEV_MODE` 本身没有变。
- **落盘并发**：`sources.json` 单后端进程假设（原子写 tmp+rename）；进程内读改写与落盘共用一把 `RLock`，
  并发按需登记同一目录只登记一条；多进程写需另加文件锁（同 P6 mask-edit）。
- **项目状态实时判定**：`GET /projects` 每次检查目录是否存在且可读，不可用时 `status=missing`；该状态不落盘。

## 测试

`backend/tests/test_datasource_registry.py`、`test_datasource_detect.py`、`test_datasource_samples.py`、
`test_datasources_api.py`、`test_uploads_api.py`、`test_upload_store.py`、`test_sources.py`（SOURCES 不变量、
resolve_object、合成源、删源）、`test_video.py`（测试内合成 mp4，缺 PyAV 时整文件跳过）、`test_paths.py`（路径写法转换）、
`test_projects.py`（项目登记、回环守卫、目录浏览）、`test_project_objects.py`（按需登记、越界、上传归属）、
`test_project_ct_wsi.py`（CT、WSI 识别与派生 id、多源并存、只有项目源时的检测器可用性与任务、上传拒医学卷）。
回环守卫在测试中经 `app.dependency_overrides[require_loopback]` 放行（`TestClient` 的来源地址是 `testclient`）。
