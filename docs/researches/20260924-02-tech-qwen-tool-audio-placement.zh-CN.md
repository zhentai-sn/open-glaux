---
kind: record
status: done
---

# Qwen 视频工具结果中的音轨入口实测

日期：2026-09-24。结论已写入 [SDD 11](../sdd/feats/11-video-understanding-harness/README.md) §6、§9。本记录只保存复核依据，不保存 API Key、请求中的 Base64 或完整响应。

## 样本与方法

使用同一段 9 秒合成 MP4：0～3 秒红色、3～6 秒蓝色并有蜂鸣、6～9 秒绿色。先通过 SDD 11 后端切片器生成 0～9 秒 H.264/AAC MP4；本地解码确认 3～6 秒切片有约 3.008 秒音频，RMS 约 0.1523。使用用户配置的 `qwen3.8-omni-flash`、`reasoning_effort=low` 对照三种 Chat Completions 消息形状。

| 消息形状 | Qwen 使用量 | 回答 |
| --- | --- | --- |
| `user.content` 直接包含 `video_url` | `audio_tokens=65`、`video_tokens=722` | 明确听到蜂鸣，回答蓝色 |
| `tool.content` 包含 `video_url`，非流式 | 未报告 `audio_tokens`，`video_tokens=722` | 回答蓝色，但以“若蜂鸣声出现在该时间段”为条件，不能证明听到声音 |
| `tool.content` 包含 `video_url`，流式 | 未报告 `audio_tokens`，`video_tokens=722` | 回答绿色，错误 |
| `tool` 只留观测文字，紧随其后的受控 `user.content` 包含视频，非流式 | `audio_tokens=65`、`video_tokens=722` | 回答蓝色 |

第一版 Pi 联调把媒体块放在 `tool` 内容中，模型能描述三段颜色，但重复观察 12 次后仍称无法核实蜂鸣，最终只提交视觉事实和无法判断项。该表现与上述音频 token 缺失相符。不能把此前 `tool` 内容块试验中偶然答对蓝色视为音画联合问答通过。

## 采纳结论

Pi 会话只保存工具结果的观测标识及元数据。Qwen 适配器在出站 `onPayload` 中，对本次新观测紧接工具结果注入一条**仅在请求中存在**的 `user` 媒体消息，文字说明这是工具返回的环境观测，再放原生 `video_url`。受控媒体消息不进入 Pi 会话、SSE 或日志；旧观测不随每次请求重复发送。该形状须在真实 Pi 流式工具循环中复测音频 token 与蜂鸣答案。
