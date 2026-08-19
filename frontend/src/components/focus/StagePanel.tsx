import { reRunActiveModel } from "../../data/actions";
import { useI18n } from "../../i18n";
import { useSession, type Tool } from "../../store/session";
import { ErrorBoundary } from "../ErrorBoundary";
import { Viewer } from "../Viewer";

// 图像舞台（SDD feats/01 §8）——Focus 的一等区域：同步核对回路的落点（纲领 G4）。
// 复用查看器引擎与任务注册表工具（同 Editor 的派生规则），不复用 tabs/breadcrumb 等 IDE chrome。
// 角标承接 StatusBar 的仪器信息（图名 · 标定 · 坐标 · 来源，D8）；度量摘要卡为 v0 落点（SDD §7-4）。
export function StagePanel() {
  const { t, lang } = useI18n();
  const modality = useSession((s) => s.modality);
  const tasks = useSession((s) => s.tasks);
  const activeImage = useSession((s) => s.activeImage);
  const activeVolume = useSession((s) => s.activeVolume);
  const activeSlide = useSession((s) => s.activeSlide);
  const cf = useSession((s) => s.imageMeta?.cf ?? null);
  const coords = useSession((s) => s.coords);
  const loading = useSession((s) => s.loading);
  const tool = useSession((s) => s.tool);
  const setTool = useSession((s) => s.setTool);
  const metrics = useSession((s) => s.metrics);
  const source = useSession((s) => s.source);
  const modelVersion = useSession((s) => s.modelVersion);

  const image = activeImage ?? activeVolume ?? activeSlide;
  const tv = tasks.find((tk) => tk.modality === modality);
  const tools = tv?.tools ?? [];

  // reset 语义与 Editor.onTool 一致：回光标 + 重跑活动模型（结果直接体现在舞台度量摘要）
  const onTool = (id: Tool) => {
    if (id === "reset") {
      setTool("cursor");
      void reRunActiveModel();
      return;
    }
    setTool(id);
  };

  // 度量摘要（注册表顺序，仅列 store.metrics 里存在的项）
  const entries = tv && metrics ? tv.metrics.map((m) => metrics[m.key]).filter(Boolean) : [];

  // v1.1（SDD 01 D13）：无活动图不再整块消失，显示占位引导（下一步去文件标签 / 顶栏选图）
  if (!image) {
    return (
      <section className="focus-stage" aria-label={t("focus_stage")}>
        <div className="focus-stage-empty">
          <span aria-hidden="true">▣</span>
          <p>{t("focus_stage_empty")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="focus-stage" aria-label={t("focus_stage")}>
      <div className="focus-stage-tools" role="toolbar">
        {tools.map((tl) => (
          <button
            key={tl.id}
            className="focus-tool"
            aria-pressed={tool === tl.id}
            title={tl.label[lang]}
            onClick={() => onTool(tl.id as Tool)}
          >
            {tl.glyph} <span>{tl.label[lang]}</span>
          </button>
        ))}
        <span className="focus-stage-grow" />
        {loading && <span className="focus-stage-busy"><span className="spin" aria-hidden="true">⟳</span> {t("running")}</span>}
      </div>
      {entries.length > 0 && (
        <div className="focus-stage-metrics">
          {entries.map((m) => (
            <span key={m.label_en} className="focus-metric mono">
              <b>{Math.abs(m.value) < 10 ? m.value.toFixed(3) : m.value.toFixed(1)}</b>
              <i>{m.unit}</i>
              <span>{lang === "zh" ? m.label_zh : m.label_en}</span>
            </span>
          ))}
          <span className={"focus-src" + (source === "human" ? " human" : "")}>
            {t(source === "human" ? "focus_src_human" : "focus_src_agent")}
          </span>
        </div>
      )}
      <div className="focus-stage-canvas">
        <ErrorBoundary label="stage">
          <Viewer />
        </ErrorBoundary>
        <span className="focus-stage-meta mono">
          {image ?? "—"}
          {cf != null && ` · CF ${cf} mm/px`}
          {` · x ${coords.x} y ${coords.y}`}
          {modelVersion && ` · ${modelVersion}`}
        </span>
      </div>
    </section>
  );
}
