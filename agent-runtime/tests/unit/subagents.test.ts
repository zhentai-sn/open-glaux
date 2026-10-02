/** SDD 18 §4.1、§7.2、§7.3：定义解析与覆盖、并发槽位、过程压缩、`agent` 工具挂载。 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import { availableTools } from "../../src/plugins/registry.js";
import { resultText } from "../../src/plugins/subagents.js";
import { loadAgents, parseAgentFile, type AgentDefinition } from "../../src/resources/agents.js";
import { compactTranscript, createSlots } from "../../src/subagents/run.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "glaux-agents-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const file = (name: string, front: string, body = "Do the task.") => `---\nname: ${name}\n${front}---\n\n${body}\n`;

describe("agent definitions", () => {
  it("parses name, description, tools and max_turns", () => {
    const def = parseAgentFile(file("scout", "description: Finds files.\ntools: [read, list_files]\nmax_turns: 5\n"), "/x/scout.md", "user");
    expect(def).toMatchObject({ name: "scout", description: "Finds files.", tools: ["read", "list_files"], maxTurns: 5, body: "Do the task.", source: "user" });
    const listed = parseAgentFile(file("scout", "description: d\ntools:\n  - read\n  - bash\n"), "/x/scout.md", "user");
    expect(listed.tools).toEqual(["read", "bash"]);
    expect(listed.maxTurns).toBe(20);
  });

  it("rejects bad definitions with a reason", () => {
    expect(() => parseAgentFile("no frontmatter", "/x/a.md", "user")).toThrow(/frontmatter/u);
    expect(() => parseAgentFile(file("other", "description: d\n"), "/x/a.md", "user")).toThrow(/file name/u);
    expect(() => parseAgentFile(file("a", ""), "/x/a.md", "user")).toThrow(/description/u);
    expect(() => parseAgentFile(file("a", "description: d\nmax_turns: 99\n"), "/x/a.md", "user")).toThrow(/max_turns/u);
  });

  it("lets project override user override builtin and reports invalid files", async () => {
    const dirs = (["builtin", "user", "project"] as const).map((source) => ({ source, path: join(root, source) }));
    for (const dir of dirs) {
      await mkdir(dir.path, { recursive: true });
      await writeFile(join(dir.path, "general.md"), file("general", `description: ${dir.source} general\n`));
    }
    await writeFile(join(root, "user", "broken.md"), "oops");
    const loaded = await loadAgents(dirs);
    expect(loaded.definitions).toHaveLength(1);
    expect(loaded.definitions[0]).toMatchObject({ source: "project", description: "project general" });
    expect(loaded.items.map((item) => [item.source, item.overridden_by])).toEqual([
      ["builtin", "project"], ["user", "project"], ["project", undefined],
    ]);
    expect(loaded.diagnostics).toEqual([expect.objectContaining({ code: "invalid_agent", source: "user" })]);
  });
});

describe("sub-agent slots", () => {
  it("runs at most the limit at once and queues the rest", async () => {
    const slots = createSlots(2);
    const a = await slots.acquire();
    await slots.acquire();
    let third = false;
    const pending = slots.acquire().then((release) => { third = true; return release; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(third).toBe(false);
    a();
    a();
    (await pending)();
    expect(third).toBe(true);
    expect(slots.active).toBe(1);
  });

  it("gives up waiting when aborted", async () => {
    const slots = createSlots(1);
    await slots.acquire();
    const controller = new AbortController();
    const waiting = slots.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow(/aborted/u);
  });
});

describe("sub-agent transcript", () => {
  it("replaces images, truncates long text and keeps the last 200 messages", () => {
    const messages = [
      { role: "user", content: [{ type: "image", data: "AAAA", mimeType: "image/png" }], timestamp: 0 },
      { role: "assistant", content: [{ type: "text", text: "x".repeat(5000) }] },
      ...Array.from({ length: 250 }, (_, i) => ({ role: "user", content: `m${i}`, timestamp: 0 })),
    ] as unknown as AgentMessage[];
    expect(compactTranscript(messages.slice(0, 2))).toEqual([
      { role: "user", content: [{ type: "text", text: "[image omitted]" }] },
      { role: "assistant", content: [{ type: "text", text: `${"x".repeat(4000)}…[truncated]` }] },
    ]);
    const kept = compactTranscript(messages);
    expect(kept).toHaveLength(200);
    expect(kept.at(-1)).toEqual({ role: "user", content: "m249" });
  });

  it("notes budget and abort outcomes and the empty reply", () => {
    const base = { turns: 1, transcript: [] };
    expect(resultText({ ...base, outcome: "completed", final: "" })).toBe("The sub-agent gave no reply.");
    expect(resultText({ ...base, outcome: "budget_exceeded", final: "partial" })).toMatch(/budget[\s\S]*partial$/u);
    expect(resultText({ ...base, outcome: "failed", final: "", error: "boom" })).toBe("The sub-agent failed: boom.");
  });
});

describe("agent tool mounting", () => {
  const def = { name: "general", description: "d", maxTurns: 20, body: "", source: "builtin", path: "" } as AgentDefinition;
  const spawn = async () => ({ outcome: "completed" as const, turns: 0, final: "", transcript: [] });
  const names = (ctx: Parameters<typeof availableTools>[0]) => availableTools(ctx).map((tool) => tool.name);

  it("mounts only with a dispatcher and at least one definition, never inside a sub-agent", () => {
    expect(names({ agents: [def], spawnSubagent: spawn })).toContain("agent");
    expect(names({ agents: [], spawnSubagent: spawn })).not.toContain("agent");
    expect(names({ agents: [def] })).not.toContain("agent");
    expect(names({ agents: [def], spawnSubagent: spawn, subagent: { description: "x" } })).not.toContain("agent");
  });
});
