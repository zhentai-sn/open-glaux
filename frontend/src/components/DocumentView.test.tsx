// SDD 14 §7.3、§11.2：文档视图的分派、Markdown 安全渲染、JSON 格式化、截断提示与失败回退。
// jsdom 不支持 CodeMirror 的布局测量，这里用纯文本替身代替 CodeView（真实渲染靠浏览器走查）。
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, api } from "../api/client";
import type { ProjectText } from "../api/types";
import { I18nProvider } from "../i18n";
import { useAgentSessions } from "../store/agentSessions";
import { useSession } from "../store/session";
import { DocumentView, PREVIEW_MAX_BYTES, formatJson, renderKindOf } from "./DocumentView";

vi.mock("./CodeView", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./CodeView")>()),
  CodeView: ({ doc, language }: { doc: string; language: string | null }) => (
    <pre data-testid="code" data-lang={language ?? ""}>
      {doc}
    </pre>
  ),
}));

function textOf(path: string, text: string, patch: Partial<ProjectText> = {}): ProjectText {
  const lines = text ? text.split("\n").length - (text.endsWith("\n") ? 1 : 0) : 0;
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    size: text.length,
    encoding: "utf-8",
    start_line: 1,
    end_line: lines,
    text,
    eof: true,
    total_lines: lines,
    line_truncated: false,
    ...patch,
  };
}

function renderDoc(path: string) {
  useSession.setState({ document: { path } });
  return render(
    <I18nProvider>
      <DocumentView />
    </I18nProvider>,
  );
}

describe("renderKindOf", () => {
  it("按扩展名分派，大小写不敏感", () => {
    expect(renderKindOf("README.md")).toBe("markdown");
    expect(renderKindOf("notes.MARKDOWN")).toBe("markdown");
    expect(renderKindOf("a.json")).toBe("json");
    expect(renderKindOf("run.IPYNB")).toBe("json");
    expect(renderKindOf("x.py")).toBe("code");
    expect(renderKindOf("data.csv")).toBe("code");
    expect(renderKindOf("Makefile")).toBe("code");
  });

  it("formatJson 非法 JSON 原样返回", () => {
    expect(formatJson('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(formatJson("{bad")).toBe("{bad");
  });
});

describe("DocumentView", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    vi.restoreAllMocks();
    useAgentSessions.setState({
      sessions: [{ session_id: "s1", project_id: "prj-a" } as never],
      currentSessionId: "s1",
    });
    useSession.setState({ document: null, documentError: null, documentLoading: false, focus: null });
  });

  it("按当前会话的项目请求前 1 MiB，顶栏显示名称、路径、大小与编码", async () => {
    const spy = vi.spyOn(api, "projectText").mockResolvedValue(textOf("src/run.py", "print(1)\n"));
    renderDoc("src/run.py");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByTestId("code")).toHaveTextContent("print(1)");
    expect(spy).toHaveBeenCalledWith("prj-a", "src/run.py", { maxBytes: PREVIEW_MAX_BYTES });
    expect(screen.getByTestId("code").textContent).toBe("print(1)"); // 末尾 \n 去掉，避免多一空行
    expect(screen.getByTestId("code")).toHaveAttribute("data-lang", "python");
    expect(screen.getByText("run.py")).toBeInTheDocument();
    expect(screen.getByText(/src\/run\.py · 9 B · UTF-8/)).toBeInTheDocument();
    expect(useSession.getState().documentLoading).toBe(false);
  });

  it("Markdown 不渲染 <script> 与 <img onerror>，相对图片无请求，链接按协议处理", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const md = [
      "# Title",
      "",
      "| a | b |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "- [x] done",
      "",
      "<script>window.__pwned = 1</script>",
      "",
      '<img src=x onerror="window.__pwned = 2">',
      "",
      "![chart](./figs/chart.png)",
      "",
      "[site](https://example.com/a) [local](./other.md) [js](javascript:alert(1))",
      "",
    ].join("\n");
    vi.spyOn(api, "projectText").mockResolvedValue(textOf("README.md", md));
    const { container } = renderDoc("README.md");
    expect(await screen.findByRole("heading", { name: "Title" })).toBeInTheDocument();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("chart")).toHaveClass("docview-img-alt");
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled(); // projectText 已替身，其余一律不应发请求

    const site = screen.getByText("site").closest("a")!;
    expect(site).toHaveAttribute("href", "https://example.com/a");
    expect(site).toHaveAttribute("target", "_blank");
    expect(site).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText("local").closest("a")).toBeNull();
    expect(screen.getByText("js").closest("a")).toBeNull();
  });

  it("Markdown 可切到源码视图", async () => {
    vi.spyOn(api, "projectText").mockResolvedValue(textOf("README.md", "# T\n"));
    renderDoc("README.md");
    fireEvent.click(await screen.findByRole("radio", { name: "Source" }));
    expect(screen.getByTestId("code")).toHaveTextContent("# T");
    expect(screen.getByTestId("code")).toHaveAttribute("data-lang", "markdown");
  });

  it("JSON 未截断时格式化，非法 JSON 按原文显示", async () => {
    vi.spyOn(api, "projectText").mockResolvedValueOnce(textOf("a.json", '{"k":1}\n'));
    const first = renderDoc("a.json");
    expect(await screen.findByTestId("code")).toHaveTextContent('{ "k": 1 }');
    expect(screen.getByTestId("code").textContent).toBe('{\n  "k": 1\n}');
    first.unmount();

    vi.spyOn(api, "projectText").mockResolvedValueOnce(textOf("b.json", "{oops\n"));
    renderDoc("b.json");
    await waitFor(() => expect(screen.getByTestId("code").textContent).toBe("{oops"));
  });

  it("未读到末尾时显示截断提示，JSON 不格式化", async () => {
    vi.spyOn(api, "projectText").mockResolvedValue(
      textOf("big.json", '{"a":\n', { eof: false, total_lines: null }),
    );
    renderDoc("big.json");
    expect(await screen.findByRole("note")).toHaveTextContent("first 1 MiB");
    expect(screen.getByTestId("code").textContent).toBe('{"a":');
  });

  it("单行被字节上限截断（eof 为真）同样显示截断提示", async () => {
    vi.spyOn(api, "projectText").mockResolvedValue(
      textOf("min.js", "x".repeat(20), { eof: true, total_lines: 1, line_truncated: true }),
    );
    renderDoc("min.js");
    expect(await screen.findByRole("note")).toBeInTheDocument();
  });

  it("未截断时不显示截断提示", async () => {
    vi.spyOn(api, "projectText").mockResolvedValue(textOf("a.txt", "hi\n"));
    renderDoc("a.txt");
    await screen.findByTestId("code");
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("读取失败时清空 document 并写入 documentError，focus 不变", async () => {
    const focus = { object_id: "x", kind: "image" as const, index: {}, region: null };
    useSession.setState({ focus });
    vi.spyOn(api, "projectText").mockRejectedValue(new ApiError(422, "binary", "binary"));
    renderDoc("pack.zip");
    await waitFor(() => expect(useSession.getState().document).toBeNull());
    expect(useSession.getState().documentError).toEqual({ path: "pack.zip", code: "binary" });
    expect(useSession.getState().focus).toBe(focus);
    expect(useSession.getState().documentLoading).toBe(false);
  });

  it("「关闭」清空 document", async () => {
    vi.spyOn(api, "projectText").mockResolvedValue(textOf("a.txt", "hi\n"));
    renderDoc("a.txt");
    fireEvent.click(await screen.findByRole("button", { name: "Close document" }));
    expect(useSession.getState().document).toBeNull();
  });

  it("切换文档时丢弃过期响应", async () => {
    let resolveFirst!: (v: ProjectText) => void;
    vi.spyOn(api, "projectText")
      .mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce(textOf("b.txt", "second\n"));
    renderDoc("a.txt");
    act(() => useSession.setState({ document: { path: "b.txt" } }));
    expect(await screen.findByTestId("code")).toHaveTextContent("second");
    await act(async () => resolveFirst(textOf("a.txt", "first\n")));
    expect(screen.getByTestId("code")).toHaveTextContent("second");
  });
});
