// SDD 14 §7.3 规则 4、§13：语言选择与挂载冒烟。jsdom 缺布局测量，只验证编辑器能建起来、只读、
// 语言包加载失败时退回无高亮；高亮、查找与主题色靠浏览器走查。
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CodeView, codeLanguageOf } from "./CodeView";

vi.mock("@codemirror/lang-python", () => {
  throw new Error("chunk load failed");
});

describe("codeLanguageOf", () => {
  it("按扩展名选语言，大小写不敏感，其余不高亮", () => {
    expect(codeLanguageOf("a.py")).toBe("python");
    expect(codeLanguageOf("A.JSON")).toBe("json");
    expect(codeLanguageOf("n.ipynb")).toBe("json");
    expect(codeLanguageOf("r.markdown")).toBe("markdown");
    expect(codeLanguageOf("c.yml")).toBe("yaml");
    expect(codeLanguageOf("m.cjs")).toBe("javascript");
    expect(codeLanguageOf("v.tsx")).toBe("tsx");
    expect(codeLanguageOf("t.ts")).toBe("typescript");
    expect(codeLanguageOf("x.toml")).toBeNull();
    expect(codeLanguageOf("Makefile")).toBeNull();
  });
});

describe("CodeView", () => {
  it("语言包加载失败时仍以只读编辑器显示正文", async () => {
    const { container } = render(<CodeView doc={"print(1)\nx = 2"} language="python" />);
    await waitFor(() => expect(container.querySelector(".cm-editor")).not.toBeNull());
    const content = container.querySelector(".cm-content")!;
    expect(content).toHaveAttribute("contenteditable", "false");
    expect(content.textContent).toContain("print(1)");
    expect(container.querySelector(".cm-lineNumbers")).not.toBeNull();
  });

  it("正文变化时整体替换", async () => {
    const { container, rerender } = render(<CodeView doc="one" language={null} />);
    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toBe("one"));
    rerender(<CodeView doc="two" language={null} />);
    await waitFor(() => expect(container.querySelector(".cm-content")?.textContent).toBe("two"));
  });
});
