# Windows 桌面入口

`desktop.ps1` 提供安装与运行控制窗口（WPF，界面用内嵌 XAML 描述，不引入第三方组件）；`install-desktop.ps1` 写入桌面、开始菜单快捷方式和安装配置。`Setup.cs` 将脚本及图标内嵌到安装 EXE，由 `scripts/release/build-windows.ps1` 编译。

窗口是无边框单外壳：`-Mode Install` 与 `-Mode Manage` 只切换内容区，标题栏、居中标识与底部次级入口共用。样式集中在脚本顶部的 `$accent`、`$ink`、`$muted`、`$line`、`$soft` 五个颜色变量里，改主题只动这几行。

调界面时用 `GLAUX_UI_SNAPSHOT=<png 路径>` 启动脚本：窗口渲染完成后把自身离屏渲染成 PNG 再退出，不需要截屏，适合做文档配图与走查对比。

## 图标

`glaux.svg` 的轮廓取自 `frontend/src/components/OwlLogo.tsx`，配紫色圆角底（`#7c4dd6`，沿用应用浅色主题默认智能体色）。`glaux.png` 用于窗口标题区，`glaux.ico` 用于窗口、快捷方式及安装 EXE，包含 16、20、24、32、40、48、64、128、256 px 图层。

修改前端小鸮轮廓后，在装有 Pillow 和 CairoSVG 的开发环境运行 `python3 scripts/release/build-icon.py`，一起提交三份导出资源。发布构建直接使用入库资源，无需安装图像转换依赖。

安装 helper 将 PNG 和 ICO 复制到程序目录 `bin`，快捷方式引用该目录内按内容摘要命名的 ICO，颜色变更后无需清空 Windows 图标缓存。窗口关闭不停止后台服务；卸载沿用启动器的数据保留规则。
