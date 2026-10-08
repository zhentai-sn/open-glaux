/**
 * SDD 24 §7.4 规则 1：Windows 上 `bash` 工具使用 Git for Windows 的 `bash.exe`。
 *
 * pi 在 Windows 上找不到 `Program Files\Git` 时会退回 `where bash.exe`，可能命中
 * `C:\Windows\System32\bash.exe`（WSL），命令就跑进了另一套文件系统。这里显式解析 Git Bash，
 * 找不到时返回一个说明安装方法的路径，pi 执行时报 `shell_unavailable` 并带上这句话。
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export const MISSING_GIT_BASH =
  "Git Bash not found. Install Git for Windows (winget install Git.Git) or set GLAUX_BASH to bash.exe";

function gitRootsOnPath(): string[] {
  try {
    const output = execFileSync("where", ["git.exe"], { encoding: "utf8", windowsHide: true, timeout: 5_000 });
    // <Git>\cmd\git.exe 或 <Git>\mingw64\bin\git.exe → <Git>
    return output
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((git) => {
        const dir = dirname(git);
        return /\\mingw64\\bin$/iu.test(dir) ? dirname(dirname(dir)) : dirname(dir);
      });
  } catch {
    return [];
  }
}

let cached: string | undefined;

/** 进程内缓存的 {@link resolveShellPath}；Git 安装位置在运行期间不变。 */
export function shellPath(): string | undefined {
  if (process.platform !== "win32") return undefined;
  cached ??= resolveShellPath();
  return cached;
}

/** 非 Windows 返回 undefined，沿用 pi 的查找顺序（`/bin/bash` → PATH）。 */
export function resolveShellPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string | undefined {
  if (platform !== "win32") return undefined;
  const explicit = env.GLAUX_BASH?.trim();
  if (explicit) return explicit;
  const roots = [
    env.ProgramFiles && join(env.ProgramFiles, "Git"),
    env["ProgramFiles(x86)"] && join(env["ProgramFiles(x86)"], "Git"),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, "Programs", "Git"),
    ...gitRootsOnPath(),
  ].filter((root): root is string => Boolean(root));
  for (const root of roots) {
    const bash = join(root, "bin", "bash.exe");
    if (existsSync(bash)) return bash;
  }
  return MISSING_GIT_BASH;
}

/** 供 `NodeExecutionEnv` 展开的选项：非 Windows 为空对象。 */
export function shellPathOption(): { shellPath: string } | Record<string, never> {
  const path = shellPath();
  return path ? { shellPath: path } : {};
}
