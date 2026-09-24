---
kind: living
status: living
---

# 视频问答与证据复核

适用范围：[SDD 11](../sdd/feats/11-video-understanding-harness/README.md) 一期，完整版 Glaux，本机用户配置的 Qwen3.8-Omni-Flash。

## 准备连接

1. 后端安装 `video` 可选依赖（PyAV），运行完整版的 frontend、agent-runtime 和 backend。
2. 在会话连接设置中选择 OpenAI 兼容、模型 `qwen3.8-omni-flash`，填写用户 workspace 所在地域、以 `/compatible-mode/v1` 结尾的 HTTPS 地址和用户自己的 API Key。
3. 在「音画适配器」中显式选择 `Qwen3.8-Omni-Flash`。普通视觉能力探测不能代替此项。地址若仍为 `/api/v1`，模型 Chat Completions 调用会失败。

一期不接入 MiMo 或语音转写。其他连接在视频焦点下会提示不支持音画联合问答，普通对话仍可使用。

## 导入和提问

- 浏览器导入 MP4（H.264，可选一条 AAC 音轨）或 WebM（VP8/VP9，可选一条 Opus 音轨）。图像单文件上限 32 MiB；视频单文件上限 512 MiB、时长上限 10 分钟。前端只做预检，拒绝原因以后端逐文件结果为准。
- 选中视频后直接在同一会话提问。Agent 按需请求最长 60 秒的原声音画片段，最多 12 次；有证据的事实显示引用，证据不足的部分显示“无法判断”。
- 点击证据时间按钮播放短片段。局部视觉证据还显示关键帧区域。源视频被删除或同名重传改变内容后，旧引用文字保留，但不可回放。

## 常见情况

| 提示 | 处理 |
| --- | --- |
| `duration_exceeded` | 视频超过 10 分钟；一期不截断导入 |
| `unsupported_codec` | 转为上述容器和编码后重传；无音轨的视频仍可做纯视觉问答 |
| `too_large` | 核对视频 512 MiB 上限与 `GLAUX_VIDEO_UPLOAD_MAX_BYTES` 配置 |
| `clip_too_large` | 将观察区间缩短后重试；系统不会为压缩而丢弃声音 |
| 该连接不支持音画联合问答 | 检查模型 ID、音画适配器和 `/compatible-mode/v1` 地址 |
| 源视频不可用或已变化 | 恢复原源文件；新上传内容不能冒充旧证据 |

视频媒体正文和 API Key 不写入会话 SQLite、日志或 SSE；会话保存对象、源文件指纹和证据时间等元数据。
