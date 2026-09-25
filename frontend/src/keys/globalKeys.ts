import { CHAT_EDITION, WORKBENCH_ENABLED } from "../edition";
import { useEffect } from "react";

import type { I18nKey } from "../i18n";
import type { Bilingual } from "../api/types";
import { activeObject, useSession } from "../store/session";
import { taskToolsFor } from "../viewer/useTaskTools";

// 全局快捷键（SDD feats/05）——单一 window keydown 分发器 + 速查数据源。
// 铁律：只调 store 已有动作，不新增契约（D-1/D-2）。键位见 SDD §7.1 / §16 D-5~D-7。

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl"; // ⌘ / Ctrl
const SHIFT = isMac ? "⇧" : "Shift"; // ⇧

// 速查面板数据（单一真相源，与下方分发逻辑同步）。keys 为展示串，label 走 i18n。
export type ShortcutGroup = "tool" | "shell" | "help";
export interface ShortcutRow {
  group: ShortcutGroup;
  keys: string;
  label?: I18nKey;
  text?: Bilingual;
  disabled?: boolean;
}
const SHELL_SHORTCUT_ROWS: ShortcutRow[] = [
  { group: "shell", keys: `${MOD} B`, label: "sc_left" },
  { group: "shell", keys: `${MOD} \\`, label: "sc_right" },
  { group: "shell", keys: `${MOD} ${SHIFT} M`, label: "sc_mode" },
  { group: "help", keys: "?", label: "sc_sheet" },
];
export const SHORTCUT_ROWS = CHAT_EDITION
  ? SHELL_SHORTCUT_ROWS.filter((row) => row.label === "sc_left" || row.label === "sc_sheet")
  : SHELL_SHORTCUT_ROWS.filter((row) => WORKBENCH_ENABLED || row.label !== "sc_mode");

type ToolState = Pick<ReturnType<typeof useSession.getState>, "tasks" | "datasources" | "objects" | "modality" | "focus">;

export function shortcutRowsFor(state: ToolState): ShortcutRow[] {
  if (CHAT_EDITION) return SHORTCUT_ROWS;
  const { declaredTools, tools } = taskToolsFor(activeObject(state), state.tasks, state.datasources);
  const available = new Set(tools.map((tool) => tool.id));
  const toolRows: ShortcutRow[] = declaredTools.filter((tool) => tool.key).map((tool) => ({
    group: "tool",
    keys: tool.key!.toUpperCase(),
    text: tool.label,
    disabled: !available.has(tool.id),
  }));
  if (declaredTools.some((tool) => tool.id === "reset")) toolRows.push({ group: "tool", keys: "Esc", label: "tl_reset" });
  return [...toolRows, ...SHORTCUT_ROWS];
}
export const SHORTCUT_GROUP_LABEL: Record<ShortcutGroup, I18nKey> = {
  tool: "sc_group_tool",
  shell: "sc_group_shell",
  help: "sc_group_help",
};

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable;
}

// R3：焦点在查看器表面或页面主体（点击画布后的常态）→ 视为查看器上下文；焦点在具体控件上则不是。
function inViewerContext(el: Element | null): boolean {
  if (!el || el === document.body) return true;
  return !!el.closest("[data-viewer-surface]");
}

export function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 输入法组合期放行（R2 延伸）
      if (e.isComposing || e.keyCode === 229) return;
      const el = document.activeElement;
      const st = useSession.getState();

      // Esc：图像放大层最先关闭（它盖在最上层），其次速查面板；
      // 否则（非编辑 + 查看器上下文）复位工具（D-7）
      if (e.key === "Escape") {
        if (st.imagePreview) {
          st.setImagePreview(null);
          e.preventDefault();
        } else if (st.shortcutSheetOpen) {
          st.setShortcutSheet(false);
          e.preventDefault();
        } else if (!CHAT_EDITION && !isEditable(el) && inViewerContext(el)) {
          st.setTool("reset");
          e.preventDefault();
        }
        return;
      }

      // R2：输入焦点内除 Esc 一律放行，绝不 preventDefault
      if (isEditable(el)) return;

      const mod = e.ctrlKey || e.metaKey;

      // ? 速查面板（Shift+/），无修饰
      if (!mod && !e.altKey && e.key === "?") {
        st.toggleShortcutSheet();
        e.preventDefault();
        return;
      }

      // 外壳组合键（Ctrl/Cmd，非 Alt）
      if (mod && !e.altKey) {
        const k = e.key.toLowerCase();
        if (WORKBENCH_ENABLED && e.shiftKey && k === "m") {
          st.setUiMode(st.uiMode === "focus" ? "workbench" : "focus");
          e.preventDefault();
          return;
        }
        if (!e.shiftKey && k === "b") {
          // Focus 切左会话栏；Workbench 侧栏由 dockview 自管，本轮不接管（放行，见 SDD §13）
          if (st.uiMode === "focus") {
            st.setFocusLayout({ railOpen: !st.focusLayout.railOpen });
            e.preventDefault();
          }
          return;
        }
        if (!CHAT_EDITION && !e.shiftKey && k === "\\") {
          if (st.uiMode === "focus") st.setFocusLayout({ rightOpen: !st.focusLayout.rightOpen });
          else st.togglePanel();
          e.preventDefault();
          return;
        }
        return;
      }

      // 工具单键（无修饰，需查看器上下文 R3）
      if (!CHAT_EDITION && !mod && !e.altKey && inViewerContext(el)) {
        const tool = taskToolsFor(activeObject(st), st.tasks, st.datasources).tools.find(
          (candidate) => candidate.key?.toLowerCase() === e.key.toLowerCase(),
        );
        if (tool) {
          st.setTool(tool.id);
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
