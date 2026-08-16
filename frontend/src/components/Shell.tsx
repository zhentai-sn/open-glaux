import { useEffect, type FunctionComponent } from "react";
import {
  DockviewReact,
  themeAbyss,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";

import { AgentPanel } from "./AgentPanel";
import { BottomPanel } from "./BottomPanel";
import { Editor } from "./Editor";
import { SideBar } from "./SideBar";
import { useI18n } from "../i18n";
import { useSession } from "../store/session";

// VS Code 式可停靠外壳（设计稿 §6/P5b）——四块主区域（侧栏/编辑器/智能体/底部面板）
// 交给 dockview 托管：可拖拽重排、可停靠、可缩放、布局持久化。活动栏仍是固定左轨（非停靠）。
// 「加一块面板 = COMPONENTS 加一行 + onReady 里 addPanel 一行」，与任务/能力的可插拔同构。

const SIDEBAR_TITLE = { explorer: "av_explorer", market: "av_market", atlas: "av_atlas" } as const;

// 侧栏面板：dockview 标签跟随「资源管理器 ↔ 插件市场 ↔ 图谱」切换（活动栏驱动），故 SideBar 内部不再自绘标题栏。
function SidebarPane({ api }: IDockviewPanelProps) {
  const view = useSession((s) => s.sidebarView);
  const { t } = useI18n();
  useEffect(() => {
    api.setTitle(t(SIDEBAR_TITLE[view]));
  }, [view, t, api]);
  return <SideBar />;
}

// 面板注册表（组件 id → 渲染器）。模块级常量，避免每次渲染重建导致 dockview 重挂面板。
const COMPONENTS: Record<string, FunctionComponent<IDockviewPanelProps>> = {
  editor: () => <Editor />,
  sidebar: SidebarPane,
  agent: () => <AgentPanel />,
  panel: () => <BottomPanel />,
};

const LKEY = "glaux.layout.v1"; // 版本化布局键：改面板 id/结构时 bump，旧布局自动作废回默认

// 默认布局：侧栏 | 编辑器 | 智能体（三列），底部面板落在编辑器下方（VS Code 式）。
function buildDefault(api: DockviewApi) {
  api.addPanel({ id: "editor", component: "editor", title: "Editor" });
  const sidebar = api.addPanel({
    id: "sidebar",
    component: "sidebar",
    title: "Explorer",
    position: { direction: "left", referencePanel: "editor" },
  });
  const agent = api.addPanel({
    id: "agent",
    component: "agent",
    title: "Agent",
    position: { direction: "right", referencePanel: "editor" },
  });
  const panel = api.addPanel({
    id: "panel",
    component: "panel",
    title: "Panel",
    position: { direction: "below", referencePanel: "editor" },
  });
  // 平衡默认比例：三横列 setSize 是「按比例重分配」，最后设置的那个最精确。
  // 智能体宽度对整体观感最关键，故最后设它（编辑器居中最宽，侧栏略随其后）。用户拖拽后由持久化覆盖。
  sidebar.group.api.setSize({ width: 260 });
  panel.group.api.setSize({ height: 200 });
  agent.group.api.setSize({ width: 340 });
}

export function Shell() {
  const onReady = (event: DockviewReadyEvent) => {
    const api = event.api;
    // 恢复用户上次拖拽/缩放的布局；损坏或跨版本 JSON 则清键回默认（版本化 + try/catch 兜底）。
    let restored = false;
    try {
      const saved = localStorage.getItem(LKEY);
      if (saved) {
        api.fromJSON(JSON.parse(saved));
        restored = true;
      }
    } catch {
      try {
        localStorage.removeItem(LKEY);
      } catch {
        /* noop */
      }
    }
    if (!restored) buildDefault(api);
    // 拖拽/缩放/停靠后持久化。
    api.onDidLayoutChange(() => {
      try {
        localStorage.setItem(LKEY, JSON.stringify(api.toJSON()));
      } catch {
        /* noop */
      }
    });
  };

  return <DockviewReact className="dv-host" components={COMPONENTS} theme={themeAbyss} onReady={onReady} />;
}
