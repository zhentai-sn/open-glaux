# Backend Changelog

本文件只记录 Backend 独立发布；Glaux 整体发布见根目录 `CHANGELOG.md`。

## [Unreleased]

### Added

- 数据轴注册表 `SOURCES`（`app/sources/`，SDD 10 W1）：一个模态一个 `Source`，`MODALITIES = tuple(SOURCES)`；`resolve_object` 为对象 id 的唯一解析入口。
- `ObjectMeta`：`GET /images` 元素新增 `kind`、`source_id`、`display_name`、`axes`、`calibration`、`resources`、`streams`、`meta`；旧字段 `cf` / `voxel_spacing_mm` / `mpp_um` / `dims` / `center` 由 `SourceBase` 回填，取值不变。
- `GET /datasources` 元素新增 `kind`、`label`、`label_key`、`importable`、`default_capabilities`（无任务模态的能力位默认集，SDD 10 §9.4）。
- `video` 模态数据轴：mp4 / webm 的上传与文件夹导入、帧率探测、音轨声明（`streams[]` + `resources.audio`，不提供取流）、`GET /image/{vid}` 取第 0 帧。依赖 PyAV，作为可选 extra `video`。
- 开发者模式下显式注册的合成源 `synthetic-us`、`synthetic-hc`，仅在同模态无其他 active 源时为 active。
- 动作轴注册表 `DETECTORS`（`app/detectors/`，SDD 10 W2）：四个几何族各一个 `Detector`；`POST /task/run` 的公共前缀（解析对象、`object_kinds` 门控、可用性、选区类型、标定）只在 `kernel.run_task` 出现一次。
- `/objects` 表征面：`GET /objects/{id}`、`GET /objects/{id}/frame`（`X-Glaux-Frame` 响应头，slide 取帧按 level + level-0 roi）、`/raw`、`/tiles/{level}/{col}/{row}`、`POST /objects/{id}/edits`（`base_seq` 乐观并发）。
- `TaskSpec` 新增 `calibration` 与 `region`；`POST /task/measure` 收 `calibration`（CT 的 voxel 标定重测可用）。
- `GET /tasks` 每行新增 `object_kinds`、`trigger`、`classes`；CT 行能力位增 `voi`、`z_scroll`，WSI 行增 `verify`。
- 标注：`AnnotationIn.index`（`z` 为一版别名）、`GET /annotations` 的 `index_from` / `index_to`、kind 增 `point`（仅存储）；标注库带 `PRAGMA user_version` 迁移（0 → 1）。

### Changed

- 未知对象 id：`GET /image/{id}` 一律 404，不再在无 CUBS 数据时返回 mock 合成图；`GET /images` 在无数据时返回空数组，不再返回 mock 列表（病理原为 503）。
- `GET /image/{id}` 对 CT 返回第 0 层轴状位 PNG（原为 404），对 slide 返回 422（需 level，W2 落地）。
- `POST /annotations` 的目标经 `resolve_object` 解析：未知对象一律 422，不再跳过范围校验。
- `POST /uploads/images` 的模态由后缀与魔数推断，不再固定为 `natural_image`。
- `Modality` / `TaskType` 由固定枚举放宽为字符串，取值由 `SOURCES` / 任务注册表校验；未注册模态 422。
- `POST /task/run`：未知对象 404（原先按任务不同为 422 或返回合成结果）；未知标定 kind 422（原 503）；无 CUBS 数据时不再返回 mock 合成边界。
- `GET /models` 由各 `Detector.methods()` 汇总，无数据时不再回退 mock 模型表。
- `/volume/{id}`、`/volume/{id}/mask-edit`、`/wsi/{id}/tile/…` 改为 `/objects/*` 的 alias（字节等价）；`/wsi/{id}/verify` 内部改调 `Detector.verify`。
- 标注的第三轴索引（`z` / `index`）按对象的轴范围校验，越界 422。

### Fixed

- CT 标注的范围校验此前把 NIfTI 形状 (X, Y, Z) 当作 (Z, Y, X) 解包，宽度取成了 Z；现取 `axes` 的 x / y。
- TotalSegmentator 现算的输入路径改走注册表生效根（`dataset_ct.nifti_path`），经 `/datasources` 导入的 CT 源缓存未命中时不再去 `data/ct` 找文件。

## [0.2.0] - 2026-08-31

### Added

- `POST /uploads/images`：浏览器上传 JPEG/PNG 为通用图像数据源，逐文件校验扩展名与文件头魔数，落盘名与图像 ID 均由服务端确定性派生（客户端文件名不进入文件系统路径）。
- `POST /datasources/samples`：显式加载仓库自带示例数据源，幂等。
- `natural_image` 进入数据源注册表；通用图像列图/取图从固定白名单扩展为「内置示例 + 导入源」，并支持 PNG。
- 上传上限环境变量 `GLAUX_UPLOAD_MAX_BYTES`（32 MiB）与 `GLAUX_UPLOAD_MAX_FILES`（20）。

### Changed

- **不兼容（0.x 破坏性变更）**：`GLAUX_DEV_MODE` 缺省由 `1` 翻为 `0`，默认不再提供内置数据源；开发环境需显式置 `1`。
- 通用图像数据源不因缺标定而标记 `needs_calibration`——它本就没有标定这回事。

### Fixed

- 上传图像的越界标注不再被静默接受：`_dims_for` 补上 `nat-` 前缀，此前落入「未知对象跳过范围校验」的降级分支。
- `make test-backend` 恢复可用：测试装配先导入 `app.config` 完成 science-core 的 `sys.path` 注入。
