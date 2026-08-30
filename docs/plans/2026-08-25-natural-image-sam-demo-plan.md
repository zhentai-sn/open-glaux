# 自然图像 SAM 演示集合实施计划

约束来源：[Feature SDD 07](../sdd/feats/07-natural-image-sam-demo/README.md)（`ready`）。

## 1. 固定演示资产

- 从 SDD §4 指定的 Wikimedia Commons 页面下载 4 张 JPEG 到 `data/natural/`。
- 用 Pillow 校验格式与尺寸，必要时等比缩放到适合 Web/SAM 测试的大小，不做内容裁剪。
- 新建 `data/natural/README.md`，记录来源页面、下载地址、作者、许可、文件摘要和建议 prompt。

验证：4 个文件可由 Pillow 解码，格式为 RGB JPEG，许可清单逐一对应。

## 2. 后端数据发现与安全取图

- 新增轻量 `backend/app/dataset_natural.py`，集中维护固定 ID → 文件映射、稳定列表、元数据和图片读取。
- 扩展 `backend/app/schemas.py` 的 `Modality`。
- 在 `GET /images` 增加 `natural_image` 分支；在 `GET /image/{id}` 的 mock 回退前增加自然图像分支，避免未知自然 ID 被 mock 合成图吞掉。
- 补后端测试：固定列表、媒体类型/字节、缺文件、未知 ID、路径伪造、无 TaskPlugin。

验证：目标 pytest 用例通过，既有 `/images` 与医学 `/image` 回归不变。

## 3. 前端契约与状态编排

- 扩展 `frontend/src/api/types.ts` 的 `Modality`，API 客户端增加自然图像列表调用。
- Session Store 增加 `naturalImages` 与 setter。
- App 初始化并行/独立加载自然图像列表，失败不阻塞医学外壳。
- 新增 `selectNaturalImage`：切换 `natural_image`、清空 3D/WSI/医学结果、设置照片元数据，且不调用 `/task/run`。
- `switchModality` 从自然图像返回医学模态时保持现有加载路径。

验证：动作测试证明状态互斥、医学结果清空、未调用 `taskRun`。

## 4. 文件栏、查看器与上下文

- Explorer 常驻渲染 `natural-images/`，点击调用 `selectNaturalImage`。
- 自然图像模式继续使用 Viewer 的 `raster_2d` 兜底。
- `toViewerContext()` 在 `natural_image` 下只发 `image_id` 与模态。
- Workbench/Focus 的标题、HUD、状态栏和上下文标签为自然图像提供中性展示，隐藏医学 CF/任务/模型字段。
- 增加中英文 `natural_images` 文案。

验证：组件/上下文测试覆盖目录渲染、选图、模态标签与无医学字段。

## 5. 全量验证与 SDD 收口

- 运行 backend、frontend、agent-runtime 的相关测试与 lint/typecheck。
- 启动三个服务，检查 5173/8000/8010 与自然图片响应。
- 若现有环境已提供 SAM token 与外发开关，走查两张图片；否则明确记录“无法验证”，不输出或读取凭证。
- 按 SDD §15 分类记录已完成/未完成/无法验证；代码完成后将 SDD 状态推进为 `implemented`，人工 SAM 走查全部通过后再推进 `accepted`。

