import { Component, useState, type ErrorInfo, type ReactNode } from "react";

import { useI18n } from "../i18n";
import { Icon } from "./Icon";
import { ICONS } from "./iconMap";

// 局部错误边界：单个区域抛错时显示体面兜底（信任可见 G5），而非把整个 UI 打成黑屏 / 死 DOM。
// fallback 拆成函数组件以复用 i18n；原始堆栈折叠进「详情」，不把技术信息直接甩给非开发用户。
interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  error: Error | null;
}

function ErrorFallback({ error, onReset }: { error: Error; onReset: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(`${error.message}\n\n${error.stack ?? ""}`).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {
        /* 剪贴板不可用时静默 */
      },
    );
  };

  return (
    <div className="err-boundary" role="alert">
      <div className="err-mark">
        <Icon icon={ICONS.warning} size="lg" />
      </div>
      <div className="err-title">{t("err_title")}</div>
      <div className="err-hint">{t("err_hint")}</div>
      <div className="err-actions">
        <button type="button" className="err-btn primary" onClick={onReset}>
          {t("err_retry")}
        </button>
        <button type="button" className="err-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {t("err_details")}
        </button>
      </div>
      {open && (
        <div className="err-details">
          <div className="err-details-head">
            <button type="button" className="err-btn" onClick={copy}>
              {copied ? t("err_copied") : t("err_copy")}
            </button>
          </div>
          <pre className="mono">{error.message}{error.stack ? `\n\n${error.stack}` : ""}</pre>
        </div>
      )}
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", this.props.label, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return <ErrorFallback error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}
