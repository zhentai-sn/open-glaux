---
kind: record
status: done
---

# SDD 22 智能体看图：缩放与复核 · 实施计划

依据：[SDD 22](../sdd/feats/22-agent-visual-inspection/README.md) §7、§9、§15、D-1～D-6。

## 现状要点

- **取帧**：backend `/objects/{id}/frame` 已支持 `roi`（对象坐标）与 `size`，返回 `X-Glaux-Frame`（`ReferenceFrame`）；runtime 的 `fetchObservation` 只按查看器焦点取帧。
- **看图**：`view_current_image` 无参数，返回全图概览。
- **按视图画框**：`propose_annotation` 的 `space: "view"` 重新按全图概览取帧换算。
- **标注接口**：backend 支持 PATCH（`base_seq` 乐观并发）与 DELETE。
- **前端**：`toolBridge` 收到 `glaux.annotation_proposed` 后把建议写回查看器。
- **双语**：工具与提示词有中英文两版（SDD 20）。

## 波次

| 波次 | 内容 | 依赖 | 波末状态 |
| --- | --- | --- | --- |
| W1 | backend：`/frame` 的 `overlay` 参数与 `X-Glaux-Overlay` | — | backend 测试通过 |
| W2 | runtime：视图登记、`view_current_image` 的 `region` 与 `annotations`、`propose_annotation` 的 `view_id`、`revise_annotation`、提示词 | W1 | runtime 测试通过 |
| W3 | 前端：看图工具行显示区域、修订卡片、查看器同步修订与撤回 | W2 | 前端测试、lint 通过 |
| W4 | 活文档、真实模型走查、§15 自查 | W1～W3 | SDD 22 转 `implemented` |

## W1 · backend

- `app/frame_overlay.py`：编号、图例、按 `ReferenceFrame` 绘制框、多边形、点与掩膜轮廓；建议态虚线。
- `app/routers/objects.py`：`overlay` 参数；2D 取全部标注，体数据与视频按当前层或帧，WSI 不按层过滤。
- 测试：无叠加时原始像素、叠加图例与绘制位置、区域换算、掩膜只画轮廓、已驳回不画。

## W2 · runtime

- `src/observation/index.ts`：`fetchObservation` 接受区域与叠加选项，解析图例头。
- `src/pi/tools/view-registry.ts`：本命令内的视图登记（`v1`、`v2`…）。
- `src/pi/tools/view-image.ts`：参数、区域校验与截取、文字换算与图例、`details` 增量。
- `src/pi/tools/propose-annotation.ts`：`view_id`；缺省最近视图。
- `src/pi/tools/revise-annotation.ts`：读当前标注，校验来源与状态，PATCH 或 DELETE。
- 插件挂载与提示词；中英文说明。
- 测试：区域与换算、非法区域、按视图换算、未知视图、修订权限与冲突、撤回。

## W3 · 前端

- 工具行：`view_current_image` 有区域时显示区域。
- `glaux.annotation_revised`：更新或移除查看器中的建议；对话中显示修订卡片。

## W4 · 活文档与验收

- SDD 02（工具约定）、操作手册、仓库骨架总览、两份 CHANGELOG。
- 真实模型走查（支持视觉的连接）；§15 自查；SDD 22 转 `implemented`；本计划改为 `done`。

## 风险

| 风险 | 应对 |
| --- | --- |
| 反复看图消耗上下文 | 上下文裁剪只保留最近若干张图（SDD 19）；每次看图都是普通工具调用，受运行预算约束 |
| 叠加遮挡边缘细节 | `annotations: false` 可取原始像素 |
| 模型照着放大图画框却按概览换算 | `view_id` 显式绑定；缺省为最近视图，提示词要求注明 |

## 实施偏差

（实施中记录与本计划不一致之处及原因。）
