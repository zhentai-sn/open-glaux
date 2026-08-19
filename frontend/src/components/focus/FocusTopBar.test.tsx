// Focus 顶栏（SDD feats/01 v1.2 §15 / D14）：上下文区为只读 chip——显示「模态 · 当前对象」、
// 点击展开右侧栏「文件」标签且不改活动对象、无活动对象时显示提示态、顶栏不再有任何 <select>。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import type { TaskView } from "../../api/types";
import { useSession } from "../../store/session";

vi.mock("../agent/ConnectionConfig", () => ({ ConnectionConfig: () => <div /> }));

import { FocusTopBar } from "./FocusTopBar";

const TASKS = [
  { modality: "carotid_imt", label: { zh: "颈动脉远壁 IMT", en: "Carotid far-wall IMT" } },
  { modality: "ct_abdomen", label: { zh: "肝+双肾", en: "Liver + kidneys" } },
] as unknown as TaskView[];

function ui() {
  return render(
    <I18nProvider>
      <FocusTopBar configOpen={false} onConfigToggle={() => {}} />
    </I18nProvider>,
  );
}

describe("FocusTopBar 图像上下文 chip", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("glaux.lang", "en");
    useSession.setState({
      uiMode: "focus",
      focusLayout: { railOpen: false, rightOpen: false, rightView: "stage" },
      tasks: TASKS,
      modality: "carotid_imt",
      activeImage: "tech_401",
      activeVolume: null,
      activeSlide: null,
    });
  });

  it("显示「模态 · 当前对象」，且顶栏不再有下拉选择器", () => {
    const { container } = ui();
    const chip = screen.getByRole("button", { name: /Current image context/ });
    expect(chip).toHaveTextContent("Carotid far-wall IMT");
    expect(chip).toHaveTextContent("tech_401");
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });

  it("点击展开右侧栏并切到「文件」标签，且不改活动对象", () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: /Current image context/ }));
    expect(useSession.getState().focusLayout).toMatchObject({ rightOpen: true, rightView: "files" });
    expect(useSession.getState().activeImage).toBe("tech_401");
  });

  it("无活动对象时呈现提示态", () => {
    useSession.setState({ activeImage: null });
    ui();
    const chip = screen.getByRole("button", { name: /Current image context/ });
    expect(chip).toHaveTextContent("Select image…");
    expect(chip.className).toContain("empty");
  });

  it("活动对象随模态派生：CT 下读 activeVolume", () => {
    useSession.setState({ modality: "ct_abdomen", activeImage: null, activeVolume: "ct_012" });
    ui();
    const chip = screen.getByRole("button", { name: /Current image context/ });
    expect(chip).toHaveTextContent("Liver + kidneys");
    expect(chip).toHaveTextContent("ct_012");
  });
});
