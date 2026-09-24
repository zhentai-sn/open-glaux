import type { ComponentType } from "react";

import type { ClassSpec } from "../api/types";
import { useI18n } from "../i18n";
import type { ToolOptions } from "../store/session";
import type { FrameAxis } from "./contract";

export interface ChromeSegmentProps {
  tool: string;
  options: ToolOptions;
  classes: ClassSpec[];
  axis: FrameAxis;
  setOptions(patch: Partial<{ brush: Partial<ToolOptions["brush"]>; voi: Partial<ToolOptions["voi"]> }>): void;
}

const CT_PRESETS = [
  { key: "abd", i18n: "chrome_preset_abd", ww: 400, wl: 40 },
  { key: "med", i18n: "chrome_preset_med", ww: 350, wl: 40 },
  { key: "lung", i18n: "chrome_preset_lung", ww: 1500, wl: -600 },
  { key: "bone", i18n: "chrome_preset_bone", ww: 1800, wl: 400 },
] as const;

function BrushSeg({ options, classes, setOptions }: ChromeSegmentProps) {
  const { t, lang } = useI18n();
  const brush = options.brush;
  return (
    <div className="chrome-seg">
      <button className="chrome-btn" aria-pressed={brush.mode === "paint"} onClick={() => setOptions({ brush: { mode: "paint" } })}>{t("chrome_brush_paint")}</button>
      <button className="chrome-btn" aria-pressed={brush.mode === "erase"} onClick={() => setOptions({ brush: { mode: "erase" } })}>{t("chrome_brush_erase")}</button>
      {classes.length > 0 && (
        <select className="chrome-select" value={brush.classId} onChange={(e) => setOptions({ brush: { classId: Number(e.target.value) } })}>
          {classes.map((c) => <option key={c.class_id} value={c.class_id}>{c.label[lang]}</option>)}
        </select>
      )}
      <label className="chrome-range">
        {t("chrome_brush_radius")} {brush.radius}
        <input type="range" min={1} max={10} value={brush.radius} onChange={(e) => setOptions({ brush: { radius: Number(e.target.value) } })} />
      </label>
    </div>
  );
}

function VoiSeg({ options, setOptions }: ChromeSegmentProps) {
  const { t } = useI18n();
  const voi = options.voi;
  return (
    <div className="chrome-seg">
      {CT_PRESETS.map((p) => (
        <button key={p.key} className="chrome-btn" aria-pressed={voi.ww === p.ww && voi.wl === p.wl} onClick={() => setOptions({ voi: { ww: p.ww, wl: p.wl } })} title={`WW ${p.ww} / WL ${p.wl}`}>
          {t(p.i18n)}
        </button>
      ))}
      <span className="chrome-sep" />
      <label className="chrome-range">WW
        <input type="range" min={1} max={3000} step={10} value={voi.ww} onChange={(e) => setOptions({ voi: { ww: Number(e.target.value) } })} />
        <span className="mono">{voi.ww}</span>
      </label>
      <label className="chrome-range">WL
        <input type="range" min={-1000} max={1000} step={10} value={voi.wl} onChange={(e) => setOptions({ voi: { wl: Number(e.target.value) } })} />
        <span className="mono">{voi.wl}</span>
      </label>
    </div>
  );
}

function TimelineSeg({ axis }: ChromeSegmentProps) {
  const { t } = useI18n();
  if (axis.kind !== "t") return null;
  const count = Math.max(1, axis.count);
  const index = Math.max(0, Math.min(count - 1, axis.index));
  return (
    <div className="chrome-seg" data-testid="timeline-seg">
      <label className="chrome-range">
        {t("chrome_timeline")}
        <input type="range" min={0} max={count - 1} value={index} aria-label={t("chrome_timeline")}
          onChange={(event) => axis.onIndex(Number(event.target.value))} />
      </label>
      <span className="mono">{t("chrome_frame")} {index + 1}/{count}</span>
      {axis.fps && <span className="mono">{(index / axis.fps).toFixed(2)} s</span>}
    </div>
  );
}

/** 能力位驱动的选项段注册面。新能力只需登记组件，不修改外壳条件分支。 */
export const CHROME_SEGMENTS: Array<{ cap: string; visible: (tool: string) => boolean; Seg: ComponentType<ChromeSegmentProps> }> = [
  { cap: "brush", visible: (tool) => tool === "brush", Seg: BrushSeg },
  { cap: "voi", visible: () => true, Seg: VoiSeg },
  { cap: "timeline", visible: () => true, Seg: TimelineSeg },
];
