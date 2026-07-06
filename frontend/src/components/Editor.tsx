import { AnnotationCanvas } from "./AnnotationCanvas";
import { BottomPanel } from "./BottomPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { Rich } from "./Rich";
import { reRunActiveModel } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession, type Tool } from "../store/session";

const TOOLS: { id: Tool; glyph: string; tip: "tip_select" | "tip_editli" | "tip_editma" | "tip_reset"; cls?: string }[] = [
  { id: "cursor", glyph: "▸", tip: "tip_select" },
  { id: "editli", glyph: "◠", tip: "tip_editli", cls: "editli" },
  { id: "editma", glyph: "◡", tip: "tip_editma", cls: "editma" },
  { id: "reset", glyph: "⟲", tip: "tip_reset" },
];

export function Editor() {
  const { t } = useI18n();
  const image = useSession((s) => s.activeImage);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const loading = useSession((s) => s.loading);
  const tool = useSession((s) => s.tool);
  const setTool = useSession((s) => s.setTool);
  const pushAgent = useSession((s) => s.pushAgent);

  const onTool = (id: Tool) => {
    if (id === "reset") {
      setTool("cursor");
      void reRunActiveModel().then(() => {
        const m = useSession.getState().measurement;
        if (m) pushAgent({ variant: "plain", key: "reset", vars: { v: m.pdm_mean_mm.toFixed(3) } });
      });
      return;
    }
    setTool(id);
  };

  return (
    <div className="center">
      <div className="tabs">
        {image && (
          <div className="tab on">
            <span className="fico">▤</span>
            {image}.tiff
          </div>
        )}
      </div>
      <div className="breadcrumb">
        <span>CUBS-tech</span>
        <span>images</span>
        <span style={{ color: "var(--ink)" }}>{image ?? "—"}.tiff</span>
      </div>

      <div className="editor">
        {image ? (
          <>
            <ErrorBoundary label="canvas">
              <AnnotationCanvas />
            </ErrorBoundary>
            <div className="hud">
              <Rich k="hud_mode" className="tagpill" />
              <span className="tagpill mono">CF {cf ?? "—"} mm/px</span>
              {loading && <span className="tagpill" style={{ color: "var(--agent)" }}>…</span>}
            </div>
            <div className="etools" role="toolbar">
              {TOOLS.map((tl) => (
                <button
                  key={tl.id}
                  className={"etool" + (tl.cls ? " " + tl.cls : "")}
                  aria-pressed={tool === tl.id}
                  onClick={() => onTool(tl.id)}
                >
                  {tl.glyph}
                  <span className="tip">{t(tl.tip)}</span>
                </button>
              ))}
            </div>
            <span className="repr">{t("repr")}</span>
            {loading && <span className="repr" style={{ left: "auto", right: 26, color: "var(--agent)", borderColor: "var(--agent-line)" }}>⟳ segmenting…</span>}
          </>
        ) : (
          <div className="empty">{t("empty_editor")}</div>
        )}
      </div>

      <BottomPanel />
    </div>
  );
}
