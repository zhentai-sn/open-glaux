<h1 align="center">🦉 Glaux</h1>

<p align="center"><strong>Biomedical Image Insight Agents · 生物医学影像洞察智能体</strong></p>

<p align="center">
  面向生物医学影像洞察的 Agent 原生环境 ——<br>
  带上一个智能体(你的或我们的),用自然语言描述一个研究目标,<br>
  把任意模态的生物医学图像,变成可验证、可复现的洞察。
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <strong>简体中文</strong>
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-pre--alpha-orange">
  <img alt="stage" src="https://img.shields.io/badge/stage-pre--research-blueviolet">
  <img alt="PRs" src="https://img.shields.io/badge/PRs-welcome-brightgreen">
  <img alt="license" src="https://img.shields.io/badge/license-TBD-lightgrey">
</p>

> **Glaux**(读作 /ɡlaʊks/;源自希腊语 **γλαύξ**,雅典娜的小鸮)是那只在黑暗中也看得清的智慧之鸟。
> 这正是 Glaux 的用途:**看进图像里去。**

---

## Glaux 是什么?

Glaux 是**面向生物医学影像洞察的 Agent 原生环境**——一个让智能体*在其中*运行的平台,把任意模态的生物
医学图像,变成可验证、可复现的洞察。你可以自带智能体(自配 API / 模型),也可以用 Glaux 的参考智能体;
无论哪种,**智能体是引擎,Glaux 是它动手所在的那个世界。**

这个世界是一层**已验证、模态无关的底座**:解码器(智能体*看到*的)、带校准的分割与测量(它能*正确地做*
的)、以及验证与溯源(让结果成为*可信的科学*)。通用智能体有推理能力,但它缺、且更强的模型也不会白送的,
正是这套环境。所以 **Glaux 不是套在模型外的薄壳,而是让任何智能体成为严谨的生物医学影像科学家的底座**。

## 为什么是 Glaux?

今天做定量生物图像分析,意味着东拼西凑 ImageJ 宏、CellProfiler 管线和一次性脚本——强大,但慢、脆、且被
专业门槛挡在外面。Glaux 的赌注不是在这堆乱麻前再加一个自然语言入口——那层会被通用 agent 商品化;而是
智能体把活干好、并对结果负责所*必需的那套环境*:推理是引擎,但没有一个已验证、懂模态的世界可供动手,
推理什么也完不成。

- **是环境,不是薄壳。** 护城河是底座——解码、带校准的测量、验证与溯源——**模型越强,它越值钱,而不是越没用。**
- **默认可验证、可复现。** 每个结果都带溯源、可重跑——是经得起同行评审的洞察,不是一张截图。
- **在生物医学内模态无关。** 结构就是结构,不管像素来自显微镜、超声探头,还是 CT 切片。
- **自带智能体。** 自配 API / 模型,或用 Glaux 的——引擎由你选,让它严谨的是环境。

## 能力边界

Glaux 拥有从 **图像 → 理解 → 表征** 这段管线。用户拿这个表征去做的下游事(决策、规划、模拟),是**在
Glaux 之上**自己搭的——这条边界是刻意划的。

| 范围之内 | 刻意排除 |
| --- | --- |
| 自然语言驱动的分割与测量 | **生产环境的临床诊断**(软件即医疗器械 SaMD) |
| 形态计量 / 定量分析 | 实时术中决策支持 |
| 重建与更丰富的表征 | 把手术规划 / 模拟作为核心承诺 |
| 在脱敏临床数据上做回顾性研究 | |

Glaux 是**科研**工具:经伦理审查(IRB)、在脱敏数据上做的回顾性研究在范围之内;受监管的临床诊断
(FDA / NMPA)不在范围之内。红线是:**科研洞察,而非临床决策。**

## 架构总览

<p align="center">
  <img src="assets/architecture.svg" alt="Glaux 架构 —— 智能体(自带或用 Glaux 的)在 Glaux 环境中运行,环境的四层(表征、动作、验证、记忆)把任意模态的图像变成可验证、可复现的洞察" width="640">
</p>

- **Agent(智能体)** —— 引擎,不是产品。自带(自配 API / 模型)或用 Glaux 的参考智能体;它在下面这套
  环境里*规划、执行、验证、迭代*。
- **Web** —— 工作台与自然语言层;从不触碰原始像素,负责编排智能体。
- **science-core** —— 智能体动手所在的无状态底座:解码 → 表征,再分割 · 测量 · 重建,且每个结果都带
  验证与溯源。新模态和新分割器挂在一个窄接口(策略注册表)后面接入,不是推倒重来。

护城河是环境,不是智能体。引擎正从一个可用的荧光显微原型迁移而来;本仓库是 Glaux 愿景下的干净重启。

## 状态

**Pre-alpha · 预研究阶段。** 这里的方向是我们正在建造的北极星,目前还不是已交付的保证——与其过度承诺,
我们宁可如实这么说。

## 路线图

**北极星:** Biomedical Image Insight Agents —— 跨模态交付可验证、可复现洞察的智能体,建立在"模型越强
越值钱"的资产之上。

1. **明确愿景、确定战略目标** —— 定位与护城河（基本完成，见下方分析）
2. **设定初步需求清单** —— 目标用户、用例、功能与非功能范围
3. **设定 / 调研技术架构** —— 可复用核心、agent 编排、已验证产物契约
4. **在 1–2 个场景上验证** —— 刻意选非荧光：病理图像（WSI）与超声图像

🔭 **远景（远期）** —— 平台化 / MCP 分销、全模态覆盖，以及远期的**辅助决策**（超出当前"研究非临床"边界的长期目标）。

完整路线图与其背后的战略见 [docs/roadmaps/](docs/roadmaps/) —— 当前版本:
[产品路线图 · 2026-07-05](docs/roadmaps/20260705-product-roadmap.zh-CN.md)。为其提供依据的竞争与定位
分析见 [docs/researches/](docs/researches/)。

### 当前已落地阶段

- **P1–P2**：多模态脊柱（TaskPlugin + Primitive/TaskOutput 信封 + 统一端点 `/task/*`）
- **P3**：能力注册表（`/capabilities` 插件市场）
- **P5**：dockview 外壳 + CLI 终端
- **P6 · 3D CT 楔子**（[设计](../designs/2026-07-09-001-p6-3d-totalseg-wedge.zh-CN.md) ·
  [计划](../plans/2026-07-09-001-feat-p6-3d-totalseg-wedge-plan.md) ·
  [runbook](docs/runbooks/p6-3d-totalseg-wedge.md)）：TotalSegmentator v2.4.0 肝+双肾分割 +
  体积度量 + 画笔编辑 + Reproducibility Dice。代码已合到 `feat/multimodal-arch` 分支；
  真机端到端（CPU/GPU 跑 nnU-Net）按 runbook 手动跑。

## 参与贡献

贡献指南会与工程规范一同落地。欢迎先通过 issue 提早期反馈与讨论。

## 许可证

**待定(TBD)** —— 预计采用宽松开源许可证(MIT 或 Apache-2.0),将在首个发布前确定。
