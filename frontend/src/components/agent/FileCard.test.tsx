// SDD 14 §7.4 规则 7：read_file 不改 focus 与 document，由用户点「在舞台打开」。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { useSession } from "../../store/session";
import { FileCard, parseFileRead } from "./FileCard";

const details = {
  kind: "glaux.file_read",
  path: "notes/report.md",
  name: "report.md",
  start_line: 1,
  end_line: 400,
  eof: false,
  total_lines: null,
};

function renderCard(payload = parseFileRead(details)!) {
  return render(
    <I18nProvider>
      <FileCard payload={payload} />
    </I18nProvider>,
  );
}

describe("FileCard", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({ document: null, documentError: null, documentLoading: false, focus: null, uiMode: "focus" });
    useSession.getState().setFocusLayout({ rightOpen: false, sideView: "atlas" });
  });

  it("解析 read_file 的 details，形状不符返回 null", () => {
    expect(parseFileRead(details)).toEqual({
      path: "notes/report.md",
      name: "report.md",
      start_line: 1,
      end_line: 400,
      eof: false,
      total_lines: null,
    });
    expect(parseFileRead({ ...details, name: undefined })?.name).toBe("report.md");
    expect(parseFileRead({ ...details, kind: "glaux.object_opened" })).toBeNull();
    expect(parseFileRead({ ...details, path: 3 })).toBeNull();
    expect(parseFileRead({ ...details, start_line: "1" })).toBeNull();
    expect(parseFileRead(null)).toBeNull();
  });

  it("显示读取的行区间；读完时写总行数", () => {
    const first = renderCard();
    expect(screen.getByText("Read lines 1–400")).toBeInTheDocument();
    first.unmount();
    renderCard(parseFileRead({ ...details, start_line: 801, end_line: 1000, eof: true, total_lines: 1000 })!);
    expect(screen.getByText("Read lines 801–1000 of 1000")).toBeInTheDocument();
  });

  it("点「在舞台打开」才设置 document，并展开舞台；focus 不变", () => {
    const focus = { object_id: "x", kind: "image" as const, index: {}, region: null };
    useSession.setState({ focus });
    renderCard();
    expect(useSession.getState().document).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open on stage" }));
    expect(useSession.getState().document).toEqual({ path: "notes/report.md" });
    expect(useSession.getState().focus).toBe(focus);
    expect(useSession.getState().focusLayout).toMatchObject({ rightOpen: true, sideView: "stage" });
    expect(screen.getByRole("button", { name: "On stage" })).toBeDisabled();
  });

  it("该文件读取失败时卡片内提示", () => {
    useSession.setState({ documentError: { path: "notes/report.md", code: "not_found" } });
    renderCard();
    expect(screen.getByRole("alert")).toHaveTextContent("File not found");
  });
});
