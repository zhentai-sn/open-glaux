import { describe, expect, it } from "vitest";

import { costText, durationText, estimateTokens, exactTokens, percentText } from "./usageFormat";

describe("usageFormat", () => {
  it("估算值带 ~，过万取整到 K，百万级取 M", () => {
    expect(estimateTokens(0)).toBe("~0");
    expect(estimateTokens(123)).toBe("~123");
    expect(estimateTokens(1700)).toBe("~1.7K");
    expect(estimateTokens(16_800)).toBe("~16.8K");
    expect(estimateTokens(145_000)).toBe("~145K");
    expect(estimateTokens(1_000_000)).toBe("1M");
  });

  it("精确值只加千分位", () => {
    expect(exactTokens(1_905_807)).toBe("1,905,807");
  });

  it("百分比保留一位，极小值给下限", () => {
    expect(percentText(0.15)).toBe("15%");
    expect(percentText(0.004)).toBe("0.4%");
    expect(percentText(0.00001)).toBe("<0.1%");
    expect(percentText(1.4)).toBe("100%");
  });

  it("费用未知时返回 null（界面显示未定价）", () => {
    expect(costText(0)).toBeNull();
    expect(costText(null)).toBeNull();
    expect(costText(5.6574)).toBe("$5.6574");
  });

  it("时长达一分钟拆成分与秒", () => {
    const t = (key: string, vars?: Record<string, string | number>) => `${key}:${JSON.stringify(vars)}`;
    expect(durationText(132_000, t as never)).toBe('agent_dur_min_sec:{"m":2,"s":12}');
    expect(durationText(900, t as never)).toBe('agent_dur_sec:{"s":"0.9"}');
  });
});
