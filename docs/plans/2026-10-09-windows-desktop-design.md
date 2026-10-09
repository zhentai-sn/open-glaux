---
kind: record
status: implemented
---

# Windows 图形安装与桌面控制

维护者已批准安装向导、运行控制窗口与桌面图标。契约见 SDD 24 §7.4.1。

## 方案选择

| 方案 | 特点 |
| --- | --- |
| Windows Forms + 内嵌脚本 EXE | 使用系统组件；复用现有启动器和安装流程；采用此方案 |
| NSIS/WiX | 需要独立安装工具链和额外下载，当前无需引入 |
| Electron/Tauri | 增加桌面运行时与平台维护，当前窗口需求较小 |

GUI 脚本负责目录输入、磁盘显示、异步子进程、进度与控制按钮。小型 .NET Framework EXE 内嵌脚本，以隐藏 PowerShell 窗口运行安装界面。桌面快捷方式直接启动安装目录内的控制脚本。

## 实现顺序

1. 扩展 SDD 24，明确目录、状态、进度和持久配置。
2. 编写共享 Windows Forms 界面、桌面入口安装 helper 与 EXE bootstrap/build。
3. 更新 PowerShell 安装流程与 Node 启动器，统一自定义数据目录和 PATH。
4. 接入发布工作流及双语落地页下载入口，更新安装手册。
5. 将控制窗口和桌面图标补装到维护者现有 D 盘安装，保留数据。

## 限制

GUI 调用已有 start/open/stop/uninstall，不新增后端接口。普通卸载保留数据。默认安装 EXE 不带代码签名；后续签名需要维护者的证书。
