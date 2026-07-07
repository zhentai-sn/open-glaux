import { useI18n } from "../i18n";
import { useSession, type PanelTab } from "../store/session";

const TABS: { id: PanelTab; key: "p_meas" | "p_out" | "p_prob" }[] = [
  { id: "meas", key: "p_meas" },
  { id: "out", key: "p_out" },
  { id: "prob", key: "p_prob" },
];

const mcell = (k: string, v: string, unit: string, hi = false) => (
  <div className="mcell" key={k}>
    <div className="k">{k}</div>
    <div className={"v" + (hi ? " hi" : "")}>
      {v}
      <small> {unit}</small>
    </div>
  </div>
);

// 泛型测量视图——度量读 store.metrics（TaskOutput.metrics），区域行读注册表 overlays。
// 加任务/度量 = 后端注册一行，此处零改（不再 IMTMeasurements/HCMeasurements 逐模态硬写）。
function MeasurementsView() {
  const { t, lang } = useI18n();
  const metrics = useSession((s) => s.metrics);
  const modality = useSession((s) => s.modality);
  const overlays = useSession((s) => s.tasks.find((tk) => tk.modality === modality)?.overlays ?? []);
  const src = useSession((s) => s.boundaries?.source ?? s.hcContour?.source ?? "agent");
  if (!metrics) return <div className="stub">— no run yet —</div>;
  const fmt = (v: number) => (Math.abs(v) < 10 ? v.toFixed(3) : v.toFixed(1));
  return (
    <div>
      <div className="mgrid">
        {Object.entries(metrics).map(([k, m]) =>
          mcell(lang === "zh" ? m.label_zh : m.label_en, fmt(m.value), m.unit, k.startsWith("vs")),
        )}
      </div>
      {overlays.map((o) => (
        <div key={o.role} className="regionrow">
          <span className="sw" style={{ background: o.color }} />
          <b>{o.role}</b>
          <span className={"src " + src}>{t(src === "human" ? "src_human" : "src_agent")}</span>
        </div>
      ))}
    </div>
  );
}

const logline = (body: JSX.Element, key: string) => (
  <div className="logline" key={key}>
    <span className="t">›</span> {body}
  </div>
);

function OutputView() {
  const modality = useSession((s) => s.modality);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const b = useSession((s) => s.boundaries);
  const m = useSession((s) => s.measurement);
  const hcC = useSession((s) => s.hcContour);
  const hcM = useSession((s) => s.hcMeasurement);

  if (modality === "fetal_hc") {
    if (!hcC || !hcM) return <div className="stub">— no run yet —</div>;
    return (
      <div>
        {logline(<>interpret → <span className="ok">in_scope</span> fetal_hc</>, "i")}
        {logline(<>calibrate → {cf ?? "—"} mm/px</>, "c")}
        {logline(<>detect → {hcC.modelVersion} · {hcC.points.length} ring pts</>, "s")}
        {logline(<>measure → ellipse-fit · Ramanujan perimeter · <span className="ok">HC {hcM.hc_mm.toFixed(1)} mm</span> · vs GT {hcM.vs_gt_mm == null ? "—" : hcM.vs_gt_mm.toFixed(2)} mm</>, "m")}
      </div>
    );
  }

  if (!b || !m) return <div className="stub">— no run yet —</div>;
  return (
    <div>
      {logline(<>interpret → <span className="ok">in_scope</span> far_wall_cca_imt</>, "i")}
      {logline(<>calibrate → CUBS CF {cf ?? "—"} mm/px</>, "c")}
      {logline(<>segment → {b.modelVersion} · {b.li.length} pts LI/MA</>, "s")}
      {logline(<>measure → PDM common-support · <span className="ok">IMT {m.pdm_mean_mm.toFixed(3)} mm</span> · cols {m.n_columns}</>, "m")}
    </div>
  );
}

function ProblemsView() {
  const { t } = useI18n();
  return <div className="stub">{t("no_problems")}</div>;
}

export function BottomPanel() {
  const { t } = useI18n();
  const tab = useSession((s) => s.panelTab);
  const setTab = useSession((s) => s.setPanelTab);
  const collapsed = useSession((s) => s.panelCollapsed);
  const toggle = useSession((s) => s.togglePanel);

  return (
    <div className={"panel" + (collapsed ? " collapsed" : "")}>
      <div className="ptabs">
        {TABS.map((tb) => (
          <button key={tb.id} className={"ptab" + (tab === tb.id ? " on" : "")} onClick={() => setTab(tb.id)}>
            {t(tb.key)}
          </button>
        ))}
        <span className="pr">
          <button title="collapse" onClick={toggle}>
            {collapsed ? "⌃" : "⌄"}
          </button>
        </span>
      </div>
      <div className="pbody">
        {tab === "meas" && <MeasurementsView />}
        {tab === "out" && <OutputView />}
        {tab === "prob" && <ProblemsView />}
      </div>
    </div>
  );
}
