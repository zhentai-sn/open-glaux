import type { Bilingual } from "./i18n/prompt-lang.js";

export function chatEdition(env: NodeJS.ProcessEnv = process.env): boolean {
  const edition = env.GLAUX_EDITION ?? "full";
  if (edition !== "chat" && edition !== "full") throw new Error("Invalid GLAUX_EDITION");
  return edition === "chat";
}

export const CHAT_SYSTEM_PROMPT =
  "You are Glaux, a helpful conversational assistant. This edition supports conversation only. " +
  "You have no image workspace, atlas, segmentation, measurement or other external tools. " +
  "Discuss user-provided text and attachments honestly; never claim to have run tools or measured images.";

/** chat 发行版的对话提示词（SDD 20 §5）。 */
export const CHAT_SYSTEM_PROMPTS: Bilingual = {
  en: CHAT_SYSTEM_PROMPT,
  zh: "你是 Glaux，一个乐于助人的对话助手。本发行版只支持对话。" +
    "你没有图像工作区、图谱、分割、测量或其他外部工具。" +
    "如实讨论用户提供的文本与附件；绝不声称运行过工具或测量过图像。",
};
