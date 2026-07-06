import { useSession } from "../store/session";

// MVP：去掉无行为的顶层菜单与假窗口控件，只留产品标识 + 真实标题（当前图）。
export function TitleBar() {
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
      <b style={{ fontSize: 12, color: "var(--bright)", marginRight: 4 }}>Glaux</b>
      <span style={{ fontSize: 11, color: "var(--faint)" }}>· Agentic IMT · MVP</span>
      <span className="ttl">{image ? `${image}.tiff — CUBS-tech` : "CUBS-tech"}</span>
    </div>
  );
}
