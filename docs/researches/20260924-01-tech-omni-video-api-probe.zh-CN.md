---
kind: record
status: draft
---

# SDD 11 · Qwen 与 MiMo 原生音视频接口实测

> 日期：2026-09-24。本文记录接口证据与实测结果；模型能力的验收门槛由 [SDD 11](../sdd/feats/11-video-understanding-harness/README.md) 冻结。未获得两家测试凭据前，不把文档支持写成真实调用通过。

## 目标

用同一段本地音画视频，验证 `qwen3.8-omni-flash` 与 `mimo-v2.6-flash` 的原生视频输入、音画联合回答、时间定位与后续工具调用兼容性。两个模型都须使用用户配置的连接；测试视频不发布到公网。

## 官方接口核对

| 项 | Qwen3.8-Omni-Flash | MiMo-V2.6-Flash |
| --- | --- | --- |
| 模型与协议 | `qwen3.8-omni-flash`，Chat Completions 的 `video_url`，输出文本时带 `modalities: ["text"]` | `mimo-v2.6-flash` 列在视频理解支持型号中，Chat Completions 的 `video_url` |
| 本地视频发送 | `video_url.url` 为 `data:;base64,...`；编码后的 Base64 字符串小于 10 MB | `video_url.url` 为 `data:video/mp4;base64,...`；编码后的 Base64 字符串不超过 50 MB |
| MP4 | 官方列为支持格式 | 官方列为支持格式 |
| 音轨 | 官方说明视频文件可含音频 | 官方说明视频 token 同时包含画面和音频部分 |
| 其他请求差异 | API 地址按地域和 workspace 配置 | `fps`、`media_resolution` 可作为视频内容块参数 |

依据：[Alibaba Cloud Qwen-Omni 调用指南](https://www.alibabacloud.com/help/en/model-studio/qwen-omni)、[小米 MiMo 视频理解指南](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/multimodal-understanding/video-understanding)。上述限制为 2026-09-24 的文档值，真实接口响应和本机连接仍须实测。两家共同的私有短片段传输预算受 Qwen 的 Base64 限制约束；不能把两家的请求体视为逐字段相同。

## 本地测试样本

- 路径：`/tmp/glaux-sdd11-probe.mp4`，仅为当前机器临时文件，不入库。
- 内容：9 秒 MP4，0～3 秒红色画面且静音，3～6 秒蓝色画面伴随间歇蜂鸣，6～9 秒绿色画面且静音。320×240、4 fps、H.264 视频加 AAC 单声道音频。
- 大小：20,407 bytes；SHA-256：`ea7fdd59a9ca0452250e0c5422079b043cc0a8139b177bbf45ac1334039f49f2`。
- 本地解码检查：容器时长 9.0 秒；第 1、4、7 秒的像素分别呈红、蓝、绿；音频静音、蜂鸣、静音三段的 RMS 分别约为 0、0.2、0（解码为归一化浮点）。
- 提问：`蜂鸣声出现时画面是什么颜色？蜂鸣声大约从第几秒到第几秒？`。期望：蓝色，约 3～6 秒；若模型只根据画面猜测声音，该样本不能单独排除，后续还需对照样本。
- 对照样本：`/tmp/glaux-sdd11-probe-green.mp4`，20,812 bytes，SHA-256 `0aaae3bee90bcd818599af1782878ce30a4d7364ab3c8edbb86eb5a0fd5bd396`。它保持全部视频帧逐像素相同，只把蜂鸣从 3～6 秒移到 6～9 秒；期望回答绿色，约 6～9 秒。本机解码比对确认画面一致，音频 RMS 由“静音／蜂鸣／静音”变为“静音／静音／蜂鸣”。

## 真实调用矩阵

| 检查 | Qwen | MiMo | 判定 |
| --- | --- | --- | --- |
| 本地 MP4 Base64 请求可受理 | 通过：HTTP 200 | 待凭据 | HTTP 成功，返回非空文本 |
| 音画联合问题 | 对照通过：原样本回答蓝色，移声样本回答绿色 | 待凭据 | 答案随声音所在区间变化，而非只看相同画面 |
| 时间定位 | 两例通过：分别回答约 3～6 秒、6～9 秒 | 待凭据 | 引用区间覆盖人工真值；精度门槛待扩充样本后冻结 |
| Agent 工具循环 | API 层通过：先自主请求区间，再接收工具结果中的原生视频并回答 | 待凭据 | 工具选择与媒体工具结果连续可用；Pi 接线仍待验证 |
| 无答案时拒答 | 待凭据 | 待凭据 | 不捏造样本中不存在的事件 |

## 当前限制与下一步

2026-09-24 已从用户提供的本机凭据文件读取 Qwen API Key 和 workspace 地址，使用上述 20,407 bytes 合成 MP4 发起一次 Chat Completions 非流式请求。响应为 HTTP 200，模型 `qwen3.8-omni-flash`，耗时 12.89 秒；回答“蓝色，约第 3～6 秒”，与样本真值相符。响应使用量中分别有 `audio_tokens=65`、`video_tokens=722`。原凭据文件给出的 `/api/v1` 不是该 Chat Completions 路径，初次探测得到 404；改用同一 workspace 域名下官方文档的 `/compatible-mode/v1/chat/completions` 后成功。测试摘要保存在本机 `/tmp/glaux-sdd11-qwen-result.json`，不含密钥或媒体正文。

对照视频的真实响应同为 HTTP 200，耗时 15.91 秒，回答“绿色，蜂鸣约第 6～9 秒”；两个文件的视觉帧完全相同，这一对照支持模型使用了声音的时间位置。工具循环试验中，模型先请求 `observe_video_interval({start_s:0,end_s:9})`（1.23 秒）；随后 Chat Completions 接受 `tool` 消息里的原生 `video_url` 内容块，并回答蓝色（62.34 秒）。这验证的是 Qwen API 层的接线形状，尚未验证本仓 pi-ai 的消息转换。摘要在 `/tmp/glaux-sdd11-qwen-green-result.json` 与 `/tmp/glaux-sdd11-qwen-tool-result.json`。

MiMo 已依据官方请求形状在本机完成 Base64 负载构造检查：样本编码后 27,212 bytes，使用 `data:video/mp4;base64,`、`video_url`、`fps=2` 和 `media_resolution=default`。用户目前只提供 Qwen 凭据，因此 MiMo 真实调用未执行，不能计为通过。

这两段合成样本仍不能代表真实视频的一般问答准确率或引用精度。MiMo 的真实调用，以及两家的无答案样本、长短区间、工具调用稳定性和人工标注集仍待补。调用日志不得保存 API Key 或 Base64 视频正文。
