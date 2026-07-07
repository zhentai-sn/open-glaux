import { useSession } from "../store/session";

// MVP：去掉无行为的顶层菜单与假窗口控件，只留产品标识 + 真实标题（当前图）。
export function TitleBar() {
  const image = useSession((s) => s.activeImage);
  const modality = useSession((s) => s.modality);
  const center = useSession((s) => s.imageMeta?.center);
  // 标题随模态：HC → .png / HC18（真实时读元数据），IMT → .tiff / CUBS-tech。
  const isHC = modality === "fetal_hc";
  const ext = isHC ? ".png" : ".tiff";
  const ws = center ?? (isHC ? "HC18" : "CUBS-tech");
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
      <span className="ttl">{image ? `${image}${ext} — ${ws}` : ws}</span>
    </div>
  );
}
