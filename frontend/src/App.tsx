import { useEffect } from "react";

import { ActivityBar } from "./components/ActivityBar";
import { AgentPanel } from "./components/AgentPanel";
import { Editor } from "./components/Editor";
import { SideBar } from "./components/SideBar";
import { StatusBar } from "./components/StatusBar";
import { TitleBar } from "./components/TitleBar";
import { useAgent } from "./agent/useAgent";
import { api } from "./api/client";
import { useSession } from "./store/session";

export function App() {
  const setModels = useSession((s) => s.setModels);
  const { seed } = useAgent();

  useEffect(() => {
    // 载入已装分割适配器（活动栏角标 + Models 视图 + Agent 徽标）。
    api.models().then(setModels).catch(() => {
      /* 后端未起时活动栏无角标；不阻塞外壳渲染 */
    });
    // 演示种子对话（三态守卫的 in_scope 分支）。
    seed();
  }, [setModels, seed]);

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
