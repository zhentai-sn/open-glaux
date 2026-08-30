import type { I18nKey } from "../i18n";
import type { Tool } from "../store/session";

// 工具 → 交互提示（SDD 04 §7.1）——两种外壳（IDE 的 ViewerChrome / Focus 的 StagePanel）
// 共用一份，避免"提示只在一种外壳里出现、且与工具真实交互对不上"的老问题重演。
// 无提示的工具（cursor/reset/brush——brush 有自己的参数条）不登记。
export const TOOL_HINT: Partial<Record<Tool, I18nKey>> = {
  bbox: "chrome_hint_bbox",
  polygon: "chrome_hint_polygon",
  wall: "chrome_hint_wall",
};
