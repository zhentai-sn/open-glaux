/** SDD 15 §7.8、§15.4：预算用尽时拦截工具并收尾；模型无视拦截时宽限后中止。 */
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fauxAssistantMessage, fauxToolCall, Type, type Context, type FauxResponseStep } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import type { TransportEvent } from "../../src/contracts.js";
import { EMPTY_SETTINGS } from "../../src/permission/settings.js";
import type { HarnessTool } from "../../src/pi/harness-registry.js";
import { TEST_CONNECTION, createRuntimeFixture } from "../helpers/runtime-fixture.js";

const call = () => fauxAssistantMessage(fauxToolCall("run_task", {}), { stopReason: "toolUse" });

async function run(steps: FauxResponseStep[]) {
  const counter = { runs: 0 };
  const tool: HarnessTool = {
    name: "run_task", label: "run", description: "test double", parameters: Type.Object({}),
    async execute() { counter.runs += 1; return { content: [{ type: "text", text: "ok" }], details: {} }; },
  };
  const fixture = await createRuntimeFixture([steps], {
    toolFactory: () => [tool],
    permission: {
      loadSettings: async () => ({
        settings: { ...EMPTY_SETTINGS, user: { path: "u", rules: [], budget: { max_turns: 3 } } },
        alwaysPath: join(tmpdir(), "unused-settings.json"),
      }),
    },
  });
  const sessionId = crypto.randomUUID();
  const events: TransportEvent[] = [];
  await fixture.sessions.createSession({ session_id: sessionId });
  fixture.registry.subscribe(sessionId, (event) => events.push(event));
  await fixture.commands.accept(sessionId, { command_id: crypto.randomUUID(), type: "prompt", content: "go", connection: TEST_CONNECTION });
  await fixture.registry.waitForIdle(sessionId);
  // run.settled 在结局落盘后发出，晚于 completion。
  await new Promise((resolve) => setTimeout(resolve, 50));
  const settled = events.find((e): e is Extract<TransportEvent, { event: "run.settled" }> => e.event === "run.settled");
  const session = await fixture.sessions.openSession(sessionId);
  const budgetEntry = (await session.getEntries()).find((e) => e.type === "custom" && e.customType === "glaux.budget");
  await fixture.sessions.closeSession(session);
  await fixture.close();
  return { counter, settled, budgetEntry: (budgetEntry as { data?: unknown } | undefined)?.data, events };
}

describe("run budget", () => {
  it("blocks tools from the turn after the limit and completes with the model's wrap-up", async () => {
    const { counter, settled, budgetEntry, events } = await run([call(), call(), call(), call(), fauxAssistantMessage("Here is what I have; the rest is unfinished.")]);
    expect(counter.runs).toBe(3);
    const blocked = events.filter((e): e is Extract<TransportEvent, { event: "tool.end" }> => e.event === "tool.end" && e.data.is_error);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]?.data.error_text).toMatch(/reached its budget \(3 turns/u);
    expect(settled?.data).toMatchObject({ outcome: "completed", budget: { turns: 5, exhausted: true } });
    expect(budgetEntry).toMatchObject({ turns: 5, max_turns: 3, exhausted: true, aborted_by_budget: false });
  });

  it("tells the model to answer in the first wind-down turn", async () => {
    const lastSeen: string[] = [];
    const answer = (context: Context) => {
      const last = context.messages[context.messages.length - 1];
      lastSeen.push(last?.role === "user" ? JSON.stringify(last.content) : String(last?.role));
      return fauxAssistantMessage("Partial answer.");
    };
    const { counter, settled } = await run([call(), call(), call(), answer]);
    expect(counter.runs).toBe(3);
    expect(lastSeen[0]).toMatch(/\[Glaux\] This run reached its budget \(3 turns/u);
    expect(settled?.data).toMatchObject({ outcome: "completed" });
  });

  it("aborts with budget_exceeded when the model keeps calling tools through the grace turns", async () => {
    const { counter, settled, events } = await run(Array.from({ length: 12 }, call));
    expect(counter.runs).toBe(3);
    expect(settled?.data).toMatchObject({ outcome: "budget_exceeded", budget: { exhausted: true } });
    expect(events.some((e) => e.event === "adapter.error")).toBe(false);
  });
});
