import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { SessionStats } from "../../agent/runtime/types";
import { I18nProvider } from "../../i18n";
import { ContextUsagePanel } from "./ContextUsagePanel";

const stats: SessionStats = {
  model_calls: 3,
  tool_calls: 2,
  turns: [],
  usage: { input: 1_905_807, output: 247_996, cacheRead: 137_982_208, cacheWrite: 0, cost: 0 },
  model_ms: 4_919_000,
  tool_ms: 823_000,
  first_token_avg_ms: 7_000,
  output_tps: 140,
  cache_hit_ratio: 0.99,
  context: { tokens: 145_000, window: 1_000_000, system: 1_700, tools: 16_700, messages: 2_500 },
};

function setup(props: Parameters<typeof ContextUsagePanel>[0]) {
  render(
    <I18nProvider>
      <ContextUsagePanel {...props} />
    </I18nProvider>,
  );
}

describe("ContextUsagePanel", () => {
  beforeEach(() => {
    localStorage.setItem("glaux.lang", "zh");
  });

  it("给出百分比、三段明细与会话统计", () => {
    setup({ stats, fallbackTokens: null, fallbackWindow: null });
    expect(screen.getByText("上下文已用")).toBeInTheDocument();
    expect(screen.getByText("14.5%")).toBeInTheDocument();
    expect(screen.getByText("~145K / 1M")).toBeInTheDocument();
    expect(screen.getByText("系统提示词")).toBeInTheDocument();
    expect(screen.getByText("~1.7K")).toBeInTheDocument();
    expect(screen.getByText("~16.7K")).toBeInTheDocument();
    expect(screen.getByText("~2.5K")).toBeInTheDocument();
    // 模型用时 4919 秒 → 81 分 59 秒；工具用时 823 秒 → 13 分 43 秒
    expect(screen.getByText("81 分 59 秒")).toBeInTheDocument();
    expect(screen.getByText("13 分 43 秒")).toBeInTheDocument();
    expect(screen.getByText("7 秒")).toBeInTheDocument();
    expect(screen.getByText("140 tok/s")).toBeInTheDocument();
    expect(screen.getByText("99%")).toBeInTheDocument();
    expect(screen.getByText("1,905,807")).toBeInTheDocument();
    expect(screen.getByText("137,982,208")).toBeInTheDocument();
    expect(screen.getByText("247,996")).toBeInTheDocument();
    // 未定价的端点不显示 0
    expect(screen.getByText("未定价")).toBeInTheDocument();
  });

  it("统计未到时用消息估算，窗口未知只给 tokens", () => {
    setup({ stats: null, fallbackTokens: 4_096, fallbackWindow: null });
    expect(screen.getByText("~4.1K")).toBeInTheDocument();
    expect(screen.queryByText(/^\d/)).toBeNull();
    expect(screen.getByText("还没有调用记录；发一条消息后这里有统计。")).toBeInTheDocument();
  });

  it("有费用时按美元显示四位小数", () => {
    setup({
      stats: { ...stats, usage: { ...stats.usage, cost: 5.6574 } },
      fallbackTokens: null,
      fallbackWindow: null,
    });
    expect(screen.getByText("$5.6574")).toBeInTheDocument();
  });
});
