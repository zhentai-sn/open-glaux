// SDD 11 §5：证据卡显示源时间；区间常短于 1 秒，需要到 0.1 秒。
import { describe, expect, it } from "vitest";

import { clock } from "./VideoEvidenceCard";

describe("evidence clock", () => {
  it("shows tenths of a second so sub-second intervals stay distinct", () => {
    expect(clock(1000)).toBe("0:01.0");
    expect(clock(1500)).toBe("0:01.5");
    expect(clock(26720)).toBe("0:26.7");
    expect(clock(61050)).toBe("1:01.0");
    expect(clock(0)).toBe("0:00.0");
  });
});
