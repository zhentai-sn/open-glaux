import { AnnotationCanvas } from "./AnnotationCanvas";
import { BottomPanel } from "./BottomPanel";
import { Rich } from "./Rich";
import { useI18n } from "../i18n";
import { useSession, type Tool } from "../store/session";

const TOOLS: { id: Tool; glyph: string; tip: "tip_select" | "tip_editli" | "tip_editma" | "tip_roi" | "tip_reset"; cls?: string }[] = [
  { id: "cursor", glyph: "▸", tip: "tip_select" },
  { id: "editli", glyph: "◠", tip: "tip_editli", cls: "editli" },
  { id: "editma", glyph: "◡", tip: "tip_editma", cls: "editma" },
  { id: "roi", glyph: "▭", tip: "tip_roi" },
  { id: "reset", glyph: "⟲", tip: "tip_reset" },
];

export function Editor() {
  const { t } = useI18n();
  const image = useSession((s) => s.activeImage);
  const tool = useSession((s) => s.tool);
  const setTool = useSession((s) => s.setTool);

  return (
    <div className="center">
      <div className="tabs">
        <div className="tab on">
          <span className="fico">▤</span>
          {image ?? "—"}.tiff <span className="dot" title="unsaved">●</span>
          <button className="x">✕</button>
        </div>
        <div className="tab">
          <span className="fico">▤</span>tech_438.tiff<button className="x">✕</button>
        </div>
        <div className="tab">
          <span className="fico csv">▦</span>cohort_gtfamus.csv<button className="x">✕</button>
        </div>
      </div>
      <div className="breadcrumb">
        <span>CUBS-tech</span>
        <span>images</span>
        <span style={{ color: "var(--ink)" }}>{image ?? "—"}.tiff</span>
      </div>

      <div className="editor">
        {image ? (
          <>
            <AnnotationCanvas />
            <div className="hud">
              <Rich k="hud_mode" className="tagpill" />
              <span className="tagpill mono">CF 0.0559 mm/px</span>
            </div>
            <div className="etools" role="toolbar">
              {TOOLS.map((tl) => (
                <button
                  key={tl.id}
                  className={"etool" + (tl.cls ? " " + tl.cls : "")}
                  aria-pressed={tool === tl.id}
                  onClick={() => setTool(tl.id === "reset" ? "cursor" : tl.id)}
                >
                  {tl.glyph}
                  <span className="tip">{t(tl.tip)}</span>
                </button>
              ))}
            </div>
            <span className="repr">{t("repr")}</span>
          </>
        ) : (
          <div className="empty">{t("empty_editor")}</div>
        )}
      </div>

      <BottomPanel />
    </div>
  );
}
