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

function IMTMeasurements() {
  const { t } = useI18n();
  const m = useSession((s) => s.measurement);
  const src = useSession((s) => s.boundaries?.source ?? "agent");
  const fmt = (v: number | undefined | null, d = 3) => (v == null ? "—" : v.toFixed(d));
  return (
    <div>
      <div className="mgrid">
        {mcell(t("measure_k1"), fmt(m?.mean_mm), "mm")}
        {mcell("Max IMT", fmt(m?.max_mm), "mm")}
        {mcell("PDM sym", fmt(m?.pdm_mean_mm), "mm")}
        {mcell(t("m_vsa1"), m?.vs_a1_um == null ? "—" : m.vs_a1_um.toFixed(1), "µm", true)}
        {mcell("cols", m?.n_columns == null ? "—" : String(m.n_columns), "")}
      </div>
      {[
        { c: "var(--li)", nm: "LI", rk: "rg_boundary" as const },
        { c: "var(--ma)", nm: "MA", rk: "rg_boundary" as const },
        { c: "var(--roi)", nm: "ROI", rk: "rg_roi" as const },
      ].map((r) => (
        <div key={r.nm} className="regionrow">
          <span className="sw" style={{ background: r.c }} />
          <b>{r.nm}</b>&nbsp;<span>{t(r.rk)}</span>
          <span className={"src " + src}>{t(src === "human" ? "src_human" : "src_agent")}</span>
        </div>
      ))}
    </div>
  );
}

function HCMeasurements() {
  const { t } = useI18n();
  const m = useSession((s) => s.hcMeasurement);
  const src = useSession((s) => s.hcContour?.source ?? "agent");
  const fmt = (v: number | undefined | null, d = 1) => (v == null ? "—" : v.toFixed(d));
  return (
    <div>
      <div className="mgrid">
        {mcell("HC", fmt(m?.hc_mm), "mm")}
        {mcell("BPD", fmt(m?.bpd_mm), "mm")}
        {mcell("OFD", fmt(m?.ofd_mm), "mm")}
        {mcell(t("m_vsgt"), m?.vs_gt_mm == null ? "—" : m.vs_gt_mm.toFixed(2), "mm", true)}
        {mcell("area", m?.area_mm2 == null ? "—" : m.area_mm2.toFixed(0), "mm²")}
      </div>
      <div className="regionrow">
        <span className="sw" style={{ background: "#C39BFF" }} />
        <b>HC</b>&nbsp;<span>{t("rg_skull")}</span>
        <span className={"src " + src}>{t(src === "human" ? "src_human" : "src_agent")}</span>
      </div>
    </div>
  );
}

function MeasurementsView() {
  const isHC = useSession((s) => s.modality === "fetal_hc");
  return isHC ? <HCMeasurements /> : <IMTMeasurements />;
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
        {logline(<>measure → ellipse-fit · Ramanujan · <span className="ok">HC {hcM.hc_mm.toFixed(1)} mm</span> · vs GT {hcM.vs_gt_mm == null ? "—" : hcM.vs_gt_mm.toFixed(2)} mm</>, "m")}
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
