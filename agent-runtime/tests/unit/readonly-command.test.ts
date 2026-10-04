/** SDD 16 §7.5 规则 6：controlled 下 bash 的只读命令判定。 */
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readOnlyViolation } from "../../src/permission/readonly-command.js";

let cwd: string;
let outside: string;
beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "glaux-ro-"));
  outside = await mkdtemp(join(tmpdir(), "glaux-ro-out-"));
  await mkdir(join(cwd, "data"));
  await symlink(outside, join(cwd, "escape"));
});
afterAll(async () => {
  await rm(cwd, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

const check = (command: string) => readOnlyViolation(command, cwd);

describe("readOnlyViolation", () => {
  it.each([
    "ls",
    "ls -la data",
    "find . -maxdepth 2 -type f",
    "find . -name '*.md'",
    "tree -L 2",
    "du -sh data",
    "grep -rn TODO .",
    "rg -n \"needle\" data",
    "cat data/a.txt | head -n 20",
    "find . -type f | sort | uniq -c | head",
    "wc -l data/*.csv",
    "stat data",
    "pwd",
  ])("allows %s", async (command) => {
    await expect(check(command)).resolves.toBeUndefined();
  });

  it("allows absolute paths inside the working directory", async () => {
    await expect(check(`ls ${cwd}/data`)).resolves.toBeUndefined();
  });

  it.each([
    ["ls; rm -rf data", "\";\""],
    ["ls && rm x", "\"&\""],
    ["ls || rm x", "\"||\""],
    ["ls &", "\"&\""],
    ["cat a > b", "\">\""],
    ["sort < a", "\"<\""],
    ["cat $HOME/x", "\"$\""],
    ["cat \"$HOME\"", "inside double quotes"],
    ["echo `id`", "\"`\""],
    ["cat {a,../b}", "\"{\""],
    ["ls\nrm x", "newline"],
    ["(ls)", "\"(\""],
    ["ls ~", "\"~\""],
    ["ls 'unterminated", "unterminated quote"],
  ])("rejects shell syntax in %j", async (command, reason) => {
    await expect(check(command)).resolves.toContain(reason);
  });

  it.each([
    ["rm -rf data", "\"rm\" is not a read-only command"],
    ["ls | xargs rm", "\"xargs\" is not a read-only command"],
    ["/bin/ls", "\"/bin/ls\" is not a read-only command"],
    ["FOO=1 ls", "\"FOO=1\" is not a read-only command"],
    ["git status", "\"git\" is not a read-only command"],
    ["sed -i s/a/b/ x", "\"sed\" is not a read-only command"],
  ])("rejects %j by command name", async (command, reason) => {
    await expect(check(command)).resolves.toBe(reason);
  });

  it.each([
    ["find . -exec rm '{}' \\;", "find -exec"],
    ["find . -name x -delete", "find -delete"],
    ["find . -fprint out", "find -fprint"],
    ["sort -o out data", "sort -o"],
    ["sort -uo out data", "sort -o"],
    ["sort --output=out data", "sort --output"],
    ["sort --compress-program=sh data", "sort --compress-program"],
    ["tree -o out", "tree -o"],
    ["rg --pre ./x needle", "rg --pre"],
    ["file -C -m magic", "file -C"],
    ["uniq in out", "uniq with an output file"],
  ])("rejects options that write or execute in %j", async (command, reason) => {
    await expect(check(command)).resolves.toContain(reason);
  });

  it.each([
    ["cat /etc/passwd", "outside the working directory"],
    ["ls ..", "outside the working directory"],
    ["cat data/../../x", "outside the working directory"],
    ["ls escape", "outside the working directory"],
    ["cat .env", "hidden path"],
    ["ls .git", "hidden path"],
    ["cat */.env", "hidden path"],
    ["cat .*", "hidden path"],
  ])("rejects paths outside or hidden in %j", async (command, reason) => {
    await expect(check(command)).resolves.toContain(reason);
  });

  it("rejects an empty command or an empty pipeline segment", async () => {
    await expect(check("   ")).resolves.toBe("empty command");
    await expect(check("ls |")).resolves.toContain("empty pipeline segment");
    await expect(check("| ls")).resolves.toContain("empty pipeline segment");
  });
});
