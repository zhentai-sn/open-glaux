/** SDD 16 §7.5 规则 2：`bash` 的环境变量白名单；新增的凭据变量默认不透传（D-6）。 */
export const SHELL_ENV_ALLOWLIST = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR", "TZ",
] as const;

export function buildShellEnv(cwd: string, source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of SHELL_ENV_ALLOWLIST) {
    const value = source[name];
    if (value !== undefined) env[name] = value;
  }
  env.GLAUX_CWD = cwd;
  return env;
}
