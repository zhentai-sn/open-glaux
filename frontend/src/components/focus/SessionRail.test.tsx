// 左侧栏右侧栏入口（SDD feats/01 v1.6 D20/D22、v1.7 D23，活动栏式）：舞台 / 文件 / 图谱 / 设置的按下态与点击语义。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import { FOCUS_LAYOUT_DEFAULTS, useSession, type FocusLayout } from "../../store/session";

vi.mock("../agent/SessionDrawer", () => ({ SessionDrawer: () => null }));

import { SessionRail } from "./SessionRail";

const start = (p: Partial<FocusLayout>) => useSession.setState({ focusLayout: { ...FOCUS_LAYOUT_DEFAULTS, ...p } });
const layout = () => useSession.getState().focusLayout;
const btn = (name: string) => screen.getByRole("button", { name });

describe("SessionRail 右侧栏入口", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    start({ rightOpen: false });
    render(<I18nProvider><SessionRail /></I18nProvider>);
  });

  it("舞台：收起 → 展开舞台；舞台 + 文件列 → 收掉文件列；只剩舞台 → 收起", () => {
    expect(btn("Stage")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn("Stage"));
    expect(layout()).toMatchObject({ rightOpen: true, sideView: "stage", browserView: null });
    expect(btn("Stage")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(btn("Files"));
    expect(layout()).toMatchObject({ rightOpen: true, sideView: "stage", browserView: "files" });
    fireEvent.click(btn("Stage"));
    expect(layout()).toMatchObject({ rightOpen: true, browserView: null });
    fireEvent.click(btn("Stage"));
    expect(layout().rightOpen).toBe(false);
  });

  it("舞台：从图谱态或带文件列的收起态点击 → 纯舞台（窄屏降级时文件列不会盖住舞台）", () => {
    start({ rightOpen: false, sideView: "atlas", browserView: "files" });
    fireEvent.click(btn("Stage"));
    expect(layout()).toMatchObject({ rightOpen: true, sideView: "stage", browserView: null });
  });

  it("文件：从图谱态点击 → 回到舞台并打开文件列；再点 → 只关文件列", () => {
    fireEvent.click(btn("Atlas"));
    fireEvent.click(btn("Files"));
    expect(layout()).toMatchObject({ rightOpen: true, sideView: "stage", browserView: "files" });
    expect(btn("Files")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(btn("Files"));
    expect(layout()).toMatchObject({ rightOpen: true, sideView: "stage", browserView: null });
  });

  it("设置：点击换成设置工作区；再点 → 收起右侧栏", () => {
    fireEvent.click(btn("Settings"));
    expect(layout()).toMatchObject({ rightOpen: true, sideView: "settings" });
    expect(btn("Settings")).toHaveAttribute("aria-pressed", "true");
    expect(btn("Stage")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn("Settings"));
    expect(layout().rightOpen).toBe(false);
  });

  it("图谱：点击换成图谱工作区（不改文件列开合）；再点 → 收起右侧栏", () => {
    start({ rightOpen: true, browserView: "files" });
    fireEvent.click(btn("Atlas"));
    expect(layout()).toMatchObject({ rightOpen: true, sideView: "atlas", browserView: "files" });
    expect(btn("Atlas")).toHaveAttribute("aria-pressed", "true");
    expect(btn("Stage")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(btn("Atlas"));
    expect(layout().rightOpen).toBe(false);
  });
});
