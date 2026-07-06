import { useI18n } from "../i18n";
import { useSession, type PanelTab } from "../store/session";

const TABS: { id: PanelTab; key: "p_meas" | "p_out" | "p_prob" }[] = [
  { id: "meas", key: "p_meas" },
  { id: "out", key: "p_out" },
  { id: "prob", key: "p_prob" },
];

function MeasurementsView() {
  const { t } = useI18n();
  const imt = useSession((s) => s.imt);
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
        {cell(t("measure_k1"), imt, "mm")}
        {cell("Max IMT", "1.041", "mm")}
        {cell("PDM sym", imt, "mm")}
        {cell(t("m_vsa1"), "66.6", "µm", true)}
        {cell("n / cols", "100 / 598", "")}
      </div>
      {[
        { c: "var(--li)", nm: "LI", rk: "rg_boundary" as const },
        { c: "var(--ma)", nm: "MA", rk: "rg_boundary" as const },
        { c: "var(--roi)", nm: "ROI", rk: "rg_roi" as const },
      ].map((r) => (
        <div key={r.nm} className="regionrow">
          <span className="sw" style={{ background: r.c }} />
          <b>{r.nm}</b>&nbsp;<span>{t(r.rk)}</span>
          <span className="src agent">{t("src_agent")}</span>
        </div>
      ))}
    </div>
  );
}

function OutputView() {
  const model = useSession((s) => s.activeModel);
  const imt = useSession((s) => s.imt);
  const line = (t: string, body: JSX.Element) => (
    <div className="logline">
      <span className="t">{t}</span> {body}
    </div>
  );
  return (
    <div>
      {line("[12:21:04]", <>interpret → <span className="ok">in_scope</span> far_wall_cca_imt</>)}
      {line("[12:21:04]", <>calibrate → CUBS CF 0.0559 mm/px</>)}
      {line("[12:21:05]", <>segment → {model} · 598 pts LI/MA</>)}
      {line("[12:21:05]", <>measure → PDM common-support · <span className="ok">IMT {imt} mm</span></>)}
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
