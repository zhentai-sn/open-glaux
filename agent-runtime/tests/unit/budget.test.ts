/** SDD 15 §7.8：预算取值优先级、收尾判定、宽限中止与等待时长扣除。 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveBudget, RunBudget } from "../../src/budget/run-budget.js";
import { InteractionTable } from "../../src/interaction/table.js";
import { EMPTY_SETTINGS, type LoadedSettings } from "../../src/permission/settings.js";

const withBudget = (user?: object, project?: object): LoadedSettings => ({
  ...EMPTY_SETTINGS,
  ...(user ? { user: { path: "u", rules: [], budget: user } } : {}),
  ...(project ? { project: { path: "p", rules: [], budget: project } } : {}),
});

afterEach(() => vi.useRealTimers());

describe("resolveBudget", () => {
  it("prefers project over user over environment over defaults, per field", () => {
    expect(resolveBudget(EMPTY_SETTINGS, {})).toEqual({ maxTurns: 50, maxMinutes: 20 });
    expect(resolveBudget(EMPTY_SETTINGS, { GLAUX_AGENT_MAX_TURNS: "8", GLAUX_AGENT_MAX_MINUTES: "3" })).toEqual({ maxTurns: 8, maxMinutes: 3 });
    expect(resolveBudget(withBudget({ max_turns: 9 }), { GLAUX_AGENT_MAX_TURNS: "8", GLAUX_AGENT_MAX_MINUTES: "3" })).toEqual({ maxTurns: 9, maxMinutes: 3 });
    expect(resolveBudget(withBudget({ max_turns: 9 }, { max_turns: 2 }), {})).toEqual({ maxTurns: 2, maxMinutes: 20 });
  });

  it("falls back past out-of-range environment values", () => {
    expect(resolveBudget(EMPTY_SETTINGS, { GLAUX_AGENT_MAX_TURNS: "0", GLAUX_AGENT_MAX_MINUTES: "999" })).toEqual({ maxTurns: 50, maxMinutes: 20 });
  });
});

describe("RunBudget", () => {
  const make = (overrides: Partial<ConstructorParameters<typeof RunBudget>[0]> = {}) => {
    const onAbort = vi.fn();
    const budget = new RunBudget({ limits: { maxTurns: 3, maxMinutes: 10 }, waitedMs: () => 0, onAbort, ...overrides });
    return { budget, onAbort };
  };

  it("enters wind-down on the turn after the limit and aborts after the grace turns", () => {
    const { budget, onAbort } = make();
    for (let i = 0; i < 3; i += 1) budget.onTurnStart();
    expect(budget.check()).toBe(false);
    budget.onTurnStart(); // 第 4 回合
    expect(budget.exhausted).toBe(true);
    expect(budget.blockReason()).toMatch(/Do not call any more tools/u);
    budget.onTurnStart();
    budget.onTurnStart();
    expect(onAbort).not.toHaveBeenCalled();
    budget.onTurnStart(); // 第 7 回合：4 + 3
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(budget.abortedByBudget).toBe(true);
    budget.dispose();
  });

  it("hits the time limit without any tool call and aborts after the grace period", () => {
    vi.useFakeTimers();
    const { budget, onAbort } = make({ limits: { maxTurns: 50, maxMinutes: 1 } });
    vi.advanceTimersByTime(60_000);
    expect(budget.exhausted).toBe(true);
    vi.advanceTimersByTime(119_000);
    expect(onAbort).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("does not count time spent waiting for the user", () => {
    vi.useFakeTimers();
    let waited = 0;
    const { budget } = make({ limits: { maxTurns: 50, maxMinutes: 1 }, waitedMs: () => waited });
    vi.advanceTimersByTime(50_000);
    waited = 30_000;
    vi.advanceTimersByTime(20_000);
    expect(budget.exhausted).toBe(false);
    expect(budget.elapsedMs()).toBe(40_000);
    vi.advanceTimersByTime(21_000);
    expect(budget.exhausted).toBe(true);
    budget.dispose();
  });
});

describe("InteractionTable.waitedMs", () => {
  it("counts overlapping waits once and includes open waits", async () => {
    let now = 0;
    const table = new InteractionTable({ emit: () => undefined, now: () => now });
    const input = { session_id: "s", command_id: "c", kind: "question" as const, question: { question: "q", options: [], allow_free_text: true } };
    const first = table.create(input);
    now = 10;
    void table.create(input);
    now = 30;
    const [a] = table.pending("s");
    table.reply("s", a!.request_id, { kind: "question", text: "x" });
    await first;
    expect(table.waitedMs("s", "c")).toBe(30);
    now = 50;
    expect(table.waitedMs("s", "c")).toBe(50);
    table.cancelCommand("s", "c");
    now = 80;
    expect(table.waitedMs("s", "c")).toBe(50);
    table.forgetCommand("s", "c");
    expect(table.waitedMs("s", "c")).toBe(0);
  });
});
