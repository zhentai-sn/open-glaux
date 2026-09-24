---
kind: record
status: reviewed
---

# SDD 10 W6 · 视频逐帧表征设计

## 目标与依据

按 [SDD 10](../sdd/feats/10-object-convergence/README.md) W6 契约，使已存在的 `VideoSource` 从前端同一对象链路完成逐帧查看、当前帧标注与 agent 观测。维护者于 2026-09-24 确认复用 `FrameStackViewer` 的 `z/t` 多帧方案，手工走查递延至 SDD 10 最终统一验收。本记录说明实现顺序；字段与验收仍以 SDD 10 为准。

## 结构与数据流

1. `ENGINES.video` 指向既有 `FrameStackViewer`。它从 `FrameAxis` 的 `z` 或 `t` 驱动 stack、滚轮与当前帧，不另建 VideoViewer；CT 的 labelmap、自动选器官层、VOI 仍由其任务和表征控制。视频默认从 `t=0` 开始，`FrameSource` 按 `resources.frame?t=N` 给 CS3D 图像 id。
2. `CHROME_SEGMENTS` 登记 `timeline` 段，由能力位控制显隐；Workbench 和 Focus 传同一 `FrameAxis`，滑杆与当前帧输入写 `Focus.index.t`。角标与坐标栏显示当前 `t`，可选按 `Axis.spacing` 显示时间提示，不引入播放或跟踪。
3. 标注桥的写目标统一为 `{image_id, index}`。CS3D bbox/polygon 与 `annotationMaskSink` 的画笔提交传当前 `{t}`；`loadAnnotations` 用 `index_from=index_to=t` 查当前帧。切帧清理上一帧的标注层、mask 缓存与未提交笔迹；迟到的加载结果由现有序号守卫丢弃。后端保持既有 `Annotation.index` 与 `z` 存储列映射。
4. agent 延用 W5 的 `ViewerContext.focus.index.t` 和 `fetchObservation`，`view_current_image` 看当前帧，`propose_annotation` 用相同索引写建议态。无 `TaskView` 的视频不自动跑任务；工具能力来自数据源默认能力位。

## 失败与门禁

帧加载失败沿用查看器错误提示；标注创建失败沿用统一写桥回滚；切帧后旧请求不得盖回当前帧。自动化覆盖视频帧源、索引切换、时间轴能力位、`index.t` 写入与刷新回显、跨帧隔离、agent 取帧及建议态；同时回归 CT、2D、WSI。运行全量测试、lint、构建与 chat 发行包测试。真实浏览器的导入 mp4 → 逐帧滚动 → bbox/画笔 → 刷新 → agent 观测留到最终统一验收。
