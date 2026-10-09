# Windows 桌面入口

`desktop.ps1` 提供安装与运行控制窗口；`install-desktop.ps1` 写入桌面、开始菜单快捷方式和安装配置。`Setup.cs` 将脚本及图标内嵌到安装 EXE，由 `scripts/release/build-windows.ps1` 编译。

## 图标

`glaux.svg` 的轮廓取自 `frontend/src/components/OwlLogo.tsx`，配蓝色圆角底。`glaux.png` 用于窗口标题区，`glaux.ico` 用于窗口、快捷方式及安装 EXE，包含 16、20、24、32、40、48、64、128、256 px 图层。

修改前端小鸮轮廓后，在装有 Pillow 和 CairoSVG 的开发环境运行 `python3 scripts/release/build-icon.py`，一起提交三份导出资源。发布构建直接使用入库资源，无需安装图像转换依赖。

安装 helper 将 PNG 和 ICO 复制到程序目录 `bin`，快捷方式引用该目录的 ICO。窗口关闭不停止后台服务；卸载沿用启动器的数据保留规则。
