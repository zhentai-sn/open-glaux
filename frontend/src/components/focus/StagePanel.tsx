import { useRef } from "react";

import { displayName, mmPerPx } from "../../data/objectInfo";
import { useI18n } from "../../i18n";
import { activeObject, useSession } from "../../store/session";
import { ChromeSegments, chromeHintText, hasSegments } from "../../viewer/chromeSegments";
import { useEditorChrome } from "../../viewer/editorChrome";
import { DocumentView } from "../DocumentView";
import { EditorActions } from "../EditorActions";
import { ErrorBoundary } from "../ErrorBoundary";
import { Icon } from "../Icon";
import { FALLBACK_ICON, ICONS, TOOL_ICON } from "../iconMap";
import { Viewer } from "../Viewer";
import { ReadoutBar } from "./ReadoutBar";
import { useCompactToolbar } from "./useCompactToolbar";

// 图像舞台（SDD feats/01 §8）——Focus 的一等区域：同步核对回路的落点（纲领 G4）。
// 复用查看器引擎与任务注册表工具（同 Editor 的派生规则），不复用 tabs/breadcrumb 等 IDE chrome。
// 角标承接 StatusBar 的仪器信息（图名 · 标定 · 坐标 · 来源，D8）。
// 工具条与读数条经 useEditorChrome 装配（SDD 04 §6.4、§7.5）：模式 → 提示 → 模式选项 → 视图 →
// 弹性占位 → 动作 → 运行中；读数条在工具条下方。
// SDD 14 §7.3 规则 9：document 非空时文档视图覆盖整个舞台，查看器保持挂载；工具条与读数条隐藏但保留布局，
// 画布尺寸不变，关闭后缩放与窗位不受影响。
export function StagePanel() {
  const { t, lang } = useI18n();
  const obj = useSession((s) => activeObject(s));
  const cf = mmPerPx(obj);
  const coords = useSession((s) => s.coords);
  const loading = useSession((s) => s.loading);
  const setTool = useSession((s) => s.setTool);
  const modelVersion = useSession((s) => s.modelVersion);
  const docOpen = useSession((s) => s.document !== null);
  const stageClass = "focus-stage" + (docOpen ? " doc-open" : "");

  const image = obj ? displayName(obj) : null;
  const chrome = useEditorChrome();
  const hint = chromeHintText(chrome, t, lang);
  const toolsRef = useRef<HTMLDivElement>(null);
  const compact = useCompactToolbar(toolsRef);

  // v1.1（SDD 01 D13）：无活动图不再整块消失，显示占位引导（下一步去「文件」标签选图；v1.2/D14 起顶栏不再选图）
  if (!image) {
    return (
      <section className={stageClass} aria-label={t("focus_stage")}>
        <div className="focus-stage-empty">
          <Icon icon={ICONS.file} size="lg" />
          <p>{t("focus_stage_empty")}</p>
        </div>
        {docOpen && <DocumentView />}
      </section>
    );
  }

  return (
    <section className={stageClass} aria-label={t("focus_stage")}>
      <div ref={toolsRef} className={"focus-stage-tools" + (compact ? " compact" : "")} role="toolbar">
        {chrome.tools.map((tl) => (
          <button
            key={tl.id}
            className="focus-tool"
            aria-pressed={chrome.tool === tl.id}
            title={t(tl.label)}
            onClick={() => setTool(tl.id)}
          >
            <Icon icon={TOOL_ICON[tl.id] ?? FALLBACK_ICON} size="sm" /> <span>{t(tl.label)}</span>
          </button>
        ))}
        {hint && <span className="focus-stage-hint">{hint}</span>}
        {hasSegments(chrome) && <div className="focus-stage-options"><ChromeSegments chrome={chrome} /></div>}
        <span className="focus-stage-grow" />
        <EditorActions chrome={chrome} variant="focus" />
        {loading && <span className="focus-stage-busy"><Icon icon={ICONS.spinner} size="sm" className="spin" /> {t("running")}</span>}
      </div>
      <ReadoutBar readout={chrome.readout} />
      <div className="focus-stage-canvas" data-viewer-surface>
        <ErrorBoundary label="stage">
          <Viewer />
        </ErrorBoundary>
        <span className="focus-stage-meta mono">
          {image ?? "—"}
          {cf != null && ` · CF ${cf} mm/px`}
          {` · x ${coords.x} y ${coords.y}`}{coords.t != null && ` t ${coords.t}`}
          {modelVersion && ` · ${modelVersion}`}
        </span>
      </div>
      {docOpen && <DocumentView />}
    </section>
  );
}
