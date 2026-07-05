<h1 align="center">🦉 Glaux</h1>

<p align="center"><strong>Biomedical Image Insight Agents · 生物医学影像洞察智能体</strong></p>

<p align="center">
  面向生物医学影像的 Agent 原生 AI ——<br>
  用自然语言描述一个研究目标;Glaux 的智能体自己规划、分割、测量、验证,<br>
  把任意模态的生物医学图像,变成可计算、可复现的洞察。
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

Glaux 是一套 **面向生物医学影像洞察的 Agent 原生工具**。你用自然语言描述一个研究目标,Glaux 的智能体
自己规划分析、执行分割与测量、**验证结果**,再把结构化、可复现的洞察交回给你——横跨各类生物医学影像模态。

你对话的是智能体;它脚下是一层 **已验证、模态无关的底座**——解码器、分割器、测量原语——溯源与可复现
内建其中。真正的价值在这层底座,而不在那个自然语言入口:**Glaux 不是套在模型外面的一层薄壳。**

可以把它理解为 **Agent 原生时代的 ImageJ,但挣脱了显微镜**:保留定量成像的科学严谨(可复现的掩膜、
测量、溯源),由你用自然语言指挥的智能体来交付,不再被绑死在单一仪器或单一模态上。

## 为什么是 Glaux?

今天做定量生物图像分析,意味着东拼西凑 ImageJ 宏、CellProfiler 管线和一次性脚本——强大,但慢、脆、且被
专业门槛挡在外面。Glaux 的赌注不是在这堆乱麻前再加一个自然语言入口——那层会被通用 agent 商品化;而是
**站在一层已验证、模态无关的底座之上、并对结果负责的智能体**。

- **Agent 原生,不是薄壳。** 你给的是目标,不是脚本。智能体自己规划、执行、验证、迭代——并随着积累
  "什么管用"而越来越准。
- **默认可验证、可复现。** 每个结果都带溯源、可重跑——是经得起同行评审的洞察,不是一张截图。
- **在生物医学内模态无关。** 结构就是结构,不管像素来自显微镜、超声探头,还是 CT 切片。
- **可计算、可复用的洞察。** 输出是别的工具和下游研究能继续接着用的结构化产物。

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
  <img src="assets/architecture.svg" alt="Glaux 架构 —— Web 将自然语言与图像请求代理给无状态的 science-core,由其解码、分割、测量" width="640">
</p>

- **Web** —— 工作台与自然语言层;从不触碰原始像素,代理转发给科学核心。
- **science-core** —— 一个无状态的 Python 服务,负责解码、分割、测量。新模态和新分割器挂在一个窄接口
  (策略注册表)后面接入,不是推倒重来。

引擎正从一个可用的荧光显微原型迁移而来;本仓库是 Glaux 愿景下的干净重启。

## 状态

**Pre-alpha · 预研究阶段。** 这里的方向是我们正在建造的北极星,目前还不是已交付的保证——与其过度承诺,
我们宁可如实这么说。

## 路线图

**北极星:** Biomedical Image Insight Agents —— 跨模态交付可验证、可复现洞察的智能体,建立在"模型越强
越值钱"的资产之上。

完整路线图与其背后的战略见 [docs/roadmaps/](docs/roadmaps/) —— 当前版本:
[产品路线图 · 2026-07-05](docs/roadmaps/20260705-product-roadmap.zh-CN.md)。为其提供依据的竞争与定位
分析见 [docs/researches/](docs/researches/)。

## 参与贡献

贡献指南会与工程规范一同落地。欢迎先通过 issue 提早期反馈与讨论。

## 许可证

**待定(TBD)** —— 预计采用宽松开源许可证(MIT 或 Apache-2.0),将在首个发布前确定。
