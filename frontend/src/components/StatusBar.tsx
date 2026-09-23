import { useI18n } from "../i18n";
import { useSession } from "../store/session";
import { Icon } from "./Icon";
import { TOOL_ICON } from "./iconMap";

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
  const naturalImages = useSession((s) => s.naturalImages);
  const setView = useSession((s) => s.setSidebarView);
  const shownImages = modality === "natural_image" ? naturalImages : images;
  const idx = image ? shownImages.findIndex((m) => m.id === image) + 1 : 0;
  // 头条度量（首个注册表度量）——状态栏泛型展示，不再硬写「IMT … mm」。
  const tv = tasks.find((tk) => tk.modality === modality);
  const head = (metrics && ((tv && metrics[tv.metrics[0]?.key]) || Object.values(metrics)[0])) || null;
  // SDD 04：工具文案改查注册表（删 TOOL_LABEL/TOOL_GLYPH 硬编码表）；图标走 SDD 06 的 TOOL_ICON
  const toolDef = tv?.tools.find((x) => x.id === tool);

  return (
    <div className="status">
      <span className="item" aria-label={lang === "zh" ? "分支：main" : "branch: main"}>
        <span aria-hidden="true">⎇</span> main
      </span>
      <span className="item" aria-label={lang === "zh" ? "当前图像" : "current image"}>
        <span className="mono">{image ?? "—"} · {idx}/{shownImages.length}</span>
      </span>
      <span className="item">
        <Icon icon={TOOL_ICON[tool]} size="sm" />{" "}
        <span>{toolDef ? toolDef.label[lang] : t("tl_cursor")}</span>
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
      {model && (
        <button className="item" onClick={() => setView("market")}>
          ● <span className="mono" style={{ color: "#bfe" }}>{model}</span>
        </button>
      )}
      <button className="item" onClick={toggle} title="language">
        {lang === "en" ? "EN" : "中"}
      </button>
    </div>
  );
}
