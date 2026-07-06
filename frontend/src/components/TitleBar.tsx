import { useI18n } from "../i18n";
import { useSession } from "../store/session";

const MENUS = ["m_file", "m_edit", "m_sel", "m_view", "m_run", "m_help"] as const;

export function TitleBar() {
  const { t } = useI18n();
  const image = useSession((s) => s.activeImage);
  return (
    <div className="titlebar">
      <span className="logo" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="8" cy="10" r="3.2" stroke="#B58BF2" strokeWidth="1.7" />
          <circle cx="16" cy="10" r="3.2" stroke="#B58BF2" strokeWidth="1.7" />
          <circle cx="8" cy="10" r="1" fill="#4FB0FF" />
          <circle cx="16" cy="10" r="1" fill="#4FB0FF" />
          <path d="M6 16.4c1.6 1.4 4 1.4 6 1.4s4.4 0 6-1.4" stroke="#B58BF2" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
      {MENUS.map((m) => (
        <button key={m} className="menu">
          {t(m)}
        </button>
      ))}
      <span className="ttl">{image ? `${image}.tiff` : "—"} — CUBS-tech — Glaux</span>
      <span className="win">
        <button aria-label="minimize">—</button>
        <button aria-label="maximize">▢</button>
        <button aria-label="close">✕</button>
      </span>
    </div>
  );
}
