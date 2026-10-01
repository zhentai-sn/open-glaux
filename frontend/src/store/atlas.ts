// 图谱页面的导航微状态（SDD feats/03 §8）：列表 / 详情，Workbench 侧栏与 Focus 右侧工作区共用同一份
// （同一组件、同一状态），会话卡片"在图谱中打开"也写这里。非领域字段，不持久化。
import { create } from "zustand";

import type { CollectionFilter } from "../components/atlas/CollectionTree";
import { useSession } from "./session";

export type AtlasScreen = "list" | "detail";

/** 一次经用户确认的描述生成（SDD 03 §6.1、D-28）：进度放 store，列表 ↔ 详情往返不中断显示。 */
export interface DescribeJob {
  total: number;
  done: number;
  ok: number;
  failed: number;
  running: boolean;
}

interface AtlasUiState {
  screen: AtlasScreen;
  selectedId: string | null;
  /** 列表刷新计数：上传/编辑/下架/删除后 +1，列表订阅它重拉。 */
  refreshTick: number;
  /** 图册筛选（v1.1）：null 全部 / {path,exact} —— 放 store 使列表 ↔ 详情往返不丢 */
  collectionFilter: CollectionFilter;
  describeJob: DescribeJob | null;
  /** 用户对哪一组待描述案例点了「暂不」（排序后的 id 串）；集合变化后确认条重新出现。 */
  describeDismissed: string | null;
  setCollectionFilter: (f: CollectionFilter) => void;
  openList: () => void;
  openExemplar: (id: string) => void;
  bumpRefresh: () => void;
  setDescribeJob: (job: DescribeJob | null) => void;
  dismissDescribe: (key: string | null) => void;
}

export const useAtlasUi = create<AtlasUiState>((set) => ({
  screen: "list",
  selectedId: null,
  refreshTick: 0,
  collectionFilter: null,
  describeJob: null,
  describeDismissed: null,
  setCollectionFilter: (f) => set({ collectionFilter: f }),
  openList: () => set({ screen: "list" }),
  openExemplar: (id) => set({ screen: "detail", selectedId: id }),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  setDescribeJob: (job) => set({ describeJob: job }),
  dismissDescribe: (key) => set({ describeDismissed: key }),
}));

/** 当前图册筛选对应的上传目标图册（"未分册"与"全部"都落根目录）。 */
export function uploadCollection(f: CollectionFilter): string | null {
  return f && !f.exact ? f.path : null;
}

/**
 * 从任意位置（如会话卡片）跳到某个案例：按当前外壳模式把图谱面板亮出来，再切到详情。
 * Focus → 右侧工作区换成图谱且展开；Workbench → 侧栏切 atlas。
 */
export function revealExemplar(id: string): void {
  const s = useSession.getState();
  if (s.uiMode === "focus") s.setFocusLayout({ sideView: "atlas", rightOpen: true });
  else s.setSidebarView("atlas");
  useAtlasUi.getState().openExemplar(id);
}
