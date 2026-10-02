/**
 * SDD 15 §7.8：命令运行预算。
 *
 * 回合数或时长达到上限后进入收尾：此后的工具调用一律拦截，要求模型基于已有结果作答；
 * 收尾再过 3 回合或 2 分钟仍未结束，中止命令，结局记为 `budget_exceeded`。
 * 时长扣除等待用户回复的时间。
 */
import type { LoadedSettings } from "../permission/settings.js";

export const DEFAULT_MAX_TURNS = 50;
export const DEFAULT_MAX_MINUTES = 20;
export const GRACE_TURNS = 3;
export const GRACE_MS = 2 * 60 * 1000;

export interface BudgetLimits {
  maxTurns: number;
  maxMinutes: number;
}

function inRange(value: unknown, min: number, max: number): number | undefined {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** 优先级：项目级设置 > 用户级设置 > 环境变量 > 默认值；越界值逐级回退（§7.8 规则 4）。 */
export function resolveBudget(settings: LoadedSettings, env: NodeJS.ProcessEnv = process.env): BudgetLimits {
  return {
    maxTurns: settings.project?.budget.max_turns ?? settings.user?.budget.max_turns
      ?? inRange(env.GLAUX_AGENT_MAX_TURNS, 1, 500) ?? DEFAULT_MAX_TURNS,
    maxMinutes: settings.project?.budget.max_minutes ?? settings.user?.budget.max_minutes
      ?? inRange(env.GLAUX_AGENT_MAX_MINUTES, 1, 240) ?? DEFAULT_MAX_MINUTES,
  };
}

export interface RunBudgetOptions {
  limits: BudgetLimits;
  /** 本命令已等待用户回复的时长（毫秒），含仍在等待中的部分。 */
  waitedMs: () => number;
  /** 宽限用尽时调用；实现方不得在回调内同步等待 harness 空闲。 */
  onAbort: () => void;
  now?: () => number;
  graceTurns?: number;
  graceMs?: number;
}

export class RunBudget {
  turns = 0;
  exhausted = false;
  abortedByBudget = false;
  private exhaustedAtTurn = 0;
  private readonly startedAt: number;
  private readonly now: () => number;
  private deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: RunBudgetOptions) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.scheduleDeadline();
  }

  get limits(): BudgetLimits {
    return this.options.limits;
  }

  elapsedMs(): number {
    return Math.max(0, this.now() - this.startedAt - this.options.waitedMs());
  }

  /** pi `turn_start`：计数并检查回合上限与收尾宽限。 */
  onTurnStart(): void {
    this.turns += 1;
    this.check();
    if (this.exhausted && this.turns >= this.exhaustedAtTurn + (this.options.graceTurns ?? GRACE_TURNS)) this.abort();
  }

  /** 返回是否已进入收尾。 */
  check(): boolean {
    if (this.exhausted) return true;
    if (this.turns > this.options.limits.maxTurns || this.elapsedMs() >= this.options.limits.maxMinutes * 60_000) {
      this.exhausted = true;
      this.exhaustedAtTurn = Math.max(this.turns, 1);
      clearTimeout(this.deadlineTimer);
      this.graceTimer = setTimeout(() => this.abort(), this.options.graceMs ?? GRACE_MS);
      this.graceTimer.unref?.();
    }
    return this.exhausted;
  }

  blockReason(): string {
    const { maxTurns, maxMinutes } = this.options.limits;
    return `This run reached its budget (${maxTurns} turns / ${maxMinutes} minutes). Do not call any more tools. ` +
      "Answer now from the results you already have, and say which parts are unfinished.";
  }

  dispose(): void {
    clearTimeout(this.deadlineTimer);
    clearTimeout(this.graceTimer);
  }

  private abort(): void {
    if (this.abortedByBudget) return;
    this.abortedByBudget = true;
    this.dispose();
    this.options.onAbort();
  }

  /** 时长上限不依赖工具调用触发：到点复查，等待时间使到期推后则重新计时。 */
  private scheduleDeadline(): void {
    const remaining = this.options.limits.maxMinutes * 60_000 - this.elapsedMs();
    this.deadlineTimer = setTimeout(() => {
      if (!this.check()) this.scheduleDeadline();
    }, Math.max(remaining, 1_000));
    this.deadlineTimer.unref?.();
  }
}
