/** SDD 16 §7.2～§7.4、§15.1～§15.3：read / write / edit 经 harness 与权限插件的端到端行为。 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PermissionMode, TransportEvent } from "../../src/contracts.js";
import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
import { defaultToolFactory } from "../../src/pi/harness-registry.js";
import { TEST_CONNECTION, createRuntimeFixture, waitFor } from "../helpers/runtime-fixture.js";

let project: string;
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "glaux-files-"));
  await mkdir(join(project, "reports"));
  await writeFile(join(project, "reports", "a.md"), "line 1\nline 2\nline 3");
  await writeFile(join(project, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]));
  await writeFile(join(project, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
});
afterEach(async () => { await rm(project, { recursive: true, force: true }); });

const call = (name: string, args: Record<string, unknown>) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

async function run(steps: FauxResponseStep[], mode: PermissionMode = "controlled", options: { vision?: boolean; projectId?: string } = {}) {
  const projectId = options.projectId === undefined ? "prj-a" : options.projectId;
  const fixture = await createRuntimeFixture([[...steps, fauxAssistantMessage("done")]], {
    toolFactory: defaultToolFactory,
    permission: { loadSettings: async () => ({ settings: EMPTY_SETTINGS, alwaysPath: join(project, "unused.json"), projectDir: project }) },
  });
  const sessionId = crypto.randomUUID();
  const events: TransportEvent[] = [];
  await fixture.sessions.createSession({ session_id: sessionId, permission_mode: mode, ...(projectId ? { project_id: projectId } : {}) });
  fixture.registry.subscribe(sessionId, (event) => events.push(event));
  await fixture.commands.accept(sessionId, {
    command_id: crypto.randomUUID(), type: "prompt", content: "go",
    connection: { ...TEST_CONNECTION, ...(options.vision ? { vision: true } : {}) },
  });
  const toolEnds = () => events.filter((e): e is Extract<TransportEvent, { event: "tool.end" }> => e.event === "tool.end").map((e) => e.data);
  return { fixture, sessionId, events, toolEnds };
}

describe("files tools", () => {
  it("reads a project text file with a card and keeps the card in the snapshot", async () => {
    const { fixture, sessionId, toolEnds } = await run([call("read", { path: "reports/a.md", offset: 2 })]);
    try {
      await fixture.registry.waitForIdle(sessionId);
      expect(toolEnds()[0]).toMatchObject({
        tool_name: "read", is_error: false,
        details: { kind: "glaux.file_read", path: "reports/a.md", name: "a.md", start_line: 2, end_line: 3, eof: true, total_lines: 3 },
      });
      const view = await fixture.sessions.getSession(sessionId);
      expect(view.messages.some((m) => m.role === "toolResult" && (m.details as { kind?: string })?.kind === "glaux.file_read")).toBe(true);
    } finally { await fixture.close(); }
  });

  it("rejects binary files and omits images for connections without vision", async () => {
    const seen: string[] = [];
    const { fixture, sessionId, toolEnds } = await run([
      call("read", { path: "blob.bin" }),
      call("read", { path: "pic.png" }),
      (context) => {
        const last = [...context.messages].reverse().find((m) => m.role === "toolResult") as { content: { type: string; text?: string }[] };
        seen.push(last.content.map((b) => b.type === "text" ? b.text : `[${b.type}]`).join(""));
        return fauxAssistantMessage("done");
      },
    ]);
    try {
      await fixture.registry.waitForIdle(sessionId);
      const [binary, picture] = toolEnds();
      expect(binary).toMatchObject({ is_error: true });
      expect(binary?.error_text).toMatch(/binary file/u);
      expect(picture?.is_error).toBe(false);
      expect(seen[0]).toBe("image omitted: the connection has no vision.");
      const view = await fixture.sessions.getSession(sessionId);
      expect(JSON.stringify(view.messages)).not.toContain("glaux.file_read\",\"path\":\"pic.png");
    } finally { await fixture.close(); }
  });

  it("writes and edits project files in controlled mode and reports the change", async () => {
    const { fixture, sessionId, toolEnds } = await run([
      call("write", { path: "notes/out.md", content: "hello" }),
      call("edit", { path: "reports/a.md", edits: [{ oldText: "line 2", newText: "LINE TWO" }] }),
    ]);
    try {
      await fixture.registry.waitForIdle(sessionId);
      expect(await readFile(join(project, "notes", "out.md"), "utf8")).toBe("hello");
      expect(await readFile(join(project, "reports", "a.md"), "utf8")).toBe("line 1\nLINE TWO\nline 3");
      expect(toolEnds().map((end) => end.details)).toEqual([
        { kind: "glaux.file_changed", op: "write", path: "notes/out.md", project_id: "prj-a" },
        { kind: "glaux.file_changed", op: "edit", path: "reports/a.md", project_id: "prj-a" },
      ]);
      expect(fixture.registry.interactions.pending(sessionId)).toEqual([]);
    } finally { await fixture.close(); }
  });

  it("asks once-only approval for hidden or outside paths below autonomous", async () => {
    const { fixture, sessionId } = await run([call("write", { path: ".env", content: "A=1" })]);
    try {
      await waitFor(() => fixture.registry.interactions.pending(sessionId).length === 1);
      const request = fixture.registry.interactions.pending(sessionId)[0]!;
      expect(request.permission).toMatchObject({ tool_name: "write", effect: "write", grant_options: ["once"] });
      fixture.registry.interactions.reply(sessionId, request.request_id, { kind: "permission", decision: "once" });
      await fixture.registry.waitForIdle(sessionId);
      expect(await readFile(join(project, ".env"), "utf8")).toBe("A=1");
    } finally { await fixture.close(); }
  });

  it("asks for outside reads too, and asks for every write in suggest mode", async () => {
    const outside = await run([call("read", { path: "../elsewhere.txt" })]);
    try {
      await waitFor(() => outside.fixture.registry.interactions.pending(outside.sessionId).length === 1);
      expect(outside.fixture.registry.interactions.pending(outside.sessionId)[0]?.permission?.tool_name).toBe("read");
    } finally { await outside.fixture.close(); }

    const suggest = await run([call("write", { path: "x.md", content: "x" })], "suggest");
    try {
      await waitFor(() => suggest.fixture.registry.interactions.pending(suggest.sessionId).length === 1);
      expect(suggest.fixture.registry.interactions.pending(suggest.sessionId)[0]?.permission?.grant_options).toEqual(["once", "session", "always"]);
    } finally { await suggest.fixture.close(); }
  });

  it("writes hidden paths without approval in autonomous mode", async () => {
    const { fixture, sessionId } = await run([call("write", { path: ".env", content: "B=2" })], "autonomous");
    try {
      await fixture.registry.waitForIdle(sessionId);
      expect(await readFile(join(project, ".env"), "utf8")).toBe("B=2");
    } finally { await fixture.close(); }
  });

  it("does not mount the file tools in observe mode except read", async () => {
    const tools = defaultToolFactory({ permissionMode: "observe", cwd: project, execEnv: {} as never, connection: TEST_CONNECTION });
    expect(tools.map((t) => t.name)).toEqual(["read"]);
  });
});
