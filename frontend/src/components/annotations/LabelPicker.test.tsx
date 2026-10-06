// 标签弹层（SDD 23 §7.2）：搜索、键盘选择、新建、Esc 取消。
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Label } from "../../api/types";
import { I18nProvider } from "../../i18n";
import { useLabels } from "../../store/labels";
import { LabelPickerHost } from "./LabelPicker";

const FOLD: Label = { id: "lbl-1", scope: "global", name: "组织折叠", color: "#E4572E", description: "", sort: 0, seq: 1, count: 0 };
const BLEED: Label = { ...FOLD, id: "lbl-2", name: "出血", sort: 1 };

function open(prefill = "") {
  let result: Promise<Label | null> = Promise.resolve(null);
  act(() => {
    result = useLabels.getState().requestLabel("img-1", { prefill, setCurrent: true });
  });
  return result;
}

beforeEach(() => {
  useLabels.setState({ objectId: "img-1", scope: "global", labels: [FOLD, BLEED], currentByScope: {}, request: null });
  render(<I18nProvider><LabelPickerHost /></I18nProvider>);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LabelPicker", () => {
  it("filters as you type and picks with the keyboard", async () => {
    const result = open();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "出" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["出血", expect.stringContaining("出")]);
    fireEvent.keyDown(input, { key: "Enter" });
    await expect(result).resolves.toEqual(BLEED);
    expect(screen.queryByTestId("label-picker")).toBeNull();
    expect(useLabels.getState().currentByScope.global).toBe("lbl-2");
  });

  it("creates a new label from the typed name", async () => {
    const created = { ...FOLD, id: "lbl-3", name: "坏死" };
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: { method?: string }) => ({
      ok: true,
      status: init?.method === "POST" ? 201 : 200,
      json: async () => (init?.method === "POST" ? { label: created } : { scope: "global", labels: [FOLD, BLEED, created] }),
    })));
    const result = open();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "坏死" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await expect(result).resolves.toEqual(created);
  });

  it("offers no create option when the name already exists, ignoring case and spaces", () => {
    void open("  组织折叠 ");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["组织折叠"]);
  });

  it("cancels with Escape", async () => {
    const result = open("x");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    await expect(result).resolves.toBeNull();
    expect(useLabels.getState().currentByScope.global).toBeUndefined();
  });
});
