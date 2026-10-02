/** SDD 15 §9.2、§13、D-15：设置文件的读取、校验与「总是允许」写入。 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendAllowRule, loadSettings, projectSettingsPath, readSettingsFile } from "../../src/permission/settings.js";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "glaux-settings-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("readSettingsFile", () => {
  it("treats a missing file as no settings without a warning", async () => {
    expect(await readSettingsFile(join(dir, "none.json"))).toEqual({ file: null });
  });

  it("ignores invalid JSON and wrong structure with a warning", async () => {
    const bad = join(dir, "bad.json");
    await writeFile(bad, "{ nope");
    expect((await readSettingsFile(bad)).warning).toMatchObject({ code: "settings_invalid", path: bad });
    await writeFile(bad, JSON.stringify({ permissions: { rules: [{ tool: "run_task", decision: "maybe" }] } }));
    expect((await readSettingsFile(bad)).warning?.message).toMatch(/decision must be allow, deny or ask/u);
    await writeFile(bad, JSON.stringify({ budget: { max_turns: "50" } }));
    expect((await readSettingsFile(bad)).file).toBeNull();
  });

  it("drops out-of-range budget values but keeps the rest of the file", async () => {
    const path = join(dir, "ok.json");
    await writeFile(path, JSON.stringify({
      permissions: { rules: [{ tool: "segment_region", decision: "deny" }, { tool: "write", pattern: "*.md", decision: "allow" }] },
      budget: { max_turns: 900, max_minutes: 30 },
      unknown: true,
    }));
    expect((await readSettingsFile(path)).file).toEqual({
      path,
      rules: [{ tool: "segment_region", decision: "deny" }, { tool: "write", pattern: "*.md", decision: "allow" }],
      budget: { max_minutes: 30 },
      skillsDisabled: [],
    });
  });
});

describe("loadSettings", () => {
  it("reads user and project levels and reports warnings per file", async () => {
    const home = join(dir, "home");
    const project = join(dir, "project");
    await appendAllowRule(join(home, "settings.json"), "run_task");
    await appendAllowRule(projectSettingsPath(project), "locate_roi");
    await writeFile(join(home, "settings.json"), "[]");
    const loaded = await loadSettings({ projectDir: project, env: { GLAUX_HOME: home } });
    expect(loaded.user).toBeNull();
    expect(loaded.project?.rules).toEqual([{ tool: "locate_roi", decision: "allow" }]);
    expect(loaded.warnings).toEqual([expect.objectContaining({ code: "settings_invalid", path: join(home, "settings.json") })]);
  });
});

describe("appendAllowRule", () => {
  it("creates the file, keeps unknown fields and does not duplicate rules", async () => {
    const path = join(dir, "nested", "settings.json");
    await appendAllowRule(path, "run_task");
    await writeFile(path, JSON.stringify({ theme: "dark", permissions: { rules: [{ tool: "run_task", decision: "allow" }], extra: 1 } }));
    await appendAllowRule(path, "run_task");
    await appendAllowRule(path, "locate_roi");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      theme: "dark",
      permissions: { extra: 1, rules: [{ tool: "run_task", decision: "allow" }, { tool: "locate_roi", decision: "allow" }] },
    });
  });

  it("refuses to overwrite an invalid file", async () => {
    const path = join(dir, "settings.json");
    await writeFile(path, "{ broken");
    await expect(appendAllowRule(path, "run_task")).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("{ broken");
  });
});
