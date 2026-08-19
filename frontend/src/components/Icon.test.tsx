// 统一图标封装（SDD feats/06 §15）：渲染 svg + token 尺寸类；装饰默认 aria-hidden；带 label 则 aria-label+role=img。
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Icon } from "./Icon";
import { ICONS, KIND_ICON, FALLBACK_ICON } from "./iconMap";

describe("Icon", () => {
  it("渲染 svg 并按 size 挂 token 尺寸类", () => {
    const { container } = render(<Icon icon={ICONS.close} size="lg" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveClass("gicon", "icon-lg");
  });

  it("装饰图标默认 aria-hidden、无 role", () => {
    const { container } = render(<Icon icon={ICONS.close} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role", "img");
  });

  it("带 label 的图标暴露 aria-label + role=img，且不再 aria-hidden", () => {
    const { container, getByLabelText } = render(<Icon icon={ICONS.close} label="关闭" />);
    expect(getByLabelText("关闭")).toBeInTheDocument();
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).not.toHaveAttribute("aria-hidden", "true");
  });

  it("未知能力类型回退到 FALLBACK_ICON（不崩不空白）", () => {
    const icon = KIND_ICON["totally-unknown-kind"] ?? FALLBACK_ICON;
    const { container } = render(<Icon icon={icon} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
