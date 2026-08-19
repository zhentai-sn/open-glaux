// 错误边界（信任可见 G5）：子组件抛错时兜底为可重载面板而非黑屏；retry 后恢复正常渲染。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { ErrorBoundary } from "./ErrorBoundary";

// 受控抛错子组件：shouldThrow 为真时渲染即抛，用于触发边界。
function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("kaboom-测试崩溃");
  return <div>正常内容 ok-content</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    // 抑制 React 抛错时的噪声堆栈输出，保持测试日志干净。
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("子组件抛错时渲染 i18n 兜底而非崩整棵树", () => {
    render(
      <I18nProvider>
        <ErrorBoundary label="test">
          <Boom shouldThrow />
        </ErrorBoundary>
      </I18nProvider>,
    );
    // 兜底文案（i18n，非英文 raw）出现，且提供重载入口
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/stopped responding/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload section/i })).toBeInTheDocument();
  });

  it("详情默认折叠，点开后显示技术堆栈", () => {
    render(
      <I18nProvider>
        <ErrorBoundary label="test">
          <Boom shouldThrow />
        </ErrorBoundary>
      </I18nProvider>,
    );
    expect(screen.queryByText(/kaboom-测试崩溃/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Technical details/i }));
    expect(screen.getByText(/kaboom-测试崩溃/)).toBeInTheDocument();
  });

  it("修因后点 retry：同一边界重渲染子树，恢复正常内容", () => {
    // 外部可变标志模拟"崩溃原因被修复"：retry 调用 reset() 触发子树重渲染，此时不再抛错。
    let throwNow = true;
    function Flaky() {
      if (throwNow) throw new Error("kaboom-测试崩溃");
      return <div>ok-content</div>;
    }
    render(
      <I18nProvider>
        <ErrorBoundary label="test">
          <Flaky />
        </ErrorBoundary>
      </I18nProvider>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    throwNow = false; // 原因已修复
    fireEvent.click(screen.getByRole("button", { name: /Reload section/i }));
    expect(screen.getByText(/ok-content/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
