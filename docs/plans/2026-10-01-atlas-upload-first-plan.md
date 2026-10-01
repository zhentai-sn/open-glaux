---
kind: record
status: done
---

# SDD 03 v2.0 上传即入库 · 实施计划

依据：[SDD 03](../sdd/feats/03-atlas/README.md) §4.1、§5.2、§6.1、§7.8、§9、§10、§13、§15 v2.0、D-23～D-28。

## 现状要点

- **导入**：前端 `ImportWizard.tsx` 四步向导；backend `importer.stage_pdf` / `stage_url` 写暂存会话 `staging/<import_id>/`，`POST /exemplars` 按 `import_id + figure_index` 或 `image_base64` 落图建案例。
- **校验**：`store.create` 要求 `tags` 非空（`TAGS_REQUIRED`）；`ExemplarIn.tags` 为 `min_length=1`。
- **编辑**：只有 `PUT /exemplars/{id}/description` 与 `PUT /exemplars/{id}/collection`；标签、图注、ROI、外发许可入库后不可改。
- **描述**：前端 `describe.ts` 逐条调 runtime `/atlas/describe` 再写回；向导提交后自动执行，详情页有重试按钮。
- **ROI 坐标约定不一致（既有缺陷）**：backend `images.clamp_roi`、CLI 与 SDD 按 `[x, y, w, h]`；前端 `RoiPicker` 产出、`ExemplarDetail` 叠加按 `[x0, y0, x1, y1]`。向导建的案例（`textbook` / `web`）实际存的是 `x0,y0,x1,y1`，裁剪图偏大；整图 ROI 两种约定结果相同。

## 改动

### backend

| 文件 | 改动 |
| --- | --- |
| `atlas/store.py` | 增列 `reviewed`（bool）；`_migrate_columns` 补列时旧行置 `true`，并把 `textbook` / `web` 旧行的 ROI 由 `x0,y0,x1,y1` 换算为 `x,y,w,h`、重建裁剪图（不改幂等键）；`create` 允许空标签；新增 `update()`（字段子集 + `reviewed=true`）；`set_description` 对未确认案例补标签（≤ 8）与空图注；`list` 增 `describe_status`、`reviewed` 过滤；`SourceType` 增 `upload` |
| `atlas/importer.py` | 删除暂存会话；新增 `upload_files(files, collection)` 与 `upload_url(url, collection)`：逐文件解析、整图 ROI、文件级错误收集、上限校验；新增 `recrop()` 与 `add_region()` |
| `atlas/parse_pdf.py` | 新增 `pdf_title()` 读元数据标题 |
| `atlas/text.py` | 新增 `auto_tags(description)` |
| `routers/atlas.py` | 删除 `/imports/*` 与 `PUT /collection`；新增 `POST /uploads`、`POST /uploads/url`、`PATCH /exemplars/{id}`、`POST /exemplars/{id}/regions`；`ExemplarIn.tags` 可空 |
| `atlas/cli.py` | 数据集导入写 `reviewed=true` |
| tests | 改写 `test_atlas_api.py` 导入用例为上传用例；`test_atlas_store.py` 增补自动补字段、`update`、迁移用例 |

### frontend

| 文件 | 改动 |
| --- | --- |
| `api/atlas.ts` | 删除导入暂存 API 与 `setCollection`；新增 `upload`、`uploadUrl`、`patch`、`addRegion`；类型增 `reviewed`、`upload` |
| `components/atlas/UploadBar.tsx`（新） | 选文件 / 拖放 / 网页地址；本批结果与文件级错误 |
| `components/atlas/DescribeConfirm.tsx`（新） | 确认条：张数 + 连接名 · host；「生成描述」「暂不」；确认后驱动队列并显示进度 |
| `components/atlas/describe.ts` | 增 `runDescribeQueue`：并发 2、单条自动重试 1 次、切换连接即停止；`connectionTarget` 给确认文案 |
| `components/atlas/ExemplarList.tsx` | 拖放区、状态徽标「待描述」「未确认」、多选与批量操作（移动图册、改外发许可、标为已确认、生成描述、下架、删除） |
| `components/atlas/ExemplarDetail.tsx` | 就地编辑标签、图注、说明、来源名、图册、外发许可；重新框选与添加区域（`RoiPicker`）；标为已确认；ROI 叠加改按 `x,y,w,h` |
| `components/atlas/RoiPicker.tsx` | 产出 `x,y,w,h` |
| `components/atlas/AtlasView.tsx`、`store/atlas.ts` | 去掉 `import` 屏与 `openImport` |
| 删除 | `ImportWizard.tsx`、`ImportWizard.test.tsx` |
| i18n | 新增上传、确认条、编辑与批量操作文案（中英） |

### 活文档

- `docs/runbooks/atlas-import.md`、`docs/architecture.zh-CN.md` 图谱行：导入向导改为上传入口。
- SDD 03 §15 v2.0 勾选与证据；状态行改为 v2.0 实现完成。

## 顺序

1. backend store / importer / router + 测试。
2. frontend API 与组件 + 测试。
3. 浏览器走查：上传图片与 PDF、确认条、编辑、批量操作。
4. 活文档同步。
