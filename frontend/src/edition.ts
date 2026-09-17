/** Release boundary: full (stage, atlas, tools) is the default; the Docker chat build sets chat explicitly. Never a browser preference. */
const edition = import.meta.env.VITE_GLAUX_EDITION ?? "full";
if (edition !== "chat" && edition !== "full") throw new Error("Invalid VITE_GLAUX_EDITION");
export const CHAT_EDITION = edition === "chat";
