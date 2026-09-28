import type { I18nKey } from "../i18n";
import type { Tool } from "../store/session";

// 模式工具目录（SDD 04 §7.5、D-21）——标签、键位、绘制提示只在这里声明，与任务无关；
// 任务只经能力位决定启用哪些。图标在 components/iconMap 的 TOOL_ICON（SDD 06 单一图标源）。
// 顺序即工具条展示序；键位供 SDD 05 分发器与速查面板共用（D-9）。
export interface ToolEntry {
  id: Tool;
  label: I18nKey;
  key: string;
  hint?: I18nKey;
}

export const TOOL_CATALOG: readonly ToolEntry[] = [
  { id: "cursor", label: "tl_cursor", key: "v" },
  { id: "bbox", label: "tl_bbox", key: "r", hint: "chrome_hint_bbox" },
  { id: "polygon", label: "tl_polygon", key: "p", hint: "chrome_hint_polygon" },
  { id: "brush", label: "tl_brush", key: "b" },
  { id: "wall", label: "tl_wall", key: "w", hint: "chrome_hint_wall" },
];

/** 常驻模式工具；其余按能力位启用（§7.5 规则 2）。 */
export const ALWAYS_TOOL: Tool = "cursor";
