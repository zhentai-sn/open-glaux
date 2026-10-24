import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("表格包在滚动容器里，宽表不撑破阅读列", () => {
    const { container } = render(<Markdown text={"| a | b |\n| - | - |\n| 1 | 2 |"} />);
    const wrapper = container.querySelector(".md-table");
    expect(wrapper).not.toBeNull();
    expect(wrapper?.querySelector("table")).not.toBeNull();
    expect(wrapper).toHaveTextContent("1");
  });

  it("标题与正文照常渲染", () => {
    const { container } = render(<Markdown text={"## 结果\n\n正文"} />);
    expect(container.querySelector("h2")).toHaveTextContent("结果");
    expect(container.querySelector("p")).toHaveTextContent("正文");
  });
});
