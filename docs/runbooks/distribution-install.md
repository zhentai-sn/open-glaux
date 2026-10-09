---
kind: living
status: living
---

# 安装、运行与更新 Glaux

Glaux 是本机应用。安装器把程序放在用户目录，不需要管理员权限；用户数据与程序分开保存，升级和普通卸载都保留数据。

## 系统要求

| 系统 | 支持范围 | 安装方式 |
| --- | --- | --- |
| Windows | Windows 10/11 x64 | 图形安装 EXE 或 PowerShell；智能体执行 shell 命令需要 Git for Windows |
| macOS | macOS 13+ Intel 或 Apple silicon | Terminal |
| Linux | Ubuntu 22.04+ x64 | POSIX shell |

需要 3 GB 可用磁盘空间、网络连接，以及兼容的模型 API。Glaux 随程序安装便携 Node.js、uv 和 Python；不需要 Docker 或管理员权限。专用模型权重不随安装器分发。

## 安装

macOS、Linux：

```sh
curl -fsSL https://zhentai-sn.github.io/open-glaux/install.sh | sh
```

Windows 推荐：[下载 Glaux-Setup.exe](https://github.com/zhentai-sn/open-glaux/releases/latest/download/Glaux-Setup.exe)，双击打开安装向导。可选择程序与数据目录，窗口显示目标盘实际可用空间、下载进度和安装日志。数据目录须放在程序目录之外，普通卸载才能保留。

安装后桌面和开始菜单的 **Glaux** 图标打开控制窗口，可启动、打开浏览器、停止或卸载；关闭控制窗口和浏览器都不会停止后台服务。

Windows PowerShell（可选）：

```powershell
irm https://zhentai-sn.github.io/open-glaux/install.ps1 | iex
```

PowerShell 安装会刷新当前窗口 PATH，可立即运行 `glaux stop`；自定义数据目录保存到程序目录 `install.json`，新终端与桌面入口沿用它。Windows 安装的临时下载、Python 和依赖缓存位于程序目录所在盘。

安装完成后，Glaux 启动并在浏览器打开 `http://127.0.0.1:7410/`。首次使用时，在连接设置中填写自己的模型服务地址、API Key 和模型名。

安装器源码：[`install.sh`](https://zhentai-sn.github.io/open-glaux/install.sh) · [`install.ps1`](https://zhentai-sn.github.io/open-glaux/install.ps1)。

## 指定版本与目录

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `GLAUX_VERSION` | Pages `latest.json` 中的版本 | 安装指定版本 |
| `GLAUX_INSTALL_DIR` | Linux `~/.local/share/glaux`；macOS `~/Library/Application Support/Glaux`；Windows `%LOCALAPPDATA%\Programs\Glaux` | 程序目录 |
| `GLAUX_HOME` | `~/.glaux`；Windows `%USERPROFILE%\.glaux` | 会话、设置、上传、图谱、日志与运行状态 |
| `GLAUX_DOWNLOAD_BASE` | 对应 GitHub Release 下载地址 | 使用 Release 镜像时覆盖下载前缀 |
| `GLAUX_MIRROR` | `auto` | `auto`、`cn` 或 `none`；控制 Node、Python 和 PyPI 镜像 |
| `GLAUX_NO_BROWSER` | `0` | 设为 `1` 时安装后不自动打开浏览器 |
| `GLAUX_NO_START` | `0` | 设为 `1` 时安装后不启动服务，主要用于自动化安装 |

若要指定版本，先下载脚本后再运行，使变量传给安装器：

```sh
curl -fsSL https://zhentai-sn.github.io/open-glaux/install.sh -o /tmp/glaux-install.sh
GLAUX_VERSION=0.3.0 sh /tmp/glaux-install.sh
```

Windows 推荐：[下载 Glaux-Setup.exe](https://github.com/zhentai-sn/open-glaux/releases/latest/download/Glaux-Setup.exe)，双击打开安装向导。可选择程序与数据目录，窗口显示目标盘实际可用空间、下载进度和安装日志。数据目录须放在程序目录之外，普通卸载才能保留。

安装后桌面和开始菜单的 **Glaux** 图标打开控制窗口，可启动、打开浏览器、停止或卸载；关闭控制窗口和浏览器都不会停止后台服务。

Windows PowerShell（可选）：

```powershell
$env:GLAUX_VERSION = '0.3.0'
irm https://zhentai-sn.github.io/open-glaux/install.ps1 | iex
```

## 命令

```text
glaux start                 启动；已运行时打开浏览器
glaux open                  打开本机页面
glaux stop                  停止服务
glaux status                查看版本、端口、进程和健康状态
glaux update                下载并安装最新版本
glaux doctor                检查运行环境并给出修复建议
glaux logs [行数]           查看启动器日志
glaux uninstall             卸载程序，保留数据
glaux uninstall --purge     卸载并删除数据（需再次确认）
```

服务仅监听 `127.0.0.1`。如果端口 7410 已被占用，可设置 `GLAUX_PORT` 后再运行 `glaux start`。`GLAUX_HOME` 可放在不同磁盘，但更新程序时不要同时运行多个安装实例。

## 数据位置

- Windows：`%USERPROFILE%\.glaux`
- macOS、Linux：`~/.glaux`

会话数据库、数据源与上传、Atlas、个人 Skills 和设置、日志、运行状态都保存在该目录。更新和普通卸载保留这些数据；只有 `--purge` 才会删除。

## 常见问题

### Windows 安装提示 Git Bash 缺失

程序仍可安装和使用其他能力。需要智能体 shell 命令时，安装 [Git for Windows](https://git-scm.com/download/win)，重新打开终端并运行 `glaux doctor`。

### 更新失败

旧版本会保留。确认网络可访问 GitHub Releases 和 PyPI 后重试 `glaux update`；在中国网络环境可在更新前设置 `GLAUX_MIRROR=cn`。查看 `GLAUX_HOME/logs/launcher.log` 获取错误详情。

### 浏览器页面无法连接

运行 `glaux status` 检查服务，再运行 `glaux open`。页面只允许本机回环地址访问；不要通过局域网地址或反向代理公开本地端口。

### 模型连接与费用

模型由用户自行接入，其 API 价格、用量和服务条款由模型服务商决定。Glaux 不收集使用统计；模型请求会把你选择发送的提示词与媒体交给对应服务商。

### 卸载但保留数据

运行 `glaux uninstall`。要完全清除本机数据，可运行 `glaux uninstall --purge` 并确认。

## 维护者发布

版本、标签、GitHub Actions 和人工发布顺序见 [SDD 24](../sdd/feats/24-distribution-install/README.md) 与 [版本发布治理](../sdd/01-version-release-governance.md)。
