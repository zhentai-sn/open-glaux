import { useEffect } from "react";

import { ActivityBar } from "./components/ActivityBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FocusShell } from "./components/focus/FocusShell";
import { Notice } from "./components/Notice";
import { Shell } from "./components/Shell";
import { ImagePreview } from "./components/ImagePreview";
import { ShortcutSheet } from "./components/ShortcutSheet";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { api } from "./api/client";
import { activeModalities, loadImages, loadNaturalImages, refreshDataSources } from "./data/actions";
import { useGlobalKeys } from "./keys/globalKeys";
import { useSession } from "./store/session";

export function App() {
  useGlobalKeys(); // 全局快捷键分发（SDD feats/05）——单一监听点
  const uiMode = useSession((s) => s.uiMode);
  const setModels = useSession((s) => s.setModels);
  const setCapabilities = useSession((s) => s.setCapabilities);
  const setTasks = useSession((s) => s.setTasks);

  useEffect(() => {
    void (async () => {
      // 任务注册表（多模态切换器/工具/度量的单一真相源）——P2 前端据此去 if 模态
      try {
        setTasks(await api.tasks());
      } catch {
        /* 后端未起时不阻塞外壳 */
      }
      // 已装分割适配器（活动栏角标 + Agent 徽标 + 模型激活）
      try {
        setModels(await api.models());
      } catch {
        /* 后端未起时不阻塞外壳 */
      }
      // 能力注册表（「插件市场」——按四层浏览模型/数据集/skill/连接器/MCP/知识库）
      try {
        setCapabilities(await api.capabilities());
      } catch {
        /* 后端未起时不阻塞外壳 */
      }
      // 数据源注册表——SDD 08 起它是「有没有数据」的唯一依据，故必须先于任何数据拉取。
      await refreshDataSources();
      // 一个 active 源都没有 → 文件栏渲染空态引导，此处不再发任何数据请求（§7 规则 4）。
      // 失败态同理：failed 不是空，画成空态会让用户以为自己没数据。
      if (useSession.getState().dsState !== "ready" || !activeModalities().length) return;
      // SDD 07/08：通用图像目录（内置示例 + 导入源）；失败不阻塞医学数据与外壳。
      try {
        await loadNaturalImages();
      } catch {
        /* 通用图像资产缺失时显示空目录 */
      }
      // 载数据集 → 选首图 → 真实分割+测量
      try {
        await loadImages();
      } catch {
        /* 无数据时外壳仍可用 */
      }
    })();
    // 仅挂载时执行一次；后续交互驱动
  }, []);

  // 双模式分叉（SDD feats/01 §6.2）：同一 store 的两种投影；key 强制换树，crossfade 由 CSS 承担。
  // 数据装载 effect 在上方仅挂载时执行一次，与模式切换解耦——切换零请求由此保证。
  // 顶层错误边界按 uiMode keying：整棵外壳崩溃时兜底为可重载面板而非黑屏；切模式即重置错误态。
  const shell =
    uiMode === "focus" ? (
      <FocusShell key="focus" />
    ) : (
      <div className="ide shell-enter" key="workbench">
        <TitleBar />
        <div className="body">
          <ActivityBar />
          <Shell />
        </div>
        <StatusBar />
        <Notice />
      </div>
    );
  return (
    <>
      <ErrorBoundary key={uiMode} label="Glaux">
        {shell}
      </ErrorBoundary>
      <ShortcutSheet />
      <ImagePreview />
    </>
  );
}
