<h1 align="center">🦉 Glaux</h1>

<p align="center"><strong>Biomedical Image Insight · 生物医学影像洞察</strong></p>

<p align="center">
  AI 原生的生物医学影像分析计算平台 ——<br>
  用自然语言,把任意模态的生物医学图像,变成可计算、可复用的结构。
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

Glaux 是一个 **AI 原生的生物医学影像分析计算平台**。你用自然语言描述想要什么,Glaux 把图像转成结构化、
可计算、可复用的结果——分割、测量、重建——横跨各类生物医学影像模态。

可以把它理解为 **AI 原生时代的 ImageJ,但挣脱了显微镜**:保留定量成像的科学严谨(可复现的掩膜、测量、
溯源),由自然语言驱动,不再被绑死在单一仪器或单一模态上。

## 为什么是 Glaux?

今天做定量生物图像分析,意味着东拼西凑 ImageJ 宏、CellProfiler 管线和一次性脚本——强大,但慢、脆、且被
专业门槛挡在外面。我们在意的壁垒不是"再多一个格式解码器",而是**由自然语言驱动、从图像到结构化知识的
那条管线**——它在很大程度上与模态无关:结构就是结构,不管像素来自显微镜、超声探头,还是 CT 切片。输出
是别的工具能继续接着用的可计算产物——不是截图。

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

- [ ] 敲定新仓库的工程规范
- [ ] 迁移计划:从原型移植可复用的核心(解码 · 分割 · 测量)
- [ ] 第一条端到端"自然语言 → 分割"回路
- [ ] 模态可行性验证(超出荧光显微)

## 参与贡献

贡献指南会与工程规范一同落地。欢迎先通过 issue 提早期反馈与讨论。

## 许可证

**待定(TBD)** —— 预计采用宽松开源许可证(MIT 或 Apache-2.0),将在首个发布前确定。
