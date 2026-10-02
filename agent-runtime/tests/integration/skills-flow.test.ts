/** SDD 17 §7.2～§7.4、§15.1～§15.2：Skills 目录进系统提示词、按需读取、显式调用。 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import { loadResources } from "../../src/resources/load.js";
import { buildServer } from "../../src/transport/server.js";
import { TEST_CONNECTION, createRuntimeFixture, waitFor } from "../helpers/runtime-fixture.js";

let root: string;
let home: string;
let project: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "glaux-skills-"));
  home = join(root, "home");
  project = join(root, "project");
  await mkdir(join(home, "skills", "imt-protocol"), { recursive: true });
  await writeFile(join(home, "skills", "imt-protocol", "SKILL.md"), "---\nname: imt-protocol\ndescription: How to measure carotid IMT.\n---\n\nMeasure the far wall.\n");
  await mkdir(join(home, "prompts"), { recursive: true });
  await writeFile(join(home, "prompts", "compare.md"), "Compare $1 with $2.");
  await writeFile(join(home, "GLAUX.md"), "Always cite units.");
  await mkdir(project, { recursive: true });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function setup(...batches: FauxResponseStep[][]) {
  const fixture = await createRuntimeFixture(batches, {
    toolFactory: defaultToolFactory,
    permission: {
      loadSettings: async () => ({ settings: EMPTY_SETTINGS, alwaysPath: join(root, "unused.json"), projectDir: project }),
      loadResources: (options) => loadResources({ ...options, env: { GLAUX_HOME: home }, builtinSkillsDir: join(root, "none") }),
    },
  });
  const sessionId = crypto.randomUUID();
  await fixture.sessions.createSession({ session_id: sessionId, project_id: "prj-a" });
  return { fixture, sessionId };
}

const userText = (messages: unknown[]) => {
  const user = messages.find((m) => (m as { role?: string }).role === "user") as { content: unknown } | undefined;
  const content = user?.content;
  if (typeof content === "string") return content;
  return Array.isArray(content) ? content.map((b: { text?: string }) => b.text ?? "").join("") : "";
};

describe("skills and prompts in a session", () => {
  it("puts instructions and the skill catalog in the system prompt and reads skills without approval", async () => {
    const prompts: string[] = [];
    const skillPath = join(home, "skills", "imt-protocol", "SKILL.md");
    const { fixture, sessionId } = await setup([
      (context) => { prompts.push(context.systemPrompt ?? ""); return fauxAssistantMessage(fauxToolCall("read", { path: skillPath }), { stopReason: "toolUse" }); },
      fauxAssistantMessage(fauxToolCall("write", { path: skillPath, content: "x" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    try {
      await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "prompt", content: "measure", connection: TEST_CONNECTION });
      await waitFor(() => fixture.registry.interactions.pending(sessionId).length === 1);
      const pending = fixture.registry.interactions.pending(sessionId);
      expect(pending.map((p) => p.permission?.tool_name)).toEqual(["write"]);
      fixture.registry.interactions.reply(sessionId, pending[0]!.request_id, { kind: "permission", decision: "deny" });
      await fixture.registry.waitForIdle(sessionId);
      const prompt = prompts[0]!;
      expect(prompt).toContain('<instructions scope="user">\nAlways cite units.\n</instructions>');
      expect(prompt).toContain("<name>imt-protocol</name>");
      expect(prompt.indexOf("<available_skills>")).toBeLessThan(prompt.indexOf("No image is currently open"));
    } finally { await fixture.close(); }
  });

  it("invokes a skill and a template explicitly", async () => {
    const seen: string[] = [];
    const { fixture, sessionId } = await setup([
      (context) => { seen.push(userText(context.messages)); return fauxAssistantMessage("ok skill"); },
    ], [
      (context) => { seen.push(JSON.stringify(context.messages.at(-1))); return fauxAssistantMessage("ok template"); },
    ]);
    try {
      await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "prompt", content: "left side", connection: TEST_CONNECTION, skill: "imt-protocol" });
      await fixture.registry.waitForIdle(sessionId);
      await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "prompt", content: "", connection: TEST_CONNECTION, template: { name: "compare", args: "A \"B C\"" } });
      await fixture.registry.waitForIdle(sessionId);
      expect(seen[0]).toMatch(/^<skill name="imt-protocol" location="[^"]+SKILL\.md">/u);
      expect(seen[0]).toContain("Measure the far wall.");
      expect(seen[0]).toContain("left side");
      expect(seen[1]).toContain("Compare A with B C.");
      expect((await fixture.sessions.getSession(sessionId)).title).toBe("/imt-protocol left side");
    } finally { await fixture.close(); }
  });

  it("rejects unknown resources and image attachments over HTTP", async () => {
    const { fixture, sessionId } = await setup([fauxAssistantMessage("never")]);
    const server = buildServer({ routes: { sessions: fixture.sessions, commands: fixture.commands, registry: fixture.registry, broker: fixture.broker } });
    try {
      const url = `/agent-api/v1/sessions/${sessionId}/commands`;
      const base = { type: "prompt", content: "x", connection: TEST_CONNECTION };
      const unknown = await server.inject({ method: "POST", url, payload: { ...base, command_id: crypto.randomUUID(), skill: "no-such-skill" } });
      expect(unknown.statusCode).toBe(422);
      expect(unknown.json().error.code).toBe("unknown_resource");
      const both = await server.inject({ method: "POST", url, payload: { ...base, command_id: crypto.randomUUID(), skill: "imt-protocol", template: { name: "compare", args: "" } } });
      expect(both.statusCode).toBe(422);
      const image = await server.inject({ method: "POST", url, payload: { ...base, command_id: crypto.randomUUID(), skill: "imt-protocol", images: [{ data: "iVBORw0KGgo=", mime_type: "image/png" }] } });
      expect(image.statusCode).toBe(422);
      const badName = await server.inject({ method: "POST", url, payload: { ...base, command_id: crypto.randomUUID(), skill: "../etc" } });
      expect(badName.json().error.code).toBe("invalid_name");
    } finally {
      await server.close();
      await fixture.close();
    }
  });
});
