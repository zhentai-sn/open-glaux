import { useI18n } from "../i18n";
import { useSession, type PanelTab } from "../store/session";

const TABS: { id: PanelTab; key: "p_meas" | "p_out" | "p_prob" }[] = [
  { id: "meas", key: "p_meas" },
  { id: "out", key: "p_out" },
  { id: "prob", key: "p_prob" },
];

function MeasurementsView() {
  const { t } = useI18n();
  const m = useSession((s) => s.measurement);
  const boundaries = useSession((s) => s.boundaries);
  const src = boundaries?.source ?? "agent";
  const fmt = (v: number | undefined | null, d = 3) => (v == null ? "—" : v.toFixed(d));
  const cell = (k: string, v: string, unit: string, hi = false) => (
    <div className="mcell">
      <div className="k">{k}</div>
      <div className={"v" + (hi ? " hi" : "")}>
        {v}
        <small> {unit}</small>
      </div>
    </div>
  );
  return (
    <div>
      <div className="mgrid">
        {cell(t("measure_k1"), fmt(m?.mean_mm), "mm")}
        {cell("Max IMT", fmt(m?.max_mm), "mm")}
        {cell("PDM sym", fmt(m?.pdm_mean_mm), "mm")}
        {cell(t("m_vsa1"), m?.vs_a1_um == null ? "—" : m.vs_a1_um.toFixed(1), "µm", true)}
        {cell("cols", m?.n_columns == null ? "—" : String(m.n_columns), "")}
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

function OutputView() {
  const imt = useSession((s) => s.imt);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const b = useSession((s) => s.boundaries);
  const m = useSession((s) => s.measurement);
  const line = (body: JSX.Element, key: string) => (
    <div className="logline" key={key}>
      <span className="t">›</span> {body}
    </div>
  );
  if (!b || !m) return <div className="stub">— no run yet —</div>;
  return (
    <div>
      {line(<>interpret → <span className="ok">in_scope</span> far_wall_cca_imt</>, "i")}
      {line(<>calibrate → CUBS CF {cf ?? "—"} mm/px</>, "c")}
      {line(<>segment → {b.modelVersion} · {b.li.length} pts LI/MA</>, "s")}
      {line(<>measure → PDM common-support · <span className="ok">IMT {imt} mm</span> · cols {m.n_columns}</>, "m")}
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
