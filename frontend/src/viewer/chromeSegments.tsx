import { useEffect } from "react";

import type { ClassSpec } from "../api/types";
import { useI18n } from "../i18n";
import { currentLabel, useLabels } from "../store/labels";
import { useSession } from "../store/session";
import type { FrameAxis } from "./contract";
import type { EditorChrome } from "./editorChrome";

// 编辑区选项段（SDD 04 §7.5）：模式选项（随当前模式）与视图（随对象）。
// 显示与否由 useEditorChrome 判定，这里只渲染；两种外壳共用。

const CT_PRESETS = [
  { key: "abd", i18n: "chrome_preset_abd", ww: 400, wl: 40 },
  { key: "med", i18n: "chrome_preset_med", ww: 350, wl: 40 },
  { key: "lung", i18n: "chrome_preset_lung", ww: 1500, wl: -600 },
  { key: "bone", i18n: "chrome_preset_bone", ww: 1800, wl: 400 },
] as const;

function BrushSeg({ classes }: { classes: ClassSpec[] }) {
  const { t, lang } = useI18n();
  const brush = useSession((s) => s.toolOptions.brush);
  const setOptions = useSession((s) => s.setToolOptions);
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

// 当前标签（SDD 23 §4.1）：新画的标注自动使用；点击打开标签弹层更换。
function LabelSeg({ objectId }: { objectId: string }) {
  const { t } = useI18n();
  const labels = useLabels();
  const current = currentLabel(labels);
  const { load, objectId: loadedFor } = labels;
  useEffect(() => {
    if (loadedFor !== objectId) void load(objectId);
  }, [objectId, loadedFor, load]);
  return (
    <div className="chrome-seg" data-testid="label-seg">
      <button
        className="chrome-btn chrome-label-btn"
        title={t("chrome_label_title")}
        onClick={() => void labels.requestLabel(objectId, { setCurrent: true })}
      >
        <span className={current ? "label-swatch" : "label-swatch none"} style={current ? { background: current.color } : undefined} />
        <span className="label-name">{current ? current.name : t("chrome_label_none")}</span>
      </button>
      <button className="chrome-btn" aria-pressed={labels.showNames} onClick={() => labels.setShowNames(!labels.showNames)}>
        {t("chrome_label_show_names")}
      </button>
    </div>
  );
}

// 预设对全部 volume 显示（D-26）。
function VoiSeg() {
  const { t } = useI18n();
  const voi = useSession((s) => s.toolOptions.voi);
  const setOptions = useSession((s) => s.setToolOptions);
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

// z 与 t 共用一个滑块（规则 4）；与滚轮翻层写同一 focus.index。
function FrameAxisSeg({ axis }: { axis: Exclude<FrameAxis, { kind: "none" }> }) {
  const { t } = useI18n();
  const count = Math.max(1, axis.count);
  const index = Math.max(0, Math.min(count - 1, axis.index));
  const label = t(axis.kind === "t" ? "chrome_timeline" : "chrome_slice");
  return (
    <div className="chrome-seg" data-testid="frame-axis-seg">
      <label className="chrome-range">
        {label}
        <input type="range" min={0} max={count - 1} value={index} aria-label={label}
          onChange={(event) => axis.onIndex(Number(event.target.value))} />
      </label>
      <span className="mono">{t(axis.kind === "t" ? "chrome_frame" : "chrome_slice")} {index + 1}/{count}</span>
      {axis.kind === "t" && axis.fps && <span className="mono">{(index / axis.fps).toFixed(2)} s</span>}
    </div>
  );
}

export function hasSegments({ brushOptions, labelOptions, voi, axis }: Pick<EditorChrome, "brushOptions" | "labelOptions" | "voi" | "axis">): boolean {
  return brushOptions || labelOptions || voi || axis.kind !== "none";
}

/** 模式选项段 + 视图段；两者皆空时返回 null。 */
export function ChromeSegments({ chrome }: { chrome: EditorChrome }) {
  const { brushOptions, labelOptions, classes, voi, axis, object } = chrome;
  if (!hasSegments(chrome)) return null;
  return (
    <>
      {labelOptions && object && <LabelSeg objectId={object.id} />}
      {brushOptions && <BrushSeg classes={classes} />}
      {voi && <VoiSeg />}
      {axis.kind !== "none" && <FrameAxisSeg axis={axis} />}
    </>
  );
}

/** 当前模式的绘制提示；on_commit 派生的「松手后运行」追加在后（规则 1）。 */
export function chromeHintText(
  chrome: Pick<EditorChrome, "hint" | "commitTask">,
  t: ReturnType<typeof useI18n>["t"],
  lang: ReturnType<typeof useI18n>["lang"],
): string | null {
  const parts = [
    chrome.hint ? t(chrome.hint) : null,
    chrome.commitTask ? t("chrome_hint_run_on_commit", { task: chrome.commitTask[lang] }) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
