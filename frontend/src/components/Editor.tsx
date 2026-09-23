import { ErrorBoundary } from "./ErrorBoundary";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";
import { Viewer } from "./Viewer";
import { ViewerChrome } from "./ViewerChrome";
import { currentTaskView, reRunActiveModel } from "../data/actions";
import { datasourceOf, displayName, mmPerPx } from "../data/objectInfo";
import { useI18n } from "../i18n";
import { activeObject, useSession, type Tool } from "../store/session";

export function Editor() {
  const { t, lang } = useI18n();
  const obj = useSession((s) => activeObject(s));
  const image = obj ? displayName(obj) : null;
  const source = useSession((s) => datasourceOf(s.datasources, obj)?.name ?? "dataset");
  const cf = mmPerPx(obj);
  const loading = useSession((s) => s.loading);
  const setTool = useSession((s) => s.setTool);
  const modelVersion = useSession((s) => s.modelVersion);

  // 当前对象的任务（注册表）——标签从这里来；工具栏/选项条由 ViewerChrome 统一渲染，不再 if 模态。
  const tv = useSession((s) => currentTaskView(s));
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
        <span>{source}</span>
        <span>{t("exp_objects")}</span>
        <span style={{ color: "var(--ink)" }}>{image ?? "—"}</span>
      </div>

      <div className="editor" data-viewer-surface>
        {image ? (
          <>
            <ErrorBoundary label="canvas"><Viewer /></ErrorBoundary>
            <div className="hud">
              {label && <span className="tagpill">{label}</span>}
              {cf != null && <span className="tagpill mono">CF {cf} mm/px</span>}
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
