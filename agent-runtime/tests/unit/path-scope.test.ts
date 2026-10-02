/** SDD 16 §7.2：路径范围——工作目录之外（跟随符号链接）与隐藏路径。 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolvePathScope } from "../../src/workspace/path-scope.js";

let root: string;
let cwd: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "glaux-scope-"));
  cwd = join(root, "project");
  await mkdir(join(cwd, "reports"), { recursive: true });
  await writeFile(join(cwd, "reports", "a.md"), "x");
  await mkdir(join(root, "outside"));
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("resolvePathScope", () => {
  it("keeps ordinary relative and absolute paths inside the working directory", async () => {
    expect(await resolvePathScope(cwd, "reports/a.md")).toMatchObject({ subject: "reports/a.md", sensitive: false });
    expect(await resolvePathScope(cwd, join(cwd, "reports", "a.md"))).toMatchObject({ subject: "reports/a.md", sensitive: false });
    expect(await resolvePathScope(cwd, "@reports/new/deep/file.txt")).toMatchObject({ subject: "reports/new/deep/file.txt", sensitive: false });
  });

  it("marks paths that leave the working directory", async () => {
    const parent = await resolvePathScope(cwd, "../outside/x.txt");
    expect(parent).toMatchObject({ outside: true, sensitive: true });
    expect(parent.subject).toMatch(/outside[/\\]x\.txt$/u);
    expect(await resolvePathScope(cwd, "/etc/hosts")).toMatchObject({ outside: true, sensitive: true });
  });

  it("follows symlinks that point outside", async () => {
    await symlink(join(root, "outside"), join(cwd, "link"));
    expect(await resolvePathScope(cwd, "link/secret.txt")).toMatchObject({ outside: true, sensitive: true });
  });

  it("marks hidden segments as sensitive but still inside", async () => {
    expect(await resolvePathScope(cwd, ".env")).toMatchObject({ subject: ".env", hidden: true, outside: false, sensitive: true });
    expect(await resolvePathScope(cwd, "src/.git/config")).toMatchObject({ hidden: true, sensitive: true });
    expect(await resolvePathScope(cwd, "./reports/../reports/a.md")).toMatchObject({ hidden: false, sensitive: false });
  });
});
