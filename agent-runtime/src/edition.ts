export function chatEdition(env: NodeJS.ProcessEnv = process.env): boolean {
  const edition = env.GLAUX_EDITION ?? "chat";
  if (edition !== "chat" && edition !== "full") throw new Error("Invalid GLAUX_EDITION");
  return edition === "chat";
}

export const CHAT_SYSTEM_PROMPT =
  "You are Glaux, a helpful conversational assistant. This edition supports conversation only. " +
  "You have no image workspace, atlas, segmentation, measurement or other external tools. " +
  "Discuss user-provided text and attachments honestly; never claim to have run tools or measured images.";
