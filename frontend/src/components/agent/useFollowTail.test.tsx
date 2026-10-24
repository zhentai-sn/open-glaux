import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";

import { useFollowTail } from "./useFollowTail";

function Harness({
  revision,
  enabled = true,
  resetKey = "s1",
}: {
  revision: number;
  enabled?: boolean;
  resetKey?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { following, jumpToLatest } = useFollowTail(ref, { revision, enabled, resetKey });
  return (
    <div>
      <div data-testid="stream" ref={ref} />
      <output data-testid="following">{String(following)}</output>
      <button type="button" onClick={jumpToLatest}>jump</button>
    </div>
  );
}

// jsdom 不布局：手动给出滚动高度与视口高度。
function measure(el: HTMLElement, scrollTop: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: 400 });
  el.scrollTop = scrollTop;
}

describe("useFollowTail", () => {
  it("贴近底部时跟随新内容", async () => {
    const { rerender } = render(<Harness revision={0} />);
    const stream = screen.getByTestId("stream");
    measure(stream, 600);
    rerender(<Harness revision={1} />);
    await waitFor(() => expect(stream.scrollTop).toBe(1000));
  });

  it("向上滚动后暂停跟随", async () => {
    const { rerender } = render(<Harness revision={0} />);
    const stream = screen.getByTestId("stream");
    measure(stream, 300);
    fireEvent.scroll(stream);
    expect(screen.getByTestId("following")).toHaveTextContent("false");
    rerender(<Harness revision={1} />);
    await waitFor(() => expect(stream.scrollTop).toBe(300));
  });

  it("jump 回到底部并恢复跟随", () => {
    render(<Harness revision={0} />);
    const stream = screen.getByTestId("stream");
    measure(stream, 300);
    fireEvent.scroll(stream);
    fireEvent.click(screen.getByRole("button", { name: "jump" }));
    expect(stream.scrollTop).toBe(1000);
    expect(screen.getByTestId("following")).toHaveTextContent("true");
  });

  it("关闭跟随后新内容不再贴底", async () => {
    const { rerender } = render(<Harness revision={0} enabled={false} />);
    const stream = screen.getByTestId("stream");
    measure(stream, 300);
    rerender(<Harness revision={1} enabled={false} />);
    await waitFor(() => expect(stream.scrollTop).toBe(300));
    expect(screen.getByTestId("following")).toHaveTextContent("false");
  });

  it("切会话立即回到底部", () => {
    const { rerender } = render(<Harness revision={0} />);
    const stream = screen.getByTestId("stream");
    measure(stream, 300);
    fireEvent.scroll(stream);
    rerender(<Harness revision={0} resetKey="s2" />);
    expect(stream.scrollTop).toBe(1000);
  });
});
