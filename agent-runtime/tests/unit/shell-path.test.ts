/** SDD 24 §7.4：Windows 上的 bash 解析与系统环境变量。 */
import { describe, expect, it, vi } from "vitest";

// 缺失场景须隔离宿主的 Git 安装；Windows CI 的 PATH 默认含 Git for Windows。
vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => { throw new Error("git not found"); }) }));

import { buildShellEnv } from "../../src/workspace/shell-env.js";
import { MISSING_GIT_BASH, resolveShellPath } from "../../src/workspace/shell-path.js";

describe("resolveShellPath", () => {
  it("leaves non-Windows platforms to pi", () => {
    expect(resolveShellPath({ GLAUX_BASH: "/opt/bash" }, "linux")).toBeUndefined();
  });

  it("prefers GLAUX_BASH on Windows", () => {
    expect(resolveShellPath({ GLAUX_BASH: "D:\Git\bin\bash.exe" }, "win32")).toBe("D:\Git\bin\bash.exe");
  });

  it("explains how to install Git Bash when none is found", () => {
    expect(resolveShellPath({ ProgramFiles: "/nonexistent" }, "win32")).toBe(MISSING_GIT_BASH);
  });
});

describe("buildShellEnv on Windows", () => {
  const source = { PATH: "C:\bin", SYSTEMROOT: "C:\Windows", TEMP: "C:\Temp", OPENAI_API_KEY: "sk-test" };

  it("passes system variables that Windows programs need", () => {
    const env = buildShellEnv("C:\work", source, "win32");
    expect(env).toMatchObject({ PATH: "C:\bin", SYSTEMROOT: "C:\Windows", TEMP: "C:\Temp", GLAUX_CWD: "C:\work" });
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("keeps the POSIX allowlist unchanged elsewhere", () => {
    expect(buildShellEnv("/work", source, "linux").SYSTEMROOT).toBeUndefined();
  });
});
