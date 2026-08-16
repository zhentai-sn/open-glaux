// 图谱页面的导航微状态（SDD feats/03 §8）：列表 / 详情 / 导入向导，Workbench 侧栏与 Focus 右侧
// 拓展区共用同一份（同一组件、同一状态），会话卡片"在图谱中打开"也写这里。非领域字段，不持久化。
import { create } from "zustand";

import { useSession } from "./session";

export type AtlasScreen = "list" | "detail" | "import";

interface AtlasUiState {
  screen: AtlasScreen;
  selectedId: string | null;
  /** 列表刷新计数：导入/下架/删除后 +1，列表订阅它重拉。 */
  refreshTick: number;
  openList: () => void;
  openExemplar: (id: string) => void;
  openImport: () => void;
  bumpRefresh: () => void;
}

export const useAtlasUi = create<AtlasUiState>((set) => ({
  screen: "list",
  selectedId: null,
  refreshTick: 0,
  openList: () => set({ screen: "list" }),
  openExemplar: (id) => set({ screen: "detail", selectedId: id }),
  openImport: () => set({ screen: "import" }),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));

/**
 * 从任意位置（如会话卡片）跳到某个案例：按当前外壳模式把图谱面板亮出来，再切到详情。
 * Focus → 右侧拓展区切 atlas 且展开；Workbench → 侧栏切 atlas。
 */
export function revealExemplar(id: string): void {
  const s = useSession.getState();
  if (s.uiMode === "focus") s.setFocusLayout({ rightView: "atlas", stageOpen: true });
  else s.setSidebarView("atlas");
  useAtlasUi.getState().openExemplar(id);
}
