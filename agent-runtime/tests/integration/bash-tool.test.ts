/** SDD 16 §7.5、§15.4：bash 只在 autonomous 挂载、环境变量白名单、超时与前缀规则。 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionMode } from "../../src/contracts.js";
import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import { bashPrefixMatch, normalizeBashTimeout } from "../../src/plugins/files.js";
import { TEST_CONNECTION, createRuntimeFixture, waitFor } from "../helpers/runtime-fixture.js";

let project: string;
beforeEach(async () => { project = await mkdtemp(join(tmpdir(), "glaux-bash-")); });
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(project, { recursive: true, force: true });
});

function lastToolText(messages: unknown[]): string {
  const result = [...messages].reverse().find((m) => (m as { role?: string }).role === "toolResult") as { content: { text?: string }[] } | undefined;
  return result?.content.map((b) => b.text ?? "").join("") ?? "";
}

async function run(steps: FauxResponseStep[], mode: PermissionMode, rules: { tool: string; pattern?: string; decision: "allow" | "deny" | "ask" }[] = []) {
  const fixture = await createRuntimeFixture([steps], {
    toolFactory: defaultToolFactory,
    permission: {
      loadSettings: async () => ({
        settings: { ...EMPTY_SETTINGS, user: { path: "u", rules, budget: {} } },
        alwaysPath: join(project, "unused.json"),
        projectDir: project,
      }),
    },
  });
  const sessionId = crypto.randomUUID();
  await fixture.sessions.createSession({ session_id: sessionId, permission_mode: mode, project_id: "prj-a" });
  await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "prompt", content: "go", connection: TEST_CONNECTION });
  return { fixture, sessionId };
}

describe("bash", () => {
  it("is mounted only in autonomous mode", () => {
    const ctx = { cwd: project, execEnv: {} as never, connection: TEST_CONNECTION };
    for (const mode of ["observe", "suggest", "controlled"] as const) {
      expect(defaultToolFactory({ ...ctx, permissionMode: mode }).map((t) => t.name)).not.toContain("bash");
    }
    expect(defaultToolFactory({ ...ctx, permissionMode: "autonomous" }).map((t) => t.name)).toContain("bash");
  });

  it("runs in the working directory with allowlisted variables only", async () => {
    vi.stubEnv("GLAUX_SEG_API_TOKEN", "seg-secret-123");
    vi.stubEnv("SOME_API_KEY", "key-secret-456");
    const seen: string[] = [];
    const { fixture, sessionId } = await run([
      fauxAssistantMessage(fauxToolCall("bash", { command: "pwd; env" }), { stopReason: "toolUse" }),
      (context) => { seen.push(lastToolText(context.messages)); return fauxAssistantMessage("ok"); },
    ], "autonomous");
    try {
      await fixture.registry.waitForIdle(sessionId);
      const output = seen[0] ?? "";
      expect(output).toContain(`GLAUX_CWD=${project}`);
      expect(output.split("\n")[0]).toMatch(new RegExp(`${project.split("/").at(-1)}$`, "u"));
      expect(output).not.toContain("seg-secret-123");
      expect(output).not.toContain("key-secret-456");
      expect(output).not.toMatch(/^GLAUX_(?!CWD)/mu);
    } finally { await fixture.close(); }
  });

  it("caps the timeout and notes it in the result", async () => {
    const seen: string[] = [];
    const { fixture, sessionId } = await run([
      fauxAssistantMessage(fauxToolCall("bash", { command: "echo hi", timeout: 5000 }), { stopReason: "toolUse" }),
      (context) => { seen.push(lastToolText(context.messages)); return fauxAssistantMessage("ok"); },
    ], "autonomous");
    try {
      await fixture.registry.waitForIdle(sessionId);
      expect(seen[0]).toMatch(/^\[timeout capped at 600 seconds\]/u);
      expect(seen[0]).toContain("hi");
    } finally { await fixture.close(); }
    expect(normalizeBashTimeout(undefined)).toEqual({ timeout: 120, clamped: false });
    expect(normalizeBashTimeout(30)).toEqual({ timeout: 30, clamped: false });
    expect(normalizeBashTimeout(601)).toEqual({ timeout: 600, clamped: true });
  });

  it("matches rules by command prefix", async () => {
    expect(bashPrefixMatch("git status", "  git status -s")).toBe(true);
    expect(bashPrefixMatch("git status", "git push")).toBe(false);
    expect(bashPrefixMatch("   ", "anything")).toBe(false);

    const { fixture, sessionId } = await run([
      fauxAssistantMessage(fauxToolCall("bash", { command: "rm -rf build" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("ok"),
    ], "autonomous", [{ tool: "bash", pattern: "rm ", decision: "ask" }]);
    try {
      await waitFor(() => fixture.registry.interactions.pending(sessionId).length === 1);
      expect(fixture.registry.interactions.pending(sessionId)[0]?.permission).toMatchObject({ tool_name: "bash", effect: "exec", grant_options: ["once"] });
    } finally { await fixture.close(); }
  });
});
