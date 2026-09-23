// Focus 顶栏（SDD feats/01 v1.2 §15 / D14）：上下文区为只读 chip——显示「模态 · 当前对象」、
// 点击展开右侧栏「文件」标签且不改活动对象、无活动对象时显示提示态、顶栏不再有任何 <select>。
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import type { DataSource, Focus } from "../../api/types";
import { useSession } from "../../store/session";
import { dsFields, KIND_OF } from "../../test/fixtures";

vi.mock("../agent/ConnectionConfig", () => ({ ConnectionConfig: () => <div /> }));

import { FocusTopBar } from "./FocusTopBar";

// 模态标签来自数据源的 label_key（SDD 10 D-22），不来自任务注册表。
const DS: DataSource[] = ["carotid_imt", "ct_abdomen", "natural_image"].map((m) => ({
  id: m,
  name: m,
  modality: m as DataSource["modality"],
  root: "/r",
  origin: "builtin",
  calibration: {},
  status: "active",
  ...dsFields(m),
}));

const focusOn = (id: string, modality: string): Focus => ({
  object_id: id,
  kind: KIND_OF[modality],
  index: {},
  region: null,
});

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
      focusLayout: { railOpen: false, rightOpen: false, browserView: null, browserW: null, railW: null, sideW: null },
      tasks: [],
      datasources: DS,
      modality: "carotid_imt",
      focus: focusOn("tech_401", "carotid_imt"),
    });
  });

  it("显示「模态 · 当前对象」，且顶栏不再有下拉选择器", () => {
    const { container } = ui();
    const chip = screen.getByRole("button", { name: /Current image context/ });
    expect(chip).toHaveTextContent("Carotid ultrasound");
    expect(chip).toHaveTextContent("tech_401");
    expect(container.querySelectorAll("select")).toHaveLength(0);
  });

  it("点击展开右侧栏并切到「文件」标签，且不改活动对象", () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: /Current image context/ }));
    expect(useSession.getState().focusLayout).toMatchObject({ rightOpen: true, browserView: "files" });
    expect(useSession.getState().focus?.object_id).toBe("tech_401");
  });

  it("无活动对象时呈现提示态", () => {
    useSession.setState({ focus: null });
    ui();
    const chip = screen.getByRole("button", { name: /Current image context/ });
    expect(chip).toHaveTextContent("Select image…");
    expect(chip.className).toContain("empty");
  });

  it("活动对象即唯一焦点：CT 下同样读 focus.object_id", () => {
    useSession.setState({ modality: "ct_abdomen", focus: focusOn("ct_012", "ct_abdomen") });
    ui();
    const chip = screen.getByRole("button", { name: /Current image context/ });
    expect(chip).toHaveTextContent("Abdominal CT");
    expect(chip).toHaveTextContent("ct_012");
  });

  it("自然图像显示中性模态标签，不依赖医学任务注册表", () => {
    useSession.setState({ modality: "natural_image", focus: focusOn("natural_cat", "natural_image") });
    ui();
    const chip = screen.getByRole("button", { name: /Current image context/ });
    expect(chip).toHaveTextContent("General images");
    expect(chip).toHaveTextContent("natural_cat");
    expect(chip).not.toHaveTextContent("Carotid");
  });
});
