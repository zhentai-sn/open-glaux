---
kind: record
status: open
title: "bug: WSI 查看器因 CSP 禁 unsafe-eval 在挂载时崩溃"
created: 2026-09-23
---

> **来源**：[对象收敛执行记录](2026-09-18-002-object-convergence-execution-log.zh-CN.md) W3 F-18。与 SDD 10 的波次无依赖，单独跟踪。

## 1. 现象

打开任一 slide，`WsiViewer` 挂载时抛出 `Current environment does not allow unsafe-eval, please use @pixi/unsafe-eval module to enable support.`，被 ErrorBoundary 接住，查看器区域整块不可用（瓦片、核质心叠加、ROI 框选都不可见）。

## 2. 证据

- 无头 Chromium（Playwright）下，W3 提交与 W2 提交 `3045114` 均复现，非对象收敛引入。
- 真实浏览器尚未复现验证。

## 3. 根因

- 开发与生产的 CSP 均为 `script-src` 不含 `'unsafe-eval'`（`frontend/vite.config.ts` 的 `cspMeta`，自 `c9b153b` 安全评审起）。
- `@annotorious/openseadragon@3.8.9` 的 dist **内嵌**了 pixi.js 7.x；pixi 的 `ShaderSystem` 构造时无条件执行 `systemCheck()`，检测到不能 `new Function` 即抛错。
- pixi 官方的 `@pixi/unsafe-eval` 补丁只作用于外部 `@pixi/core`，够不到 Annotorious 内嵌的副本；按代码推断真实浏览器同样会崩，待 §2 验证。

## 4. 方案比较

| 方案 | 结论 |
| --- | --- |
| CSP 加 `'unsafe-eval'` | 不采纳：全站放开动态代码执行，撤销 `c9b153b` 的 XSS 防线 |
| `@pixi/unsafe-eval` + Vite 去重让 Annotorious 用外部 pixi | 不可行：dist 已内嵌 pixi，别名改不到 |
| patch-package 改写内嵌的 `systemCheck` | 不采纳：改第三方产物，升级即失效，且只压掉检查、不保证渲染正确 |
| 升级 Annotorious 到不需要 eval 的版本 | 待调研：需确认上游是否提供不依赖 `unsafe-eval` 的构建 |
| 挂载 Annotorious 失败时降级：查看器照常显示瓦片与叠加，只禁用框选并提示 | **立即做**：改动局限在 `WsiViewer`，恢复「能看」 |
| W4 的 `PyramidViewer` 以 OpenSeadragon 原生叠加层实现 bbox / polygon，去掉 Annotorious | **根治**：WSI 只需要 bbox 与多边形，W4 本就要把 WSI 私有 UI 迁入 `PyramidViewer`（SDD 10 §8.3） |

## 5. 决定

1. 维护者先在真实浏览器确认复现。
2. 确认后以独立 `fix(frontend)` 提交做降级修复，不并入 SDD 10 的波次提交；补一条 smoke 用例断言 Annotorious 初始化失败时瓦片仍打开。
3. 根治随 W4 `PyramidViewer` 落地；若上游提供免 eval 构建，可改为升级。

## 6. W4 进展

`PyramidViewer` 已删除 Annotorious / pixi 依赖，用 OpenSeadragon 原生标注层承接 bbox / polygon；无头组件测试、前端构建和全量门禁通过。独立无头 Chromium 153 实际打开 `slide_001`，瓦片可见，未捕获 `unsafe-eval` 异常。桌面浏览器的瓦片、框选与控制台走查仍待维护者签字；签字前本单保持 open，§5 的降级修复路径不再适用于当前代码。
