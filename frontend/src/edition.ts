/** Release boundary: full (stage, atlas, tools) is the default; the Docker chat build sets chat explicitly. Never a browser preference. */
const edition = import.meta.env.VITE_GLAUX_EDITION ?? "full";
if (edition !== "chat" && edition !== "full") throw new Error("Invalid VITE_GLAUX_EDITION");
export const CHAT_EDITION = edition === "chat";

/** Workbench (IDE shell) entry: off by default; VITE_GLAUX_WORKBENCH=1 exposes the mode switch. Never in the chat edition. */
const workbench = import.meta.env.VITE_GLAUX_WORKBENCH ?? "0";
if (workbench !== "0" && workbench !== "1") throw new Error("Invalid VITE_GLAUX_WORKBENCH");
export const WORKBENCH_ENABLED = !CHAT_EDITION && workbench === "1";
