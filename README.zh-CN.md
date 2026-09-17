<h1 align="center">🦉 Glaux</h1>
<p align="center"><strong>将视觉转化为洞见</strong></p>
<p align="center"><a href="README.md">English</a> · <strong>简体中文</strong></p>

Glaux（小鸮）是面向图像与视频分析的智能体 harness：模型由你自带，Glaux 提供模型运行的环境，把图像与视频转化为可验证、可复现的洞见。

## Glaux 是什么

> **智能体 = harness + 模型**

- **模型**负责推理，由你自带，可以替换。
- **Glaux 是 harness**，决定模型能看到什么、能做什么、怎样算对，以及积累下什么。

| 要素 | Glaux 负责 |
| --- | --- |
| **观测空间** | 读取多种模态、多种格式的图像与视频，带上物理语义（像素间距、通道、帧时间）；决定给模型看哪一部分（切块、抽帧、裁剪、叠加） |
| **动作空间** | 分割、测量、跟踪、重建等工具，集成专用模型 |
| **验证器** | 结论可溯源到帧与区域、可原样重跑、多种方法相互印证、人工复核；有标准答案时计算指标 |
| **回合与轨迹** | 经过验证的轨迹与人工校正沉淀为案例库 |

四个要素仍在建设中，当前发行的对话预览版尚未包含。

## 领域与边界

| 类别 | 模态 | 常见格式 |
| --- | --- | --- |
| 自然图像与视频 | 照片、摄像 | PNG、JPEG、WebP；MP4 等 |
| 显微与病理 | 明场、荧光显微；病理全切片 | TIFF；SVS、NDPI、MRXS 等 |
| 医学影像 | 超声、X 线、CT、MRI 等 | DICOM、NIfTI；PNG、TIFF |

- Glaux 负责从图像与视频到可计算的表征；拿表征做决策与规划，由你在 Glaux 之上自建。
- 生物医学方向只做研究，不做临床诊断。

## 当前版本：对话预览版

连接自己的模型，开始对话。

- **已提供**：会话历史，搜索、重命名、归档、删除，流式回复，停止与重新生成，图片附件（PNG、JPEG、WebP、GIF，由你所选的视觉模型处理）。
- **未开放**：视频；工作台、图像舞台、图谱、分割和测量工具。相关实现保留在源码中，后续以插件交付。
- 不安装或下载专用模型和权重。

## 快速开始

发行包尚未公开发布；以下流程适用于维护者提供的离线包，或镜像发布之后。

- 安装并启动 Docker（Windows / macOS 用 Docker Desktop，Linux 用 Docker Engine 和 Compose v2）。
- 下载并解压 `glaux-chat.zip`。
- 启动：Windows 双击 `start.cmd`，macOS 双击 `start.command`，Linux 运行 `bash start.sh`。
- 在"连接设置"里配置模型的 API 地址、API Key 和模型，开始对话。
- 停止：运行对应的 `stop` 脚本。会话历史保存在 Docker 卷中，**要保留历史，不要执行 `docker compose down -v`**。

数据、排障、维护者构建与分发、本地开发，见[安装、运行与分发手册](https://github.com/zhentai-sn/open-glaux/blob/main/docs/runbooks/chat-distribution.md)。

## 文档

- [纲领](https://github.com/zhentai-sn/open-glaux/blob/main/docs/roadmaps/charter.zh-CN.md)
- [架构说明](https://github.com/zhentai-sn/open-glaux/blob/main/docs/architecture.zh-CN.md)
- [路线图](https://github.com/zhentai-sn/open-glaux/tree/main/docs/roadmaps)

## 许可

[Apache-2.0](LICENSE)
