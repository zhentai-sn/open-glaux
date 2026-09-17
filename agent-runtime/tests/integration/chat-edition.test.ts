import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chatEdition, CHAT_SYSTEM_PROMPT } from "../../src/edition.js";
import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import { createRuntimeFixture, TEST_CONNECTION } from "../helpers/runtime-fixture.js";

afterEach(() => vi.unstubAllEnvs());
describe("chat release boundary", () => {
  it("defaults to full and rejects unknown editions", () => {
    expect(chatEdition({})).toBe(false);
    expect(chatEdition({ GLAUX_EDITION: "chat" })).toBe(true);
    expect(chatEdition({ GLAUX_EDITION: "full" })).toBe(false);
    expect(() => chatEdition({ GLAUX_EDITION: "typo" })).toThrow();
  });
  it("never exposes domain tools, including with vision, permission and segmentation credentials", () => {
    vi.stubEnv("GLAUX_EDITION", "chat");
    vi.stubEnv("GLAUX_ANNOT_ALLOW_EGRESS", "1");
    vi.stubEnv("GLAUX_SEG_API_TOKEN", "test-only");
    for (const permissionMode of ["observe", "suggest", "controlled", "autonomous"] as const) {
      expect(defaultToolFactory({ permissionMode, connection: { ...TEST_CONNECTION, vision: true } })).toEqual([]);
    }
  });
  it("persists conversation without constructing even an injected tool factory", async () => {
    vi.stubEnv("GLAUX_EDITION", "chat");
    const toolFactory = vi.fn(() => { throw new Error("Domain tools must not load"); });
    const fixture = await createRuntimeFixture([[(context) => {
      expect(context.systemPrompt).toBe(CHAT_SYSTEM_PROMPT);
      expect(context.tools ?? []).toEqual([]);
      expect(context.systemPrompt).not.toContain("legacy-image");
      return fauxAssistantMessage("Hello from chat");
    }]], { toolFactory });
    const sessionId = crypto.randomUUID();
    try {
      await fixture.sessions.createSession({ session_id: sessionId });
      await fixture.commands.accept(sessionId, {
        command_id: crypto.randomUUID(), type: "prompt", content: "hello",
        connection: TEST_CONNECTION, viewer: { image_id: "legacy-image" },
      });
      await fixture.registry.waitForIdle(sessionId);
      expect(toolFactory).not.toHaveBeenCalled();
      const view = await fixture.sessions.getSession(sessionId);
      expect(JSON.stringify(view.messages)).toContain("Hello from chat");
    } finally { await fixture.close(); }
  });
});
