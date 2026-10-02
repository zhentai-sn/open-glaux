/** SDD 17 §7.1、§7.2：资源加载、同名覆盖、停用、说明截断与系统提示词段。 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadResources, MAX_INSTRUCTIONS_BYTES } from "../../src/resources/load.js";

let root: string;
let home: string;
let builtin: string;
let project: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "glaux-res-"));
  home = join(root, "home");
  builtin = join(root, "builtin");
  project = join(root, "project");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function skill(dir: string, name: string, description: string, extra = "") {
  await mkdir(join(dir, name), { recursive: true });
  await writeFile(join(dir, name, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n${extra}---\n\nBody of ${name}.\n`);
}

const load = (options: { project?: boolean; disabled?: string[] } = {}) => loadResources({
  env: { GLAUX_HOME: home },
  builtinSkillsDir: builtin,
  ...(options.project ? { projectDir: project } : {}),
  ...(options.disabled ? { disabledSkills: options.disabled } : {}),
});

describe("loadResources", () => {
  it("keeps the highest-priority skill of a name and marks the rest overridden", async () => {
    await skill(builtin, "imt", "builtin imt");
    await skill(join(home, "skills"), "imt", "user imt");
    await skill(join(project, ".glaux", "skills"), "imt", "project imt");
    const loaded = await load({ project: true });
    expect(loaded.harnessSkills.map((s) => s.description)).toEqual(["project imt"]);
    expect(loaded.skills.map((s) => [s.source, s.overridden_by ?? null])).toEqual([
      ["builtin", "project"], ["user", "project"], ["project", null],
    ]);
    expect(loaded.readableRoots).toEqual([builtin, join(home, "skills"), join(project, ".glaux", "skills")]);
  });

  it("ignores project resources when the session has no project directory", async () => {
    await skill(join(project, ".glaux", "skills"), "only-project", "p");
    expect((await load()).skills).toEqual([]);
  });

  it("drops disabled skills from the harness and hides manual-only ones from the catalog", async () => {
    await skill(join(home, "skills"), "off", "disabled one");
    await skill(join(home, "skills"), "manual", "manual only", "disable-model-invocation: true\n");
    await skill(join(home, "skills"), "auto", "model may use it");
    const loaded = await load({ disabled: ["off"] });
    expect(loaded.harnessSkills.map((s) => s.name).sort()).toEqual(["auto", "manual"]);
    expect(loaded.skills.find((s) => s.name === "off")).toMatchObject({ enabled: false });
    expect(loaded.skills.find((s) => s.name === "manual")).toMatchObject({ model_invocable: false });
    expect(loaded.promptExtras).toContain("<name>auto</name>");
    expect(loaded.promptExtras).not.toContain("<name>manual</name>");
    expect(loaded.promptExtras).not.toContain("<name>off</name>");
  });

  it("reports invalid skill files without failing", async () => {
    await mkdir(join(home, "skills", "broken"), { recursive: true });
    await writeFile(join(home, "skills", "broken", "SKILL.md"), "---\nname: broken\n---\nno description\n");
    const loaded = await load();
    expect(loaded.diagnostics.length).toBeGreaterThan(0);
    expect(loaded.diagnostics[0]).toMatchObject({ source: "user" });
  });

  it("adds user then project instructions, truncating oversized files", async () => {
    await mkdir(home, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(home, "GLAUX.md"), "Answer in Chinese.");
    await writeFile(join(project, "GLAUX.md"), "x".repeat(MAX_INSTRUCTIONS_BYTES + 10));
    const loaded = await load({ project: true });
    const user = loaded.promptExtras.indexOf('<instructions scope="user">');
    const proj = loaded.promptExtras.indexOf('<instructions scope="project">');
    expect(user).toBeGreaterThanOrEqual(0);
    expect(proj).toBeGreaterThan(user);
    expect(loaded.promptExtras).toContain("[truncated: the file exceeds 32768 bytes]");
    expect(loaded.instructions).toEqual([
      { scope: "user", path: join(home, "GLAUX.md"), exists: true, bytes: 18 },
      { scope: "project", path: join(project, "GLAUX.md"), exists: true, bytes: MAX_INSTRUCTIONS_BYTES + 10 },
    ]);
  });

  it("loads templates with project overriding user", async () => {
    await mkdir(join(home, "prompts"), { recursive: true });
    await mkdir(join(project, ".glaux", "prompts"), { recursive: true });
    await writeFile(join(home, "prompts", "review.md"), "---\ndescription: user review\n---\nReview $1");
    await writeFile(join(project, ".glaux", "prompts", "review.md"), "Project review $ARGUMENTS");
    const loaded = await load({ project: true });
    expect(loaded.harnessTemplates.map((t) => t.content)).toEqual(["Project review $ARGUMENTS"]);
    expect(loaded.templates.find((t) => t.source === "user")).toMatchObject({ overridden_by: "project", description: "user review" });
  });

  it("produces no prompt extras when nothing exists", async () => {
    expect((await load({ project: true })).promptExtras).toBe("");
  });
});
