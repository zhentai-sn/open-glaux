import { useEffect } from "react";

import { ActivityBar } from "./components/ActivityBar";
import { AgentPanel } from "./components/AgentPanel";
import { Editor } from "./components/Editor";
import { SideBar } from "./components/SideBar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { useAgent } from "./agent/useAgent";
import { api } from "./api/client";
import { loadImages } from "./data/actions";
import { useSession } from "./store/session";

export function App() {
  const setModels = useSession((s) => s.setModels);
  const { seedFromCurrent } = useAgent();

  useEffect(() => {
    void (async () => {
      // 已装分割适配器（活动栏角标 + Models 视图 + Agent 徽标）
      try {
        setModels(await api.models());
      } catch {
        /* 后端未起时不阻塞外壳 */
      }
      // 载数据集 → 选首图 → 真实分割+测量；就绪后用真实结果种四步提议
      try {
        await loadImages();
        seedFromCurrent();
      } catch {
        /* 无数据时外壳仍可用 */
      }
    })();
    // 仅挂载时执行一次（种子只种一次；后续交互驱动）
  }, []);

  return (
    <div className="ide">
      <TitleBar />
      <div className="body">
        <ActivityBar />
        <SideBar />
        <Editor />
        <AgentPanel />
      </div>
      <StatusBar />
    </div>
  );
}
