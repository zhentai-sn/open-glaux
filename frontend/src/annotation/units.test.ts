// 面积与长度显示（SDD 23 §7.3 规则 3）。
import { describe, expect, it } from "vitest";

import { formatArea, formatLength } from "./units";

describe("units", () => {
  it("keeps three significant digits and groups large numbers", () => {
    expect(formatArea(0.04567, "mm2")).toBe("0.0457 mm²");
    expect(formatArea(123.456, "px2")).toBe("123 px²");
    expect(formatArea(45678, "px2")).toBe("45,678 px²");
  });

  it("switches µm² to mm² from 10⁶", () => {
    expect(formatArea(999_000, "um2")).toBe("999,000 µm²");
    expect(formatArea(9_057_600, "um2")).toBe("9.06 mm²");
    expect(formatLength(15460, "um")).toBe("15.5 mm");
  });
});
