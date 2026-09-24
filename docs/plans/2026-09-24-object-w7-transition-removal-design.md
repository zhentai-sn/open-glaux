---
kind: record
status: reviewed
---

# SDD 10 W7 · 过渡物清除设计

## 边界

按 [SDD 10](../sdd/feats/10-object-convergence/README.md) §11.3 清除过渡副本。用户已授权继续 SDD 10 开发并把人工走查留到最终统一验收。本设计只安排删除顺序，不扩展到已有独立契约：保留 `GET /image/{id}`、`GET /volume/{id}/labelmap`、`GET /wsi/{id}/verify`，保留标注库物理 `z` 列与 science-core 分割适配器内部的 `roi_used`。

## 实施顺序

1. 先把前端、runtime 与测试改读新字段和端点；`TaskSpec`、`Annotation` 请求只用 `calibration` / `region` / `index`。确认生产会话从不发旧 `ViewerContext` 字段。
2. 删除服务端 `ObjectMeta` 的四个回填字段、`ImageMeta` 别名、`TaskSpec` 的三种旧输入、Annotation 的 `z` API 别名；标注落盘列继续叫 `z`，仅在 router 边界由 `Index` 映射。
3. 删除五组过渡端点 alias、`TaskPlugin.viewer` 与 `Detection.roi_used`；任务结果中的 ROI 改读 `Detection.region`。旧路径断言 404/405，保留端点继续回归。
4. 删除 runtime 旧上下文映射和告警计数；把模态字面量脚本以 `--strict` 接入 `make test`。静态检查聚焦过渡字段在跨层契约和核心路由的出现，保留数据源与算法内部有独立含义的 `cf`、`dims` 等词。

## 门禁

每段运行目标契约测试；最终跑三端全量测试、lint、构建、chat 发行包与严格字面量门禁。验证对象响应字段集、新输入拒旧字段、旧 alias 下线、标注 `index` 跨几何族、Detection 区域口径、未知对象 404 与无数据空态。W4/W6 的真实浏览器项仍待最终统一验收。
