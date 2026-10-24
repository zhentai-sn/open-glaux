import type { I18nKey } from "../../i18n";

type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;

/**
 * token 估算的紧凑写法（SDD 21 §9.5）：全部是估算值，带 `~`；1000 以下原样。
 * 1700 → `~1.7K`、16800 → `~16.8K`、145000 → `~145K`、1000000 → `1M`。
 */
export function estimateTokens(n: number): string {
  if (n < 1000) return `~${Math.max(0, Math.round(n))}`;
  if (n < 1_000_000) {
    // 十万以下保留一位小数，之上取整（`~16.8K` / `~145K`）。
    const thousands = n / 1000;
    return `~${n < 100_000 ? thousands.toFixed(1).replace(/\.0$/u, "") : Math.round(thousands)}K`;
  }
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/u, "")}M`;
}

/** 窗口等已知值：200000 → `200K`，1000000 → `1M`，不加 `~`。 */
export function compactExact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${Math.round(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/u, "")}M`;
}

/** 精确 token 数（用量合计）：千分位，不加 `~`。 */
export function exactTokens(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** 比例 → 百分比：不足 0.1% 显示 `<0.1%`，其余保留一位小数后去掉多余 `.0`。 */
export function percentText(ratio: number): string {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  if (pct > 0 && pct < 0.1) return "<0.1%";
  return `${pct.toFixed(1).replace(/\.0$/u, "")}%`;
}

/** 毫秒 → 「7 秒」「0.4 秒」「81 分 59 秒」；不足一分钟保留一位小数，免得快回合全显示 0 秒。 */
export function durationText(ms: number, t: Translate): string {
  const safe = Math.max(0, ms);
  if (safe < 60_000) {
    return t("agent_dur_sec", { s: (safe / 1000).toFixed(1).replace(/\.0$/u, "") });
  }
  const seconds = Math.round(safe / 1000);
  return t("agent_dur_min_sec", { m: Math.floor(seconds / 60), s: seconds % 60 });
}

/** 费用：目录单价给出的美元金额；未知（0）返回 null，界面显示「未定价」。 */
export function costText(cost: number | null | undefined): string | null {
  if (typeof cost !== "number" || !Number.isFinite(cost) || cost <= 0) return null;
  return `$${cost.toFixed(4)}`;
}
