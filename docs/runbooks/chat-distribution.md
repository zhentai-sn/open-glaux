# 对话预览版：安装、运行与分发

> 规范：[SDD 09](../sdd/feats/09-chat-distribution/README.md) · English: [chat-distribution.en.md](chat-distribution.en.md)

## 发布状态

- Docker 发行包正在准备，公开镜像与下载版本尚未发布。
- 以下流程适用于维护者提供的离线包，或对应镜像发布之后。
- 源码压缩包不是开箱即用的运行包。

## 安装与启动

- 安装并启动 Docker：Windows / macOS 用 [Docker Desktop](https://docs.docker.com/get-docker/)，Linux 用 Docker Engine 和 Compose v2。使用 Linux 容器，Compose 需支持 `up --wait`。
- 从 [GitHub Releases](https://github.com/zhentai-sn/open-glaux/releases) 下载 `glaux-chat.zip`（发布后），或获取维护者提供的离线包，解压。
- 启动：Windows 双击 `start.cmd`，macOS 双击 `start.command`，Linux 在解压目录运行 `bash start.sh`。脚本先导入包内镜像（若有），否则拉取预构建镜像，等服务健康后打开浏览器。
- 打开"连接设置"，配置 Anthropic 或兼容 OpenAI 的 API 地址、API Key 和模型。自定义模型按提示填写上下文窗口和最大输出 token。

注意：

- 用户机器无需安装 Python、Node.js、Git，无需编译源码、配置 GPU 或安装专用模型。
- 在线拉取镜像和调用远端模型需要联网；离线包只省去镜像下载，远端模型仍需联网。
- 默认地址 `http://127.0.0.1:5173`，仅本机可访问。换浏览器或访问地址后，需要重新配置模型连接。
- 模型请求从 Docker 内发出，API 地址里的 `localhost` 指容器自身，不是宿主机。

## 停止与数据

- 停止：Windows 双击 `stop.cmd`，macOS 双击 `stop.command`，Linux 运行 `bash stop.sh`。关闭浏览器不会停止服务。
- 会话历史保存在 Docker 卷 `glaux_conversations`，停止或重建容器都会保留。**要保留历史，不要执行 `docker compose down -v`，也不要删除该卷。**
- 模型连接配置（含 API Key）保存在当前浏览器的本地存储中，清理站点数据会移除；密钥不会打包进镜像。

## 排障

- 端口 5173 被占用：在 `compose.yaml` 同目录新建 `.env`，写入 `GLAUX_PORT=5174`，重新启动。端口变化相当于新站点，需要重新配置模型连接。
- 启动失败：确认 Docker 在运行，再在解压目录执行 `docker compose logs --tail=100`。镜像拉取失败可能是尚未发布、未开放匿名拉取或网络不通。
- 反馈问题：在 [GitHub Issues](https://github.com/zhentai-sn/open-glaux/issues) 附上系统版本、Docker 版本和报错；分享前去掉 API Key 和私人对话内容。

## 维护者：构建与分发

在源码仓库构建并运行：

```bash
docker compose -f compose.yaml -f docker/compose.build.yaml build
docker compose up -d --wait
```

生成离线运行包（只有这一步需要 Python）：

```bash
mkdir -p dist
docker save -o dist/images.tar ghcr.io/zhentai-sn/open-glaux-agent:0.2.0-chat.1 ghcr.io/zhentai-sn/open-glaux-web:0.2.0-chat.1
python3 scripts/release/package.py --images dist/images.tar --output dist/glaux-chat-offline.zip
```

- 只生成小型在线启动包：`python3 scripts/release/package.py`。
- 依赖按锁文件安装。发行环境只有 Web 和 Node Agent Runtime；对话不依赖 Python 图像后端，所以没有打入镜像。
- `compose.yaml` 里的预览镜像标签不代表已经公开发布。
- 对外分发前：发布两个对应标签的镜像、开放匿名拉取、在干净机器上验证，再把 ZIP 附到 Release。公开发布是单独的步骤。
- 镜像 CPU 架构要匹配目标 Docker 环境；只构建 amd64 不代表已验证 Apple Silicon / arm64。

## 本地开发

- `frontend/` 和 `agent-runtime/` 的 `npm run dev` 默认进入对话版。
- 维护保留的实验功能：前端设 `VITE_GLAUX_EDITION=full`，Agent 设 `GLAUX_EDITION=full`，并启动 Python 后端。
- 既有测试继续覆盖完整模式，另有对话版边界测试。
