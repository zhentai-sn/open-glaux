import { useI18n } from "../i18n";
import { useSession } from "../store/session";

const TOOL_LABEL = {
  cursor: "tl_cursor",
  editli: "tl_editli",
  editma: "tl_editma",
  roi: "tl_roi",
  reset: "tl_reset",
} as const;

const TOOL_GLYPH = { cursor: "▸", editli: "◠", editma: "◡", roi: "▭", reset: "⟲" } as const;

export function StatusBar() {
  const { t, lang, toggle } = useI18n();
  const tool = useSession((s) => s.tool);
  const coords = useSession((s) => s.coords);
  const imt = useSession((s) => s.imt);
  const model = useSession((s) => s.activeModel);
  const image = useSession((s) => s.activeImage);
  const setView = useSession((s) => s.setSidebarView);

  return (
    <div className="status">
      <button className="item">
        <span>⎇</span> main
      </button>
      <button className="item">
        <span className="mono">{image ?? "—"} · 37/100</span>
      </button>
      <span className="item">
        {TOOL_GLYPH[tool]} <span>{t(TOOL_LABEL[tool])}</span>
      </span>
      <span className="sp" />
      <span className="item mono">
        x {coords.x} · y {coords.y}
      </span>
      <span className="item mono">
        IMT <b>{imt}</b> mm
      </span>
      <button className="item" onClick={() => setView("models")}>
        ● <span className="mono" style={{ color: "#bfe" }}>{model}</span>
      </button>
      <button className="item" onClick={toggle} title="language">
        {lang === "en" ? "EN" : "中"}
      </button>
      <span className="item">🔔</span>
    </div>
  );
}
