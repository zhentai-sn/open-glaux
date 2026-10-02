/** SDD 16 §7.1、§7.6：命令的工作目录与会话工作区生命周期。 */
import { access } from "node:fs/promises";
import { join } from "node:path";

import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { HarnessToolContext } from "../../src/pi/harness-registry.js";
import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
import { workspaceDir } from "../../src/workspace/cwd.js";
import { TEST_CONNECTION, createRuntimeFixture } from "../helpers/runtime-fixture.js";

const exists = (path: string) => access(path).then(() => true, () => false);

async function runOnce(options: { projectId?: string; projectDir?: string } = {}) {
  const seen: HarnessToolContext[] = [];
  const fixture = await createRuntimeFixture([[fauxAssistantMessage("ok")]], {
    toolFactory: (ctx) => { seen.push(ctx); return []; },
    ...(options.projectDir !== undefined || options.projectId
      ? {
          permission: {
            loadSettings: async () => ({
              settings: EMPTY_SETTINGS, alwaysPath: "/dev/null",
              ...(options.projectDir ? { projectDir: options.projectDir } : {}),
            }),
          },
        }
      : {}),
  });
  const sessionId = crypto.randomUUID();
  await fixture.sessions.createSession({ session_id: sessionId, ...(options.projectId ? { project_id: options.projectId } : {}) });
  await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "prompt", content: "hi", connection: TEST_CONNECTION });
  await fixture.registry.waitForIdle(sessionId);
  return { fixture, sessionId, ctx: seen[0]! };
}

describe("working directory", () => {
  it("creates a workspace for an unassigned session and removes it with the session", async () => {
    const { fixture, sessionId, ctx } = await runOnce();
    try {
      const dir = workspaceDir(join(fixture.dataDir, "workspaces"), sessionId);
      expect(ctx.cwd).toBe(dir);
      expect(ctx.execEnv?.cwd).toBe(dir);
      expect(await exists(dir)).toBe(true);

      await fixture.sessions.patchSession(sessionId, { status: "archived" });
      expect(await exists(dir)).toBe(true);
      await fixture.sessions.deleteSession(sessionId);
      expect(await exists(dir)).toBe(false);
    } finally { await fixture.close(); }
  });

  it("uses the project directory for a bound session and creates no workspace", async () => {
    const { fixture, sessionId, ctx } = await runOnce({ projectId: "prj-a", projectDir: "/tmp" });
    try {
      expect(ctx.cwd).toBe("/tmp");
      expect(await exists(workspaceDir(join(fixture.dataDir, "workspaces"), sessionId))).toBe(false);
    } finally { await fixture.close(); }
  });

  it("has no working directory when the project directory is unknown", async () => {
    const { fixture, ctx } = await runOnce({ projectId: "prj-a" });
    try {
      expect(ctx.cwd).toBeUndefined();
      expect(ctx.execEnv).toBeUndefined();
    } finally { await fixture.close(); }
  });
});
