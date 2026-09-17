---
kind: record
status: done
---

# 数据导入优先的文件栏实施计划

约束来源：[Feature SDD 08](../sdd/feats/08-data-import-first-explorer/README.md)（`ready`）。

本计划不引入 SDD 08 未声明的契约。实现期若发现需要新增字段、端点或状态，先回改 SDD，再继续编码。

## 0. 阶段划分与依赖

```mermaid
flowchart LR
    P1["§1 上传落盘与 ID"] --> P2["§2 上传端点"]
    P1 --> P3["§3 自然图像数据源合并"]
    P2 --> P3
    P3 --> P4["§4 示例数据显式加载"]
    P4 --> P5["§5 前端数据源编排"]
    P5 --> P6["§6 Explorer 空态与导入面板"]
    P5 --> P7["§7 模态切换器改造"]
    P6 --> P8["§8 最近使用"]
    P7 --> P9["§9 SDD 回填与全量验证"]
    P8 --> P9
```

§1–§4 为后端，可先独立完成并跑通 pytest；§5–§8 为前端；§9 收口。

## 1. 上传落盘与 ID 派生（后端 · 纯函数层）

- 新增 `backend/app/upload_store.py`，纯 stdlib + Pillow，不 import FastAPI：
  - `ALLOWED = {"image/jpeg": (b"\xff\xd8\xff", ".jpg"), "image/png": (b"\x89PNG\r\n\x1a\n", ".png")}`。
  - `classify(filename, head_bytes, size)` → `("accept", ext)` 或 `("reject", reason)`，`reason` 取 SDD §9.2 三值。
  - `image_id(source_id, rel_name)` → `nat-<sha1(source_id)[:8]>-<sha1(rel_name)[:8]>`。
  - `store_name(index, ext)` → 服务端生成的落盘名（如 `img-0007.jpg`），**不含**任何客户端字符串。
  - `uploads_root()` → `datasource_registry.datasets_root() / "uploads"`。
- `backend/app/config.py` 增 `UPLOAD_MAX_BYTES`（`GLAUX_UPLOAD_MAX_BYTES`，缺省 `33554432`）与 `UPLOAD_MAX_FILES`（`GLAUX_UPLOAD_MAX_FILES`，缺省 `20`）。

验证：`backend/tests/test_upload_store.py` 覆盖三类拒绝原因、魔数与扩展名不一致、ID 正则与确定性（同参两次同值、异参不同值）、`store_name` 不含客户端片段。

## 2. 上传端点（后端 · HTTP 层）

- `backend/app/schemas.py` 增 `UploadAccepted` / `UploadRejected` / `UploadResult`，字段与约束按 SDD §9.2。
- 新增 `backend/app/routers/uploads.py`，`POST /uploads/images`：
  1. 文件数 > `UPLOAD_MAX_FILES` → 立即 `422`，不写盘。
  2. 逐个流式读取，超 `UPLOAD_MAX_BYTES` 即中止该文件并记 `too_large`（不落盘）。
  3. 先算目标 `source_id`（由 `uploads_root() / <sid>` 路径派生，与 `register_folder` 的 `_safe_id` 一致），再按 `store_name` 写盘。
  4. 全部被拒 → `422`，不创建数据源、不留空目录。
  5. 至少一条接受 → `register_folder(dir, "natural_image", name=...)` 并返回 `UploadResult`。
- 在 `backend/app/main.py` 注册该 router。

注意：`register_folder` 的白名单校验必须保留在链路上（不要绕过直接构造 `DataSource`），使「路径必须在 `datasets_root()` 下」只有一处实现。

验证：`backend/tests/test_uploads.py` 逐条对应 SDD §15 后端前 6 项，含 `../../etc/passwd` 文件名用例与「全拒不建源」用例。

## 3. 自然图像接入导入源（后端）

- `datasource_registry.MODALITIES` 增 `"natural_image"`。
- `config.root_has_data` 增 `natural_image` 分支：目录下存在至少一个 `.jpg`/`.jpeg`/`.png` 即为 `active`。
- `backend/app/dataset_natural.py` 从「固定白名单」扩为「内置白名单 + 导入源」：
  - `list_ids()` = 内置（示例已加载时，即 `NATURAL_ROOT` 有对应源）+ 各 `natural_image` 导入源逐目录列举，按 SDD §5.3 顺序合并。
  - 新增内部索引 `_resolve(image_id) -> Path`：内置 ID 走原 `ASSETS`；`nat-` 前缀 ID 按 `sources_for("natural_image")` 重算哈希匹配，未命中抛 `FileNotFoundError`。
  - `image_meta` 的 `center` 取所属数据源 `name`；内置仍为 `Natural images`。
  - 保持既有约束：读不出或魔数不符的文件不进列表。
- `routers/api.py` 的 `/images` 与 `/image/{id}` 自然图像分支无需改签名，只是底层来源变宽。

验证：`backend/tests/test_natural_images.py` 扩展——上传源与内置源共存时的合并顺序、`nat-` ID 取图、删源后 404、内置 ID 行为回归不变（SDD 07 契约不破）。

## 4. 示例数据改为显式加载（后端）

- `datasource_registry.dev_mode()` 缺省翻为 `0`：`os.environ.get("GLAUX_DEV_MODE", "0")`。
- 新增 `register_builtin_samples() -> list[DataSource]`：遍历 `_builtin_specs()`，仅对 `config.root_has_data` 为真的项写入 `_SOURCES`（`origin="builtin"`），落盘持久化；已存在则覆盖刷新。为此放宽 `_save_persisted` / `_load_persisted` 对 `origin != "builtin"` 的过滤——改为「dev_mode 的实时视图不落盘，显式加载的示例落盘」，用一个 `explicit: bool` 字段或独立键区分。
- `routers/api.py` 增 `POST /datasources/samples` → `list[DataSourceInfo]`。
- `data/natural/` 作为 `natural_image` 的示例项一并纳入 `_builtin_specs()`（新增一行 `natural-demo`），使 SDD 07 的 4 张照片与其他示例同进同退。
- 开发脚本 `run-backend.sh`（及 `health.sh` / `restart-backend.sh` 中启动后端处）显式导出 `GLAUX_DEV_MODE=1`。

验证：`backend/tests/test_datasources.py` 增——未设 env 时 `list_all()` 无 builtin；`GLAUX_DEV_MODE=1` 时与改前一致；`register_builtin_samples()` 幂等；内置根全空时返回空数组。既有 datasource 测试若依赖旧缺省，改为显式 `monkeypatch.setenv`。

## 5. 前端数据源编排

- `api/types.ts` 增 `UploadAccepted` / `UploadRejected` / `UploadResult`。
- `api/client.ts` 增 `uploadImages(files, name?)`（`FormData`，不手写 `Content-Type`）与 `loadSamples()`。
- `store/session.ts`：
  - 新增 `dsState: "loading" | "ready" | "failed"`，与既有 `datasources` 并存。
  - 新增 `recentItems: RecentItem[]` 与 `pushRecent` / `setRecentItems`。
- `data/actions.ts`：
  - `refreshDataSources()`：拉 `/datasources`，设 `dsState`，失败置 `failed` 而非空数组。
  - `bootstrap` 改为「先 `refreshDataSources()`，无 active 源则**直接返回**，不调用任何数据端点」（SDD §7 规则 4）。
  - `uploadImages(files)`：调接口 → `refreshDataSources()` → 刷新 `naturalImages` → `selectNaturalImage(首个新 ID)`。
  - `loadSamples()`：调接口 → `refreshDataSources()` → 若有 active 源则加载首个源的模态。
  - `removeDataSource` 后补 `refreshDataSources()`，并在归零时回空态。

验证：`frontend/src/data/actions.test.ts` 扩展——空数据源时不发数据请求；上传成功后模态与选中项正确；`/datasources` 失败时 `dsState=failed`。

## 6. Explorer 空态与统一导入面板

- 新增 `frontend/src/components/ImportPanel.tsx`，三个入口一处收敛：
  - 拖拽区 + `<input type="file" multiple accept="image/jpeg,image/png">`；前端预筛类型与大小，超限项直接本地标 `too_large`/`unsupported_type`，不发请求。
  - 「打开服务端文件夹」：把现有 `ImportDataSourceForm` 整体搬进来（`IMPORTABLE` 仍只含 `pathology` / `ct_abdomen`，D-5）。
  - 「加载示例数据」按钮。
  - 结果区：`accepted` 计数 + `rejected` 逐条文件名与原因。
- `SideBar.tsx` 的 `ExplorerView` 按 SDD §11 分四态渲染：`Loading` 骨架 / `Failed` 错误+重试 / `Empty` 空态卡（内嵌 `ImportPanel`）/ `Browsing` 树 + 头部「＋ 导入」。
- 移除 `MarketplaceView` 里内嵌的 `ImportDataSourceForm` 调用（改为引用同一组件或留一个跳转），避免两处导入表单漂移。
- 移除 `ExplorerView` 中「非自然模态下常驻 `natural-images/` 目录」的分支（被 SDD §7 规则 13 取代）。
- 移除导入源的确认文案加上「不会删除磁盘上的文件」（D-6）。
- i18n 新增键（`zh.ts` / `en.ts` 同步）：空态标题与三个入口、上传结果与三类拒绝原因、示例加载空结果、数据源加载失败与重试、`mod_general_images`。

验证：`frontend/src/components/SideBar.test.tsx` 扩展——四态渲染、空态不发数据请求、部分拒绝的逐条展示、移除末个源回空态、双语无缺 key。

## 7. 模态切换器改造

- `ModalitySwitch` 改为：候选 = `datasources` 中 `status==="active"` 的 modality 去重；标签 = `tasks` 中该 modality 首个任务的 `label[lang]`，`natural_image` 取 i18n `mod_general_images`。
- 保留「候选 < 2 不渲染」规则。
- `switchModality` 目标模态无 active 源时不应被触发；加一条防御性早返回。

验证：`SideBar.test.tsx` 覆盖 SDD §15 前端第 3–5 项，重点断言「选中通用图像时该 tab 处于选中态」。

## 8. 最近使用

- `frontend/src/data/recent.ts`：`readRecent()` / `writeRecent()`，键 `glaux.recent.v1`，容量 10，`try/catch` 包裹读写，解析失败返回 `[]`。
- 在 `selectImage` / `selectVolume` / `selectSlide` / `selectNaturalImage` 成功后 `pushRecent`。
- Explorer `Browsing` 态在文件树上方渲染「最近使用」区；点击项按其 `modality` 走对应选择动作。
- 渲染前按当前各列表过滤掉已不存在的对象，并把过滤结果写回持久化。

验证：`actions.test.ts` + `SideBar.test.tsx`——容量与顺序、刷新后保留、非法 JSON 不炸、失效项静默剔除。

## 9. SDD 回填与全量验证

- 修订 [SDD 07](../sdd/feats/07-natural-image-sam-demo/README.md)：§2 删除「不实现任意图片上传、目录导入」并改为指向 SDD 08；§7 规则 5 改为「示例数据加载后常驻」；§0 最后更新时间与 §16 补一条指向 D-4 的说明。
- 更新 `docs/sdd/README.md` 的 Feature SDD 表格（08 一行 + 07 状态备注）。
- 更新 `README.zh-CN.md` / `docs/architecture.zh-CN.md` 中「四个内置数据集」相关描述与 `GLAUX_DEV_MODE` 说明。
- 全量跑：`backend` pytest + ruff、`frontend` vitest + tsc + eslint、`agent-runtime` 测试（本改动不触及，作回归）。
- 三服务起来做浏览器走查：空态首屏 → 拖入 2 张图 → 出现在树中并可选中 → 会话里对该图调 `segment_region` → 加载示例数据 → 切换器出现多个 tab。
- 按 SDD §15 逐条记录「已完成 / 未完成 / 无法验证」，写入 SDD 08 §15 下方；代码完成后状态 `ready → implemented`，浏览器走查全通过后再 `→ accepted`。

## 10. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| `dev_mode` 缺省翻转打破既有后端测试 | 大量 `/images`、`/task/run` 测试突然走无源分支 | §4 一次性给受影响测试加 `monkeypatch.setenv("GLAUX_DEV_MODE", "1")`，把「默认有数据」变成测试的显式前提而不是隐式假设 |
| `_SOURCES` 落盘过滤改动误伤已有 `sources.json` | 用户已导入的源丢失 | 只增不改字段：显式示例用独立标记写入，回读时对缺该字段的旧记录按 `imported` 处理 |
| 上传大文件占满磁盘 | 服务端不可用 | 本期只做单文件与单次数量上限；总容量配额记入后续，不在本期实现（不写进 SDD §15） |
| 自然图像 ID 解析每次重算哈希 | 大源下列表变慢 | 演示规模可接受；若出现瓶颈再加进程内索引，属实现细节不改契约 |
| 空态判定误伤「有源但都不 active」 | 首屏错误地显示空态 | SDD §7 规则 2/4 统一用 `status==="active"` 判定，测试覆盖 `needs_calibration` / `empty` 源存在时的表现 |
