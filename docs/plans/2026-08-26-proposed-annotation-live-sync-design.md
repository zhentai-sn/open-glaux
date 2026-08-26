# 建议态标注实时同步修复设计

## 背景

`segment_region` 能返回有效多边形，`propose_annotation` 也能把 `suggested` 标注写入 Backend，
但当前 Viewer 与会话卡片不会立即更新。原因是前端工具事件桥只消费 `run_task`，而 Agent
Runtime 会话快照也只保留图谱引用 details。

## 目标

- `propose_annotation` 成功后，当前 Viewer 立即显示建议态轮廓。
- 会话立即显示确认/驳回卡片，并在刷新后保留。
- 用户已切换对象时，旧工具结果不得写入当前 Viewer。
- Backend `/annotations` 继续作为持久化事实源。

## 方案

采用事件驱动写回，不增加轮询或成功后的额外 HTTP 请求。

1. Agent Runtime 在会话快照白名单中保留 `glaux.annotation_proposed` 工具结果，并像图谱卡片一样剥离正文。
2. 前端收到 `tool_execution_end` 时按工具名分派：
   - `run_task` 沿用现有 metrics/primitives 写回；
   - `propose_annotation` 校验 details，构造 `status=suggested`、`source=agent` 的 Annotation 并 upsert 到 Session Store。
3. 仅当 details 的 `image_id` 等于当前 Viewer 活动对象时写回；错误结果、空 ID、缺失几何或已切图结果全部忽略。
4. Viewer 继续订阅 `annotations`，因此 upsert 后由既有 Cornerstone/WSI/Volume reconcile 立即渲染。
5. 页面刷新或重新打开对象时仍通过 `GET /annotations` 恢复真实状态；事件写回只负责低延迟反馈，不替代事实源。

## 错误与一致性

- `propose_annotation` 只有 Backend 创建成功后才返回有效 details，因此前端不得对失败事件乐观造标注。
- 前端把 Runtime details 当作不可信边界输入，必须校验 kind、ID、label、primitive、seq 与 z。
- 同一 annotation ID 重复到达时使用既有 `upsertAnnotation` 幂等覆盖，不追加重复轮廓。
- 会话快照仅保存结构化 details，不复制大型工具正文或图像数据。

## 测试

- 前端：成功事件即时 upsert；重复事件幂等；切图、错误或畸形 details 不写入；`run_task` 行为不回归。
- Agent Runtime：建议态工具结果进入会话快照且正文被剥离；错误结果仍不暴露。
- 既有 Viewer 标注 reconcile、建议卡片确认/驳回和全量测试保持通过。

## 非目标

- 不改变 SAM、`propose_annotation` 或 Backend Annotation REST 契约。
- 不自动确认建议态标注。
- 不增加轮询、WebSocket 或新的持久化表。
