---
kind: record
status: reviewed
---

# SDD 10 W5 · 智能体上下文与观测收敛设计

## 目标与依据

按 [SDD 10](../sdd/feats/10-object-convergence/README.md) W5 冻结契约，agent-runtime 改读 `ViewerContext{collection,task,method,object,focus}`，图像字节只经 `fetchObservation` 获取，工具由 `TOOL_PROVIDERS` 装配。旧查看器字段仅作带计数告警的过渡输入，W7 删除。本设计只规定实施顺序，契约仍以 SDD 10 为准。

## 分段实施

1. 在 runtime 镜像 `ObjectMeta` 摘要、`Focus`、`Region`、`ReferenceFrame`；`parseViewer` 优先校验新字段，旧字段仅在新字段缺失时整体映射并记录可读取的 warn 计数。待 runtime 消费新字段后，前端 `toViewerContext` 停止双发。
2. 建唯一 `fetchObservation(base, focus, opts)`：从 `/objects/{id}/frame` 读取帧字节与 `X-Glaux-Frame`，校验对象、索引、尺寸和坐标；`toObjectCoords` 将帧坐标映回对象坐标。逐个迁移看图、定位、分割与标注工具，保持既有结果通道和外发门控。
3. 用 `TOOL_PROVIDERS` 登记六个现有工具的能力、焦点支持、创建和提示片段，替换固定 if 序列。保留 observe/chat 模式无工具、视觉连接与第三方分割外发门控；`SegmenterPort` 本期只定义 `segment`。

## 门禁

每段运行契约和集成定向测试；末尾运行 runtime 与 frontend 全量测试、lint、构建及 SDD 10 的 chat 发行包回归。坐标往返、CT 层号、WSI level/ROI、新旧字段冲突优先级、旧字段 warn 计数和无图空态均须有断言。W4 的未签人工项按维护者决定留到最终统一验收，不阻断 W5 开发。

维护者于 2026-09-24 确认按此设计开工。
