/** Release boundary; full is an explicit developer opt-in, never a browser preference. */
const edition = import.meta.env.VITE_GLAUX_EDITION ?? "chat";
if (edition !== "chat" && edition !== "full") throw new Error("Invalid VITE_GLAUX_EDITION");
export const CHAT_EDITION = edition === "chat";
