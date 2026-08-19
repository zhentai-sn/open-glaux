import { useEffect } from "react";

import { ActivityBar } from "./components/ActivityBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FocusShell } from "./components/focus/FocusShell";
import { Notice } from "./components/Notice";
import { Shell } from "./components/Shell";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { api } from "./api/client";
import { loadImages } from "./data/actions";
import { useSession } from "./store/session";

export function App() {
  const uiMode = useSession((s) => s.uiMode);
  const setModels = useSession((s) => s.setModels);
  const setCapabilities = useSession((s) => s.setCapabilities);
  const setDatasources = useSession((s) => s.setDatasources);
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
      // 数据源注册表（dev-mode 标识 + 导入源管理；市场表征层的数据集卡即由此驱动）
      try {
        setDatasources(await api.datasources());
      } catch {
        /* 后端未起时不阻塞外壳 */
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
    <ErrorBoundary key={uiMode} label="Glaux">
      {shell}
    </ErrorBoundary>
  );
}
