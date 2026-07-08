import { ErrorBoundary } from "./ErrorBoundary";
import { Viewer } from "./Viewer";
import { reRunActiveModel } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession, type Tool } from "../store/session";

export function Editor() {
  const { t, lang } = useI18n();
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const image = useSession((s) => s.activeImage);
  const center = useSession((s) => s.imageMeta?.center ?? "dataset");
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const loading = useSession((s) => s.loading);
  const tool = useSession((s) => s.tool);
  const setTool = useSession((s) => s.setTool);
  const pushAgent = useSession((s) => s.pushAgent);
  const modelVersion = useSession((s) => s.modelVersion);

  // 当前模态对应任务（注册表）——工具栏/标签/查看器全从这里来，不再 if 模态。
  const tv = tasks.find((tk) => tk.modality === modality);
  const tools = tv?.tools ?? [];
  const label = tv?.label[lang] ?? "";

  const onTool = (id: Tool) => {
    if (id === "reset") {
      setTool("cursor");
      void reRunActiveModel().then(() => {
        const st = useSession.getState();
        const head = tv && st.metrics ? st.metrics[tv.metrics[0]?.key] : undefined;
        if (head) {
          const v = Math.abs(head.value) < 10 ? head.value.toFixed(3) : head.value.toFixed(1);
          const hl = lang === "zh" ? head.label_zh : head.label_en;
          pushAgent({ variant: "plain", key: "reset_done", vars: { v: `${hl} ${v} ${head.unit}` } });
        }
      });
      return;
    }
    setTool(id);
  };

  return (
    <div className="editorpane">
      <div className="tabs">
        {image && (
          <div className="tab on">
            <span className="fico">▤</span>
            {image}
          </div>
        )}
      </div>
      <div className="breadcrumb">
        <span>{center}</span>
        <span>images</span>
        <span style={{ color: "var(--ink)" }}>{image ?? "—"}</span>
      </div>

      <div className="editor">
        {image ? (
          <>
            <ErrorBoundary label="canvas"><Viewer /></ErrorBoundary>
            <div className="hud">
              <span className="tagpill">{label}</span>
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
            {modelVersion && <span className="repr">{modelVersion}</span>}
            {loading && <span className="repr" style={{ left: "auto", right: 26, color: "var(--agent)", borderColor: "var(--agent-line)" }}>⟳ {t("running")}</span>}
          </>
        ) : (
          <div className="empty">{t("empty_editor")}</div>
        )}
      </div>
    </div>
  );
}
