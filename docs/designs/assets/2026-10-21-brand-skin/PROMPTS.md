---
kind: record
status: draft
---

# 小鸮图标 · 生成记录

- 生成日期：2026-10-21
- 执行方：Codex 子代理（内置图像工具），产出 1254×1254 原图；尺寸归一、像素清理与 ICO 导出由 Lead 用 Pillow 完成
- 纪律来源：`agent-design-icon-creator` skill（1:1、≤3–4 色、先生成再缩小、像素风格关键词、无文字）

## 参考 prompt

```text
Generate an image: A square 1:1 aspect ratio app icon of a small owl, mascot of a
local image-analysis agent called Glaux. Style: strict pixel art, 8-bit, crisp
hard-edged pixels, no anti-aliasing, no gradients, limited 3-color palette.
Colors: body #7C4DD6, shading #5E36A8, pale facial disc #F0EAFC. The owl faces
forward with two large round eyes inside pale facial discs, a tiny triangular
beak, two short ear tufts on top, compact rounded body, two small feet.
Centered composition, transparent background, clean edges, bold silhouette.
Designed to read clearly at 32x32 px. Professional, production-ready, no text.
```

紫底变体的差异：`solid #7C4DD6 rounded-square background, owl drawn in pale #F0EAFC linework`。

## 产出

| 文件 | 说明 |
| --- | --- |
| `glaux-owl-a-*.png` | 透明背景变体，1024 / 512 |
| `glaux-owl-b-*.png` | 紫底圆角变体，1024 / 512 / 256 / 128 / 64 / 32 |
| `glaux-owl-*-pixel-*.png` | 像素清理版（64 网格、5 色、NEAREST 放大），用于 favicon 与帧图基准 |
| `glaux-owl.ico` | Windows 多尺寸图标 16–256 |

## 已知偏差

- 原图 1254×1254（模型未遵守 1024 约定），已用 LANCZOS 归一到 1024
- 原图含 2 万级颜色与抗锯齿边缘，已用"缩到 64 网格 + 量化 5 色 + NEAREST 回放"清理
- 眼睛高光在 5 色量化下部分并入瞳孔，若需要保留需放宽到 7–8 色
