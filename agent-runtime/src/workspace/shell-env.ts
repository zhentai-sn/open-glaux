/** SDD 16 §7.5 规则 2：`bash` 的环境变量白名单；新增的凭据变量默认不透传（D-6）。 */
export const SHELL_ENV_ALLOWLIST = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "TZ",
] as const;

/**
 * Windows 进程运行所需的系统变量（SDD 24 §7.4）：缺 `SYSTEMROOT` 等时 Git Bash 与多数程序无法启动。
 * 只含系统路径，不含凭据。
 */
export const WINDOWS_SHELL_ENV_ALLOWLIST = [
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE",
] as const;

export function buildShellEnv(
  cwd: string,
  source: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  const names = platform === "win32" ? [...SHELL_ENV_ALLOWLIST, ...WINDOWS_SHELL_ENV_ALLOWLIST] : SHELL_ENV_ALLOWLIST;
  for (const name of names) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  env.GLAUX_CWD = cwd;
  return env;
}
