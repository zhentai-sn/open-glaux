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
  const metrics = useSession((s) => s.metrics);
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const model = useSession((s) => s.activeModel);
  const image = useSession((s) => s.activeImage);
  const images = useSession((s) => s.images);
  const setView = useSession((s) => s.setSidebarView);
  const idx = image ? images.findIndex((m) => m.id === image) + 1 : 0;
  // 头条度量（首个注册表度量）——状态栏泛型展示，不再硬写「IMT … mm」。
  const tv = tasks.find((tk) => tk.modality === modality);
  const head = (metrics && ((tv && metrics[tv.metrics[0]?.key]) || Object.values(metrics)[0])) || null;

  return (
    <div className="status">
      <button className="item">
        <span>⎇</span> main
      </button>
      <button className="item">
        <span className="mono">{image ?? "—"} · {idx}/{images.length}</span>
      </button>
      <span className="item">
        {TOOL_GLYPH[tool]} <span>{t(TOOL_LABEL[tool])}</span>
      </span>
      <span className="sp" />
      <span className="item mono">
        x {coords.x} · y {coords.y}
      </span>
      <span className="item mono">
        {head ? (
          <>
            {lang === "zh" ? head.label_zh : head.label_en}{" "}
            <b>{Math.abs(head.value) < 10 ? head.value.toFixed(3) : head.value.toFixed(1)}</b> {head.unit}
          </>
        ) : (
          "—"
        )}
      </span>
      <button className="item" onClick={() => setView("market")}>
        ● <span className="mono" style={{ color: "#bfe" }}>{model}</span>
      </button>
      <button className="item" onClick={toggle} title="language">
        {lang === "en" ? "EN" : "中"}
      </button>
    </div>
  );
}
