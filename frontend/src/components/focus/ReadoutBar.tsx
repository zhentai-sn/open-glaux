import { useI18n } from "../../i18n";
import type { EditorChrome } from "../../viewer/editorChrome";

// 读数条（SDD 04 §7.5）：注册表顺序的度量 + 复现结果 + 来源角标，只读。
// 只在 Focus 舞台渲染；Workbench 读数由底部面板承载（D-27）。无度量且无复现结果时不渲染。
export function ReadoutBar({ readout }: { readout: EditorChrome["readout"] }) {
  const { t, lang } = useI18n();
  const { metrics, source, verification } = readout;
  if (metrics.length === 0 && !verification) return null;
  const f1Tone = verification ? (verification.f1 >= 0.95 ? "good" : verification.f1 >= 0.85 ? "warn" : "bad") : "";
  return (
    <div className="focus-stage-metrics">
      {metrics.map((m) => (
        <span key={m.label_en} className="focus-metric mono">
          <b>{Math.abs(m.value) < 10 ? m.value.toFixed(3) : m.value.toFixed(1)}</b>
          <i>{m.unit}</i>
          <span>{lang === "zh" ? m.label_zh : m.label_en}</span>
        </span>
      ))}
      {verification && (
        <span className={`focus-verify mono ${f1Tone}`}>
          {t("readout_verify", {
            f1: verification.f1.toFixed(2),
            pred: verification.count_pred,
            ref: verification.count_ref,
          })}
        </span>
      )}
      <span className={"focus-src" + (source === "human" ? " human" : "")}>
        {t(source === "human" ? "focus_src_human" : "focus_src_agent")}
      </span>
    </div>
  );
}
