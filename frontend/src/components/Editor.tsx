import { AnnotationCanvas } from "./AnnotationCanvas";
import { BottomPanel } from "./BottomPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { HCCanvas } from "./HCCanvas";
import { Rich } from "./Rich";
import { reRunActiveModel } from "../data/actions";
import { useI18n, type I18nKey } from "../i18n";
import { useSession, type Tool } from "../store/session";

type ToolDef = { id: Tool; glyph: string; tip: I18nKey; cls?: string };

// IMT：选择 / 改 LI / 改 MA / 复位；HC：选择 / 重新检测（闭合轮廓无 LI/MA 拖边界）。
const IMT_TOOLS: ToolDef[] = [
  { id: "cursor", glyph: "▸", tip: "tip_select" },
  { id: "editli", glyph: "◠", tip: "tip_editli", cls: "editli" },
  { id: "editma", glyph: "◡", tip: "tip_editma", cls: "editma" },
  { id: "reset", glyph: "⟲", tip: "tip_reset" },
];
const HC_TOOLS: ToolDef[] = [
  { id: "cursor", glyph: "▸", tip: "tip_select" },
  { id: "reset", glyph: "⟲", tip: "tip_redetect" },
];

export function Editor() {
  const { t } = useI18n();
  const modality = useSession((s) => s.modality);
  const image = useSession((s) => s.activeImage);
  const center = useSession((s) => s.imageMeta?.center ?? (modality === "fetal_hc" ? "synthetic-HC" : "CUBS-tech"));
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const loading = useSession((s) => s.loading);
  const tool = useSession((s) => s.tool);
  const setTool = useSession((s) => s.setTool);
  const pushAgent = useSession((s) => s.pushAgent);

  const isHC = modality === "fetal_hc";
  const ext = isHC ? ".png" : ".tiff";
  const tools = isHC ? HC_TOOLS : IMT_TOOLS;

  const onTool = (id: Tool) => {
    if (id === "reset") {
      setTool("cursor");
      void reRunActiveModel().then(() => {
        const st = useSession.getState();
        if (isHC) {
          if (st.hcMeasurement) pushAgent({ variant: "plain", key: "hc_redetect", vars: { v: st.hcMeasurement.hc_mm.toFixed(1) } });
        } else if (st.measurement) {
          pushAgent({ variant: "plain", key: "reset", vars: { v: st.measurement.pdm_mean_mm.toFixed(3) } });
        }
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
            {image}
            {ext}
          </div>
        )}
      </div>
      <div className="breadcrumb">
        <span>{center}</span>
        <span>images</span>
        <span style={{ color: "var(--ink)" }}>
          {image ?? "—"}
          {ext}
        </span>
      </div>

      <div className="editor">
        {image ? (
          <>
            <ErrorBoundary label="canvas">{isHC ? <HCCanvas /> : <AnnotationCanvas />}</ErrorBoundary>
            <div className="hud">
              <Rich k={isHC ? "hud_mode_hc" : "hud_mode"} className="tagpill" />
              <span className="tagpill mono">CF {cf ?? "—"} mm/px</span>
              {loading && <span className="tagpill" style={{ color: "var(--agent)" }}>…</span>}
            </div>
            <div className="etools" role="toolbar">
              {tools.map((tl) => (
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
            <span className="repr">{t(isHC ? "repr_hc" : "repr")}</span>
            {loading && <span className="repr" style={{ left: "auto", right: 26, color: "var(--agent)", borderColor: "var(--agent-line)" }}>⟳ {t(isHC ? "hc_detecting" : "segmenting")}</span>}
          </>
        ) : (
          <div className="empty">{t("empty_editor")}</div>
        )}
      </div>

      <BottomPanel />
    </div>
  );
}
