---
kind: record
status: reviewed
---

# SDD 10 W4 查看器收敛设计

## 目标与依据

按 [SDD 10](../sdd/feats/10-object-convergence/README.md) W4 的冻结契约，把 2D 与 CT 的 CS3D 实现合为 `FrameStackViewer`，把 WSI 实现迁为 `PyramidViewer`。本文件只记录实施组织；字段、接口、能力位和验收口径以 SDD 10 为准。过程证据写入[对象收敛执行记录](../todo/2026-09-18-002-object-convergence-execution-log.zh-CN.md)。

## 实施顺序

1. 提取两套 CS3D 实现的 mask PNG 编码、原语绘制、渲染引擎生命周期、叠加画布和画笔缓冲。先让 CT、再让 2D 使用共用实现，每一步运行既有 smoke 测试。
2. 以 `FrameSource`、`FrameAxis`、`MaskSink` 和 `ViewerProps` 装配统一 `FrameStackViewer`。`Viewer` 从对象的 `kind` 选择引擎，从 `axes` 与 `resources` 选择帧和索引。CT 层号只经 `Focus.index.z` 写入；编辑请求切至 `/objects/{id}/edits`。
3. 用 OpenSeadragon 的视口坐标转换和 SVG 叠加层实现 WSI bbox、polygon 绘制、回显与编辑，保持标注写桥和 `/wsi/{id}/verify`。移除 Annotorious 初始化链，解决 [F-18](../todo/2026-09-23-001-wsi-annotorious-csp.zh-CN.md) 的 CSP 冲突。
4. 工具栏、舞台、快捷键共用 `useTaskTools()`。任务对象只读 `TaskView.capabilities`；无任务对象只读数据源的 `default_capabilities`。`registerTaskTool` 承接 IMT 壁线，配置传入当前对象及帧，不再由工具拼 URL。

## 回归与异常处理

- 保留 `viewerEngines.smoke.test.tsx` 的六个接线断言，改指统一引擎；另覆盖帧源、两种 mask sink、叠加过滤、画笔提交与 WSI 绘制。
- WSI 叠加层不依赖动态代码执行。切片加载失败、标注写入失败沿用现有通知和回滚路径；验证按钮仍调用原端点。
- 每段运行前端定向测试与 lint；波末运行 `make test`、`make lint`，按 SDD 10 §15.2 的 2D、CT、WSI 场景手工走查并记录无法验证的项。

## 方案取舍

- 直接一次合并：改动过大，回归失败难定位。
- **分段接线、最终完整合并（采用）**：保持每一步可验证，同时满足 W4 已决定的完整合并。
- 只共享 hooks、保留两引擎：仅是 SDD 10 D-21 的降级路径；现有 smoke 基线可运行，不触发降级。
