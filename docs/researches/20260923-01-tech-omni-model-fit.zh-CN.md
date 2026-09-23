---
kind: record
status: review
---

# 全模态模型选型与仓库契合度调研：Qwen3.8-Omni-Flash / MiMo-V2.6-Flash

> **用途**：评估音视频原生输入的全模态模型接入 Glaux 视频理解 harness 的可行性，为 SDD 11「视频理解 harness」提供输入。
> **日期**：2026-09-23 · **类别**：tech（技术）
> **依据**：[纲领](../roadmaps/charter.zh-CN.md) 第六节「观测空间」· [SDD 10 视觉对象与数据源收敛](../sdd/feats/10-object-convergence/README.md) D-23、§17 · [SDD 00 内置参考智能体](../sdd/feats/00-reference-agent-conversations/README.md)
> **半衰期提醒**：两款模型均于 2026-09 发布，基准全部为厂商自报；接口与价格以各平台文档为准，落地前复核。

---

## 0. 结论

- **主选 Qwen3.8-Omni-Flash，备选 MiMo-V2.6-Flash。**
  - 两者都是原生全模态，输入包括文本、图像、音频、视频，输出为文本，上下文 1M，接口兼容 OpenAI。
  - 两者音视频内容块的形状相同（`image_url` / `video_url` / `input_audio`），一套适配可同时服务两家。
  - MiMo-V2.6-Flash 以 MIT 许可开放权重，是私有部署与数据不出域场景的唯一候选。
- **与纲领和 SDD 10 方向一致。**
  - 纲领的观测空间要求交付「与画面对齐的音频区间」。
  - SDD 10 D-23 已声明音轨并保留取流入口。
  - 两款模型都能直接消费「一个时间区间的视频片段加音频」，不需要先转写成文字。
- **现有代码接不上，缺口集中在 agent-runtime 的模型通道**，见第 3 节：
  - pi-ai 只支持文本和图像内容块；
  - 连接配置只有 `vision` 一个能力位；
  - 两个模型 id 都不命中视觉名称启发式；
  - 无法控制思考强度；
  - 本地媒体只能以不超过 10MB 的 base64 发送。
- **落地顺序**：
  1. 先冻结 SDD 11 的观测形状（时间区间 → 帧集合 + 音频片段 + 时间戳）；
  2. 再在 agent-runtime 用 `onPayload` 钩子补音视频内容块；
  3. 不 fork pi-ai，不做整段视频上传的流水线。
- **需要实测的一项**：秒级时间定位精度。两家都没有公开这项指标，而它直接决定「结论可溯源到帧」这一验证器要求能否成立。

## 1. 候选模型

### 1.1 规格对比

| 项 | Qwen3.8-Omni-Flash | MiMo-V2.6-Flash | Gemini 3.8 Flash（参照） |
| --- | --- | --- | --- |
| 发布 | 2026-09-18 | 2026-09-21 | 2026 |
| 权重 | 闭源，仅 API | MIT 开放权重 | 闭源，仅 API |
| 规模 | 未公开 | 309B MoE，15B 激活（HF 仓库另有 159B 的说法，口径待核） | 未公开 |
| 输入 | 文本、图像、音频、视频 | 文本、图像、音频、视频 | 文本、图像、音频、视频 |
| 输出 | 文本（另有实时变体，走 WebSocket/WebRTC） | 文本 | 文本 |
| 上下文 / 最大输出 | 1M / 131K | 1M / 128K | 1M / — |
| 单次音视频上限 | 视频 2h（URL，≤2GB）；音频 3h；采样最高 15 fps 仍稳定 | 未公开；官方称可理解超过 10h 的连续音频 | 音频 9.5h；视频 3h（低分辨率）或 1h（高分辨率） |
| 本地文件 | base64 data URI，≤10MB | base64（音频为 wav） | — |
| 协议 | OpenAI Chat Completions / Responses、DashScope | OpenAI、Anthropic | Gemini API |
| 接口地址 / 模型 id | DashScope 各区域 / `qwen3.8-omni-flash` | `https://api.xiaomimimo.com/v1` / `mimo-v2.6-flash` | — |
| 思考模式 | 默认开启，`reasoning_effort` 可调，默认 `xhigh` | 可开关 | 可调 |
| 工具调用 | 支持 | 支持 | 支持 |
| 音频特性 | 74 种语言 + 39 种中文方言；双声道 / 四声道 FOA 空间音频（`use_multichannel`） | 环境声分类、多说话人分离 | — |
| 价格（每 M token，输入 / 输出） | $0.15 / $0.47；缓存命中 $0.016 | $0.14 / $0.28；缓存命中 $0.0028 | $0.75 / $3.75，2027-01-01 起 $1.5 / $7.5 |
| 限流 | — | 100 RPM，10M TPM | — |
| 部署区域 | 北京、新加坡、香港、东京、法兰克福、弗吉尼亚 | 小米自有平台；OpenRouter、Vercel 等网关 | — |

### 1.2 厂商自报基准

Qwen3.8-Omni-Flash 与 Gemini 3.8 Flash 的对比：

| 基准 | Qwen3.8-Omni-Flash | Gemini 3.8 Flash | 说明 |
| --- | --- | --- | --- |
| OmniVideoBench | 63.4；agent 模式 67.8 | 65.2 | agent 模式每题 token 从 14.6 万降到 7.9 万 |
| Video-MME-v2 | 65.0 | 71.0 | 纯视频推理 Gemini 领先 |
| JointAVBench | 75.9 | 70.4 | 音画联合推理 |
| WildClawBench-MM | 71.0 | 58.9 | 多模态工具调用 |
| UniClawBench | 69.6 | 69.0 | — |
| AliMeeting 说话人分离错误率（越低越好） | 3.4 | 72.6 | 数值差距异常大，需实测复核 |

MiMo-V2.6 公开的基准以智能体和编程为主，没有找到 Video-MME、OmniVideoBench 等音视频基准的数值。它在音视频上的表现需要在 Glaux 自己的评测集上测。

### 1.3 与本仓库相关的观察

- **agent 模式的实测证据**：Qwen 的 agent 模式让模型按需截取片段，不再整段读入。结果是准确率上升、token 下降约 46%。这支持 SDD 10 §17 定下的「先粗后细、由模型指定区间放大」，而不是由核心预设抽样策略。
- **工具封装方式**：Qwen 同期开源了 [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins)（Apache-2.0），以 Skill + MCP 的形式把音视频能力接入 agent 框架，包括 omni-memory、omni-video2note、omni-chatcut。它的工具划分可以作为 SDD 11 的参考，但其中剪辑、配音类工具不在 Glaux 边界内。
- **稳定性**：第三方实测指出，在 Claude Code 中接入时经常中断、会话不稳定，长会话需要验证。

## 2. 与纲领和 SDD 的契合点

| 依据 | 要求 | 两款模型的对应能力 |
| --- | --- | --- |
| 纲领第五节 | 模型由用户自带、可以替换 | 两家接口都兼容 OpenAI，内容块形状一致；换模型只改连接配置 |
| 纲领第六节「观测空间」 | 抽帧、裁剪，以及与画面对齐的音频区间 | 原生接收视频片段（带音轨）、图像序列和音频片段，不依赖 ASR 转写 |
| 纲领第六节「验证器」 | 结论可溯源到帧与区域 | 前提是模型能输出可靠的时间戳，需实测（见第 4 节） |
| 纲领第七节「决策过滤器」 | 更强的模型应让环境更值钱 | Glaux 只负责交付有物理语义（时间基、采样率）的观测，模型越强，同一观测的收益越高；整段上传再摘要的流水线则会被模型能力直接取代，不应做 |
| SDD 10 D-23 | 音轨是一等观测内容，只声明不消费 | 为音频区间交付预留了入口；消费形状等 SDD 11 冻结 |
| SDD 10 §17 第三项 | 一个时间区间 → 帧集合加音频片段，共享同一时间基 | 可直接映射为一条消息中的 `video` 图像序列（或 `video_url` 片段）加 `input_audio` |
| 视频方向（2026-09-22） | 工程约束做薄、不预先写死工具集 | 模型自身具备规划和工具调用能力，Glaux 提供取区间的原语即可 |

## 3. 代码层缺口

以下基于 2026-09-23 的 `main`（SDD 10 处于 W0；视频数据源 `backend/app/dataset_video.py` 尚未建）。

| 编号 | 缺口 | 位置 | 影响 |
| --- | --- | --- | --- |
| G1 | pi-ai 0.82.1 的内容块只有 `TextContent` 和 `ImageContent`；`openai-completions` 只转换出 `image_url` | `agent-runtime/node_modules/@earendil-works/pi-ai/dist/types.d.ts`、`api/openai-completions.js` | 音频、视频无法经主对话循环或工具结果送达模型 |
| G2 | 连接能力只有 `vision?: boolean`；没有音频、视频能力位 | `agent-runtime/src/contracts.ts` | 无法按连接能力决定交付原生音频，还是回退为帧加转写 |
| G3 | 视觉名称启发式不含 `omni`、`mimo` | `agent-runtime/src/pi/connection-probe.ts` 的 `VISION_NAME_TOKENS` | `qwen3.8-omni-flash`、`mimo-v2.6-flash` 会判为 `unknown`，前端按无视觉处理，`view_current_image`、`locate_roi`、`consult_atlas` 不注册 |
| G4 | 非内置模型 `reasoning` 固定为 `false`，pi-ai 不下发任何思考参数 | `agent-runtime/src/pi/model-runtime.ts` | Qwen3.8-Omni-Flash 服务端默认按 `xhigh` 思考，延迟和成本不可控 |
| G5 | 本地媒体只能以 base64 发送，Qwen 上限 10MB；需要公网 URL 才能发大文件，而 backend 在本地 | backend 媒体出口 | 交付单位必须是短区间片段，需要 backend 按区间切片和转码。这与分层导航一致，但切片接口尚不存在 |
| G6 | SDD 10 规则 22：SDD 11 冻结前，前端与 agent-runtime 不得消费 `resources.audio` | SDD 10 §7 | 接入必须排在 SDD 11 之后 |

`onPayload` 钩子的情况：pi-ai 在发送前调用 `options.onPayload(params, model)`，返回值会替换整个请求体（`openai-completions.js` 约第 130 行）。因此 G1、G4 可以不 fork pi-ai 解决：

- 工具结果中用占位文本引用「对象 + 时间区间」，由 `onPayload` 把占位替换为 `input_audio` / `video` 内容块，同时注入 `reasoning_effort`。
- 代价：会话历史里只保存占位。重放历史轮次时，要么重新切片，要么只对最近一轮展开媒体。

## 4. 待实测项

| 项 | 方法 | 判定意义 |
| --- | --- | --- |
| 秒级时间定位 | 在带人工时间标注的视频上，让模型答出事件起止秒，统计误差分布 | 决定验证器「结论可溯源到帧」能否直接依赖模型输出，还是必须经 Glaux 二次取帧确认 |
| 音画联合 | 同一区间分别给「帧 + 原始音频」和「帧 + ASR 文本」，比较答案质量 | 决定 G2 是否值得做原生音频能力位，还是统一回退为转写 |
| 区间放大收益 | 同一问题分别用整段低帧率和「粗扫 + 模型指定区间高帧率」，比较准确率与 token | 验证 SDD 11 分层导航的收益，对照 Qwen 的 agent 模式数据 |
| 长会话稳定性 | 连续 50 轮以上的工具调用会话 | 对照第三方报告的会话中断问题 |
| 两家一致性 | 同一套请求只换 base_url 和 model id | 验证「一套适配服务两家」的假设 |

## 5. 风险

- **数据出域**：两款模型的 API 都在境外或云端区域。医学影像和视频上传到第三方需要用户明示同意；数据不出域时，只能自部署 MiMo-V2.6-Flash。
- **自部署门槛**：MiMo-V2.6-Flash 的 FP8 权重约 173GB，推荐 SGLang TP16 或 vLLM TP8；稳定版 vLLM 可能尚未跟上该架构。个人或单机环境不可行。
- **SSRF 与代理**：出站请求经 agent-runtime 的 net-guard。在 fake-ip 代理环境下需要为 agent-runtime 设置 `GLAUX_VLM_ALLOW_FAKEIP`。
- **基准可信度**：全部为厂商自报，说话人分离一项差距异常，必须以第 4 节实测为准。
- **价格**：Qwen3.8-Omni-Flash 的音频不到 $0.01/小时，720p@1fps 视频约 $0.20/小时（不含输出）；Gemini 3.8 Flash 2027 年涨价。价格优势只对 Qwen、MiMo 成立。

## 6. 对 SDD 11 的建议输入

- 观测形状与模型无关：返回帧集合、音频片段、时间戳和时间基，由 agent-runtime 按连接能力决定是交付原生音视频，还是回退为帧加转写文本。
- 连接能力从单一的 `vision` 扩展为能力集合，至少包括 `image`、`audio`、`video`；探测不到时按名称启发式只判 yes。
- 切片由 backend 负责：按区间切片、转码、控制大小（base64 ≤10MB），agent-runtime 不自行解复用。这与 SDD 10 规则 22 一致。
- 不内置剪辑、配音、摘要成片类工具，它们超出纲领边界。

## 参考

- [Qwen 官方博客](https://qwen.ai/blog?id=qwen3.8-omni-flash)
- [Alibaba Cloud Model Studio：qwen3.8-omni-flash](https://www.alibabacloud.com/help/en/model-studio/qwen3-8-omni-flash)
- [Alibaba Cloud Model Studio：Qwen-Omni 调用指南](https://www.alibabacloud.com/help/en/model-studio/qwen-omni)
- [MarkTechPost](https://www.marktechpost.com/2026/09/18/alibaba-qwen-releases-qwen3-8-omni-flash/)
- [DataCamp](https://www.datacamp.com/blog/qwen3-8-omni-flash)
- [The Decoder](https://the-decoder.com/qwen3-8-omni-flash-undercuts-gemini-flash-pricing-while-matching-its-multimodal-benchmarks/)
- [Qwen-MM-Plugins](https://github.com/QwenLM/Qwen-MM-Plugins)
- [MiMo-V2.6-Flash 官方页](https://mimo.mi.com/models/en-US/mimo-v2.6-flash)
- [Hugging Face：XiaomiMiMo/MiMo-V2.6-Flash-RL](https://huggingface.co/XiaomiMiMo/MiMo-V2.6-Flash-RL)
- [OrcaRouter：MiMo-V2.6-Flash](https://www.orcarouter.ai/blog/xiaomi-mimo-v2-6-flash-release)
- [SiliconANGLE：MiMo-V2.6](https://siliconangle.com/2026/09/22/xiaomi-introduces-mimo-v2-6-series-open-source-ai-model-family/)
- [Gemini API 价格](https://ai.google.dev/gemini-api/docs/pricing)
- [OpenRouter：Gemini 3.8 Flash](https://openrouter.ai/google/gemini-3.8-flash)
