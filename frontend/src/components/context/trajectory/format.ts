// 运行轨迹的摘要文案与泳道归属（SDD 21 §7.3）。纯函数，便于单测。
import type { RequestHeaderBody, Trajectory, TrajectoryBlock, TrajectoryItem } from "../../../agent/runtime/types";
import type { I18nKey } from "../../../i18n";

export type Translate = (key: I18nKey, vars?: Record<string, string | number>) => string;
export type Lane = "input" | "model" | "tool";

export const LANES: readonly Lane[] = ["input", "model", "tool"];

export function laneOf(item: TrajectoryItem): Lane {
  if (item.kind === "model" || item.kind === "compaction") return "model";
  if (item.kind === "tool") return "tool";
  return "input";
}

const firstLine = (text: string) => text.split("\n").find((line) => line.trim())?.trim() ?? "";

export function blocksText(blocks: TrajectoryBlock[]): string {
  return blocks.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

function truncate(text: string, max = 80): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function imageLabel(t: Translate, block: Extract<TrajectoryBlock, { type: "image" }>): string {
  return t("traj_image", { mime: block.mimeType, kb: (block.bytes / 1024).toFixed(1) });
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m${Math.round((ms % 60_000) / 1000)}s`;
}

/** 记录行右侧的耗时；没有计时的记录返回空串。 */
export function durationOf(item: TrajectoryItem): string {
  if (item.kind === "model" && item.timing) return formatMs(item.timing.duration_ms);
  if (item.kind === "tool" && item.duration_ms !== undefined) return formatMs(item.duration_ms);
  return "";
}

export function noticeText(t: Translate, item: Extract<TrajectoryItem, { kind: "notice" }>): string {
  const data = item.data;
  if (item.type === "budget") return t("traj_notice_budget", { turns: String(data.turns ?? "?"), max: String(data.max_turns ?? "?") });
  if (item.type === "model_change") return t("traj_notice_model_change", { model: String(data.model ?? "") });
  const tool = String(data.tool ?? "");
  return data.decision === "deny"
    ? t("traj_notice_permission_deny", { tool })
    : t("traj_notice_permission_ask", { tool, outcome: String(data.outcome ?? "") });
}

/** 记录行的一行摘要（§7.3 表格）。 */
export function summaryOf(t: Translate, item: TrajectoryItem, headers: Trajectory["headers"]): string {
  switch (item.kind) {
    case "user": {
      const images = item.content.filter((block) => block.type === "image").length;
      const text = truncate(firstLine(blocksText(item.content)));
      return images ? `${text} ${t("traj_user_images", { n: images })}`.trim() : text;
    }
    case "header": {
      const body: RequestHeaderBody | undefined = headers[item.hash];
      const base = body
        ? t("traj_header_summary", { prompt: body.est_tokens.prompt, tools: body.tools.length })
        : t("traj_header_missing");
      return `${base} · ${t(`traj_header_${item.changed}` as I18nKey)}`;
    }
    case "model": {
      const text = firstLine(blocksText(item.content));
      if (text) return truncate(text);
      const calls = item.content.filter((block) => block.type === "toolCall").length;
      return calls ? t("traj_model_tools", { n: calls }) : t("traj_model_empty");
    }
    case "tool": {
      const args = truncate(JSON.stringify(item.arguments), 48);
      const image = item.result.find((block) => block.type === "image");
      const result = image ? imageLabel(t, image) : truncate(firstLine(blocksText(item.result)), 48);
      return `${item.name} ${args} → ${result}`;
    }
    case "compaction":
      return t("traj_compaction_summary", { n: item.tokens_before });
    case "notice":
      return noticeText(t, item);
  }
}
