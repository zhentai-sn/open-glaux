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

  it("asks for sensitive reads and writes below autonomous (SDD 16 §7.2)", () => {
    const sensitive = (effect: "read" | "write", mode: PermissionMode) => decide({ ...base, effect, mode, sensitive: true }).decision;
    expect([sensitive("read", "observe"), sensitive("read", "suggest"), sensitive("read", "controlled"), sensitive("read", "autonomous")])
      .toEqual(["ask", "ask", "ask", "allow"]);
    expect([sensitive("write", "observe"), sensitive("write", "suggest"), sensitive("write", "controlled"), sensitive("write", "autonomous")])
      .toEqual(["deny", "ask", "ask", "allow"]);
  });

  it("does not let grants or pattern-less allow rules cover sensitive paths", () => {
    const common = { ...base, tool: "write", effect: "write" as const, mode: "controlled" as const, sensitive: true, subject: ".env" };
    expect(decide({ ...common, grants: new Set(["write"]) }).decision).toBe("ask");
    expect(decide({ ...common, rules: [{ tool: "write", decision: "allow" }] }).decision).toBe("ask");
    expect(decide({ ...common, rules: [{ tool: "write", pattern: ".env", decision: "allow" }] }).decision).toBe("allow");
  });

  it("uses a tool's own pattern matcher", () => {
    const prefix = (pattern: string, subject: string) => subject.trim().startsWith(pattern.trim());
    const rules: PermissionRule[] = [{ tool: "bash", pattern: "git status", decision: "allow" }];
    const verdict = (subject: string) => decide({ ...base, tool: "bash", effect: "exec", mode: "autonomous", rules, subject, match: prefix });
    expect(verdict("git status -s")).toMatchObject({ basis: "rule" });
    expect(verdict("git push")).toMatchObject({ basis: "mode" });
  });

  it("mounts exec only from controlled up, and nothing but read in observe", () => {
    expect(mountable("exec", "suggest")).toBe(false);
    expect(mountable("exec", "controlled")).toBe(true);
    expect(mountable("exec", "autonomous")).toBe(true);
    expect(TOOL_EFFECTS.filter((effect) => mountable(effect, "observe"))).toEqual(["read"]);
  });

  // SDD 16 §7.5 规则 6：controlled 下 exec 只放行只读调用，allow 规则与会话授权都不能越过
  it("allows only read-only exec calls in controlled mode", () => {
    const exec = { ...base, tool: "bash", effect: "exec" as const, mode: "controlled" as const };
    expect(decide({ ...exec, readOnly: true })).toEqual({ decision: "allow", basis: "mode" });
    expect(decide({ ...exec, readOnly: false })).toEqual({ decision: "deny", basis: "mode" });
    expect(decide({ ...exec, rules: [{ tool: "bash", decision: "allow" }], grants: new Set(["bash"]) })).toMatchObject({ decision: "deny", basis: "mode" });
    expect(decide({ ...exec, readOnly: true, rules: [{ tool: "bash", decision: "ask" }] })).toMatchObject({ decision: "ask", basis: "rule" });
    expect(decide({ ...exec, mode: "autonomous", readOnly: false })).toEqual({ decision: "allow", basis: "mode" });
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
