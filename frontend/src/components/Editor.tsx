import { ErrorBoundary } from "./ErrorBoundary";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";
import { Viewer } from "./Viewer";
import { ViewerChrome } from "./ViewerChrome";
import { reRunActiveModel } from "../data/actions";
import { useI18n } from "../i18n";
import { useSession, type Tool } from "../store/session";

export function Editor() {
  const { t, lang } = useI18n();
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const activeImage = useSession((s) => s.activeImage);
  const activeVolume = useSession((s) => s.activeVolume);
  const activeSlide = useSession((s) => s.activeSlide);
  // 2D 模态用 activeImage，3D（CT）用 activeVolume，WSI（病理）用 activeSlide——查看器/标签统一
  // 走「当前对象」，否则 CT/WSI 因 activeImage 恒 null 永远卡在空状态、对应 Viewer 从不挂载。
  const image = activeImage ?? activeVolume ?? activeSlide;
  const center = useSession((s) => s.imageMeta?.center ?? "dataset");
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const loading = useSession((s) => s.loading);
  const setTool = useSession((s) => s.setTool);
  const modelVersion = useSession((s) => s.modelVersion);

  // 当前模态对应任务（注册表）——标签从这里来；工具栏/选项条由 ViewerChrome 统一渲染，不再 if 模态。
  const tv = tasks.find((tk) => tk.modality === modality);
  const label = tv?.label[lang] ?? "";

  // reset：回光标 + 重跑活动模型（结果直接体现在叠加/度量面板，不再叙事）
  const onTool = (id: Tool) => {
    if (id === "reset") {
      setTool("cursor");
      void reRunActiveModel();
      return;
    }
    setTool(id);
  };

  return (
    <div className="editorpane">
      <div className="tabs">
        {image && (
          <div className="tab on">
            <Icon icon={ICONS.file} size="sm" className="fico" />
            {image}
          </div>
        )}
      </div>
      <div className="breadcrumb">
        <span>{center}</span>
        <span>images</span>
        <span style={{ color: "var(--ink)" }}>{image ?? "—"}</span>
      </div>

      <div className="editor" data-viewer-surface>
        {image ? (
          <>
            <ErrorBoundary label="canvas"><Viewer /></ErrorBoundary>
            <div className="hud">
              <span className="tagpill">{label}</span>
              <span className="tagpill mono">CF {cf ?? "—"} mm/px</span>
              {loading && <span className="tagpill" style={{ color: "var(--agent)" }}><Icon icon={ICONS.spinner} size="sm" className="spin" /></span>}
            </div>
            <ViewerChrome onTool={onTool} />
            {modelVersion && <span className="repr">{modelVersion}</span>}
            {loading && <span className="repr" style={{ left: "auto", right: 26, color: "var(--agent)", borderColor: "var(--agent-line)" }}><Icon icon={ICONS.spinner} size="sm" className="spin" /> {t("running")}</span>}
          </>
        ) : (
          <div className="empty">{t("empty_editor")}</div>
        )}
      </div>
    </div>
  );
}
