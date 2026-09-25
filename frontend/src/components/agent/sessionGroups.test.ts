// SDD 13 §7.4 规则 1～4：分组顺序、同名消歧、已移除组、只读判定。
import { describe, expect, it } from "vitest";

import type { SessionListItem } from "../../agent/runtime/types";
import type { ProjectView } from "../../api/types";
import { UNASSIGNED } from "../../store/projects";
import { buildSessionGroups, projectWritable } from "./sessionGroups";

const session = (id: string, projectId: string | null, updated: string): SessionListItem => ({
  session_id: id,
  title: id,
  status: "active",
  permission_mode: "controlled",
  provider: null,
  model: null,
  phase: "idle",
  context_usage: null,
  created_at: updated,
  updated_at: updated,
  project_id: projectId,
});

const project = (id: string, name: string, display: string, created: string, status: "ok" | "missing" = "ok"): ProjectView => ({
  id,
  name,
  path: display,
  display_path: display,
  created_at: created,
  status,
});

describe("buildSessionGroups", () => {
  it("有会话的项目按最近会话倒序，其后空项目按登记倒序，再是未归属与已移除", () => {
    const projects = [
      project("a", "a", "/x/a", "2026-01-01"),
      project("b", "b", "/x/b", "2026-01-02"),
      project("c", "c", "/x/c", "2026-01-03"),
      project("d", "d", "/x/d", "2026-01-04"),
    ];
    const sessions = [
      session("s1", "a", "2026-02-03"),
      session("s2", "b", "2026-02-05"),
      session("s3", null, "2026-02-09"),
      session("s4", "gone", "2026-02-01"),
    ];
    const groups = buildSessionGroups(sessions, projects, {
      gone: { name: "old", path: "/x/old", display_path: "/x/old" },
    });
    expect(groups.map((g) => g.id)).toEqual(["b", "a", "d", "c", UNASSIGNED, "gone"]);
    expect(groups[groups.length - 1]).toMatchObject({ kind: "removed", label: "old" });
  });

  it("同名项目追加父目录名", () => {
    const groups = buildSessionGroups(
      [],
      [project("a", "data", "C:\\cases\\data", "2026-01-01"), project("b", "data", "/home/u/data", "2026-01-02")],
      {},
    );
    expect(groups.filter((g) => g.kind === "project").map((g) => g.label).sort()).toEqual(["data · cases", "data · u"]);
  });

  it("路径失效的项目标记 missing，且不可发送", () => {
    const projects = [project("a", "a", "/x/a", "2026-01-01", "missing")];
    expect(buildSessionGroups([], projects, {})[0].missing).toBe(true);
    expect(projectWritable("a", projects)).toBe(false);
    expect(projectWritable("gone", projects)).toBe(false);
    expect(projectWritable(null, projects)).toBe(true);
  });
});
