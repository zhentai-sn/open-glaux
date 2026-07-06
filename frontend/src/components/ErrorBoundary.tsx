import { Component, type ErrorInfo, type ReactNode } from "react";

// 局部错误边界：单个组件抛错时显示兜底，而非把整个 UI 打成"死 DOM"（按钮全失效）。
interface Props {
  children: ReactNode;
  label?: string;
}
interface State {
  error: Error | null;
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
      return (
        <div style={{ padding: 20, color: "var(--crit)", fontSize: 12, textAlign: "center" }}>
          <div style={{ marginBottom: 8 }}>⚠ {this.props.label ?? "component"} error</div>
          <div style={{ color: "var(--faint)", marginBottom: 10, maxWidth: 360 }}>
            {this.state.error.message}
          </div>
          <button
            onClick={this.reset}
            style={{
              border: "1px solid var(--line2)",
              borderRadius: 5,
              padding: "5px 12px",
              color: "var(--ink)",
              background: "var(--input)",
            }}
          >
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
