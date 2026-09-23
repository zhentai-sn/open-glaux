// Workbench 查看器工具栏；工具与选项段均由当前对象能力位装配。
import { useMemo } from "react";

import { useI18n } from "../i18n";
import { useSession, type Tool } from "../store/session";
import { CHROME_SEGMENTS } from "../viewer/chromeSegments";
import { useTaskTools } from "../viewer/useTaskTools";
import type { ClassSpec, Primitive } from "../api/types";
import { Icon } from "./Icon";
import { FALLBACK_ICON, TOOL_ICON } from "./iconMap";
import { TOOL_HINT } from "./toolHint";

type VolMaskPrim = Extract<Primitive, { kind: "volume_mask" }>;

export function ViewerChrome({ onTool }: { onTool: (id: Tool) => void }) {
  const { t, lang } = useI18n();
  const tool = useSession((s) => s.tool);
  const options = useSession((s) => s.toolOptions);
  const setOptions = useSession((s) => s.setToolOptions);
  const primitives = useSession((s) => s.primitives);
  const { capabilities, tools } = useTaskTools();
  const classes = useMemo<ClassSpec[]>(() => {
    const volume = primitives.find((p): p is VolMaskPrim => p.kind === "volume_mask");
    return volume?.classes ?? [];
  }, [primitives]);
  const segments = CHROME_SEGMENTS.filter((entry) => capabilities.includes(entry.cap) && entry.visible(tool));
  const hintKey = TOOL_HINT[tool] ?? null;

  return (
    <>
      <div className="etools" role="toolbar">
        {tools.map((entry) => (
          <button key={entry.id} className="etool" aria-pressed={tool === entry.id} onClick={() => onTool(entry.id)}>
            <Icon icon={TOOL_ICON[entry.id] ?? FALLBACK_ICON} size="sm" />
            <span className="tip">{entry.label[lang]}</span>
          </button>
        ))}
      </div>
      {(hintKey || segments.length > 0) && (
        <div className="chrome-options">
          {hintKey && <span className="chrome-hint">{t(hintKey)}</span>}
          {segments.map(({ cap, Seg }) => <Seg key={cap} tool={tool} options={options} setOptions={setOptions} classes={classes} />)}
        </div>
      )}
    </>
  );
}
