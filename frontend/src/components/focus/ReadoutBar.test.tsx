// 读数条（SDD 04 §7.5 规则 7）：度量 + 复现结果 + 来源角标。
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { ReadoutBar } from "./ReadoutBar";

const METRIC = { value: 12.5, unit: "个/mm²", label_en: "Nuclei density", label_zh: "核密度" };

function mount(readout: Parameters<typeof ReadoutBar>[0]["readout"]) {
  return render(<I18nProvider><ReadoutBar readout={readout} /></I18nProvider>);
}

describe("ReadoutBar", () => {
  beforeEach(() => localStorage.setItem("glaux.lang", "en"));

  it("无度量且无复现结果时不渲染", () => {
    const { container } = mount({ metrics: [], source: "agent", verification: null });
    expect(container.firstChild).toBeNull();
  });

  it("复现结果显示在读数条，按 F1 分档着色", () => {
    mount({ metrics: [METRIC], source: "agent", verification: { f1: 0.9, count_pred: 90, count_ref: 100 } });
    const verify = screen.getByText("Reproduced F1 0.90 (90/100)");
    expect(verify.className).toContain("warn");
    expect(screen.getByText("Nuclei density")).toBeTruthy();
    expect(screen.getByText("source · agent", { exact: false })).toBeTruthy();
  });

  it("只有复现结果、无度量时也渲染", () => {
    mount({ metrics: [], source: "agent", verification: { f1: 0.97, count_pred: 97, count_ref: 100 } });
    expect(screen.getByText("Reproduced F1 0.97 (97/100)").className).toContain("good");
  });
});
