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
  const setTasks = useSession((s) => s.setTasks);
  const setIntentBackends = useSession((s) => s.setIntentBackends);
  const { seedFromCurrent } = useAgent();

  useEffect(() => {
    void (async () => {
      // 任务注册表（多模态切换器/工具/度量的单一真相源）——P2 前端据此去 if 模态
      try {
        setTasks(await api.tasks());
      } catch {
        /* 后端未起时不阻塞外壳 */
      }
      // 已装分割适配器（活动栏角标 + Models 视图 + Agent 徽标）
      try {
        setModels(await api.models());
      } catch {
        /* 后端未起时不阻塞外壳 */
      }
      // 意图后端可用性（VLM 配置面板显示服务端密钥状态）
      try {
        setIntentBackends(await api.intentBackends());
      } catch {
        /* 忽略 */
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
