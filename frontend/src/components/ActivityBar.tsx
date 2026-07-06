import { useAgent } from "../agent/useAgent";
import { useI18n } from "../i18n";
import { useSession, type View } from "../store/session";

const VIEWS: { id: View; key: "av_explorer" | "av_search" | "av_scm" | "av_models"; icon: JSX.Element }[] = [
  {
    id: "explorer",
    key: "av_explorer",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M13 3H5v18h14V9l-6-6z" />
        <path d="M13 3v6h6" />
      </svg>
    ),
  },
  {
    id: "search",
    key: "av_search",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M20 20l-4.5-4.5" />
      </svg>
    ),
  },
  {
    id: "scm",
    key: "av_scm",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <circle cx="6" cy="6" r="2.4" />
        <circle cx="6" cy="18" r="2.4" />
        <circle cx="18" cy="9" r="2.4" />
        <path d="M6 8.4v7.2M8.2 7.2c6 1 8 1.2 8 4.4" />
      </svg>
    ),
  },
  {
    id: "models",
    key: "av_models",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <path d="M17.5 14v7M14 17.5h7" />
      </svg>
    ),
  },
];

export function ActivityBar() {
  const { t } = useI18n();
  const view = useSession((s) => s.sidebarView);
  const setView = useSession((s) => s.setSidebarView);
  const nInstalled = useSession((s) => s.models.length);
  const { run } = useAgent();

  return (
    <nav className="activity">
      {VIEWS.map((v) => (
        <button
          key={v.id}
          className="act"
          aria-selected={view === v.id}
          onClick={() => setView(v.id)}
        >
          {v.icon}
          <span className="tip">{t(v.key)}</span>
          {v.id === "models" && nInstalled > 0 && <span className="badge">{nInstalled}</span>}
        </button>
      ))}
      <button className="act" onClick={() => run(t("seed"))}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M7 5l12 7-12 7V5z" />
        </svg>
        <span className="tip">{t("av_run")}</span>
      </button>
    </nav>
  );
}
