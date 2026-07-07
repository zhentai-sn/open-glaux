import { BottomPanel } from "./BottomPanel";
import { ErrorBoundary } from "./ErrorBoundary";
import { Rich } from "./Rich";
import { Viewer } from "./Viewer";
import { reRunActiveModel } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession, type Tool } from "../store/session";

export function Editor() {
  const { t, lang } = useI18n();
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const image = useSession((s) => s.activeImage);
  const center = useSession((s) => s.imageMeta?.center ?? (modality === "fetal_hc" ? "HC18" : "CUBS-tech"));
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const loading = useSession((s) => s.loading);
  const tool = useSession((s) => s.tool);
  const setTool = useSession((s) => s.setTool);
  const pushAgent = useSession((s) => s.pushAgent);

  const isHC = modality === "fetal_hc";
  const ext = isHC ? ".png" : ".tiff";
  // 工具栏从任务注册表派生（当前模态对应任务的 tools），不再硬编码 IMT_TOOLS/HC_TOOLS。
  const tools = tasks.find((tk) => tk.modality === modality)?.tools ?? [];

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
            <ErrorBoundary label="canvas"><Viewer /></ErrorBoundary>
            <div className="hud">
              <Rich k={isHC ? "hud_mode_hc" : "hud_mode"} className="tagpill" />
              <span className="tagpill mono">CF {cf ?? "—"} mm/px</span>
              {loading && <span className="tagpill" style={{ color: "var(--agent)" }}>…</span>}
            </div>
            <div className="etools" role="toolbar">
              {tools.map((tl) => (
                <button
                  key={tl.id}
                  className={"etool" + (tl.id === "editli" || tl.id === "editma" ? " " + tl.id : "")}
                  aria-pressed={tool === tl.id}
                  onClick={() => onTool(tl.id as Tool)}
                >
                  {tl.glyph}
                  <span className="tip">{tl.label[lang]}</span>
                </button>
              ))}
            </div>
            <span className="repr">{t(isHC ? (center === "synthetic-HC" ? "repr_hc_synth" : "repr_hc") : "repr")}</span>
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
