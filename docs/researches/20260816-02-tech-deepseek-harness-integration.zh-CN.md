---
kind: record
status: superseded
superseded_by: docs/roadmaps/charter.zh-CN.md
---

# DeepSeek Harness 插件生态集成可行性调研

> **用途**：评估 Glaux 以插件/工具身份接入 DeepSeek Harness (dsh) 生态的可行性，给出集成路径与推荐方案。
> **日期**：2026-08-16 · **类别**：tech（技术） · **状态**：draft · 待评审
> **依据**：[纲领](../roadmaps/charter.zh-CN.md) · [仓库骨架总览](../architecture.zh-CN.md) · [SDD 02 智能体图像标注能力](../sdd/feats/02-agent-image-annotation/README.md) · [SDD 03 Atlas 图谱](../sdd/feats/03-atlas/README.md)
> **半衰期提醒**：DeepSeek Harness 目前为 v0.1.0-rc.5 开发者预览版，API 与插件契约可能随版本迭代 breaking change；落地前需复核最新文档与 schema-version。

---

## 0. 一页纸结论

**问题**：DeepSeek Harness（2026-08-13 发布，MIT 许可，GitHub 33k+ star）是 DeepSeek 推出的开源 agent harness，核心理念"Everything is a Plugin"，定位为 Claude Code 的开源竞品。Glaux 能否作为插件接入其生态，让 dsh agent 直接调用生物医学图像分析能力？

**结论**：**完全可行，且天然契合。** Glaux 定位是"agent 运行的世界/环境"，dsh 定位是"agent 运行的引擎"——两者互补而非竞争。

| 路径 | 方式 | 投入 | 覆盖面 | 推荐 |
| --- | --- | --- | --- | --- |
| **A. MCP Server 封装** | 将 glaux-core 管线暴露为 MCP tools，dsh 通过内置 MCP 客户端消费 | ~1–2 周 | dsh + Claude Code + Cursor + 一切 MCP 客户端 | ✅ **推荐首选** |
| B. Cordis Service 插件 | TypeScript wrapper 注册 `ctx.glaux` 服务 | ~3–4 周 | 仅 dsh 生态 | ⚠️ 待 dsh 稳定后考虑 |
| C. Agent Runtime 替换 | 用 dsh 替换 pi-agent-core 作为 Glaux agent 引擎 | ~6–8 周 | 绑定 dsh | ❌ 过早，风险过高 |

**推荐方案**：先走路径 A（MCP Server），与 Glaux roadmap 中已规划的"MCP distribution"完全重合——做一次，全平台覆盖。dsh 稳定至 v1.0 后再评估路径 B。

---

## 1. DeepSeek Harness 概况

### 1.1 基本信息

| 项 | 内容 |
| --- | --- |
| 名称 | DeepSeek Harness (CLI: `dsh`) |
| 发布日期 | 2026-08-13 |
| 版本 | v0.1.0-rc.5（开发者预览） |
| 许可证 | MIT |
| 仓库 | [github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) |
| 技术栈 | Node.js / TypeScript / pnpm |
| 插件框架 | Cordis（"A Programming Paradigm for Spatiotemporal Composability"） |
| 定位 | 将裸语言模型变为自主 agent 的基础设施层；Claude Code 的开源竞品 |

### 1.2 架构特征

- **"Everything is a Plugin"**：模型适配器、工具、会话状态、文件系统、沙箱、agent loop、编排、调度、Web UI 均为 Cordis 插件服务
- **Cordis Context 模型**：`context` 是服务仓库，插件通过声明合并（`declare module '@deepseek-ai/cordis'`）注册类型安全的服务键（如 `ctx.tools`、`ctx.llm`）
- **Schema-driven 契约**：每个插件声明 typed 输入/输出，通过 `harness-schema-version` 字段 pin 版本
- **YAML 配置**：`cordis.yml` 声明插件加载与参数
- **MCP 内置**：`@deepseek-ai/dsh-mcp-client` 插件连接外部 MCP server，工具自动注册到 `ctx.tools`

### 1.3 SDK 与接入方式

| SDK | 说明 |
| --- | --- |
| TypeScript SDK | 主力开发语言，子进程 JSON-RPC stdio |
| Python SDK | `pip install deepseek-harness`，嵌入式运行时 |
| CLI | `dsh` 命令行 |
| MCP server | `npx @deepseek-harness/mcp` |

### 1.4 关键资源

- 官网：[deepseek.com/harness/en/](https://deepseek.com/harness/en/)
- Cordis 教程：[deepseek-harness.github.io/.../cordis-tutorial/](https://deepseek-harness.github.io/deepseek-harness/en/develop/cordis-tutorial/)
- 第一个插件：[deepseek-harness.github.io/.../basic/](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)
- 社区插件：[github.com/topics/deepseek-harness](https://github.com/topics/deepseek-harness)

---

## 2. Glaux 与 dsh 的互补性分析

### 2.1 定位对比

| 维度 | Glaux | DeepSeek Harness |
| --- | --- | --- |
| 身份 | Agent 运行的**世界**（verified environment） | Agent 运行的**引擎**（harness / loop） |
| 核心能力 | 生物医学图像解码、校准分割、测量、验证、溯源 | 模型适配、工具编排、会话管理、插件生命周期 |
| 技术栈 | Python (backend / science-core) + TypeScript (agent-runtime / frontend) | TypeScript / Node.js |
| 形态 | 三进程本地系统 | 可嵌入的 harness 框架 |
| 护城河 | 已验证的科学环境（纲领§"agent 卖铲子"） | 插件生态与社区规模 |

**结论**：Glaux 提供的恰好是 dsh 生态缺少的——一个经过校准和验证的垂直领域环境。两者没有功能重叠。

### 2.2 Glaux 可暴露的原子能力

从 science-core 与后端 API 提取可作为工具暴露的能力：

| 能力 | 对应模块 | MCP tool 候选名 |
| --- | --- | --- |
| 数据集列表与图像加载 | backend/routers, datasource registry | `glaux/list-datasets`, `glaux/get-image` |
| 影像解码（TIFF→PNG, NIfTI, WSI） | backend/imaging, glaux_core/io | `glaux/decode-image` |
| 校准（像素间距提取与验证） | glaux_core/calibration | `glaux/calibrate` |
| 分割（多模态适配器） | glaux_core/segmentation | `glaux/segment` |
| 测量（IMT 等） | glaux_core/measurement | `glaux/measure` |
| 验证（结构化结果校验） | glaux_core/verification | `glaux/verify` |
| 端到端管线 | backend /task/run | `glaux/run-task` |
| Atlas 案例检索 | backend/atlas/store | `glaux/atlas-search` |

---

## 3. 集成路径详述

### 路径 A：MCP Server 封装（推荐）

**原理**：将 Glaux 后端包装为 MCP server，dsh 通过内置 `@deepseek-ai/dsh-mcp-client` 消费。

**架构**：

```
┌─────────────────────────────────────────────────┐
│  dsh (agent harness)                            │
│  ┌──────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ ctx.llm  │  │ ctx.tools  │  │ ctx.session │  │
│  └──────────┘  └─────┬──────┘  └─────────────┘  │
│                      │ MCP client                │
└──────────────────────┼──────────────────────────┘
                       │ stdio / SSE
            ┌──────────▼──────────┐
            │  glaux-mcp-server   │
            │  (thin Python shim) │
            └──────────┬──────────┘
                       │ in-process
            ┌──────────▼──────────┐
            │   glaux-core +      │
            │   FastAPI backend   │
            └─────────────────────┘
```

**实现步骤**：

1. 基于 `mcp` Python SDK 编写 `glaux-mcp-server`，transport 选 stdio（与 dsh MCP 客户端兼容）
2. 每个原子能力注册为 MCP tool，定义 JSON Schema 的 inputSchema / outputSchema
3. 图像传输走 base64 或临时文件路径（MCP resource 协议支持 `file://`）
4. `cordis.yml` 中配置一行即可接入：
   ```yaml
   plugins:
     mcp-client:
       servers:
         glaux:
           command: python
           args: ["-m", "glaux_mcp_server"]
   ```

**优势**：
- 与 Glaux roadmap 中"MCP distribution"目标完全一致——同一份代码同时服务 dsh / Claude Code / Cursor / 任意 MCP 客户端
- 零侵入：Glaux 自身架构不需要改动，只加一层薄 wrapper
- 协议级隔离：dsh API breaking change 不影响 Glaux
- Python 原生：不需要额外的 TypeScript wrapper

**风险与对策**：

| 风险 | 对策 |
| --- | --- |
| 医学图像体积大，MCP stdio 传输慢 | 图像走文件路径引用 + MCP resource，不走 base64 inline |
| dsh 对 MCP server 的生命周期管理可能有 quirk | 初期测试；必要时走 SSE transport |
| 当前无 MCP server 骨架 | 复用 `mcp` Python SDK 的 `FastMCP` 快速搭建 |

**工作量**：~1–2 周（含测试）

### 路径 B：Cordis Service 插件

**原理**：用 TypeScript 编写 Cordis service wrapper，通过 HTTP 调用 Glaux 后端，注册为 `ctx.glaux`。

**实现要点**：

```typescript
import { Service, Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    glaux: GlauxService
  }
}

class GlauxService extends Service {
  constructor(ctx: Context) {
    super(ctx, 'glaux')
  }

  async analyze(imagePath: string, task: string) {
    // HTTP call to Glaux backend :8000
  }
}
```

**优势**：
- 类型安全的 TypeScript 接口
- 生命周期由 Cordis 管理（热重载、依赖注入）
- dsh 社区插件发现（`npm publish @open-glaux/dsh-plugin`）

**劣势**：
- 锁定 dsh 生态，Claude Code / Cursor 不能用
- 多维护一层 TypeScript wrapper，增加跨语言调试成本
- dsh v0.1 可能有 breaking change，需要跟进适配

**工作量**：~3–4 周

### 路径 C：Agent Runtime 替换

**原理**：用 dsh 替换 Glaux 当前的 `@earendil-works/pi-agent-core`，Glaux 变为 dsh 的"世界插件"。

**劣势严重**：
- 对 v0.1 预览版有强依赖——breaking change 会中断 Glaux 核心功能
- 迁移成本高：pi-agent-core 的 session/SSE/permission 契约需要全部重写
- 丧失对 agent 行为的精细控制（权限四级分类 observe/suggest/controlled/autonomous）
- 前端 agent-api 层需要大面积适配

**工作量**：~6–8 周，且高风险

**判定**：❌ v0.1 阶段不建议。等 dsh 到 v1.0 稳定版、社区验证充分后重新评估。

---

## 4. 决策建议

### D-1：首选路径 A（MCP Server 封装）

- Glaux roadmap 已有"MCP distribution"规划，路径 A 完全复用这项投入
- 一次实现 → 多平台覆盖（dsh / Claude Code / Cursor / VS Code Copilot）
- 协议级隔离，不受 dsh 版本波动影响

### D-2：路径 B 作为 dsh 稳定后的增值选项

- 当 dsh 发布 v1.0 且 `harness-schema-version` 稳定时，评估是否追加 Cordis 插件
- 目标是 dsh 社区内的"一等公民"体验（类型安全、自动发现、生命周期管理）

### D-3：路径 C 暂不考虑

- pi-agent-core 目前满足需求，无替换动力
- dsh 的 agent loop 治理能力尚不明确（权限分级、provenance、verification 是否支持）

### D-4：MCP tool 粒度遵循"原子能力"原则

- 每个 tool 对应一个可独立调用的科学计算步骤
- 避免"大而全"的单一 `glaux/run` tool——agent 应该能自行编排 calibrate → segment → measure → verify 的流程

### D-5：关注 dsh 演进

- 订阅 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 的 release 通知
- 当 v1.0 发布时触发路径 B 评估

---

## 5. 行动项

| # | 行动 | 前置 | 优先级 |
| --- | --- | --- | --- |
| 1 | 待评审通过后，将"MCP Server 封装"纳入 roadmap | 本文档评审 | — |
| 2 | 基于 `mcp` Python SDK 实现 `glaux-mcp-server` 骨架 | 行动 1 | P1 |
| 3 | 定义 MCP tool schema（inputSchema / outputSchema） | 行动 2 | P1 |
| 4 | 在 dsh 环境中端到端验证 MCP 连接 | 行动 3 | P1 |
| 5 | dsh v1.0 发布时评估路径 B | dsh 版本演进 | P3 |
