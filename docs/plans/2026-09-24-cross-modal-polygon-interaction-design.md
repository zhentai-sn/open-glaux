---
kind: record
status: reviewed
---

# 跨模态多边形逐点交互设计

## 目标

统一 `polygon` 工具的基本手势：图像、CT 与 WSI 均逐点点击，绘制中显示圆形顶点，至少三个点后点击首点闭合；已保存顶点可调整，刷新后几何一致。维护者于 2026-09-24 确认采用此方向。

## 方案

- `FrameStackViewer` 的图像与 CT 分支改用 Cornerstone `SplineROITool`，配置为 `LINEAR`。它原生支持逐点点击、显示控制点、点击首点闭合和拖动控制点；直线配置避免曲线插值改变用户所画的边。
- `csAnno` 从 `SplineROI.data.handles.points` 读取点击顶点，写入现有 `Annotation.primitive={kind:"polyline",closed:true,points}`。回显时以服务端点列重建直线顶点工具对象。保留对当前 `PlanarFreehandROI` 完成事件的读取兼容，不改已有服务端标注。
- WSI 沿用已通过刷新验证的 OpenSeadragon SVG 实现。工具提示统一描述逐点点击和首点闭合；各引擎继续使用各自的坐标换算及同一个 annotation bridge。

## 取舍与验证

继续使用自由手绘会让同一按钮在超声与 WSI 下含义不同；另建跨引擎叠加层会重复 Cornerstone 已有的坐标、选择和拖点机制。采用原生直线顶点工具，限定改动在工具映射与契约适配层。

测试覆盖工具激活、点击顶点到服务端点列、服务端重建、图像缩放坐标、CT 切层目标、旧自由手绘事件兼容及提示文案。浏览器中还需走查图像与 CT 的绘制、拖点和刷新回显。
