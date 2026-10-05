/**
 * SDD 21 §7.6：重建某次模型调用实际发给模型的消息，并用记录的条数校验。
 */
import {
  buildSessionContext,
  estimateTokens,
  type AgentMessage,
  type Session,
  type SessionTreeEntry,
} from "@earendil-works/pi-agent-core";

import type { ModelCallEntry, RequestContext, RequestContextMessage, RequestHeaderEntry } from "../contracts.js";
import { RuntimeError } from "../errors.js";
import { pruneImages } from "../plugins/context-pruning.js";
import { redactText } from "../security/redact.js";
import { MODEL_CALL_ENTRY, REQUEST_HEADER_ENTRY } from "./capture.js";
import { splitTurns, toBlocks } from "./project.js";

type Role = RequestContextMessage["role"];
const ROLES: readonly string[] = ["user", "assistant", "toolResult", "compactionSummary", "branchSummary", "custom"];

function toRequestMessage(message: AgentMessage, marks: RequestContextMessage["marks"]): RequestContextMessage {
  const raw = message as unknown as Record<string, unknown>;
  const role = (ROLES.includes(String(raw.role)) ? raw.role : "custom") as Role;
  const content = typeof raw.summary === "string"
    ? [{ type: "text" as const, text: redactText(raw.summary) }]
    : raw.role === "bashExecution"
      ? [{ type: "text" as const, text: redactText(`$ ${String(raw.command ?? "")}\n${String(raw.output ?? "")}`) }]
      : toBlocks(raw.content);
  return { role, content, est_tokens: estimateTokens(message), marks };
}

function locate(entries: readonly SessionTreeEntry[], itemId: string) {
  const drafts = splitTurns(entries);
  for (const draft of drafts) {
    let step = 0;
    for (const entry of draft.entries) {
      if (entry.type !== "message" || (entry.message as { role?: unknown }).role !== "assistant") continue;
      step += 1;
      if (entry.id !== itemId) continue;
      const custom = (type: string) => draft.entries.flatMap((candidate) =>
        candidate.type === "custom" && candidate.customType === type ? [candidate.data] : []);
      const call = (custom(MODEL_CALL_ENTRY) as ModelCallEntry[]).find((candidate) => candidate?.step === step);
      const header = (custom(REQUEST_HEADER_ENTRY) as RequestHeaderEntry[]).find((candidate) => typeof candidate?.hash === "string");
      return { entry, turnIndex: draft.turn.index, call, header };
    }
  }
  return undefined;
}

export async function requestContext(
  session: Session, entries: readonly SessionTreeEntry[], itemId: string,
): Promise<RequestContext> {
  const found = locate(entries, itemId);
  if (!found) throw new RuntimeError("trajectory_item_not_found", "Trajectory item is not a model call.", 404);
  const { entry, turnIndex, call, header } = found;
  // 与 harness 构建上下文同一路径：在压缩的保留起点截断的分支 → buildSessionContext（§7.6 规则 2）。
  const prefix = entry.parentId ? await session.getBranch(entry.parentId) : [];
  const history = buildSessionContext(prefix).messages;
  const pruned = pruneImages(history);
  const messages = [
    ...pruned.map((message, index) => toRequestMessage(message, message === history[index] ? [] : ["pruned"])),
    ...(call?.request.injected ?? []).map((injected) => toRequestMessage(
      { role: "user", content: [{ type: "text", text: injected.text }], timestamp: 0 },
      ["injected"],
    )),
  ];
  return {
    item_id: itemId,
    ...(header ? { header_hash: header.hash } : {}),
    turn_index: turnIndex,
    matched: call !== undefined && call.request.message_count === messages.length,
    ...(call ? { recorded_count: call.request.message_count } : {}),
    messages,
  };
}
