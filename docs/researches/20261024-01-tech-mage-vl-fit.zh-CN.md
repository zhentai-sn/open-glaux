---
kind: record
status: done
---

# 微软 Mage-VL 调研与 Glaux 落地评估

日期：2026-10-24。

目的：核对微软开源的 Mage-VL（`microsoft/Mage` 仓库的 `mage_vl/`），判断它在 Glaux 的环境四要素里能补什么、接入成本多少、哪些不值得投入。本文是调研记录，不改 SDD 状态，不启动模型部署或评测，也不承诺新功能。

## 1. 结论

**Mage-VL 适合作为「用户自带的视觉连接」之一被支持，不适合作为默认模型或随发行包分发；它真正的可复用价值不在模型权重，而在「按编解码器显著性选择视觉 token」这一观测策略，且该策略应先在 Glaux 侧用 ffmpeg 单独验证。**

三条支撑判断：

1. **连接层零专用代码即可试跑**（OpenAI 兼容 + 本地 SGLang），但视频只能走抽帧通道，等于放弃它唯一的差异化，剩下的是「又一个 4B 视觉模型」。
2. **codec 原生输入与事件门控（cognition gate）不能直接落进现有视频契约**：SDD 11 的片段规格（H.264/AAC、≤640 px、≤15 fps、≤6 MiB、≤60 s）与它依赖的「保留 GOP、运动矢量 + 残差能量」不是同一种数据；要接就得新设媒体适配器并改契约，收益尚未在 Glaux 自己的题目上被证明。
3. **分发侧不可打包**：约 9.5 GB 权重 + 1.07 GB 门控权重，外加需要本机编译的 `flash-attn` / `mamba-ssm`。这与[纲领](../roadmaps/charter.zh-CN.md)「模型由用户自带、可以替换」一致：Glaux 只负责支持它作为连接，不负责把它装进安装包。

## 2. 核对范围与证据

一手来源（2026-10-24 直接读取）：

- 仓库 [`microsoft/Mage`](https://github.com/microsoft/Mage) 的 `README.md`、`mage_vl/README.md`、`mage_vl/requirements.txt`、根 `LICENSE`；
- Hugging Face [`microsoft/Mage-VL`](https://huggingface.co/microsoft/Mage-VL) 的模型卡、`config.json`、`preprocessor_config.json`、文件清单与体积；[`microsoft/Mage-ViT`](https://huggingface.co/microsoft/Mage-ViT) 元数据；
- 论文 [arXiv:2607.24904v1](https://arxiv.org/abs/2607.24904) 正文（含结论与局限、评测口径）；
- GitHub API（star、fork、open issue 与评论数）、HF API（下载量、许可、可访问性）。

项目侧核对：[纲领](../roadmaps/charter.zh-CN.md)、[仓库骨架总览](../architecture.zh-CN.md)、[SDD 11](../sdd/feats/11-video-understanding-harness/README.md)、[Agent 连接 runbook](../runbooks/agent-connection.md)、`agent-runtime/src/pi/connection-probe.ts`、`compatibility.ts`、`video-turn.ts`。

**未做**（因此下列结论有边界）：未下载权重、未部署、未跑任何基准、未验证 SGLang 分支 `feat/mage-vl` 可用、未核对 `neural_codec/DCVC/` 第三方许可条款、未确认 HF `microsoft/Mage-Flow` 返回 401 是「已移除」还是「需登录」。本文所有性能数字均为作者自报，不构成本机验证结论。

## 3. Mage-VL 事实摘要（只留与落地相关的）

| 项 | 事实 | 对落地的意义 |
| --- | --- | --- |
| 发布形态 | 仓库是 Mage 家族：Mage-VL（理解）、Mage-Flow（生成）、Mage-ViT（编码器）；`mage_vl` 是一个子目录 | 「mage-vl」不是独立仓库，跟踪上游要看整个仓库 |
| 规模与结构 | 4B：Mage-ViT（24 层、hidden 1024、patch 16、输出 2560 维，从零训练）+ Qwen3-4B-Instruct-2507（36 层、hidden 2560、262k 上下文） | 单一规模，无更大变体；同一 LLM 下换视觉前端是它的比较口径 |
| 权重体积 | 两个 bf16 safetensors 分片共约 9.5 GB；流式门控 `streammind_gate.safetensors` 约 1.07 GB；神经 codec 预训练包约 265 MB | 与 Qwen3-VL-4B 同量级，不算额外负担；但「+1 GB 门控」只在流式场景有用 |
| 输入 | 图像；视频三种后端：均匀抽帧、传统 codec（H.264/HEVC，运动矢量 + 残差）、神经 codec（DCVC-RT，学习到的 rate map）；16×16 patch 上保留全部 I 帧 patch、只保留 P 帧的显著 patch，视觉 token 降 75% 以上 | 差异化只在 codec 后端；抽帧后端就是普通 VLM |
| 训练 | 五阶段纯 SFT（3.5 亿图 + 420 万短视频描述 → 5400 万图像指令 → 中长视频 → 35 万长视频 codec 窗口 → 冻结主干只训门控），无 RL 后训练 | 论文自述 agentic 与数学推理弱；也没有训练代码可复现 |
| 许可 | 权重 Apache-2.0；仓库 `LICENSE` 为 MIT；Mage-Flow / Mage-ViT 为 MIT | 权重可商用；DCVC 目录另有第三方许可，需单独核 |
| 评测口径 | 与同 LLM 的 Qwen3-VL-4B 对比；实际耗时在单机 8×B200 上测，Qwen3-VL 与 Phi-4-R-V 固定 32 帧且不计视频加载时间 | 数字不能平移到消费级显卡或 Glaux 的片段规格上 |
| 社区状态 | 约 1.68k star / 171 fork；HF 约 8.6k 下载；25 个 open issue，多数 0 回应 | 维护响应弱，遇到问题不能指望上游快速修 |

## 4. 与 Glaux 环境四要素的对应

| 要素 | Mage-VL 提供什么 | Glaux 现状 | 是否新增能力 |
| --- | --- | --- | --- |
| 观测空间 | 按 codec 显著性决定「哪些 patch 值得编码」，把 token 花在运动与新增细节上 | 视频观测按源 PTS 取区间片段，转码为 H.264/AAC、≤640 px、≤15 fps、6 MiB 以内，`fps` 只能取 0.5/2/5；图像观测是单帧 + 区域放大 | 只在「选哪一帧、花多少 token」这一层重合；codec 原生通道不存在 |
| 动作空间 | 无。它的 tracking 指标是问答式判断，不产出可回写查看器的 mask 或测量 | `run_task` 注册表 + 分割/测量/标注工具 | 不新增 |
| 验证器 | 无。它给的是更快、更省 token | 区间/帧时间/区域/源指纹校验，证据不足单列 | 不新增；不要把它「说得流畅」当作证据 |
| 回合与轨迹 | 「什么时候开口」的事件门控（System 1）+ 完整回答（System 2） | 智能体自主选区间观察；一次分析是一个回合，轨迹沉淀为案例 | 语义相近但阈值语义不可迁移：门控是在它自己的流式数据上训的 |

关键错配说清楚：SDD 11 把片段统一转成 ≤640 px / ≤15 fps 的 H.264/AAC MP4。转码会重写运动矢量与残差，Mage-VL 在训练时看到的分布（原始码流的 MV + 残差能量，或 DCVC 的 rate map）不复存在；而 OpenAI Chat Completions 通道只能承载抽帧图像。**结论：在现有通道里调用 Mage-VL，等价于用它的 4B 参数做抽帧问答，不是论文设置。**

## 5. 四条落地路径

| 路径 | 做什么 | 收益 | 成本与依赖 | 建议 |
| --- | --- | --- | --- | --- |
| P0 连接层 | 作为 `openai-compatible` 连接接入（本地 SGLang 或远端网关），用于图像理解与抽帧视频问答 | 中低：图像能力与 Qwen3-VL-4B 相当，无独占优势 | 低：不改代码。模型 id 含 `-vl`，`nameVision` 判 👁，视觉工具自动挂载；`http` 仅回环可直连 `127.0.0.1`，远端 https 需 `GLAUX_VLM_HOST_ALLOW` | **支持，只写文档，不写专用代码** |
| P1 观测采样 | 不引入模型，用 ffmpeg 的 `mv` / 残差能量在 backend 侧做事件驱动抽帧、选片与预算分配 | 高：直接加深观测空间；与模型强弱无关，模型变强仍需要 | 中：backend 片段生成路径 + 新参数契约；需在真实题库上证明「同预算更准」 | **最推荐投入**，先用小样本证明再谈契约 |
| P2 视频适配器 | 新 `media_adapter`，保留 GOP 与码流信息，另立片段规格给 Mage-VL | 未知：需要先证明 codec 通道比抽帧在 Glaux 题目上更强 | 高：改 SDD 11 契约、绕过 ≤640 px 转码约束、依赖上游 codec 预处理代码 | **递延到 P1 结论之后再评估** |
| P3 流式门控 | 接 `streammind_gate` 做「何时开口」 | 低：Glaux 是回合制分析，不是直播解说 | 高：需 codec 输入 + 阈值语义校准 | **不投入**，当前无场景 |

补充两条工程事实，供以后真接时省一次排查：

- 视觉能力判定是名称启发式（`connection-probe.ts` 的 `VISION_NAME_TOKENS` 含 `-vl`），`microsoft/Mage-VL` 会被判「可看图」，无需改代码；但「探测成功不等于视频能力通过」——这与 SDD 11 的既有判断一致。
- 上游 `/models` 若不自报上下文窗口，前端回退 200K / 32K；Mage-VL 的 config 是 262k 上下文，可在面板手填。

## 6. 若只做 P0，验收点什么

1. 按 [连接 runbook](../runbooks/agent-connection.md) 的 C 通道（OpenAI 兼容）接本地 SGLang（`http://127.0.0.1:30000/v1`，`--trust-remote-code`），确认测试连通、拉模型、👁 标注正确。
2. 对当前焦点图像调 `view_current_image`，确认它能出可核对结论（Glaux 送的是 PNG base64；Mage-VL 的图像预处理是 patch 16、`min_pixels` 3136、`max_pixels` 4M，与 Qwen2-VL 图像处理器同族，预期兼容但须实测）。
3. 用 32 帧抽帧问一道时间定位题，与现有连接对照；若没有明显更准，说明差异化在 codec 侧，P0 到此为止。
4. 记录失败模式：拒绝视频、格式报错、超时、token 用量。这些是判断是否值得进 P2 的原始材料。

## 7. 评测建议（小成本、可被拒证）

- 复用本仓已有的 TennisTV / BARD 数据准备与本机示例短视频，不新拉数据集。
- 固定总帧数或总字节预算，比较三种条件：现有区间观察、Mage-VL 抽帧问答、Mage-VL + codec 后端（若 P2 发生）。
- 指标分开报：答案正确率、证据时间 IoU、拒答率、单题时延、单题成本。**不要把「模型自报置信度高」当成正确率**。
- 不搬 OVO-Bench / SoccerNet 的分数：那是它的训练与评测分布，且硬件口径是单机 8×B200。论文里 VideoQA SFT 冗余、运动—空间协同等结论只作为假设，不作为 Glaux 的设计依据。
- 本文不启动评测；恢复评测时应另立计划文件。

## 8. 风险与不确定

| 风险 | 说明 | 应对 |
| --- | --- | --- |
| 维护响应弱 | 25 个 open issue 多数 0 回应；#34 指出正文的「MV + 残差」与代码的 `bitcost` 口径差异；#28 报告图像与视频同批处理时占位符错位；#37 在问模型在哪 | 只做连接支持，不把上游代码嵌进主链路 |
| 单点分支 | 在线推理依赖个人分支 `kcz358/sglang:feat/mage-vl`，不是上游合并状态 | P0 只作试用；生产不承诺吞吐 |
| 依赖面新且重 | `transformers>=5.7`、`torch>=2.9`、`flash-attn`、`mamba-ssm`（需按本机 CUDA 编译）、`decord`、`codec-video-prep` | 不进安装包；只写在文档里，由用户自建环境 |
| 无训练/评测代码 | 仓库只有推理脚本（`inference_base.py`、`inference_streaming.py`） | 不规划自训或微调；Mage-ViT 可作独立编码器另行评估 |
| 许可细节 | 权重 Apache-2.0 可商用，但 `neural_codec/DCVC/` 带第三方 `LICENSE`/`NOTICE` | 走神经 codec 前单独核条款 |
| 能力边界 | 自述 agentic 与数学推理弱、无 RL 后训练；自报表中 TextVQA、CC-OCR、MV-Bench 落后 Qwen3-VL-4B | 定位为「视频与空间更强、文字密集更弱」的 4B 选项 |

## 9. 按纲领的决策过滤器

- **更强的模型会让它作废吗？** 会。连接层接入是薄封装，模型商品化后没有差异，因此只做配置与文档，不写专用代码。
- **更强的模型会让它更值钱吗？** 会，但值钱的是 P1：codec 显著性决定了同样的 token 预算看哪里，这与模型能力正交。**先证明，再谈实现。**
- **它加深了哪个要素？** P1 加深观测空间；P0 不加深任何要素，属于「让模型更聪明」那一类，不该在这里投入。

## 10. 一手来源导航

| 来源 | 用途与阅读深度 |
| --- | --- |
| [microsoft/Mage](https://github.com/microsoft/Mage) | 家族定位、目录结构、README 全文 |
| [mage_vl/README.md](https://github.com/microsoft/Mage/tree/main/mage_vl) | 架构、五阶段训练、评测表、推理用法全文 |
| [arXiv:2607.24904](https://arxiv.org/abs/2607.24904) | 摘要、结论与局限、评测口径（8×B200）、数据规模 |
| [HF 模型卡](https://huggingface.co/microsoft/Mage-VL) | 权重许可、体积清单、`config.json` / `preprocessor_config.json` 实测 |
| [项目页](https://microsoft.github.io/Mage/vl/) | 定位与演示，未逐项复算 |
| [GitHub Issues](https://github.com/microsoft/Mage/issues) | 维护响应、codec 预处理口径争议、已知缺陷 |
