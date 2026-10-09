<h1 align="center">🦉 Glaux</h1>
<p align="center"><strong>将视觉转化为洞见</strong></p>
<p align="center"><strong>简体中文</strong> · <a href="README.md">English</a></p>

Glaux 是本机运行的图像与视频分析智能体环境。你接入兼容的模型，Glaux 提供文件工作区、分析工具和证据复核能力。

## 安装

**macOS 或 Linux**（Ubuntu 22.04+ x64；macOS 13+ Intel 或 Apple 芯片）：

```sh
curl -fsSL https://zhentai-sn.github.io/open-glaux/install.sh | sh
```

**Windows 10/11 x64**（PowerShell；执行智能体 shell 命令需要 Git for Windows）：

推荐：[下载 Windows 图形安装程序](https://github.com/zhentai-sn/open-glaux/releases/latest/download/Glaux-Setup.exe)，双击安装；桌面 Glaux 图标提供启动、打开和停止按钮。也可使用 PowerShell：

```powershell
irm https://zhentai-sn.github.io/open-glaux/install.ps1 | iex
```

安装程序从 GitHub Releases 下载当前版本并校验 SHA-256，然后在应用目录内准备独立的 Node.js 和 Python 环境。无需管理员权限或 Docker。安装完成后会在浏览器中打开 Glaux。

指定版本时，在运行安装脚本前设置 `GLAUX_VERSION`。系统要求、其他选项和排障方法见[安装与使用手册](docs/runbooks/distribution-install.md)。

## 当前能力

- 围绕图像和视频提问；查看视频画面、时间点与对齐的音频证据。
- 使用智能体处理本机文件，并调用看图、标注、测量和分割工具。
- 复核证据、标注与运行轨迹，并在 Atlas 中保存可复用案例。
- 接入你自己的模型。本机保存 API 凭据和分析数据。

程序包不含专用模型权重；部分分析工具需要另行安装对应模型。Glaux 不用于临床诊断。

## 常用命令

```sh
glaux start      # 启动本地服务并打开 Glaux
glaux stop       # 停止服务
glaux status     # 查看版本、端口和健康状态
glaux update     # 安装最新版本
glaux doctor     # 检查本机运行条件
glaux uninstall  # 卸载程序并保留数据
```

用户数据默认保存在 `~/.glaux`（Windows：`%USERPROFILE%\.glaux`），更新或普通卸载不会删除。运行 `glaux uninstall --purge` 可同时删除数据。

## 文档

- [项目主页与下载](https://zhentai-sn.github.io/open-glaux/)
- [项目纲领](docs/roadmaps/charter.zh-CN.md) · [架构说明](docs/architecture.zh-CN.md)
- [Feature 规范](docs/sdd/README.md)
- [安装、运行与更新手册](docs/runbooks/distribution-install.md)

## 许可

Glaux 使用 [Apache-2.0](LICENSE) 许可。示例图像与研究数据的来源和许可记录见对应目录。
