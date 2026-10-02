/** SDD 15 §7.4、§7.5：模式默认全表与判定顺序。 */
import { describe, expect, it } from "vitest";

import type { PermissionMode } from "../../src/contracts.js";
import { decide, globMatch, mountable, type PermissionRule } from "../../src/permission/decide.js";
import { TOOL_EFFECTS, type ToolEffect } from "../../src/plugins/types.js";

const EXPECTED: Record<PermissionMode, Record<ToolEffect, "allow" | "ask" | "deny">> = {
  observe: { read: "allow", annotate: "deny", compute: "deny", egress: "deny", write: "deny", exec: "deny", delegate: "deny" },
  suggest: { read: "allow", annotate: "allow", compute: "ask", egress: "ask", write: "ask", exec: "deny", delegate: "ask" },
  controlled: { read: "allow", annotate: "allow", compute: "allow", egress: "allow", write: "allow", exec: "deny", delegate: "allow" },
  autonomous: { read: "allow", annotate: "allow", compute: "allow", egress: "allow", write: "allow", exec: "allow", delegate: "allow" },
};

const base = { tool: "t", rules: [] as PermissionRule[], grants: new Set<string>() };

describe("mode defaults", () => {
  for (const mode of Object.keys(EXPECTED) as PermissionMode[]) {
    it(`${mode} matches the §7.4 table`, () => {
      const actual = Object.fromEntries(TOOL_EFFECTS.map((effect) => [effect, decide({ ...base, effect, mode }).decision]));
      expect(actual).toEqual(EXPECTED[mode]);
    });
  }

  it("asks for writes outside the project directory in controlled mode only", () => {
    expect(decide({ ...base, effect: "write", mode: "controlled", outsideCwd: true }).decision).toBe("ask");
    expect(decide({ ...base, effect: "write", mode: "autonomous", outsideCwd: true }).decision).toBe("allow");
  });

  it("does not mount exec below autonomous, nor anything but read in observe", () => {
    expect(mountable("exec", "controlled")).toBe(false);
    expect(mountable("exec", "autonomous")).toBe(true);
    expect(TOOL_EFFECTS.filter((effect) => mountable(effect, "observe"))).toEqual(["read"]);
  });
});

describe("decision order", () => {
  it("deny rules win over allow rules, grants and autonomous mode", () => {
    const verdict = decide({
      ...base, tool: "run_task", effect: "compute", mode: "autonomous", grants: new Set(["run_task"]),
      rules: [{ tool: "run_task", decision: "allow" }, { tool: "*", decision: "deny" }],
    });
    expect(verdict).toMatchObject({ decision: "deny", basis: "rule", rule: { tool: "*", decision: "deny" } });
  });

  it("ask rules cannot be bypassed by a session grant", () => {
    const verdict = decide({ ...base, tool: "run_task", effect: "compute", mode: "controlled", grants: new Set(["run_task"]), rules: [{ tool: "run_task", decision: "ask" }] });
    expect(verdict).toMatchObject({ decision: "ask", basis: "rule" });
  });

  it("allow rules and grants skip the mode default", () => {
    expect(decide({ ...base, tool: "run_task", effect: "compute", mode: "suggest", rules: [{ tool: "run_task", decision: "allow" }] }))
      .toMatchObject({ decision: "allow", basis: "rule" });
    expect(decide({ ...base, tool: "run_task", effect: "compute", mode: "suggest", grants: new Set(["run_task"]) }))
      .toMatchObject({ decision: "allow", basis: "grant" });
  });

  it("rules cannot mount a tool the mode does not mount", () => {
    expect(decide({ ...base, tool: "bash", effect: "exec", mode: "controlled", rules: [{ tool: "bash", decision: "allow" }] }).decision).toBe("deny");
  });

  it("pattern rules only match tools that expose a subject", () => {
    const rules: PermissionRule[] = [{ tool: "write", pattern: "reports/**", decision: "deny" }];
    expect(decide({ ...base, tool: "write", effect: "write", mode: "controlled", rules }).decision).toBe("allow");
    expect(decide({ ...base, tool: "write", effect: "write", mode: "controlled", rules, subject: "reports/a/b.md" }).decision).toBe("deny");
  });
});

describe("globMatch", () => {
  it("treats * as one segment and ** as any depth", () => {
    expect(globMatch("*.md", "a.md")).toBe(true);
    expect(globMatch("*.md", "x/a.md")).toBe(false);
    expect(globMatch("**/*.md", "x/y/a.md")).toBe(true);
    expect(globMatch("a.(md)", "a.(md)")).toBe(true);
  });
});
